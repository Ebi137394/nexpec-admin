-- ════════════════════════════════════════════════════════════════════════════
--  20260724120000_god_mode_admin_fee_schedule.sql
--
--  GOD-MODE completeness (final): the platform_settings RLS *write* policy was
--  already widened to role IN ('admin','super_admin') in 20260721. But the
--  admin_set_fee_schedule() function is SECURITY DEFINER and does its OWN inline
--  role check (`v_actor_role IS DISTINCT FROM 'super_admin'`), so that internal
--  gate — not the table policy — is what actually decides the RPC. A literal
--  `admin` (= ME) was therefore still blocked from changing the fee schedule.
--
--  This reproduces admin_set_fee_schedule VERBATIM from 20260523120000_platform_
--  settings.sql with ONLY the role predicate widened to NOT IN ('admin',
--  'super_admin') (= nx_is_admin semantics). Everything else — bounds checks,
--  FOR UPDATE lock, audit correlation/intent, before/after jsonb — is byte-for-
--  byte identical. CREATE OR REPLACE preserves the existing GRANT/ACL. The whole
--  thing is self-guarded so a missing dependency is skipped (RAISE NOTICE)
--  instead of aborting the migration.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- admin_set_fee_schedule  [verbatim from 20260523120000, role predicate widened]
DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
AS $fn$
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
  -- GOD-MODE: the single `admin` role has unrestricted access; super_admin kept
  -- for back-compat. (was: IS DISTINCT FROM 'super_admin')
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Only admin can change fee schedule' USING ERRCODE = '42501';
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
$fn$;
$nx_ddl$;

  EXECUTE $nx_ddl$
COMMENT ON FUNCTION public.admin_set_fee_schedule(int, int, int, int, text) IS
  'GOD-MODE: admin (or super_admin) updates the global fee schedule. Reason required. Audit-correlated with before/after in the return jsonb.'
$nx_ddl$;

  EXECUTE $nx_ddl$
GRANT EXECUTE ON FUNCTION public.admin_set_fee_schedule(int, int, int, int, text) TO authenticated
$nx_ddl$;

EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode-fee skip: admin_set_fee_schedule (%)', SQLERRM;
END $nx_guard$;

COMMIT;
