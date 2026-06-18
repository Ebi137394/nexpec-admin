-- ════════════════════════════════════════════════════════════════════════════
--  20260801152000_tax_admin_exemption.sql
--
--  ADMIN OVERRIDE for the tax-info-before-money gate (Step 4 foundation, part 2).
--
--  The owner/admin must never be locked out by the platform's own gate: trusted
--  legacy partners, special international cases, and operational emergencies need
--  a manual exemption. Architecture: a BOOLEAN (is_tax_exempt) + an accountable
--  audit trail (exempt_reason / exempt_by / exempt_at), NOT an 'exempt' enum
--  state — exemption is orthogonal to the tax lifecycle and must record WHO/WHY.
--
--  Gate becomes: tax_can_withdraw(uid) = tax_is_verified(uid) OR is_tax_exempt.
--  Additive (ALTER … IF NOT EXISTS); ships held alongside 151000.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tax_profiles
  ADD COLUMN IF NOT EXISTS is_tax_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exempt_reason text,
  ADD COLUMN IF NOT EXISTS exempt_by     uuid,
  ADD COLUMN IF NOT EXISTS exempt_at     timestamptz;

-- ─── Gate predicate: verified OR admin-exempt ────────────────────────────────
CREATE OR REPLACE FUNCTION public.tax_can_withdraw(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tax_is_verified(p_uid)
      OR EXISTS (SELECT 1 FROM public.tax_profiles WHERE user_id = p_uid AND is_tax_exempt = true);
$$;

-- ─── Admin grants / revokes an exemption (accountable, audited) ──────────────
CREATE OR REPLACE FUNCTION public.admin_set_tax_exemption(
  p_user_id uuid,
  p_exempt  boolean,
  p_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_admin uuid := auth.uid();
BEGIN
  -- Admin users OR service_role (auth.uid() NULL). Non-admin denied.
  IF v_admin IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_exempt AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'EXEMPTION_REASON_REQUIRED';  -- exemptions must be justified
  END IF;

  INSERT INTO public.tax_profiles (user_id, is_tax_exempt, exempt_reason, exempt_by, exempt_at, updated_at)
  VALUES (p_user_id, p_exempt,
          CASE WHEN p_exempt THEN p_reason END,
          CASE WHEN p_exempt THEN v_admin END,
          CASE WHEN p_exempt THEN now() END,
          now())
  ON CONFLICT (user_id) DO UPDATE SET
        is_tax_exempt = p_exempt,
        exempt_reason = CASE WHEN p_exempt THEN p_reason ELSE NULL END,
        exempt_by     = CASE WHEN p_exempt THEN v_admin ELSE NULL END,
        exempt_at     = CASE WHEN p_exempt THEN now() ELSE NULL END,
        updated_at    = now();

  -- Accountable audit trail (append-only audit_events).
  INSERT INTO public.audit_events
    (event_type, severity, actor_id, actor_role, actor_label, subject_table, subject_id, summary, delta, metadata)
  VALUES (
    'tax.exemption_' || CASE WHEN p_exempt THEN 'granted' ELSE 'revoked' END,
    'warning', v_admin, 'admin', 'Tax Center', 'tax_profiles', p_user_id,
    CASE WHEN p_exempt THEN 'Tax exemption granted' ELSE 'Tax exemption revoked' END,
    '{}'::jsonb,
    jsonb_build_object('user_id', p_user_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'is_tax_exempt', p_exempt);
END
$fn$;

REVOKE ALL ON FUNCTION public.tax_can_withdraw(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_tax_exemption(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_can_withdraw(uuid)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_tax_exemption(uuid,boolean,text) TO authenticated, service_role;
ALTER FUNCTION public.tax_can_withdraw(uuid)               OWNER TO postgres;
ALTER FUNCTION public.admin_set_tax_exemption(uuid,boolean,text) OWNER TO postgres;

-- ════════════════════════════════════════════════════════════════════════════
--  request_withdrawal — gate now allows verified OR exempt (tax_can_withdraw).
--  Body identical to 151000 except the gate predicate.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount_cents bigint,
  p_method text DEFAULT 'bank_transfer',
  p_note text DEFAULT NULL,
  p_client_op_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_kind text;
  v_dollars numeric(12,2);
  v_avail numeric;
  v_avail_h bigint;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_method NOT IN ('bank_transfer','stripe_manual','other') THEN RAISE EXCEPTION 'INVALID_METHOD'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role = 'inspector' THEN v_kind := 'inspector';
  ELSIF v_role = 'supplier' THEN v_kind := 'supplier';
  ELSE RAISE EXCEPTION 'NOT_ELIGIBLE_FOR_PAYOUT'; END IF;

  IF p_client_op_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.withdrawal_requests WHERE client_op_id = p_client_op_id;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'request_id', v_id); END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.withdrawal_requests WHERE requester_id = v_uid AND status IN ('requested','approved')) THEN
    RAISE EXCEPTION 'OPEN_REQUEST_EXISTS';
  END IF;

  -- ★ TAX-INFO-BEFORE-MONEY GATE — verified OR admin-exempt.
  IF NOT public.tax_can_withdraw(v_uid) THEN
    RAISE EXCEPTION 'TAX_NOT_VERIFIED' USING ERRCODE = 'P0001';
  END IF;

  v_dollars := round(p_amount_cents::numeric / 100.0, 2);

  IF v_kind = 'inspector' THEN
    INSERT INTO public.wallets(user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
    SELECT available_balance INTO v_avail FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
    IF COALESCE(v_avail,0) < v_dollars THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.wallets
       SET available_balance = available_balance - v_dollars,
           pending_payouts   = COALESCE(pending_payouts,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_uid;
  ELSE
    SELECT available_balance_halalas INTO v_avail_h FROM public.supplier_earnings WHERE supplier_id = v_uid FOR UPDATE;
    IF COALESCE(v_avail_h,0) < p_amount_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.supplier_earnings
       SET available_balance_halalas = available_balance_halalas - p_amount_cents,
           pending_halalas           = COALESCE(pending_halalas,0) + p_amount_cents,
           updated_at = now()
     WHERE supplier_id = v_uid;
  END IF;

  INSERT INTO public.withdrawal_requests(requester_id, requester_role, amount_cents, status, method, destination_note, client_op_id)
  VALUES (v_uid, v_kind, p_amount_cents, 'requested', p_method, p_note, p_client_op_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'request_id', v_id, 'reserved_cents', p_amount_cents);
END $$;

ALTER FUNCTION public.request_withdrawal(bigint, text, text, uuid) OWNER TO postgres;

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regprocedure('public.tax_can_withdraw(uuid)') IS NULL
     OR to_regprocedure('public.admin_set_tax_exemption(uuid,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: tax exemption objects missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='tax_profiles' AND column_name='is_tax_exempt') THEN
    RAISE EXCEPTION 'SELFTEST: is_tax_exempt column missing';
  END IF;
  RAISE NOTICE 'tax admin exemption ready (boolean override + audit; gate = verified OR exempt).';
END
$selftest$;
