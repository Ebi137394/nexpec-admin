-- ════════════════════════════════════════════════════════════════════════════
--  20260517150000_job_state_machine_lockdown.sql
--  NEXPEC — Phase 5 Module 3: Job Lifecycle State Machine + Audit Trail
--
--  Closes NX-JOB-002, NX-JOB-003, NX-JOB-004 (NX-JOB-001 was a UI fix
--  applied to submit-report.tsx).
--
--  WHAT THIS MIGRATION LANDS
--  ─────────────────────────
--    1. `inspector_start_job(p_job_id)` SECURITY DEFINER RPC
--       — canonical assigned → in_progress transition
--       — FOR UPDATE row lock prevents double-start race
--       — actor must be the assigned contractor (self-auth)
--       — audit-annotated via audit_set_intent
--
--    2. `owner_cancel_job(p_job_id, p_reason)` SECURITY DEFINER RPC
--       — canonical cancel path for clients (their own job, pre-assign only)
--       — admin_cancel_job for super_admin (any non-terminal job, anytime)
--       — both audit-annotated; reason is captured into the audit event
--
--    3. `guard_jobs_status_transition()` BEFORE UPDATE trigger on `jobs`
--       — enforces the legal transition table at the schema layer
--       — prevents any path (UI, RPC, raw SQL via authenticated/anon) from
--         making an illegal jump like open → completed
--       — service_role bypasses the guard so Edge Functions and the
--         admin_dispatch_job RPC remain the legitimate orchestration paths
--
--  LEGAL TRANSITION TABLE
--  ──────────────────────
--    open         → assigned | cancelled
--    assigned     → in_progress | cancelled | disputed
--    in_progress  → completed | disputed | cancelled
--    disputed     → completed | cancelled | in_progress
--    completed    → (terminal)
--    cancelled    → (terminal)
--
--  Idempotent (same status → same status) is always allowed, otherwise the
--  audit trigger would fire spuriously on every UPDATE that touches an
--  unrelated column.
--
--  Safe to re-run. Wrapped in a transaction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — TRANSITION GUARD TRIGGER (NX-JOB-003)
-- ════════════════════════════════════════════════════════════════════════════
-- Belt-and-braces enforcement at the schema level. Even if a future RPC
-- forgets to validate, even if someone runs raw SQL via the Supabase SQL
-- Editor (authenticated role), even if RLS lets a stray UPDATE through —
-- the guard refuses any status transition not in the legal table.
--
-- Service-role bypass: the postgres / service_role contexts legitimately
-- drive state changes through curated entry points (admin_dispatch_job,
-- Edge Function webhooks, scheduled jobs). Skipping the guard for those
-- roles keeps the trigger from breaking our own orchestration.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_jobs_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_legal boolean := false;
BEGIN
  -- No-op if status is unchanged (column wasn't touched, or set to itself).
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Service-role / superuser bypass. Edge Functions and the admin
  -- dispatch RPC run under postgres or service_role and are the
  -- legitimate orchestration paths.
  v_role := current_setting('role', true);
  IF v_role IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;

  -- Block writes that drop status to NULL.
  IF NEW.status IS NULL THEN
    RAISE EXCEPTION 'jobs.status cannot be set to NULL (was: %)', OLD.status
      USING ERRCODE = '22000', HINT = 'Use a canonical RPC.';
  END IF;

  -- Legal transition table.
  v_legal := CASE OLD.status
    WHEN 'open'        THEN NEW.status IN ('assigned', 'cancelled')
    WHEN 'assigned'    THEN NEW.status IN ('in_progress', 'cancelled', 'disputed')
    WHEN 'in_progress' THEN NEW.status IN ('completed', 'disputed', 'cancelled')
    WHEN 'disputed'    THEN NEW.status IN ('completed', 'cancelled', 'in_progress')
    WHEN 'completed'   THEN false  -- terminal
    WHEN 'cancelled'   THEN false  -- terminal
    ELSE false
  END;

  IF NOT v_legal THEN
    RAISE EXCEPTION 'Illegal jobs.status transition: % → %', OLD.status, NEW.status
      USING ERRCODE = '22000',
            HINT = 'Use a canonical state-machine RPC (admin_dispatch_job, inspector_start_job, owner_cancel_job, admin_cancel_job, mark_job_completed, or open_dispute).';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_jobs_status_transition() IS
  'BEFORE UPDATE trigger on jobs. Refuses any status change not in the legal transition table. Service-role / postgres callers bypass for orchestration.';

DROP TRIGGER IF EXISTS guard_jobs_status_transition_trigger ON public.jobs;
CREATE TRIGGER guard_jobs_status_transition_trigger
  BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_jobs_status_transition();


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — inspector_start_job RPC (NX-JOB-002)
-- ════════════════════════════════════════════════════════════════════════════
-- The assigned inspector flips the job to in_progress when they begin work.
-- Previously the UI lacked this transition entirely — a job sat in
-- 'assigned' from dispatch through report submission, so 'in_progress' was
-- effectively dead state. This is the canonical path.
--
-- Concurrency: FOR UPDATE on the jobs row.
-- Auth: only the assigned contractor may call. RLS would catch unauthorized
--   actors but we fail loudly here for a better UX error.
-- Audit: audit_set_intent annotates the event the trigger writes.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.inspector_start_job(
  p_job_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid;
  v_actor_role  text;
  v_job         public.jobs%ROWTYPE;
  v_correlation uuid := gen_random_uuid();
BEGIN
  -- ── 1. Auth ────────────────────────────────────────────────────────
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_role NOT IN ('inspector', 'contractor', 'super_admin') THEN
    RAISE EXCEPTION 'Only the assigned inspector can start a job' USING ERRCODE = '42501';
  END IF;

  -- ── 2. Input validation ───────────────────────────────────────────
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id is required' USING ERRCODE = '22000';
  END IF;

  -- ── 3. Audit annotation ───────────────────────────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Inspector started job');

  -- ── 4. Lock + validate ────────────────────────────────────────────
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  -- Self-auth: only the assigned contractor (or super_admin) may start.
  IF v_actor_role <> 'super_admin' AND v_job.contractor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'You are not the assigned inspector for this job' USING ERRCODE = '42501';
  END IF;

  IF v_job.status <> 'assigned' THEN
    RAISE EXCEPTION 'Job is not in assigned state (current: %)', v_job.status
      USING ERRCODE = '22000',
            HINT = 'A job must be dispatched before it can be started.';
  END IF;

  -- ── 5. Flip status ────────────────────────────────────────────────
  UPDATE public.jobs
  SET status     = 'in_progress',
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'job_id',         p_job_id,
    'from_status',    v_job.status,
    'to_status',      'in_progress',
    'correlation_id', v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.inspector_start_job(uuid) IS
  'Canonical assigned → in_progress transition. Caller must be the jobs.contractor_id (or super_admin). FOR UPDATE locks the row to prevent races. Audit-annotated.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — owner_cancel_job + admin_cancel_job RPCs (NX-JOB-004)
-- ════════════════════════════════════════════════════════════════════════════
-- Two flavours because the rules differ:
--
--   owner_cancel_job   — the posting client cancels their own job.
--                        Allowed only while the job is still 'open' (i.e.
--                        no contractor has been dispatched yet). After
--                        dispatch, cancellation must go through admin.
--
--   admin_cancel_job   — super_admin can cancel from any non-terminal
--                        state. Required for cleanup of disputed /
--                        in_progress jobs that cannot be settled.
--
-- Both write the reason into the audit event via audit_set_intent so the
-- Industrial Black Box captures the why, not just the what.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.owner_cancel_job(
  p_job_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        uuid;
  v_actor_role   text;
  v_job          public.jobs%ROWTYPE;
  v_correlation  uuid := gen_random_uuid();
  v_clean_reason text;
BEGIN
  -- ── 1. Auth ────────────────────────────────────────────────────────
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor;

  -- ── 2. Input validation ───────────────────────────────────────────
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id is required' USING ERRCODE = '22000';
  END IF;

  v_clean_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  IF v_clean_reason IS NOT NULL AND length(v_clean_reason) > 500 THEN
    v_clean_reason := left(v_clean_reason, 500);
  END IF;

  -- ── 3. Audit annotation (reason captured here) ────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent(
    'Client cancelled own job' ||
    COALESCE(' — ' || v_clean_reason, '')
  );

  -- ── 4. Lock + validate ────────────────────────────────────────────
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  -- Self-auth: only the owning client may call this path. Admins use
  -- admin_cancel_job below.
  IF v_job.client_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only the job owner can cancel via this RPC'
      USING ERRCODE = '42501',
            HINT = 'Admins should use admin_cancel_job.';
  END IF;

  -- Client cancellation window: pre-dispatch only. After 'assigned' the
  -- client must request admin cancellation so escrow / dispute handling
  -- can run through the proper channel.
  IF v_job.status <> 'open' THEN
    RAISE EXCEPTION 'Job can only be cancelled by the owner while open (current: %)', v_job.status
      USING ERRCODE = '22000',
            HINT = 'Once dispatched, contact support to cancel.';
  END IF;

  -- ── 5. Flip status ────────────────────────────────────────────────
  UPDATE public.jobs
  SET status         = 'cancelled',
      cancelled_at   = now(),
      cancelled_by   = v_actor,
      cancel_reason  = v_clean_reason,
      updated_at     = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'job_id',         p_job_id,
    'from_status',    v_job.status,
    'to_status',      'cancelled',
    'correlation_id', v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.owner_cancel_job(uuid, text) IS
  'Owning client cancels their own job. Allowed only in open state (pre-dispatch). Reason captured into audit event.';


CREATE OR REPLACE FUNCTION public.admin_cancel_job(
  p_job_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        uuid;
  v_actor_role   text;
  v_job          public.jobs%ROWTYPE;
  v_correlation  uuid := gen_random_uuid();
  v_clean_reason text;
BEGIN
  -- ── 1. Auth ────────────────────────────────────────────────────────
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can call admin_cancel_job' USING ERRCODE = '42501';
  END IF;

  -- ── 2. Input validation ───────────────────────────────────────────
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id is required' USING ERRCODE = '22000';
  END IF;
  v_clean_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required when admin cancels a job' USING ERRCODE = '22000';
  END IF;
  IF length(v_clean_reason) > 500 THEN
    v_clean_reason := left(v_clean_reason, 500);
  END IF;

  -- ── 3. Audit annotation ───────────────────────────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Admin cancelled job — ' || v_clean_reason);

  -- ── 4. Lock + validate ────────────────────────────────────────────
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Job is already in terminal state (%) and cannot be cancelled', v_job.status
      USING ERRCODE = '22000';
  END IF;

  -- ── 5. Flip status ────────────────────────────────────────────────
  UPDATE public.jobs
  SET status         = 'cancelled',
      cancelled_at   = now(),
      cancelled_by   = v_actor,
      cancel_reason  = v_clean_reason,
      updated_at     = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'job_id',         p_job_id,
    'from_status',    v_job.status,
    'to_status',      'cancelled',
    'correlation_id', v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.admin_cancel_job(uuid, text) IS
  'Super_admin cancels a job from any non-terminal state. A reason is required and is captured into the audit event.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — DEFENSIVE COLUMN ADDITIONS
-- ════════════════════════════════════════════════════════════════════════════
-- The cancel paths above write to cancelled_at / cancelled_by /
-- cancel_reason and the start path writes started_at. Older schemas may
-- not have these columns; add them defensively so a clean install
-- compiles and a partial install can run the RPCs without a crash.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS started_at    timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cancelled_by  uuid REFERENCES public.profiles(id);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cancel_reason text;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — GRANTS
-- ════════════════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.inspector_start_job(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_cancel_job(uuid, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_job(uuid, text)      TO authenticated;


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS — run after the COMMIT to verify
-- ════════════════════════════════════════════════════════════════════════════

-- A. Trigger exists
-- SELECT tgname FROM pg_trigger WHERE tgname = 'guard_jobs_status_transition_trigger';

-- B. RPCs exist
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM pg_proc
-- WHERE proname IN ('inspector_start_job', 'owner_cancel_job', 'admin_cancel_job');

-- C. Guard rejects illegal transition (any authenticated session):
--   UPDATE public.jobs SET status = 'completed' WHERE id = '<open-job>';
-- Expected: ERROR 22000 — "Illegal jobs.status transition: open → completed"

-- D. inspector_start_job rejects non-assigned-contractor:
--   SELECT public.inspector_start_job('<assigned-job-not-yours>');
-- Expected: ERROR 42501 — "You are not the assigned inspector for this job"

-- E. inspector_start_job happy path (signed in as the assigned contractor):
--   SELECT public.inspector_start_job('<assigned-job-id>');
-- Expected: jsonb ok=true. Then verify jobs.status='in_progress',
-- jobs.started_at is set, audit_events row with event_type='job.status_changed'
-- and metadata->>'intent' = 'Inspector started job'.

-- F. owner_cancel_job rejects post-dispatch cancel:
--   SELECT public.owner_cancel_job('<assigned-job-id>', 'changed my mind');
-- Expected: ERROR 22000 — "Job can only be cancelled by the owner while open"

-- G. admin_cancel_job requires reason:
--   SELECT public.admin_cancel_job('<job-id>', '');
-- Expected: ERROR 22000 — "A reason is required when admin cancels a job"

-- H. Service-role bypass — the migration above (running as postgres) must
--    have completed without the guard firing on its own DDL.
