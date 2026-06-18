-- ════════════════════════════════════════════════════════════════════════════
--  20260801151000_tax_center_foundation.sql
--
--  TAX CENTER (foundation) — "tax-info-before-money" gate, TOKENIZE route.
--
--  We are NOT the system of record for raw government IDs. Stripe (or a tax
--  vendor) holds the raw SSN/SIN/TIN; our DB stores only reference tokens,
--  status, form type, residency, a display-safe masked last-4, expiry, and
--  metadata. No raw PII columns here, by design.
--
--  Components:
--    • tax_profiles      — one row per payee (admin-or-self read; writes via RPC)
--    • tax_is_verified() — gate predicate (verified AND not expired)
--    • upsert_tax_profile()    — payee submits their tokenized form → 'submitted'
--    • admin_set_tax_status()  — admin/Stripe-callback marks verified/needs_update
--    • request_withdrawal()    — CREATE OR REPLACE: refuse payout unless verified
--                                (gate AFTER idempotency + open-request, BEFORE
--                                 balance, so replays/open-request still behave)
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tax_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tax_status           text NOT NULL DEFAULT 'not_started'
                         CHECK (tax_status IN ('not_started','in_progress','submitted','verified','needs_update')),
  form_type            text CHECK (form_type IS NULL OR form_type IN ('w9','w8ben','w8bene','t4a','dac7')),
  tax_residency_country text,                 -- ISO-3166 alpha-2
  stripe_tax_form_id   text,                  -- reference token (Stripe-held raw PII)
  stripe_account_ref   text,
  masked_tax_id        text,                  -- display-safe last-4 only, NEVER the raw TIN
  expires_at           timestamptz,           -- e.g. W-8BEN: 3 calendar years
  submitted_at         timestamptz,
  verified_at          timestamptz,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tax_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tax_profiles TO authenticated;       -- self-or-admin via policy
GRANT ALL    ON TABLE public.tax_profiles TO service_role;
DROP POLICY IF EXISTS tax_profiles_select_self_or_admin ON public.tax_profiles;
CREATE POLICY tax_profiles_select_self_or_admin ON public.tax_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.nx_is_admin());
-- No client write policy: status transitions happen ONLY via the RPCs below
-- (a user must never be able to self-set tax_status = 'verified').

-- ─── Gate predicate ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tax_is_verified(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tax_profiles
     WHERE user_id = p_uid
       AND tax_status = 'verified'
       AND (expires_at IS NULL OR expires_at > now())
  );
$$;

-- ─── Payee submits their tokenized form (owner-callable) ─────────────────────
CREATE OR REPLACE FUNCTION public.upsert_tax_profile(
  p_form_type          text,
  p_country            text,
  p_stripe_tax_form_id text DEFAULT NULL,
  p_masked_tax_id      text DEFAULT NULL,
  p_expires_at         timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000'; END IF;
  IF p_form_type IS NULL OR p_form_type NOT IN ('w9','w8ben','w8bene','t4a','dac7') THEN
    RAISE EXCEPTION 'INVALID_FORM_TYPE';
  END IF;

  INSERT INTO public.tax_profiles (user_id, tax_status, form_type, tax_residency_country,
        stripe_tax_form_id, masked_tax_id, expires_at, submitted_at, updated_at)
  VALUES (v_uid, 'submitted', p_form_type, p_country,
        p_stripe_tax_form_id, p_masked_tax_id, p_expires_at, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
        tax_status = 'submitted',
        form_type = EXCLUDED.form_type,
        tax_residency_country = EXCLUDED.tax_residency_country,
        stripe_tax_form_id = COALESCE(EXCLUDED.stripe_tax_form_id, public.tax_profiles.stripe_tax_form_id),
        masked_tax_id = COALESCE(EXCLUDED.masked_tax_id, public.tax_profiles.masked_tax_id),
        expires_at = EXCLUDED.expires_at,
        submitted_at = now(),
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'status', 'submitted');
END
$fn$;

-- ─── Admin / Stripe-callback sets the verification status ────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_tax_status(p_user_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Admin users OR service_role (Stripe webhook). Non-admin denied.
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('not_started','in_progress','submitted','verified','needs_update') THEN
    RAISE EXCEPTION 'INVALID_STATUS: %', p_status;
  END IF;

  UPDATE public.tax_profiles
     SET tax_status = p_status,
         verified_at = CASE WHEN p_status = 'verified' THEN now() ELSE verified_at END,
         updated_at = now()
   WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TAX_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'status', p_status);
END
$fn$;

REVOKE ALL ON FUNCTION public.tax_is_verified(uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_tax_profile(text,text,text,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_tax_status(uuid,text)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_is_verified(uuid)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_tax_profile(text,text,text,text,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_tax_status(uuid,text)            TO authenticated, service_role;
ALTER FUNCTION public.tax_is_verified(uuid)                       OWNER TO postgres;
ALTER FUNCTION public.upsert_tax_profile(text,text,text,text,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.admin_set_tax_status(uuid,text)            OWNER TO postgres;

-- ════════════════════════════════════════════════════════════════════════════
--  request_withdrawal — CREATE OR REPLACE with the tax-info-before-money gate.
--  Body is reproduced verbatim from the prod canonical overload + ONE added
--  gate (marked) after the open-request check and before the balance debit.
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

  -- Idempotent replay (returns BEFORE the tax gate, so a prior success replays
  -- even if the payee's tax later lapses).
  IF p_client_op_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.withdrawal_requests WHERE client_op_id = p_client_op_id;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'request_id', v_id); END IF;
  END IF;

  -- One open request at a time (also enforced by a partial unique index).
  IF EXISTS (SELECT 1 FROM public.withdrawal_requests WHERE requester_id = v_uid AND status IN ('requested','approved')) THEN
    RAISE EXCEPTION 'OPEN_REQUEST_EXISTS';
  END IF;

  -- ★ TAX-INFO-BEFORE-MONEY GATE — refuse a NEW payout unless tax is verified.
  IF NOT public.tax_is_verified(v_uid) THEN
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
  ELSE  -- supplier ledger (halalas minor units)
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
  IF to_regclass('public.tax_profiles') IS NULL
     OR to_regprocedure('public.tax_is_verified(uuid)') IS NULL
     OR to_regprocedure('public.upsert_tax_profile(text,text,text,text,timestamptz)') IS NULL
     OR to_regprocedure('public.admin_set_tax_status(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: tax center foundation incomplete';
  END IF;
  IF has_table_privilege('authenticated','public.tax_profiles','UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can UPDATE tax_profiles (must be RPC-only)';
  END IF;
  RAISE NOTICE 'tax center foundation ready (tokenized; tax-info-before-money gate live in request_withdrawal).';
END
$selftest$;
