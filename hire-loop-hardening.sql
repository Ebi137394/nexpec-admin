-- ════════════════════════════════════════════════════════════════════════════
--  hire-loop-hardening.sql
--  NEXPEC — Phase 1 strike on Hiring Loop P0/P1 defects
--
--  Closes HIRE-001 (status enum case mismatch) + HIRE-002 (non-transactional
--  admin dispatch) + HIRE-003 (silent sibling-rejection failure).
--
--  Three things land here:
--    1. Backfill any rows currently stuck in lowercase 'client_selected'
--       so the canonical casing is the only thing in the wild.
--    2. New RPC `admin_dispatch_job` — single transactional entry point
--       for the Spread Editor's Confirm & Dispatch. Replaces three loose
--       UPDATEs from the client. Concurrency-safe (FOR UPDATE locks).
--       Validates every guard the manual path was supposed to.
--    3. Audit integration — the RPC sets a correlation_id + intent at
--       the top so the existing audit_capture trigger groups every
--       resulting event under one logical action in the Audit Trail.
--
--  Safe to re-run. Wrapped in a transaction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — BACKFILL lowercase 'client_selected' → 'CLIENT_SELECTED'
-- ════════════════════════════════════════════════════════════════════════════
-- Any application row written by the now-deprecated client screen
-- carries lowercase status. Every admin surface reads uppercase, so
-- those rows are silently invisible to admin. Promote them to canonical
-- casing before the deprecated screen is removed from the UI.

UPDATE public.applications
SET status = 'CLIENT_SELECTED',
    updated_at = now()
WHERE status = 'client_selected';

-- Report what was touched so the operator can verify in the SQL editor.
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.applications
  WHERE status = 'client_selected';
  IF v_count > 0 THEN
    RAISE WARNING '[hire-loop] % rows still in lowercase ''client_selected'' after backfill — investigate.', v_count;
  ELSE
    RAISE NOTICE '[hire-loop] Backfill clean. No lowercase client_selected rows remain.';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — TRANSACTIONAL DISPATCH RPC
