-- ════════════════════════════════════════════════════════════════════════════
--  20260801162000_fix_approve_inspection_report_columns.sql
--
--  BUGFIX: client "Review & Pay → Confirm Release" crashed with
--    42703: column "reviewer_id" of relation "inspection_reports" does not exist
--  (toast: "[review-report] approve failed").
--
--  Root cause: approve_inspection_report was written against a schema that
--  doesn't exist. It wrote PHANTOM columns on TWO tables, so it could never
--  succeed:
--    • inspection_reports: reviewer_id / reviewer_note / reviewed_at  ← none exist
--        Real approval columns: status, is_published, is_client_approved.
--    • job_events: kind / payload + event_type='report_approved'  ← columns are
--        event_type / metadata, and event_type has a CHECK that does NOT allow
--        'report_approved' (allowed: created, status_change, …). The approval is
--        recorded as event_type='status_change' with details in metadata.
--
--  Also promoted to SECURITY DEFINER: the function already self-authorizes
--  (caller must be the job's client_id or agency_id) and locks the job row
--  FOR UPDATE, so it can safely perform the report UPDATE + audit INSERT as
--  owner. search_path stays pinned. Approver identity + comment are preserved
--  in the job_events row (actor_id + metadata), so no data is lost by dropping
--  the phantom reviewer_* columns.
--
--  Behaviour preserved: same signature, same auth checks, same return shape
--  ({ ok, report_id, new_status, approved }). Idempotent (CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_inspection_report(
  p_job_id uuid, p_approved boolean, p_comment text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_client_id  uuid;
  v_agency_id  uuid;
  v_report_id  uuid;
  v_new_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT j.client_id, j.agency_id
    INTO v_client_id, v_agency_id
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % not found', p_job_id USING ERRCODE = 'P0002';
  END IF;

  -- Server-side authorization: only the job's client OR agency may approve.
  IF v_caller IS DISTINCT FROM v_client_id AND v_caller IS DISTINCT FROM v_agency_id THEN
    RAISE EXCEPTION 'caller % is not the owner of job %', v_caller, p_job_id
      USING ERRCODE = '42501';
  END IF;

  v_new_status := CASE WHEN p_approved THEN 'approved' ELSE 'revision_requested' END;

  -- ★ SCHEMA-FIX: real approval columns only (prior phantom columns are listed
  --   in the migration header; not repeated here so pg_get_functiondef stays clean).
  UPDATE public.inspection_reports
     SET status             = v_new_status,
         is_published       = p_approved,
         is_client_approved = p_approved,
         updated_at         = NOW()
   WHERE job_id = p_job_id
   RETURNING id INTO v_report_id;

  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'no inspection report exists for job %', p_job_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ★ SCHEMA-FIX: real audit columns + a CHECK-allowed event_type ('status_change').
  --   Approver (actor_id) + comment + outcome are captured in metadata.
  INSERT INTO public.job_events (job_id, actor_id, event_type, metadata)
  VALUES (
    p_job_id,
    v_caller,
    'status_change',
    jsonb_build_object(
      'domain',        'inspection_report_review',
      'report_id',     v_report_id,
      'report_status', v_new_status,
      'approved',      p_approved,
      'comment',       p_comment,
      'intent',        CASE WHEN p_approved THEN 'report_approved' ELSE 'report_revision_requested' END
    )
  );

  RETURN jsonb_build_object(
    'ok',         true,
    'report_id',  v_report_id,
    'new_status', v_new_status,
    'approved',   p_approved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_inspection_report(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_inspection_report(uuid, boolean, text) TO authenticated, service_role;

-- ── Self-tests — guard against the phantom-column regression ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='inspection_reports'
                   AND column_name='is_client_approved') THEN
    RAISE EXCEPTION 'SELFTEST: inspection_reports.is_client_approved missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='job_events'
                   AND column_name='event_type') THEN
    RAISE EXCEPTION 'SELFTEST: job_events.event_type missing';
  END IF;
  -- the function body must no longer reference the phantom columns
  IF pg_get_functiondef('public.approve_inspection_report(uuid,boolean,text)'::regprocedure)
       ~* '(reviewer_id|reviewer_note|reviewed_at)' THEN
    RAISE EXCEPTION 'SELFTEST: approve_inspection_report still references phantom columns';
  END IF;
  RAISE NOTICE 'approve_inspection_report schema-fix OK (real columns; SECURITY DEFINER; self-authorized).';
END $$;

COMMIT;
