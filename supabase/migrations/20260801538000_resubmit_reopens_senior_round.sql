-- ════════════════════════════════════════════════════════════════════════════
--  20260801538000_resubmit_reopens_senior_round.sql
--
--  DEFECT D21 (P1, workflow): a resubmitted report was silently stranded.
--
--  nx_report_resubmit flipped inspection_reports.status back to 'submitted' and
--  then tried to notify "the live reviewer":
--
--      (SELECT reviewer_id FROM public.report_senior_reviews
--        WHERE inspection_report_id = p_report_id
--          AND decision IS NULL AND superseded_at IS NULL LIMIT 1)
--
--  but it never opened a new round. The previous round already carried
--  decision='returned', so that subquery matched NOTHING and
--  nx_notify_lifecycle ran with a NULL recipient.
--
--  Reproduced end to end on Staging with the canonical QA report
--  06f77797-b19d-494b-aa3c-ab749fca7348:
--      report status            = submitted
--      open rounds              = 0
--      report_resubmitted notifs= 0
--      Senior UI                = "RETURNED WITH COMMENTS", no decision form
--
--  So the inspector corrects the report, and from then on nobody is told and
--  nobody can act. The lifecycle only continues if an admin independently
--  notices and re-assigns a reviewer by hand.
--
--  FIX: reopen a round for the same reviewer before notifying. See the inline
--  comment for why that reviewer, and why it is retry-safe.
--
--  BLAST RADIUS: nx_report_resubmit only. No existing row is modified — the fix
--  is a guarded INSERT. Signature unchanged, so CREATE OR REPLACE preserves
--  ownership and grants. Rollback: supabase/rollback/20260801538000_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_report_resubmit(p_job_id uuid, p_report_id uuid, p_expected_updated_at timestamp with time zone, p_summary text, p_response_to_reviewer text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid; v_owner uuid; v_status text; v_active boolean; v_hit int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  IF p_summary IS NULL OR length(btrim(p_summary)) = 0 THEN
    RAISE EXCEPTION 'SUMMARY_REQUIRED: a correction must say what changed'
      USING ERRCODE = '22000';
  END IF;

  -- 2. the report must be this caller's own
  SELECT inspector_id, status INTO v_owner, v_status
    FROM public.inspection_reports
   WHERE id = p_report_id AND job_id = p_job_id
   FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'NOT_THE_REPORT_AUTHOR: this report belongs to another inspector'
      USING ERRCODE = '42501';
  END IF;

  -- 3. LIVE CONTRACT — the replacement rule, fails closed
  SELECT public.is_active_contract_inspector(p_job_id, v_uid) INTO v_active;
  IF v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'NOT_ACTIVE_INSPECTOR: you are no longer the assigned inspector on this job, so it can no longer be resubmitted by you. Your review history stays readable.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. it must actually be back with its author
  IF v_status IS DISTINCT FROM 'returned_to_inspector' THEN
    RAISE EXCEPTION
      'NOT_AWAITING_CORRECTION: this report is not awaiting corrections right now (status %)', v_status
      USING ERRCODE = '22000';
  END IF;

  -- 5. optimistic lock — the row has not moved on while this was queued
  UPDATE public.inspection_reports
     SET status     = 'submitted',
         notes      = p_summary,
         updated_at = now()
   WHERE id = p_report_id
     AND inspector_id = v_uid
     AND status = 'returned_to_inspector'
     AND updated_at = p_expected_updated_at;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN
    RAISE EXCEPTION
      'REPORT_CHANGED: this report changed while you were editing — it may have been reassigned or already resubmitted. Nothing was overwritten.'
      USING ERRCODE = '22000';
  END IF;

  -- The reviewer's next round needs the author's response; it is stored on the
  -- report, not on the closed review round, because those rounds are immutable
  -- (nx_guard_senior_review_immutable, 20260801450000).
  IF p_response_to_reviewer IS NOT NULL
     AND length(btrim(p_response_to_reviewer)) > 0 THEN
    UPDATE public.inspection_reports
       SET notes = notes || E'\n\n--- Response to reviewer ---\n' || p_response_to_reviewer
     WHERE id = p_report_id;
  END IF;


  -- ── D21 FIX: reopen a review round ───────────────────────────────────────
  -- Before this, resubmission set the report back to 'submitted' and stopped.
  -- The previous round was already decided ('returned'), and nothing opened a
  -- new one, so:
  --   * the Senior UI offered no decision form (nothing to act on),
  --   * the notification below selected `decision IS NULL AND superseded_at IS
  --     NULL` and matched ZERO rows, so nx_notify_lifecycle was called with a
  --     NULL recipient and notified nobody,
  --   * the report sat at 'submitted' indefinitely until an admin happened to
  --     notice and re-assign a reviewer by hand.
  -- Verified on Staging: 0 open rounds, 0 report_resubmitted notifications.
  --
  -- The correction goes back to the SAME reviewer who returned it — they are
  -- already eligibility-checked (trg_report_senior_reviews_no_self) and they
  -- wrote the comments being answered. `assigned_by` is carried over from the
  -- prior round so the assigning authority is unchanged and truthful.
  --
  -- Guarded on "no open round exists" so a retry cannot create two, and round
  -- numbering follows nx_admin_assign_senior_reviewer (max+1), satisfying
  -- report_senior_reviews_round_uq. Decided rows are never touched, so
  -- nx_guard_senior_review_immutable is not engaged.
  IF NOT EXISTS (
    SELECT 1 FROM public.report_senior_reviews
     WHERE inspection_report_id = p_report_id
       AND decision IS NULL AND superseded_at IS NULL
  ) THEN
    INSERT INTO public.report_senior_reviews
      (inspection_report_id, job_id, round, reviewer_id, assigned_by)
    SELECT p_report_id,
           p_job_id,
           COALESCE(max(r.round), 0) + 1,
           (SELECT reviewer_id  FROM public.report_senior_reviews
             WHERE inspection_report_id = p_report_id
             ORDER BY round DESC LIMIT 1),
           (SELECT assigned_by  FROM public.report_senior_reviews
             WHERE inspection_report_id = p_report_id
             ORDER BY round DESC LIMIT 1)
      FROM public.report_senior_reviews r
     WHERE r.inspection_report_id = p_report_id
    HAVING (SELECT reviewer_id FROM public.report_senior_reviews
             WHERE inspection_report_id = p_report_id
             ORDER BY round DESC LIMIT 1) IS NOT NULL;
  END IF;

  -- Tell the live reviewer their correction has arrived. Pointer only, per the
  -- Lane F privacy rule (20260801452000).
  PERFORM public.nx_notify_lifecycle(
    (SELECT reviewer_id FROM public.report_senior_reviews
      WHERE inspection_report_id = p_report_id
        AND decision IS NULL AND superseded_at IS NULL
      LIMIT 1),
    'A corrected report is ready for your review',
    'The Inspector resubmitted a report you returned. Open it to review the correction.',
    'report_resubmitted',
    '/inspector/reviews/' || p_report_id::text,
    p_job_id);

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'job_id', p_job_id);
END $function$
