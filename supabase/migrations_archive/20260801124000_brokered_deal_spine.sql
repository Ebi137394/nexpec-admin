-- ============================================================================
--  20260801124000_brokered_deal_spine.sql   — P0 of the Brokered Deal blueprint
--  (docs/architecture/brokered-deal-blueprint.md)
--
--  Introduces the hub-and-spoke contract spine that unifies the direct and
--  turnkey flows: a `deals` aggregate that owns N `agreements`, where NEXPEC is
--  a party to EVERY agreement (client_supply | supplier_supply |
--  inspector_engagement). There is never a contract edge Client↔Supplier or
--  Client↔Inspector — price-blindness (Golden Rule 2) and anti-poaching fall
--  out of the topology.
--
--  P0 SCOPE = the spine only (ADDITIVE, non-destructive):
--    • tables: deals, agreements, agreement_signatures
--    • party-projected views: client / supplier / inspector (one money figure
--      each, no spread) — base-table RLS keyed on counterparty_id makes a leg
--      unreadable to anyone but its own counterparty + nx_is_admin().
--  Legacy job_contracts / supplier_contracts keep operating untouched. Their
--  ADOPTION/backfill is intentionally deferred to P1, where it runs atomically
--  with the saga + the application cut-over and after staging validation — a
--  legacy job_contract carries the DUAL blind price (client + inspector) and
--  must be SPLIT into a client_supply + inspector_engagement pair under a new
--  deal, which is not safe to do blind in a standalone migration.
--
--  Approved executive decisions (blueprint §13) recorded for downstream phases:
--    1. Escrow funds on client signature (P1 saga).
--    2. Auto-approve window: standard 24h / enterprise 48h / named manual (P3).
--    3. Named tier leads with a redacted CV (P4).
--    4. New `deals` aggregate (this migration).
--    5. Inspector identity revealed to the client on FINAL REPORT signature (P3
--       client_assigned_inspector_view) — compliance (ASME/API audit files);
--       risk mitigated because money is escrowed + non-circumvention is signed
--       by that stage.
--
--  Idempotent + safe to re-run. Depends only on: profiles, supplier_rfqs, jobs,
--  public.nx_is_admin().
-- ============================================================================

BEGIN;

-- ── shared updated_at trigger fn ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ── 1. deals — the aggregate root (1:1 with an RFQ award or a direct job) ─────
CREATE TABLE IF NOT EXISTS public.deals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id              uuid REFERENCES public.supplier_rfqs(id) ON DELETE SET NULL,  -- turnkey origin
  job_id              uuid REFERENCES public.jobs(id)          ON DELETE SET NULL,  -- inspection job (once spawned)
  client_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'forming'
                      CHECK (status IN ('forming','awaiting_client_signature','funded','dispatched','in_delivery','closed','cancelled')),
  -- frozen client-price snapshot (protects the markup from drift). CLIENT PRICE ONLY.
  client_price_cents  bigint NOT NULL DEFAULT 0 CHECK (client_price_cents >= 0),
  currency            text NOT NULL DEFAULT 'USD',
  transparency_tier   text NOT NULL DEFAULT 'standard'
                      CHECK (transparency_tier IN ('standard','enterprise','named')),
  created_by          uuid REFERENCES public.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  cancelled_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_deals_client ON public.deals(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_rfq    ON public.deals(rfq_id);
CREATE INDEX IF NOT EXISTS idx_deals_job    ON public.deals(job_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON public.deals(status);
DROP TRIGGER IF EXISTS trg_deals_touch ON public.deals;
CREATE TRIGGER trg_deals_touch BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.nx_set_updated_at();

-- ── 2. agreements — the polymorphic contract spine (NEXPEC on one side) ───────
CREATE TABLE IF NOT EXISTS public.agreements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE RESTRICT,
  kind              text NOT NULL CHECK (kind IN ('client_supply','supplier_supply','inspector_engagement')),
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','presented','signed','countersigned','executed','amended','voided')),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id     uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  counterparty_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,  -- the non-NEXPEC party
  -- exactly ONE money figure per leg: client_price | supplier_cost | inspector_payout.
  -- the spread is never stored on a leg → price-blindness by construction.
  amount_cents      bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency          text NOT NULL DEFAULT 'USD',
  -- rendered + sealed content
  body_md           text,
  content_sha256    text,                       -- nullable: legacy job_contracts were not sha-sealed
  ots_proof         jsonb,
  ots_status        text NOT NULL DEFAULT 'unsubmitted'
                    CHECK (ots_status IN ('unsubmitted','pending','bitcoin_confirmed','failed')),
  seal_id           uuid,                       -- → /passport/<seal_id>
  -- lifecycle stamps
  presented_at      timestamptz,
  signed_at         timestamptz,                -- counterparty signature
  countersigned_at  timestamptz,                -- NEXPEC signature
  executed_at       timestamptz,
  voided_at         timestamptz,
  voided_reason     text,
  generated_by      uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, kind, version)
);
CREATE INDEX IF NOT EXISTS idx_agreements_deal         ON public.agreements(deal_id);
CREATE INDEX IF NOT EXISTS idx_agreements_counterparty ON public.agreements(counterparty_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_agreements_status       ON public.agreements(status);
DROP TRIGGER IF EXISTS trg_agreements_touch ON public.agreements;
CREATE TRIGGER trg_agreements_touch BEFORE UPDATE ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public.nx_set_updated_at();

-- ── 3. agreement_signatures — non-repudiation audit (per party, per version) ──
CREATE TABLE IF NOT EXISTS public.agreement_signatures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id   uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  signer_id      uuid NOT NULL REFERENCES public.profiles(id),
  party_role     text NOT NULL CHECK (party_role IN ('client','supplier','inspector','nexpec')),
  signed_name    text,
  signed_sha256  text,                          -- hash of the exact version signed (matches agreements.content_sha256)
  signed_at      timestamptz NOT NULL DEFAULT now(),
  ip             text,
  user_agent     text
);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_agreement ON public.agreement_signatures(agreement_id);

