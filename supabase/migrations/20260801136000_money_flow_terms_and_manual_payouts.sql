-- ════════════════════════════════════════════════════════════════════════════
--  20260801136000_money_flow_terms_and_manual_payouts.sql   (PHASE 1 — schema)
--
--  Re-architects the money model to protect platform cash flow and give the
--  operator total control. Two operator decisions drive this:
--    1) Support ALL THREE client payment modes from day one:
--         • prepay     — client funds escrow up front (existing flow)
--         • net_terms  — B2B credit (Net-15/30/45/60); inspector earnings ACCRUE
--                        and only become withdrawable AFTER the client settles.
--         • (advance)  — inspectors may opt to be paid early for a fee
--                        (Option C) — modeled by public.payout_advances.
--    2) Payouts are 100% MANUAL. Inspectors/suppliers REQUEST a payout; that
--       creates a row in public.withdrawal_requests for the admin dashboard.
--       The operator wires funds OUTSIDE the system, then clicks "Mark as Paid"
--       which (Phase 2 RPC) debits the wallet's available balance. There is NO
--       automated Stripe Connect payout.
--
--  SAFETY: this migration is ADDITIVE and idempotent. It does NOT touch wallet
--  balance internals (available_balance/escrow_amount are numeric; transactions
--  use *_halalas; jobs use *_cents — the balance-mutating RPCs land in Phase 2
--  once those exact column types are confirmed, so real-money math is exact).
--  New money columns/tables use *_cents (bigint) to align with the job pricing
--  flow (jobs.client_price_cents / inspector_payout_cents). CHECK constraints on
--  pre-existing columns are added NOT VALID so apply never scans/rejects live rows.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ─── 1. Job payment mode + client-settlement lifecycle ──────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS payment_mode        text NOT NULL DEFAULT 'prepay',
  ADD COLUMN IF NOT EXISTS client_invoiced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS client_settled_at   timestamptz;

COMMENT ON COLUMN public.jobs.payment_mode IS
  'prepay = client funds escrow up front; net_terms = B2B credit, inspector funds clear only after client_settled_at.';
COMMENT ON COLUMN public.jobs.client_settled_at IS
  'When the client actually paid NEXPEC. On net_terms jobs this is the event that moves inspector earnings Pending → Available (Phase 2).';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_payment_mode_chk') THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_payment_mode_chk CHECK (payment_mode IN ('prepay','net_terms')) NOT VALID;
  END IF;
END $$;

-- Constrain the previously free-text escrow_status (defensive; NOT VALID so it
-- never rejects historical rows, only governs new writes).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_escrow_status_chk') THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_escrow_status_chk
      CHECK (escrow_status IN ('pending','funded','released','refunded','disputed')) NOT VALID;
  END IF;
END $$;

-- ─── 2. Client B2B credit terms (distinct from inspector rate-card terms) ────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS client_payment_terms      text   NOT NULL DEFAULT 'prepay',
  ADD COLUMN IF NOT EXISTS client_credit_limit_cents bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.client_payment_terms IS
  'B2B credit posture this client gets when POSTING jobs: prepay (default, unvetted) or net_15/30/45/60 (granted privilege). Separate from profiles.payment_terms which is the inspector rate-card term.';
COMMENT ON COLUMN public.profiles.client_credit_limit_cents IS
  'Max outstanding (invoiced-but-unsettled) net_terms exposure NEXPEC will extend this client. 0 = no credit (prepay only).';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_client_terms_chk') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_client_terms_chk
      CHECK (client_payment_terms IN ('prepay','net_15','net_30','net_45','net_60')) NOT VALID;
  END IF;
END $$;

