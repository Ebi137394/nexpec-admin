-- ════════════════════════════════════════════════════════════════════════════
--  20260512190000_wallet_topup_rpc_schema_fix.sql
--  NEXPEC — WALLET-SCHEMA-DRIFT-001
--
--  Hotfix for WALLET-DEPOSIT-001. The original migration
--  (20260512180000_wallet_topup_rpc.sql) wrote `inspector_earnings.
--  inspector_id` and `transactions.inspector_id` — those names came
--  from the on-disk migration (20250219120000_create_earnings_tables.sql).
--
--  An information_schema probe revealed live-DB drift:
--    • inspector_earnings.inspector_id  → DOES NOT EXIST
--    • inspector_earnings.user_id        → EXISTS (the actual column)
--    • transactions.inspector_id          → EXISTS (legacy, NOT NULL)
--    • transactions.user_id               → ALSO EXISTS (added later)
--
--  Net behaviour pre-fix: every wallet_credit_topup() call from the
--  Stripe webhook errored with 42703 (undefined column). Test deposits
--  appeared to succeed (Stripe Payment Sheet confirmed) but the
--  webhook returned 500, Stripe queued retries, the inspector's
--  available_balance_halalas was never credited.
--
--  This migration redefines wallet_credit_topup() to read/write the
--  correct columns AND populate both transactions.user_id and
--  transactions.inspector_id (defensive against the legacy NOT NULL).
--  Idempotency contract is unchanged (description column).
--
--  Reversible. Re-running is safe — CREATE OR REPLACE FUNCTION.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  UP
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

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
  v_row_exists         boolean;
BEGIN
  -- ── 1. Input validation ─────────────────────────────────────────
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_amount_halalas IS NULL OR p_amount_halalas <= 0 THEN
    RAISE EXCEPTION 'amount_halalas must be positive' USING ERRCODE = '22000';
  END IF;
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
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE description = ('wallet_topup:' || p_stripe_payment_intent_id)
  ) THEN
    v_already_credited := true;

    -- ★ DRIFT FIX: read by user_id, not inspector_id.
    SELECT available_balance_halalas
      INTO v_new_balance
      FROM public.inspector_earnings
     WHERE user_id = p_user_id;

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
  -- ★ DRIFT FIX: replaced the ON CONFLICT (inspector_id) UPSERT with a
  --   defensive NOT-EXISTS pattern. ON CONFLICT requires a unique
  --   constraint on the target column; we don't have a confirmed
  --   UNIQUE on user_id in the live schema (the on-disk migration only
  --   declares a non-unique index). The NOT EXISTS pattern works
  --   regardless and is safe under the SECURITY DEFINER scope.
  SELECT EXISTS (
    SELECT 1 FROM public.inspector_earnings WHERE user_id = p_user_id
  ) INTO v_row_exists;

  IF NOT v_row_exists THEN
    INSERT INTO public.inspector_earnings (
      user_id, available_balance_halalas, total_earned_halalas
    )
    VALUES (p_user_id, 0, 0);
  END IF;

  -- ── 4. Credit the wallet ────────────────────────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent(
    'Wallet top-up credited (pi=' || p_stripe_payment_intent_id || ')'
  );

  UPDATE public.inspector_earnings
     SET available_balance_halalas = available_balance_halalas + p_amount_halalas,
         updated_at = now()
   WHERE user_id = p_user_id
  RETURNING available_balance_halalas INTO v_new_balance;

  -- Note: deliberately NOT bumping total_earned_halalas — that tracks
  -- money earned FROM jobs, not money pre-loaded by the inspector. Same
  -- rationale as the original migration.

  -- ── 5. Record the transaction ──────────────────────────────────
  -- ★ DRIFT FIX: insert into BOTH user_id (canonical) and inspector_id
  --   (legacy NOT NULL) with the same value. The information_schema
  --   probe confirmed both columns exist on transactions in the live
  --   schema; the original CREATE TABLE migration declared inspector_id
  --   as NOT NULL, so we must populate it or the INSERT fails.
  INSERT INTO public.transactions (
    user_id,
    inspector_id,
    job_id,
    description,
    gross_amount_halalas,
    platform_fee_halalas,
    status
  ) VALUES (
    p_user_id,
    p_user_id,
    NULL,
    'wallet_topup:' || p_stripe_payment_intent_id,
    p_amount_halalas,
    0,
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
  'WALLET-DEPOSIT-001 + WALLET-SCHEMA-DRIFT-001 fix: aligns reads/writes with the live inspector_earnings.user_id column (not inspector_id) and populates both transactions.user_id + transactions.inspector_id for legacy NOT NULL compat.';

-- Privilege grants unchanged from the original migration.
REVOKE EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, bigint, text, uuid, uuid) TO service_role;

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. Function body now references user_id, not inspector_id
-- SELECT pg_get_functiondef('public.wallet_credit_topup(uuid, bigint, text, uuid, uuid)'::regprocedure);
-- Visually scan for `WHERE user_id =` and the dual transactions INSERT.

-- B. Idempotency end-to-end on the live schema
-- BEGIN;
--   SELECT public.wallet_credit_topup(
--     '<your-inspector-uuid>', 5000, 'pi_smoke_drift_fix', gen_random_uuid(), NULL
--   );
--   -- Expected: ok=true, already_credited=false, new_balance_halalas = current+5000.
--
--   SELECT public.wallet_credit_topup(
--     '<your-inspector-uuid>', 5000, 'pi_smoke_drift_fix', gen_random_uuid(), NULL
--   );
--   -- Expected: ok=true, already_credited=true, new_balance_halalas UNCHANGED.
-- ROLLBACK;

-- C. Stripe-queued retry recovery
--   Any previously-failed payment_intent.succeeded webhooks for wallet
--   top-ups (from your earlier test deposit) WILL re-fire automatically
--   once Stripe retries them. They should now succeed and credit the
--   wallet. No manual replay required.


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback)
-- ────────────────────────────────────────────────────────────────────────────
--  Reverting this hotfix means re-creating the buggy version, which has
--  no benefit. The migration is forward-only in practice.
--  If absolutely needed:
--    Re-run 20260512180000_wallet_topup_rpc.sql (the original buggy version).
