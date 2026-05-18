-- ════════════════════════════════════════════════════════════════════════════
--  20260512180000_wallet_topup_rpc.sql
--  NEXPEC — WALLET-DEPOSIT-001
--
--  Re-enables the gated Finance-tab Deposit flow. After STRIPE-003/004
--  the legacy "wallet topup via create-payment-intent" path was
--  intentionally killed (client-supplied amount = revenue-theft vector).
--  This migration delivers the trusted server-side credit RPC that the
--  new create-wallet-deposit-intent Edge Function + the existing
--  stripe-payments-webhook will route success events into.
--
--  Scope: INSPECTOR-ONLY.
--    The only wallet schema on disk today is public.inspector_earnings.
--    Clients / agencies have no wallet table. Top-ups for those roles
--    require a separate architectural strike (new table + RLS + UI).
--
--  Hard guarantees
--  ───────────────
--    1. SECURITY DEFINER, EXECUTE granted to service_role only — only
--       the Stripe webhook (server-side) can credit a wallet.
--    2. Idempotent at the business level. Keyed on
--       p_stripe_payment_intent_id: a second call with the same PI id
--       short-circuits and returns already_credited=true without
--       double-counting funds.
--    3. Audit-correlated. Writes a `wallet.topup_credited` event into
--       audit_events with the PI metadata.
--    4. Side-effect record. Inserts a row into public.transactions
--       (already-present in the earnings migration) tagged as a topup
--       so finance UI can render it.
--    5. Rejects amounts ≤ 0 and amounts above a hard cap (10,000 SAR ==
--       1,000,000 halalas) to prevent runaway credits even if the
--       Edge Function's validation drifts.
--
--  Reversible. Down path at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  UP
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. RPC: wallet_credit_topup ──────────────────────────────────────────
--
--  Called exclusively from the stripe-payments-webhook Edge Function
--  after a payment_intent.succeeded event with metadata.kind=='wallet_topup'.
--  All inputs are server-trusted (the Edge Function reads them from
--  Stripe's authenticated event payload, not from any client).

CREATE OR REPLACE FUNCTION public.wallet_credit_topup(
  p_user_id                   uuid,
  p_amount_halalas            bigint,
  p_stripe_payment_intent_id  text,
  p_transaction_ref_id        uuid,
  p_correlation_id            uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_correlation        uuid := COALESCE(p_correlation_id, gen_random_uuid());
  v_already_credited   boolean := false;
  v_new_balance        bigint;
BEGIN
  -- ── 1. Input validation ─────────────────────────────────────────
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_amount_halalas IS NULL OR p_amount_halalas <= 0 THEN
    RAISE EXCEPTION 'amount_halalas must be positive' USING ERRCODE = '22000';
  END IF;
  -- Hard server-side ceiling: 10,000 SAR per top-up. Mirrors the
  -- Edge Function cap; belt-and-braces in case the front-end drifts.
  IF p_amount_halalas > 1000000 THEN
    RAISE EXCEPTION 'amount_halalas exceeds per-topup cap (1,000,000)'
      USING ERRCODE = '22000';
  END IF;
  IF p_stripe_payment_intent_id IS NULL
     OR length(trim(p_stripe_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'stripe_payment_intent_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_transaction_ref_id IS NULL THEN
    RAISE EXCEPTION 'transaction_ref_id is required' USING ERRCODE = '22000';
  END IF;

  -- ── 2. Idempotency check ────────────────────────────────────────
  --   Stripe webhooks are at-least-once. If a transaction row already
  --   exists for this payment_intent_id, the credit has already been
  --   applied. Short-circuit. (The stripe_webhook_events ledger from
  --   STRIPE-001 catches DUPLICATE EVENT IDs; this check catches the
  --   rarer "same PI, different event_id" case — e.g. processing
  --   followed by succeeded.)
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE description = ('wallet_topup:' || p_stripe_payment_intent_id)
  ) THEN
    v_already_credited := true;

    SELECT available_balance_halalas
      INTO v_new_balance
      FROM public.inspector_earnings
     WHERE inspector_id = p_user_id;

    PERFORM public.audit_set_correlation(v_correlation);
    PERFORM public.audit_set_intent(
      'Wallet top-up duplicate (pi=' || p_stripe_payment_intent_id || ')'
    );
    INSERT INTO public.audit_events (
      event_type, severity,
      actor_id, actor_role, actor_label,
      subject_table, subject_id, job_id,
      summary, delta, metadata, correlation_id
    ) VALUES (
      'wallet.topup_duplicate',
      'info',
      NULL, 'system', 'Stripe webhook (wallet topup)',
      'profiles', p_user_id, NULL,
      'Wallet top-up duplicate event received — no double credit',
      '{}'::jsonb,
      jsonb_build_object(
        'user_id', p_user_id,
        'payment_intent_id', p_stripe_payment_intent_id,
        'transaction_ref_id', p_transaction_ref_id,
        'amount_halalas', p_amount_halalas
      ),
      v_correlation
    );

    RETURN jsonb_build_object(
      'ok', true,
      'user_id', p_user_id,
      'amount_halalas', p_amount_halalas,
      'already_credited', true,
      'new_balance_halalas', v_new_balance,
      'correlation_id', v_correlation
    );
  END IF;

  -- ── 3. Ensure the inspector_earnings row exists ─────────────────
  --   New inspectors may not have a row yet (it's created lazily on
  --   first credit). UPSERT pattern keeps the topup flow tolerant of
  --   that gap.
  INSERT INTO public.inspector_earnings (
    inspector_id, available_balance_halalas, total_earned_halalas
  )
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (inspector_id) DO NOTHING;

  -- ── 4. Credit the wallet ────────────────────────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent(
    'Wallet top-up credited (pi=' || p_stripe_payment_intent_id || ')'
  );

  UPDATE public.inspector_earnings
     SET available_balance_halalas = available_balance_halalas + p_amount_halalas,
         updated_at = now()
   WHERE inspector_id = p_user_id
  RETURNING available_balance_halalas INTO v_new_balance;

  -- Note: we deliberately do NOT bump total_earned_halalas — that
  -- field tracks money EARNED from jobs, not money the inspector
  -- pre-loaded into their own wallet. Keeps the "Total Earned" stat
  -- honest.

  -- ── 5. Record the transaction ──────────────────────────────────
  --   description is the idempotency key (see step 2). Don't change
  --   its shape without also updating the dup-check above.
  INSERT INTO public.transactions (
    inspector_id,
    job_id,
    description,
    gross_amount_halalas,
    platform_fee_halalas,
    status
  ) VALUES (
    p_user_id,
    NULL,                          -- top-ups aren't job-bound
    'wallet_topup:' || p_stripe_payment_intent_id,
    p_amount_halalas,
    0,                             -- no platform fee on a top-up
    'paid'
  );

  -- ── 6. Audit event ──────────────────────────────────────────────
  INSERT INTO public.audit_events (
    event_type, severity,
    actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id,
    summary, delta, metadata, correlation_id
  ) VALUES (
    'wallet.topup_credited',
    'info',
    NULL, 'system', 'Stripe webhook (wallet topup)',
    'profiles', p_user_id, NULL,
    'Wallet credited: ' ||
      to_char(p_amount_halalas::numeric / 100, 'FM999G999G990D00') ||
      ' SAR',
    jsonb_build_object(
      'after', jsonb_build_object(
        'available_balance_halalas', v_new_balance
      )
    ),
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_halalas', p_amount_halalas,
      'payment_intent_id', p_stripe_payment_intent_id,
      'transaction_ref_id', p_transaction_ref_id
    ),
    v_correlation
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'amount_halalas', p_amount_halalas,
    'already_credited', false,
    'new_balance_halalas', v_new_balance,
    'correlation_id', v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) IS
  'WALLET-DEPOSIT-001: Server-trusted wallet credit for a Stripe-backed top-up. Service-role only — called from the stripe-payments-webhook Edge Function on payment_intent.succeeded events with metadata.kind=wallet_topup. Idempotent on payment_intent_id; capped at 1,000,000 halalas per call.';

REVOKE EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) TO service_role;

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. Function exists, service_role only
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
-- WHERE routine_schema='public' AND routine_name='wallet_credit_topup';
-- Expected: only service_role with EXECUTE.

-- B. Idempotency end-to-end
-- BEGIN;
--   SELECT public.wallet_credit_topup(
--     '<inspector-uuid>', 5000, 'pi_smoke_1', gen_random_uuid(), NULL
--   );
--   -- First call: ok=true, already_credited=false, balance +5000.
--   SELECT public.wallet_credit_topup(
--     '<inspector-uuid>', 5000, 'pi_smoke_1', gen_random_uuid(), NULL
--   );
--   -- Second call: ok=true, already_credited=true, balance UNCHANGED.
-- ROLLBACK;

-- C. Cap enforcement
-- SELECT public.wallet_credit_topup(
--   '<inspector-uuid>', 1000001, 'pi_smoke_cap', gen_random_uuid(), NULL
-- );
-- Expected: ERROR 22000 — exceeds per-topup cap.


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback)
-- ────────────────────────────────────────────────────────────────────────────
--  BEGIN;
--    DROP FUNCTION IF EXISTS public.wallet_credit_topup(uuid, bigint, text, uuid, uuid);
--  COMMIT;