-- ─── 3. Manual payout model: withdrawal_requests ────────────────────────────
--   Clean, versioned table (the legacy ghost public.payout_requests + the
--   Custom/CAD process-payout path are retired in Phase 2). Writes happen ONLY
--   through SECURITY DEFINER RPCs (Phase 2): request_withdrawal / mark-paid /
--   reject. No client write access.
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_role   text NOT NULL CHECK (requester_role IN ('inspector','supplier')),
  amount_cents     bigint NOT NULL CHECK (amount_cents > 0),
  status           text NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested','approved','paid','rejected','cancelled')),
  -- payout destination is informational; money moves OUTSIDE the platform
  method           text CHECK (method IS NULL OR method IN ('bank_transfer','stripe_manual','other')),
  destination_note text,
  -- lifecycle / audit
  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by       uuid,
  paid_at          timestamptz,
  marked_paid_by   uuid,
  external_reference text,            -- the wire / transfer reference the admin records
  admin_note       text,
  reject_reason    text,
  client_op_id     uuid,              -- idempotency key for request creation
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_client_op_key
  ON public.withdrawal_requests (client_op_id) WHERE client_op_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS withdrawal_requests_requester_idx
  ON public.withdrawal_requests (requester_id, status);
CREATE INDEX IF NOT EXISTS withdrawal_requests_queue_idx
  ON public.withdrawal_requests (status, requested_at);
-- One open request per requester at a time (prevents double-spend races).
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_one_open_per_user
  ON public.withdrawal_requests (requester_id)
  WHERE status IN ('requested','approved');

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS withdrawal_requests_select ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_select ON public.withdrawal_requests
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR public.nx_is_admin());
GRANT SELECT ON public.withdrawal_requests TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.withdrawal_requests FROM anon, authenticated;

-- ─── 4. Option C: monetized early payout (advance / factoring) ───────────────
CREATE TABLE IF NOT EXISTS public.payout_advances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_role        text NOT NULL CHECK (requester_role IN ('inspector','supplier')),
  job_id                uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  gross_cents           bigint NOT NULL CHECK (gross_cents > 0),     -- accrued amount being advanced
  fee_bps               int    NOT NULL DEFAULT 0 CHECK (fee_bps >= 0 AND fee_bps <= 10000),
  fee_cents             bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  net_cents             bigint NOT NULL CHECK (net_cents > 0),       -- gross - fee, paid now
  status                text NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested','approved','funded','recovered','rejected','cancelled')),
  funded_by             text CHECK (funded_by IS NULL OR funded_by IN ('platform','partner')),
  withdrawal_request_id uuid REFERENCES public.withdrawal_requests(id) ON DELETE SET NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  funded_at             timestamptz,
  recovered_at          timestamptz,        -- when the client finally settled and the advance was recouped
  decided_by            uuid,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_advances_net_lte_gross') THEN
    ALTER TABLE public.payout_advances
      ADD CONSTRAINT payout_advances_net_lte_gross CHECK (net_cents <= gross_cents);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payout_advances_requester_idx ON public.payout_advances (requester_id, status);
CREATE INDEX IF NOT EXISTS payout_advances_queue_idx ON public.payout_advances (status, requested_at);

ALTER TABLE public.payout_advances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_advances_select ON public.payout_advances;
CREATE POLICY payout_advances_select ON public.payout_advances
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR public.nx_is_admin());
GRANT SELECT ON public.payout_advances TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payout_advances FROM anon, authenticated;

-- ─── Self-test ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.withdrawal_requests') IS NULL THEN RAISE EXCEPTION 'SELFTEST: withdrawal_requests missing'; END IF;
  IF to_regclass('public.payout_advances') IS NULL THEN RAISE EXCEPTION 'SELFTEST: payout_advances missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='withdrawal_requests' AND relrowsecurity) THEN RAISE EXCEPTION 'SELFTEST: RLS not enabled on withdrawal_requests'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='payout_advances' AND relrowsecurity) THEN RAISE EXCEPTION 'SELFTEST: RLS not enabled on payout_advances'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='payment_mode') THEN RAISE EXCEPTION 'SELFTEST: jobs.payment_mode missing'; END IF;
  RAISE NOTICE 'Phase 1 money-flow schema ready: payment_mode + client terms + withdrawal_requests + payout_advances (manual payouts, RLS-locked).';
END $$;

COMMIT;
