-- ════════════════════════════════════════════════════════════════════════════
--  20260801544000_fix_submit_inspection_report_rpc.sql
--
--  DEFECT D24. `submit_inspection_report` was doubly broken:
--
--  1. It ended with `UPDATE jobs SET status='under_review'` — a state
--     `guard_jobs_status_transition` does not have, from ANY state. The guard
--     raises, the whole transaction rolls back, and the RPC can never succeed.
--     (Zero callers today: the web form inserts into inspection_reports
--     directly. Found when the credit-release lane tried the RPC first.)
--
--  2. Worse, it is SECURITY DEFINER with NO authorization check: any
--     authenticated user could upsert a report row onto ANY job. The only
--     reason that was not exploitable is the accident in (1) — the illegal
--     status write aborted the transaction every time, undoing the insert.
--     Fixing (1) without adding authorization would have OPENED the hole.
--
--  The fix mirrors the canonical web path (submitReport.ts):
--    * caller must be the job's contractor, and the job must be
--      assigned/in_progress — the same eligibility the web action enforces;
--    * the report row is inserted with status='pending' (web parity);
--    * jobs.status is NOT touched — report state lives on the report;
--    * resubmission of a pending row updates it (same ON CONFLICT the old
--      body had), but a report already in senior review or beyond is refused.
--
--  Rollback: supabase/rollback/20260801544000_rollback.sql (the broken body,
--  for the record only — restoring it re-breaks the RPC).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_inspection_report(
  p_job_id uuid, p_photo_url text, p_notes text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job RECORD;
  v_existing RECORD;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  SELECT id, status, contractor_id INTO v_job
    FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- the same eligibility the web action enforces
  IF v_job.contractor_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'NOT_THE_ASSIGNED_INSPECTOR: only the job''s contractor may submit its report'
      USING ERRCODE = '42501';
  END IF;
  IF v_job.status NOT IN ('assigned','in_progress') THEN
    RAISE EXCEPTION 'JOB_NOT_ACTIVE: reports can be submitted while the job is assigned or in_progress (now %)', v_job.status
      USING ERRCODE = '22000';
  END IF;

  SELECT id, status INTO v_existing
    FROM public.inspection_reports
   WHERE job_id = p_job_id AND inspector_id = v_uid AND deleted_at IS NULL;

  IF FOUND AND v_existing.status NOT IN ('pending','submitted') THEN
    RAISE EXCEPTION 'REPORT_LOCKED: this report is % and can no longer be replaced through submission', v_existing.status
      USING ERRCODE = '22000';
  END IF;

  INSERT INTO public.inspection_reports (job_id, inspector_id, photo_url, notes, status)
  VALUES (p_job_id, v_uid, p_photo_url, p_notes, 'pending')
  ON CONFLICT (job_id, inspector_id) DO UPDATE
    SET photo_url = EXCLUDED.photo_url,
        notes     = EXCLUDED.notes,
        updated_at = NOW()
  RETURNING id INTO v_id;

  -- NOTE: jobs.status is deliberately NOT written. 'under_review' is not a
  -- state the job machine has; review state lives on the report row.
  RETURN jsonb_build_object('success', true, 'report_id', v_id);
END;
$function$;

COMMENT ON FUNCTION public.submit_inspection_report(uuid, text, text)
IS 'Inspector-facing report submission (mobile/API path). Caller must be the job''s contractor on an assigned/in_progress job; upserts the pending report row; never writes jobs.status (D24: the old body wrote a nonexistent under_review state AND had no authorization check).';
