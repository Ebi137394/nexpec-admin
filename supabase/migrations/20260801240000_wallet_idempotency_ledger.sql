-- ============================================================================
--  20260801240000_wallet_idempotency_ledger.sql
--
--  RED TEAM P0/P1 — double-credit on duplicate/replayed Stripe events.
--
--  (A) restore_wallet_balance was a bare additive credit with NO idempotency:
--      a replayed `payout.failed` (Stripe retry after the release-and-retry
--      path) credited the wallet again. Now it records the Stripe event id in
--      wallet_restore_ledger and credits ONCE per event (replays no-op).
--      Signature gains p_event_id; the 2-arg version is dropped. The connect
--      webhook is updated to pass event.id (deploy together).
--
--  (B) wallet_credit_topup deduped on transactions.description='wallet_topup:<pi>'
--      via an EXISTS read with NO unique constraint behind it (TOCTOU under
--      concurrent deliveries). A partial UNIQUE index now backstops it at the
--      DB layer: a concurrent second credit's marker INSERT raises 23505 and
--      rolls back its whole transaction → exactly-once.
--
--  SAFE TO RE-RUN: IF NOT EXISTS / CREATE OR REPLACE; transactional; the dupe
--  pre-check fails loudly (not silently) if prod already has duplicate markers.
-- ============================================================================

BEGIN;

-- ── (A) idempotency ledger for wallet restores ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_restore_ledger (
  stripe_event_id text PRIMARY KEY,
  user_id         uuid        NOT NULL,
  amount_cents    bigint      NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_restore_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wallet_restore_ledger FROM PUBLIC, anon, authenticated;
-- service_role only (the webhook); no policies → authenticated/anon get nothing.

CREATE OR REPLACE FUNCTION public.restore_wallet_balance(
  p_user_id     uuid,
  p_amount_cents bigint,
  p_event_id    text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_inserted int;
BEGIN
  -- Service-role-only (the stripe-connect-webhook). A logged-in caller cannot
  -- mint into a wallet. service_role / trusted contexts have NULL auth.uid().
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: restore_wallet_balance is service-role only'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NULL OR length(btrim(p_event_id)) = 0 THEN
    RAISE EXCEPTION 'p_event_id (Stripe event/payout id) is required for idempotency'
      USING ERRCODE = '22000';
  END IF;

  -- First writer for this event wins; a replayed event no-ops (no double credit).
  INSERT INTO public.wallet_restore_ledger (stripe_event_id, user_id, amount_cents)
  VALUES (p_event_id, p_user_id, p_amount_cents)
  ON CONFLICT (stripe_event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN;  -- already restored for this Stripe event
  END IF;

  UPDATE public.wallets
     SET available_balance = available_balance + (p_amount_cents::numeric / 100.0),
         updated_at = now()
   WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.restore_wallet_balance(uuid, bigint, text) OWNER TO postgres;
REVOKE ALL    ON FUNCTION public.restore_wallet_balance(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_wallet_balance(uuid, bigint, text) TO service_role;

-- Drop the non-idempotent 2-arg version (the connect webhook now calls the
-- 3-arg form — deploy the function + push this migration together).
DROP FUNCTION IF EXISTS public.restore_wallet_balance(uuid, bigint);

-- ── (B) unique backstop for wallet_credit_topup idempotency ────────────────
DO $dup$
DECLARE
  v_dupes int;
BEGIN
  SELECT count(*) - count(DISTINCT description)
    INTO v_dupes
    FROM public.transactions
   WHERE description LIKE 'wallet_topup:%';
  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'cannot add unique index: % duplicate wallet_topup marker(s) already exist — dedupe before applying', v_dupes;
  END IF;
END
$dup$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_wallet_topup
  ON public.transactions (description)
  WHERE description LIKE 'wallet_topup:%';

-- ── Self-test ──────────────────────────────────────────────────────────────
DO $test$
BEGIN
  IF to_regprocedure('public.restore_wallet_balance(uuid,bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: non-idempotent 2-arg restore_wallet_balance still exists';
  END IF;
  IF to_regprocedure('public.restore_wallet_balance(uuid,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: idempotent 3-arg restore_wallet_balance missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_transactions_wallet_topup') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: wallet_topup unique backstop missing';
  END IF;
  RAISE NOTICE 'wallet idempotency sealed: restore credits once per Stripe event; topup unique-backed.';
END
$test$;

COMMIT;
