-- ════════════════════════════════════════════════════════════════════════════
--  20260801272000_applications_forward_gate.sql
--
--  ISSUE 1 (workflow bypass): clients saw inspector proposals BEFORE an admin
--  clicked "Forward to Client". Nothing gated client visibility — the client
--  read ALL applications for their job (RLS allowed any status), and the admin
--  "forward" action merely flipped status→'CLIENT_SELECTED' (which also collided
--  with the CLIENT's own "select" action, collapsing the client's decision step).
--
--  FIX — a dedicated, status-independent visibility gate enforced at the DB layer
--  so NO client on ANY surface (mobile, web, future) can ever see an un-forwarded
--  application:
--    • New columns applications.forwarded_to_client_at / forwarded_to_client_by.
--    • admin_forward_application_to_client() stamps forwarded_to_client_at and
--      LEAVES status untouched ('pending'), so after forwarding the client still
--      gets the Decline / "Select & Notify Admin" decision (client-select is the
--      only writer of 'CLIENT_SELECTED'). Idempotent: re-forwarding is rejected.
--    • RLS: the client/agency SELECT branch now REQUIRES forwarded_to_client_at
--      IS NOT NULL. Admin + applicant (inspector-own) visibility unchanged.
--
--  Backfill keeps already-progressed applications visible (only un-forwarded
--  'pending' rows are newly hidden — exactly the leak). safeupdate-safe
--  (WHERE-qualified). Idempotent; self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Visibility-gate columns ────────────────────────────────────────────────
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS forwarded_to_client_at timestamptz,
  ADD COLUMN IF NOT EXISTS forwarded_to_client_by uuid;

COMMENT ON COLUMN public.applications.forwarded_to_client_at IS
  'Set by admin_forward_application_to_client when an admin releases this application to the client. NULL = not yet forwarded → invisible to the client (enforced in RLS). Anti-bypass gate, decoupled from status.';
COMMENT ON COLUMN public.applications.forwarded_to_client_by IS
  'Admin (auth.uid()) who forwarded this application to the client.';

-- 2) Heal: keep every application that already progressed past intake visible;
--    only un-forwarded 'pending' rows become newly hidden (the actual leak).
UPDATE public.applications
   SET forwarded_to_client_at = COALESCE(forwarded_to_client_at, updated_at, created_at, NOW())
 WHERE forwarded_to_client_at IS NULL
   AND status <> 'pending';

-- 3) Forward RPC — stamp the gate, DO NOT touch status, reject double-forward.
CREATE OR REPLACE FUNCTION public.admin_forward_application_to_client(p_application_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_app RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- Release to the client by stamping the gate. Status stays 'pending' so the
  -- client still owns the Decline / Select decision. Already-forwarded or
  -- counter-pending applications are rejected (idempotent, no double-notify).
  UPDATE public.applications SET
    forwarded_to_client_at = NOW(),
    forwarded_to_client_by = auth.uid(),
    updated_at             = NOW()
  WHERE id = p_application_id
    AND forwarded_to_client_at IS NULL
    AND (
      negotiation_status IS NULL
      OR negotiation_status IN ('none', 'counter_accepted')
    )
  RETURNING * INTO v_app;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot forward — application not found, already forwarded, or counter still pending';
  END IF;

  -- Notify the client (best-effort).
  BEGIN
    DECLARE v_client uuid;
    BEGIN
      SELECT COALESCE(client_id, agency_id) INTO v_client
        FROM public.jobs WHERE id = v_app.job_id;
      IF v_client IS NOT NULL THEN
        PERFORM public.notify_safe(
          v_client,
          'assignment',
          'Inspector ready for your review',
          'Admin has vetted an inspector for your job. Open the applications page to confirm.',
          '/client/jobs/' || v_app.job_id::text || '/applications',
          v_app.job_id
        );
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', v_app.id,
    'status', v_app.status,
    'forwarded_to_client_at', v_app.forwarded_to_client_at
  );
END $$;

ALTER FUNCTION public.admin_forward_application_to_client(uuid) OWNER TO postgres;

-- 4) RLS — the client/agency SELECT branch now requires the gate. Admin and
--    inspector-own visibility are preserved byte-for-byte.
DROP POLICY IF EXISTS "applications_client_select_own_jobs" ON public.applications;
CREATE POLICY "applications_client_select_own_jobs" ON public.applications
  FOR SELECT TO authenticated
  USING (
    forwarded_to_client_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = applications.job_id
         AND (j.client_id = auth.uid() OR j.agency_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "applications_read" ON public.applications;
CREATE POLICY "applications_read" ON public.applications
  FOR SELECT
  USING (
    ((deleted_at IS NULL) OR public.nx_is_admin())
    AND (
      public.nx_is_admin()
      OR (applicant_id = auth.uid())
      OR (
        forwarded_to_client_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.jobs j
           WHERE j.id = applications.job_id
             AND (auth.uid() = j.client_id OR auth.uid() = j.agency_id)
        )
      )
    )
  );

-- 5) Self-test ───────────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_def   text;
  v_cols  int;
  v_leak  int;
  v_qual1 text;
  v_qual2 text;
BEGIN
  -- (a) columns exist
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='applications'
     AND column_name IN ('forwarded_to_client_at','forwarded_to_client_by');
  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: forward-gate columns missing (found %)', v_cols;
  END IF;

  -- (b) RPC stamps the gate and no longer sets status='CLIENT_SELECTED'
  v_def := pg_get_functiondef('public.admin_forward_application_to_client(uuid)'::regprocedure);
  IF v_def !~* 'forwarded_to_client_at\s*=\s*now\(\)' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: forward RPC does not stamp forwarded_to_client_at';
  END IF;
  IF v_def ~* 'status\s*=\s*''CLIENT_SELECTED''' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: forward RPC still overwrites status (must leave the client decision intact)';
  END IF;

  -- (c) both client-facing SELECT policies now gate on the forward flag
  SELECT qual INTO v_qual1 FROM pg_policies
   WHERE schemaname='public' AND tablename='applications' AND policyname='applications_client_select_own_jobs';
  SELECT qual INTO v_qual2 FROM pg_policies
   WHERE schemaname='public' AND tablename='applications' AND policyname='applications_read';
  IF v_qual1 IS NULL OR position('forwarded_to_client_at' IN v_qual1) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: applications_client_select_own_jobs not gated on forwarded_to_client_at';
  END IF;
  IF v_qual2 IS NULL OR position('forwarded_to_client_at' IN v_qual2) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: applications_read not gated on forwarded_to_client_at';
  END IF;

  -- (d) no progressed application was accidentally left hidden by the heal
  SELECT count(*) INTO v_leak FROM public.applications
   WHERE forwarded_to_client_at IS NULL AND status <> 'pending';
  IF v_leak > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % progressed application(s) left un-forwarded by heal', v_leak;
  END IF;

  RAISE NOTICE 'forward-gate LIVE: clients see only forwarded applications; admin/inspector visibility unchanged.';
END
$test$;

COMMIT;