-- ── 4. RLS — base-table privity (this is where price-blindness is enforced) ───
--   A leg is readable ONLY by its own counterparty (+ admin). A client is the
--   counterparty of client_supply only, so it can never read the supplier or
--   inspector legs from the base table. Writes are RPC/service-role only.
ALTER TABLE public.deals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deals_select ON public.deals;
CREATE POLICY deals_select ON public.deals
  FOR SELECT TO authenticated USING (client_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS deals_service_all ON public.deals;
CREATE POLICY deals_service_all ON public.deals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS agreements_select ON public.agreements;
CREATE POLICY agreements_select ON public.agreements
  FOR SELECT TO authenticated USING (counterparty_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS agreements_service_all ON public.agreements;
CREATE POLICY agreements_service_all ON public.agreements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS agreement_signatures_select ON public.agreement_signatures;
CREATE POLICY agreement_signatures_select ON public.agreement_signatures
  FOR SELECT TO authenticated USING (
    signer_id = auth.uid()
    OR public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.agreements a
               WHERE a.id = agreement_id AND a.counterparty_id = auth.uid())
  );
DROP POLICY IF EXISTS agreement_signatures_service_all ON public.agreement_signatures;
CREATE POLICY agreement_signatures_service_all ON public.agreement_signatures
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.deals, public.agreements, public.agreement_signatures TO authenticated;

-- ── 5. Party-projected views — ONE money figure each, no spread ───────────────
--   Owner-run + security_barrier (mirrors supplier_directory). Latest version
--   per leg via LATERAL. Admin (god-mode) sees all rows via the WHERE gate.

DROP VIEW IF EXISTS public.client_deal_view;
CREATE VIEW public.client_deal_view WITH (security_barrier = true) AS
  SELECT d.id AS deal_id, d.status AS deal_status, d.client_price_cents, d.currency,
         d.transparency_tier, d.rfq_id, d.job_id, d.created_at,
         a.id AS client_agreement_id, a.status AS client_agreement_status,
         a.seal_id AS client_agreement_seal_id, a.presented_at, a.executed_at
  FROM public.deals d
  LEFT JOIN LATERAL (
    SELECT x.* FROM public.agreements x
    WHERE x.deal_id = d.id AND x.kind = 'client_supply'
    ORDER BY x.version DESC LIMIT 1
  ) a ON true
  WHERE d.client_id = auth.uid() OR public.nx_is_admin();

DROP VIEW IF EXISTS public.supplier_deal_view;
CREATE VIEW public.supplier_deal_view WITH (security_barrier = true) AS
  SELECT a.deal_id, a.id AS agreement_id, a.status, a.amount_cents AS cost_cents, a.currency,
         a.seal_id, a.presented_at, a.executed_at, d.job_id, d.rfq_id
  FROM public.agreements a
  JOIN public.deals d ON d.id = a.deal_id
  WHERE a.kind = 'supplier_supply'
    AND (a.counterparty_id = auth.uid() OR public.nx_is_admin());

DROP VIEW IF EXISTS public.inspector_deal_view;
CREATE VIEW public.inspector_deal_view WITH (security_barrier = true) AS
  SELECT a.deal_id, a.id AS agreement_id, a.status, a.amount_cents AS payout_cents, a.currency,
         a.seal_id, a.presented_at, a.executed_at, d.job_id
  FROM public.agreements a
  JOIN public.deals d ON d.id = a.deal_id
  WHERE a.kind = 'inspector_engagement'
    AND (a.counterparty_id = auth.uid() OR public.nx_is_admin());

GRANT SELECT ON public.client_deal_view, public.supplier_deal_view, public.inspector_deal_view TO authenticated;

-- ── 6. Self-tests (structural + price-blindness column guards) ─────────────────
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.deals') IS NULL
     OR to_regclass('public.agreements') IS NULL
     OR to_regclass('public.agreement_signatures') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: spine tables missing';
  END IF;

  -- RLS must be enabled on all three.
  SELECT count(*) INTO n FROM pg_tables t
   WHERE t.schemaname='public' AND t.tablename IN ('deals','agreements','agreement_signatures')
     AND t.rowsecurity = true;
  IF n <> 3 THEN RAISE EXCEPTION 'SELFTEST: RLS not enabled on all spine tables (% of 3)', n; END IF;

  -- Price-blindness: each projection exposes ONLY its own money column.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='client_deal_view'
               AND column_name IN ('cost_cents','payout_cents','amount_cents')) THEN
    RAISE EXCEPTION 'SELFTEST: client_deal_view leaks supplier/inspector money';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='supplier_deal_view'
               AND column_name IN ('client_price_cents','payout_cents')) THEN
    RAISE EXCEPTION 'SELFTEST: supplier_deal_view leaks client/inspector money';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='inspector_deal_view'
               AND column_name IN ('client_price_cents','cost_cents')) THEN
    RAISE EXCEPTION 'SELFTEST: inspector_deal_view leaks client/supplier money';
  END IF;

  RAISE NOTICE 'Brokered Deal spine OK: deals + agreements + signatures + 3 price-blind views; RLS on; legacy contracts untouched (adoption is P1).';
END $$;

COMMIT;
