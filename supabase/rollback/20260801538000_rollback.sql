-- Rollback for 20260801538000_resubmit_reopens_senior_round.sql
-- Restores nx_report_resubmit WITHOUT the round-reopen block.
-- Running this re-opens D21: a resubmitted report is stranded with no open
-- senior round and no notification to anyone.

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