-- ════════════════════════════════════════════════════════════════════════════
-- One function, one transaction, all four state changes:
--   (a) application.status: CLIENT_SELECTED → hired
--   (b) job.status:         open → assigned + contractor_id + admin confirmation
--   (c) sibling applications: pending/shortlisted/CLIENT_SELECTED/offered → rejected
--   (d) returns a summary jsonb for the caller
--
-- If ANY step fails (concurrency conflict, RLS, constraint, etc.), the
-- whole thing rolls back — no orphan 'hired' application + 'open' job
-- mismatch possible.
--
-- Concurrency safety: SELECT ... FOR UPDATE on both rows prevents two
-- admins from dispatching the same job at the same time.
--
-- Audit grouping: audit_set_correlation + audit_set_intent fire at the
-- top so the existing audit_capture trigger tags every resulting
-- event with the same correlation_id and a human-readable intent.
-- The Audit Trail's Command Center can group these events visually.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_dispatch_job(
  p_job_id              uuid,
  p_application_id      uuid,
  p_client_price_cents  bigint,
  p_payout_cents        bigint,
  p_payout_status       text DEFAULT 'unpaid'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor             uuid;
  v_actor_role        text;
  v_job               public.jobs%ROWTYPE;
  v_app               public.applications%ROWTYPE;
  v_correlation       uuid := gen_random_uuid();
  v_rejected_count    int  := 0;
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- ── 2. Authorization: super_admin only ───────────────────────────
  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can dispatch jobs' USING ERRCODE = '42501';
  END IF;

  -- ── 3. Input validation ──────────────────────────────────────────
  IF p_job_id IS NULL OR p_application_id IS NULL THEN
    RAISE EXCEPTION 'job_id and application_id are required' USING ERRCODE = '22000';
  END IF;
  IF p_client_price_cents IS NULL OR p_client_price_cents <= 0 THEN
    RAISE EXCEPTION 'Client price must be greater than zero' USING ERRCODE = '22000';
  END IF;
  IF p_payout_cents IS NULL OR p_payout_cents <= 0 THEN
    RAISE EXCEPTION 'Inspector payout must be greater than zero' USING ERRCODE = '22000';
  END IF;
  IF p_payout_cents > p_client_price_cents THEN
    RAISE EXCEPTION 'Inspector payout cannot exceed client price' USING ERRCODE = '22000';
  END IF;

  -- ── 4. Audit grouping (Phase 5 integration) ──────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Admin Confirm & Dispatch (Spread Editor)');

  -- ── 5. Lock the job row to prevent concurrent dispatch ───────────
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status <> 'open' THEN
    RAISE EXCEPTION 'Job is not in open state (current: %)', v_job.status
      USING ERRCODE = '22000';
  END IF;
  IF v_job.contractor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job already has a contractor assigned' USING ERRCODE = '22000';
  END IF;

  -- ── 6. Lock and validate the target application ──────────────────
  SELECT * INTO v_app
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_app.job_id IS DISTINCT FROM p_job_id THEN
    RAISE EXCEPTION 'Application does not belong to this job' USING ERRCODE = '22000';
  END IF;
  IF v_app.status <> 'CLIENT_SELECTED' THEN
    RAISE EXCEPTION 'Application is not in CLIENT_SELECTED state (current: %)', v_app.status
      USING ERRCODE = '22000';
  END IF;
  IF v_app.applicant_id IS NULL THEN
    RAISE EXCEPTION 'Application has no applicant_id' USING ERRCODE = '22000';
  END IF;

  -- ── 7. Promote target application: CLIENT_SELECTED → hired ───────
  UPDATE public.applications
  SET status     = 'hired',
      updated_at = now()
  WHERE id = p_application_id;

  -- ── 8. Lock job: open → assigned + contractor + confirmation ─────
  UPDATE public.jobs
  SET status              = 'assigned',
      contractor_id       = v_app.applicant_id,
      client_price_cents  = p_client_price_cents,
      payout_amount_cents = p_payout_cents,
      payout_status       = COALESCE(p_payout_status, 'unpaid'),
      admin_confirmed_at  = now(),
      admin_confirmed_by  = v_actor,
      updated_at          = now()
  WHERE id = p_job_id;

  -- ── 9. Reject every other non-terminal application on this job ───
  --     (HIRE-003: this was silently swallowed in the old path; now
  --     it's inside the transaction. If anything blocks it, the
  --     whole dispatch rolls back.)
  WITH rejected AS (
    UPDATE public.applications
    SET status     = 'rejected',
        updated_at = now()
    WHERE job_id = p_job_id
      AND id <> p_application_id
      AND status IN ('pending', 'shortlisted', 'CLIENT_SELECTED', 'offered')
    RETURNING id
  )
  SELECT count(*) INTO v_rejected_count FROM rejected;

  -- ── 10. Return summary ───────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                true,
    'job_id',            p_job_id,
    'application_id',    p_application_id,
    'contractor_id',     v_app.applicant_id,
    'rejected_siblings', v_rejected_count,
    'correlation_id',    v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.admin_dispatch_job(uuid, uuid, bigint, bigint, text) IS
  'Single transactional entry point for admin Confirm & Dispatch. Promotes the CLIENT_SELECTED application to hired, locks the job (open → assigned), sets pricing + contractor + admin confirmation, and rejects every other non-terminal sibling application — all atomically. Concurrency-safe via SELECT ... FOR UPDATE.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — GRANTS
-- ════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.admin_dispatch_job(uuid, uuid, bigint, bigint, text)
  TO authenticated;


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS — run after the COMMIT to verify
-- ════════════════════════════════════════════════════════════════════════════

-- A. Backfill verification — should return 0
-- SELECT count(*) FROM public.applications WHERE status = 'client_selected';

-- B. Function exists
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM pg_proc WHERE proname = 'admin_dispatch_job';

-- C. Permission rejection (sign in as a non-admin, then):
-- SELECT public.admin_dispatch_job(
--   '<job-id>', '<app-id>', 50000, 30000, 'unpaid'
-- );
-- Expected: ERROR 42501 — "Only super_admin can dispatch jobs"

-- D. State guard rejection (sign in as admin, job is already assigned):
-- SELECT public.admin_dispatch_job(
--   '<assigned-job-id>', '<app-id>', 50000, 30000, 'unpaid'
-- );
-- Expected: ERROR 22000 — "Job is not in open state (current: assigned)"

-- E. Happy path (sign in as admin, job is open + has CLIENT_SELECTED app):
-- SELECT public.admin_dispatch_job(
--   '<open-job-id>', '<CLIENT_SELECTED-app-id>',
--   75000, 50000, 'unpaid'
-- );
-- Expected: jsonb with ok=true, contractor_id populated, rejected_siblings count.
-- Then verify: job.status='assigned', application.status='hired',
-- sibling apps.status='rejected', and audit_events shows multiple rows
-- with the SAME correlation_id and intent='Admin Confirm & Dispatch (Spread Editor)'.
