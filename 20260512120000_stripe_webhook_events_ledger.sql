-- ════════════════════════════════════════════════════════════════════════════
--  20260512120000_stripe_webhook_events_ledger.sql
--  NEXPEC — STRIPE-001 strike: idempotency ledger for Stripe webhook deliveries.
--
--  Stripe delivers webhooks at-least-once. Without an idempotency guard,
--  retried deliveries re-apply every state mutation in the handler —
--  including the wallet-restore RPC, which is NOT idempotent. This ledger
--  is the test-and-set surface used by the webhook to detect duplicates.
--
--  Design:
--    • Append-only. event_id is the primary key; ON CONFLICT is the
--      duplicate signal.
--    • Service-role only. No RLS policies for authenticated — RLS is
--      enabled with no SELECT/INSERT/UPDATE/DELETE policy, so default-deny
--      kicks in for every non-bypass role. Edge Functions write via
--      service-role (bypasses RLS); nothing else can read or write.
--    • Full event payload retained for replay / debugging. Disk is
--      cheap; investigation blind spots are expensive.
--
--  Reversible. Down path at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  UP
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id     text        PRIMARY KEY,
  type         text        NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  payload      jsonb
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_received_at_idx
  ON public.stripe_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_type_idx
  ON public.stripe_webhook_events (type, received_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- No policies. Default-deny for every role. Service role (used by Edge
-- Functions) bypasses RLS — that's the only writer / reader.

COMMENT ON TABLE public.stripe_webhook_events IS
  'STRIPE-001: Idempotency ledger for Stripe webhook deliveries. Append-only. Service-role only. INSERT ON CONFLICT detects duplicate retries from Stripe.';

COMMENT ON COLUMN public.stripe_webhook_events.event_id IS
  'Stripe event id (evt_*). Primary key — ON CONFLICT signals a duplicate delivery so the handler can short-circuit with 200.';

COMMENT ON COLUMN public.stripe_webhook_events.type IS
  'Stripe event.type (e.g. account.updated, payout.paid). Indexed for ops queries by event family.';

COMMENT ON COLUMN public.stripe_webhook_events.received_at IS
  'Wall-clock time we wrote the ledger row. Distinct from event.created which is Stripe-side.';

COMMENT ON COLUMN public.stripe_webhook_events.payload IS
  'Full Stripe Event object retained for debugging / replay. JSONB.';

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. Table + indexes landed
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='stripe_webhook_events'
-- ORDER BY ordinal_position;
--
-- SELECT indexname FROM pg_indexes
-- WHERE tablename='stripe_webhook_events';

-- B. RLS enabled, no policies (default-deny for authenticated)
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relname='stripe_webhook_events';
-- Expected: relrowsecurity = t
--
-- SELECT policyname FROM pg_policies
-- WHERE tablename='stripe_webhook_events';
-- Expected: zero rows

-- C. Idempotency behavior — duplicate INSERTs are rejected with 23505
-- BEGIN;
--   INSERT INTO public.stripe_webhook_events (event_id, type) VALUES ('evt_test', 'account.updated');
--   -- Second INSERT should raise unique_violation:
--   INSERT INTO public.stripe_webhook_events (event_id, type) VALUES ('evt_test', 'account.updated');
-- ROLLBACK;
-- Expected: second statement → ERROR 23505 unique_violation


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback — Supabase CLI does not auto-execute down sections)
-- ────────────────────────────────────────────────────────────────────────────
--  Copy/paste the block below into the SQL editor if a rollback is needed.
--
--  BEGIN;
--    DROP INDEX IF EXISTS public.stripe_webhook_events_type_idx;
--    DROP INDEX IF EXISTS public.stripe_webhook_events_received_at_idx;
--    DROP TABLE IF EXISTS public.stripe_webhook_events;
--  COMMIT;
