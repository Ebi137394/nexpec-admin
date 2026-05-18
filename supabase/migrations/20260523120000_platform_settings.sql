-- ════════════════════════════════════════════════════════════════════════════
--  20260523120000_platform_settings.sql
--  Phase 6 / Sprint 4 close — platform settings + fee schedule.
--
--  Single-row settings table (key='global'). Two RPCs:
--    public_get_fee_schedule()       — anon-callable read, no secrets.
--    admin_set_fee_schedule(...)     — super_admin write, audit-CRITICAL.
--
--  Why a single row instead of a key/value table:
--    - Fees are read on every job-post + every dispatch flow. A single
--      row keeps the read trivial and indexable.
--    - Versioning + auditability come from the audit_events trigger.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                         text        PRIMARY KEY DEFAULT 'global'
                                        CHECK (id = 'global'),
  updated_at                 timestamptz NOT NULL    DEFAULT now(),
  updated_by                 uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Fee schedule (basis points so we can express 2.5% as 250 cleanly).
  client_commission_bps      int         NOT NULL    DEFAULT 1500
                                        CHECK (client_commission_bps BETWEEN 0 AND 5000),
  stripe_application_fee_bps int         NOT NULL    DEFAULT 250
                                        CHECK (stripe_application_fee_bps BETWEEN 0 AND 2000),
  dispute_fee_cents          int         NOT NULL    DEFAULT 5000
                                        CHECK (dispute_fee_cents BETWEEN 0 AND 100000),
  payout_fee_bps             int         NOT NULL    DEFAULT 0
                                        CHECK (payout_fee_bps BETWEEN 0 AND 1000)
);

COMMENT ON TABLE public.platform_settings IS
  'Single-row global platform settings. fee values stored in basis points (bps) so 250 = 2.50%. id is locked to ''global''.';

-- Seed the row if missing.
INSERT INTO public.platform_settings (id) VALUES ('global')
  ON CONFLICT (id) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_select_all     ON public.platform_settings;
DROP POLICY IF EXISTS platform_settings_admin_write    ON public.platform_settings;

-- Every authenticated user can READ the public-facing fee schedule (it
-- affects what they're billed). Mutations are super_admin only.
CREATE POLICY platform_settings_select_all
  ON public.platform_settings FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY platform_settings_admin_write
  ON public.platform_settings FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  );

-- ── public_get_fee_schedule() ────────────────────────────────────────
-- Anon-callable read. Returns the four fee values in jsonb. Marketing
-- surfaces can call this to render a Fees page without leaking anything
-- privileged.
CREATE OR REPLACE FUNCTION public.public_get_fee_schedule()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'client_commission_bps',      client_commission_bps,
    'stripe_application_fee_bps', stripe_application_fee_bps,
    'dispute_fee_cents',          dispute_fee_cents,
    'payout_fee_bps',             payout_fee_bps,
    'updated_at',                 updated_at
  )
  FROM public.platform_settings WHERE id = 'global';
$$;

GRANT EXECUTE ON FUNCTION public.public_get_fee_schedule() TO anon, authenticated;

-- ── admin_set_fee_schedule(...) ──────────────────────────────────────
-- Super_admin only. FOR UPDATE locked. AUDIT-CRITICAL severity (every
-- fee change is high-impact + reversible-via-history but immediately
-- affecting all new transactions).
CREATE OR REPLACE FUNCTION public.admin_set_fee_schedule(
  p_client_commission_bps      int,
  p_stripe_application_fee_bps int,
  p_dispute_fee_cents          int,
  p_payout_fee_bps             int,
  p_reason                     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        uuid;
  v_actor_role   text;
  v_old          public.platform_settings%ROWTYPE;
  v_correlation  uuid := gen_random_uuid();
  v_clean_reason text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can change fee schedule' USING ERRCODE = '42501';
  END IF;

  v_clean_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required for fee changes (audit-critical)' USING ERRCODE = '22000';
  END IF;
  IF length(v_clean_reason) > 1000 THEN
    v_clean_reason := left(v_clean_reason, 1000);
  END IF;

  -- Bounds validation (defense in depth — CHECK constraints also enforce).
  IF p_client_commission_bps NOT BETWEEN 0 AND 5000 THEN
    RAISE EXCEPTION 'client_commission_bps out of range (0-5000)' USING ERRCODE = '22000';
  END IF;
  IF p_stripe_application_fee_bps NOT BETWEEN 0 AND 2000 THEN
    RAISE EXCEPTION 'stripe_application_fee_bps out of range (0-2000)' USING ERRCODE = '22000';
  END IF;
  IF p_dispute_fee_cents NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'dispute_fee_cents out of range (0-100000)' USING ERRCODE = '22000';
  END IF;
  IF p_payout_fee_bps NOT BETWEEN 0 AND 1000 THEN
    RAISE EXCEPTION 'payout_fee_bps out of range (0-1000)' USING ERRCODE = '22000';
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Fee schedule updated — ' || v_clean_reason);

  SELECT * INTO v_old FROM public.platform_settings WHERE id = 'global' FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.platform_settings (id) VALUES ('global');
    SELECT * INTO v_old FROM public.platform_settings WHERE id = 'global' FOR UPDATE;
  END IF;

  UPDATE public.platform_settings
  SET client_commission_bps      = p_client_commission_bps,
      stripe_application_fee_bps = p_stripe_application_fee_bps,
      dispute_fee_cents          = p_dispute_fee_cents,
      payout_fee_bps             = p_payout_fee_bps,
      updated_at                 = now(),
      updated_by                 = v_actor
  WHERE id = 'global';

  RETURN jsonb_build_object(
    'ok',             true,
    'correlation_id', v_correlation,
    'before', jsonb_build_object(
      'client_commission_bps',      v_old.client_commission_bps,
      'stripe_application_fee_bps', v_old.stripe_application_fee_bps,
      'dispute_fee_cents',          v_old.dispute_fee_cents,
      'payout_fee_bps',             v_old.payout_fee_bps
    ),
    'after', jsonb_build_object(
      'client_commission_bps',      p_client_commission_bps,
      'stripe_application_fee_bps', p_stripe_application_fee_bps,
      'dispute_fee_cents',          p_dispute_fee_cents,
      'payout_fee_bps',             p_payout_fee_bps
    )
  );
END;
$$;

COMMENT ON FUNCTION public.admin_set_fee_schedule(int, int, int, int, text) IS
  'Super_admin updates the global fee schedule. Reason required. Audit-correlated with before/after in the return jsonb.';

GRANT EXECUTE ON FUNCTION public.admin_set_fee_schedule(int, int, int, int, text)
  TO authenticated;

COMMIT;
