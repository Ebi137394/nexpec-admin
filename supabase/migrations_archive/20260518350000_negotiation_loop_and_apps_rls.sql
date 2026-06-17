-- ============================================================================
-- Inspector ↔ Admin negotiation loop + permissive RLS so admin can SEE
-- every application + missed-notification backfill.
-- ============================================================================

BEGIN;

-- ── 1) Application visibility for admin (root cause of phantom apps) ────
--
-- The current RLS on `applications` only lets an inspector read their own
-- applications. Admin couldn't SELECT — hence "0 applicants". Add explicit
-- admin-read policy + client-read policy (their own jobs).

DROP POLICY IF EXISTS "applications_admin_select_all" ON public.applications;
CREATE POLICY "applications_admin_select_all"
  ON public.applications FOR SELECT
  TO authenticated
  USING (public.nx_is_admin());

DROP POLICY IF EXISTS "applications_client_select_own_jobs" ON public.applications;
CREATE POLICY "applications_client_select_own_jobs"
  ON public.applications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = applications.job_id
         AND (j.client_id = auth.uid() OR j.agency_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "applications_inspector_select_own" ON public.applications;
CREATE POLICY "applications_inspector_select_own"
  ON public.applications FOR SELECT
  TO authenticated
  USING (applicant_id = auth.uid());

-- Admin can also UPDATE any application (for setting counter offers)
DROP POLICY IF EXISTS "applications_admin_update_all" ON public.applications;
CREATE POLICY "applications_admin_update_all"
  ON public.applications FOR UPDATE
  TO authenticated
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- Inspector can UPDATE their own application (for accepting / rejecting counter)
DROP POLICY IF EXISTS "applications_inspector_update_own" ON public.applications;
CREATE POLICY "applications_inspector_update_own"
  ON public.applications FOR UPDATE
  TO authenticated
  USING (applicant_id = auth.uid())
  WITH CHECK (applicant_id = auth.uid());

-- ── 2) Negotiation columns on applications ─────────────────────────────
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS admin_counter_cents      bigint,
  ADD COLUMN IF NOT EXISTS admin_comment            text,
  ADD COLUMN IF NOT EXISTS admin_countered_at       timestamptz,
  ADD COLUMN IF NOT EXISTS admin_countered_by       uuid,
  ADD COLUMN IF NOT EXISTS negotiation_status       text,
  ADD COLUMN IF NOT EXISTS inspector_decision       text,
  ADD COLUMN IF NOT EXISTS inspector_decision_note  text,
  ADD COLUMN IF NOT EXISTS inspector_decision_at    timestamptz;

-- negotiation_status enum-like check (text + check for forward-compat)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'applications_negotiation_status_check'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_negotiation_status_check
      CHECK (negotiation_status IS NULL OR negotiation_status IN (
        'none',             -- inspector's original bid stands
        'admin_countered',  -- admin sent a counter, awaiting inspector
        'counter_accepted', -- inspector accepted admin's counter
        'counter_rejected'  -- inspector rejected; back to pending
      )) NOT VALID;
  END IF;
END $$;

-- ── 3) RPC: admin sends a counter offer ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_counter_application(
  p_application_id uuid,
  p_counter_cents  bigint,
  p_comment        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_app RECORD;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_counter_cents IS NULL OR p_counter_cents < 0 THEN
    RAISE EXCEPTION 'counter must be non-negative';
  END IF;

  UPDATE public.applications SET
    admin_counter_cents = p_counter_cents,
    admin_comment       = p_comment,
    admin_countered_at  = NOW(),
    admin_countered_by  = v_uid,
    negotiation_status  = 'admin_countered',
    -- Reset any prior inspector decision when a new counter arrives
    inspector_decision      = NULL,
    inspector_decision_note = NULL,
    inspector_decision_at   = NULL
  WHERE id = p_application_id
  RETURNING * INTO v_app;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  -- Notify the inspector
  BEGIN
    PERFORM public.notify_safe(
      v_app.applicant_id,
      'application_status',
      'Counter offer received',
      'Admin proposed a new payout — open your dashboard to accept or decline.',
      '/inspector/assignments?app=' || v_app.id::text,
      v_app.job_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notify failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', v_app.id,
    'admin_counter_cents', v_app.admin_counter_cents,
    'negotiation_status', v_app.negotiation_status
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_counter_application(uuid, bigint, text) TO authenticated;

-- ── 4) RPC: inspector accepts / rejects the counter ────────────────────
CREATE OR REPLACE FUNCTION public.inspector_respond_to_counter(
  p_application_id uuid,
  p_decision       text,   -- 'accepted' | 'rejected'
  p_note           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_app RECORD;
  v_uid uuid := auth.uid();
BEGIN
  IF p_decision NOT IN ('accepted','rejected') THEN
    RAISE EXCEPTION 'decision must be accepted or rejected';
  END IF;

  SELECT * INTO v_app FROM public.applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found';
  END IF;
  IF v_app.applicant_id <> v_uid THEN
    RAISE EXCEPTION 'only the applicant can decide on the counter';
  END IF;
  IF v_app.negotiation_status <> 'admin_countered' THEN
    RAISE EXCEPTION 'no outstanding counter offer';
  END IF;

  UPDATE public.applications SET
    inspector_decision      = p_decision,
    inspector_decision_note = p_note,
    inspector_decision_at   = NOW(),
    negotiation_status      = CASE
                                WHEN p_decision = 'accepted' THEN 'counter_accepted'
                                ELSE 'counter_rejected'
                              END,
    -- On acceptance, copy the counter into bid_amount_cents so the rest of
    -- the platform (dispatch table, payouts) sees a single canonical price.
    bid_amount_cents = CASE
                         WHEN p_decision = 'accepted' THEN admin_counter_cents
                         ELSE bid_amount_cents
                       END
  WHERE id = p_application_id
  RETURNING * INTO v_app;

  -- Notify the admins
  BEGIN
    PERFORM public.notify_admins(
      'application_status',
      CASE p_decision
        WHEN 'accepted' THEN 'Inspector accepted your counter'
        ELSE 'Inspector rejected your counter'
      END,
      COALESCE(p_note, 'Open the job to continue the negotiation.'),
      '/admin/jobs?inspect=' || v_app.job_id::text,
      v_app.job_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notify_admins failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', v_app.id,
    'negotiation_status', v_app.negotiation_status
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.inspector_respond_to_counter(uuid, text, text) TO authenticated;

-- ── 5) RPC: admin forwards inspector to client ─────────────────────────
--
-- Only allowed when negotiation is settled (no outstanding counter waiting
-- on inspector). Flips status to CLIENT_SELECTED so the client sees the
-- inspector's card and can accept/reject.
CREATE OR REPLACE FUNCTION public.admin_forward_application_to_client(
  p_application_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_app RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.applications SET
    status = 'CLIENT_SELECTED'
  WHERE id = p_application_id
    AND (
      negotiation_status IS NULL
      OR negotiation_status IN ('none', 'counter_accepted')
    )
  RETURNING * INTO v_app;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot forward — application not found or counter still pending';
  END IF;

  -- Notify the client
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
    'status', v_app.status
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_forward_application_to_client(uuid) TO authenticated;

-- ── 6) Backfill missed notifications for the current admin ─────────────
DO $$
DECLARE r RECORD; v_count int := 0;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.notify_safe(
      r.id, 'system',
      'Notification subsystem reconfirmed',
      'If you see this, your bell is wired to the DB. Restart your browser tab to pick up new pushes.',
      '/admin/diagnostics', NULL
    );
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfilled % notifications', v_count;
END $$;

COMMIT;
