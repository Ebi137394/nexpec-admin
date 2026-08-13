-- ════════════════════════════════════════════════════════════════════════════
--  20260801460000_reviewer_eligibility_and_round_binding.sql
--
--  Lane G P1s 1–3. All three are authorisation defects in the Senior Review
--  path, so they land together.
--
--  ── P1-1: ASSIGNMENT ACCEPTED ANY UUID ─────────────────────────────────────
--  nx_admin_assign_senior_reviewer took p_reviewer_id on trust. The ONLY filter
--  was the Admin UI's roster query (seniorReviewData.ts:75, `.eq('role','senior')`),
--  which is a convenience, not a control — the RPC is reachable directly. An
--  Admin could assign the job's own client, a supplier, or a deactivated account,
--  and that account then legitimately passed nx_senior_review_decide.
--
--  Eligibility is checked against the EXISTING canonical architecture — no new
--  reviewer taxonomy is invented: profiles.role = 'senior' is the platform's
--  Senior Inspector authorisation (the same fact the Admin roster reads), and
--  profiles.status = 'active' is the existing deactivation flag.
--
--  ── P1-2: SELF-REVIEW CHECKED ONLY THE PRIMARY AUTHOR ──────────────────────
--  trg_report_senior_reviews_no_self compared only inspection_reports.inspector_id.
--  But a report is authored by a TEAM: nx_report_contributors(uuid)
--  (20260801378000:130) already resolves everyone who contributed inspection
--  items or captures. A co-author who is not the primary inspector could be
--  assigned to review their own team's report.
--
--  Reusing nx_report_contributors is deliberate — it is the canonical
--  contributor set (team membership + evidence attribution + item attribution),
--  so this cannot drift from whatever the platform means by "contributed".
--  Unrelated Senior Inspectors are unaffected: they appear in no contributor row.
--
--  ── P1-3: A QUEUED DECISION WAS NOT BOUND TO ITS ROUND ─────────────────────
--  nx_senior_review_decide bound to whatever round was LIVE at execution time.
--  Offline, that is exploitable by accident:
--      R assigned round 1 → R queues "approved" → admin supersedes R →
--      S returns it → inspector resubmits → admin assigns round 3 TO R AGAIN →
--      R's device drains → the stale approval decides round 3, a version R
--      never read.
--  p_expected_round pins the decision to the round the reviewer actually saw.
--  It is OPTIONAL so the online path is unchanged, and the offline path always
--  sends it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Canonical eligibility predicate ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_eligible_senior_reviewer(
  p_user_id uuid, p_report_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_role text; v_status text; v_author uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  SELECT role, COALESCE(status, 'active') INTO v_role, v_status
    FROM public.profiles WHERE id = p_user_id;

  -- authorised Senior Inspector, and not deactivated
  IF v_role IS DISTINCT FROM 'senior' THEN RETURN false; END IF;
  IF v_status IS DISTINCT FROM 'active' THEN RETURN false; END IF;

  -- never the primary author
  SELECT inspector_id INTO v_author
    FROM public.inspection_reports WHERE id = p_report_id;
  IF v_author IS NOT NULL AND v_author = p_user_id THEN RETURN false; END IF;

  -- never a DERIVED contributor either (P1-2). nx_report_contributors is the
  -- canonical set: team membership + evidence + inspection-item attribution.
  IF EXISTS (
    SELECT 1 FROM public.nx_report_contributors(p_report_id) c
     WHERE c.inspector_id = p_user_id
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END $fn$;

ALTER FUNCTION public.nx_is_eligible_senior_reviewer(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_eligible_senior_reviewer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_eligible_senior_reviewer(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_is_eligible_senior_reviewer(uuid, uuid) IS
  'Canonical Senior Inspector eligibility for ONE report. Reuses the existing architecture '
  '— profiles.role = ''senior'' (the same fact the Admin roster filters on), '
  'profiles.status = ''active'', and nx_report_contributors() for the derived contributor '
  'set — rather than inventing a reviewer taxonomy. Excludes the primary author AND every '
  'team co-author; unrelated Senior Inspectors are unaffected.';

-- ─── 2. Assignment enforces eligibility ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_assign_senior_reviewer(
  p_report_id uuid, p_reviewer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_jwt_role text; v_uid uuid; v_job uuid; v_round int; v_open uuid;
  v_prev_reviewer uuid;
BEGIN
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  IF v_jwt_role = 'anon' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT job_id INTO v_job FROM public.inspection_reports WHERE id = p_report_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- ADDED 20260801460000 (P1-1, P1-2). Being an Admin authorises you to CHOOSE
  -- a reviewer; it does not make an arbitrary account into one.
  IF NOT public.nx_is_eligible_senior_reviewer(p_reviewer_id, p_report_id) THEN
    RAISE EXCEPTION
      'REVIEWER_NOT_ELIGIBLE: the assignee must be an active Senior Inspector who did not contribute to this report'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, reviewer_id INTO v_open, v_prev_reviewer
    FROM public.report_senior_reviews
   WHERE inspection_report_id = p_report_id
     AND decision IS NULL AND superseded_at IS NULL
   FOR UPDATE;
  IF v_open IS NOT NULL THEN
    UPDATE public.report_senior_reviews
       SET superseded_at = now(), superseded_by = v_uid
     WHERE id = v_open;
  END IF;

  SELECT COALESCE(max(round), 0) + 1 INTO v_round
    FROM public.report_senior_reviews WHERE inspection_report_id = p_report_id;

  INSERT INTO public.report_senior_reviews
    (inspection_report_id, job_id, round, reviewer_id, assigned_by)
  VALUES (p_report_id, v_job, v_round, p_reviewer_id, COALESCE(v_uid, p_reviewer_id));

  UPDATE public.inspection_reports
     SET status = 'in_senior_review'
   WHERE id = p_report_id;

  PERFORM public.nx_notify_lifecycle(
    p_reviewer_id,
    'Report assigned for your review',
    'An Admin has assigned an inspection report to you for Senior Inspector review.',
    'senior_review_assigned',
    '/inspector/reviews/' || p_report_id::text,
    v_job);

  IF v_prev_reviewer IS NOT NULL AND v_prev_reviewer <> p_reviewer_id THEN
    PERFORM public.nx_notify_lifecycle(
      v_prev_reviewer,
      'Review assignment withdrawn',
      'This report has been reassigned to another Senior Inspector. Your round is closed and no longer accepts a decision. The history remains readable.',
      'senior_review_superseded',
      '/inspector/reviews/' || p_report_id::text,
      v_job);
  END IF;

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id,
                            'round', v_round, 'reviewer_id', p_reviewer_id,
                            'superseded_round', v_open IS NOT NULL);
END $fn$;

-- ─── 3. Decisions are bound to the round the reviewer saw ───────────────────
CREATE OR REPLACE FUNCTION public.nx_senior_review_decide(
  p_report_id uuid, p_decision text, p_comments text DEFAULT NULL,
  p_expected_round integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid; v_id uuid; v_reviewer uuid; v_round int;
  v_author uuid; v_job uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','returned') THEN
    RAISE EXCEPTION 'INVALID_DECISION: expected approved or returned, got %', p_decision
      USING ERRCODE = '22000';
  END IF;
  IF p_decision = 'returned'
     AND (p_comments IS NULL OR length(btrim(p_comments)) = 0) THEN
    RAISE EXCEPTION 'RETURN_REQUIRES_COMMENT: say what must change'
      USING ERRCODE = '22000';
  END IF;

  SELECT id, reviewer_id, round INTO v_id, v_reviewer, v_round
    FROM public.report_senior_reviews
   WHERE inspection_report_id = p_report_id
     AND decision IS NULL AND superseded_at IS NULL
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'NO_OPEN_REVIEW: this report has no live Senior Inspector assignment'
      USING ERRCODE = 'P0002';
  END IF;

  -- ADDED 20260801460000 (P1-3). Pin the decision to the round the reviewer
  -- actually read. Without this, a decision composed offline against round 1
  -- could land on round 3 after a supersede/return/resubmit/reassign cycle —
  -- deciding a version of the report the reviewer never saw.
  IF p_expected_round IS NOT NULL AND p_expected_round <> v_round THEN
    RAISE EXCEPTION
      'REVIEW_ROUND_CHANGED: this decision was made against round %, but round % is live now. Re-read the report and decide again.',
      p_expected_round, v_round
      USING ERRCODE = '22000';
  END IF;

  IF v_reviewer <> v_uid THEN
    RAISE EXCEPTION
      'NOT_THE_ASSIGNED_REVIEWER: round % is assigned to another Senior Inspector', v_round
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.report_senior_reviews
     SET decision = p_decision, decided_at = now(), decided_by = v_uid,
         comments = p_comments
   WHERE id = v_id;

  UPDATE public.inspection_reports
     SET status = CASE WHEN p_decision = 'approved'
                       THEN 'senior_approved' ELSE 'returned_to_inspector' END
   WHERE id = p_report_id;

  SELECT inspector_id, job_id INTO v_author, v_job
    FROM public.inspection_reports WHERE id = p_report_id;

  IF p_decision = 'returned' THEN
    PERFORM public.nx_notify_lifecycle(
      v_author,
      'Your report was returned for correction',
      'A Senior Inspector returned your report with comments. Open it to read them and resubmit.',
      'senior_review_returned',
      '/inspector/jobs/' || v_job::text || '/submit-report',
      v_job);
  ELSE
    PERFORM public.nx_notify_lifecycle(
      v_author,
      'Your report passed Senior Inspector review',
      'Your report was approved in review. An Admin performs final delivery to the Client.',
      'senior_review_approved',
      '/inspector/jobs/' || v_job::text || '/submit-report',
      v_job);

    PERFORM public.nx_notify_admins(
      'Report approved and awaiting delivery',
      'A Senior Inspector approved a report. Final delivery to the Client is an Admin action and may still be gated on the remaining funding tranche.',
      'senior_review_approved',
      '/admin/reports',
      v_job);

    IF NOT public.nx_funding_delivery_satisfied(v_job) THEN
      PERFORM public.nx_notify_lifecycle(
        (SELECT client_id FROM public.jobs WHERE id = v_job),
        'Remaining funding required',
        'Your report has passed review. The remaining funding tranche is required before the final signed report can be delivered.',
        'funding_required_final',
        '/client/jobs/' || v_job::text || '/funding',
        v_job);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id,
                            'round', v_round, 'decision', p_decision);
END $fn$;

-- The 3-arg signature is superseded by the 4-arg one above. Postgres treats
-- them as distinct functions, so drop the old one rather than leave two live
-- overloads that could drift.
DROP FUNCTION IF EXISTS public.nx_senior_review_decide(uuid, text, text);

REVOKE ALL ON FUNCTION public.nx_senior_review_decide(uuid, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_senior_review_decide(uuid, text, text, integer)
  TO authenticated, service_role;

-- ─── 4. Self-review trigger covers derived contributors ─────────────────────
CREATE OR REPLACE FUNCTION public.nx_guard_no_self_senior_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_author uuid;
BEGIN
  SELECT inspector_id INTO v_author
    FROM public.inspection_reports WHERE id = NEW.inspection_report_id;

  IF v_author IS NOT NULL AND v_author = NEW.reviewer_id THEN
    RAISE EXCEPTION
      'SELF_REVIEW_FORBIDDEN: a report''s author cannot review it'
      USING ERRCODE = '42501';
  END IF;

  -- WIDENED 20260801460000 (P1-2): a report is authored by a team, and a
  -- co-author reviewing their own team's work is the same conflict.
  IF EXISTS (
    SELECT 1 FROM public.nx_report_contributors(NEW.inspection_report_id) c
     WHERE c.inspector_id = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION
      'SELF_REVIEW_FORBIDDEN: this reviewer contributed to the report (team member, evidence or inspection items) and cannot review it'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $fn$;

-- ─── 5. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='nx_admin_assign_senior_reviewer'
       AND p.prosrc ~* 'nx_is_eligible_senior_reviewer') THEN
    RAISE EXCEPTION 'SELFTEST: assignment does not check reviewer eligibility';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='nx_guard_no_self_senior_review'
       AND p.prosrc ~* 'nx_report_contributors') THEN
    RAISE EXCEPTION 'SELFTEST: the self-review guard still ignores derived contributors';
  END IF;

  IF to_regprocedure('public.nx_senior_review_decide(uuid,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the round-bound decide signature is missing';
  END IF;
  IF to_regprocedure('public.nx_senior_review_decide(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION
      'SELFTEST: the old 3-arg decide overload still exists — a caller could bypass round binding';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
