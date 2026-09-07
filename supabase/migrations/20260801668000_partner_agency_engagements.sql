-- ════════════════════════════════════════════════════════════════════════════
--  20260801668000_partner_agency_engagements.sql
--
--  NEXPEC-managed partner-agency collaboration.
--
--  Agency A (the originating customer) requests an inspection. Agency B (a
--  verified partner) nominates a NAMED inspector. NEXPEC brokers, prices and
--  settles. Three amounts are agreed SEPARATELY, and no party may see another
--  party's number.
--
--  ── WHY NEW TABLES RATHER THAN THE SUPPLIER RFQ SPINE ──────────────────────
--  supplier_quotes.quote is a supplier's GROSS price for supplying goods or a
--  service outright. This model is different in kind: Agency B receives its own
--  COMMISSION, and the inspector is paid separately and directly. Overloading
--  `quote` to mean "commission" would corrupt every ordinary supplier RFQ and
--  every existing supplier contract that reads it as a gross price. The
--  commercial components are therefore typed explicitly here.
--
--  ── CAPABILITY, NOT ROLE ───────────────────────────────────────────────────
--  profiles.role is a single global value, so making an agency a "supplier"
--  would remove its buyer portal. Partner standing is a separate CAPABILITY
--  (public.partner_agencies) plus JOB-LEVEL permission. One organisation can be
--  a buyer on one engagement and a partner on another with no role change.
--  Nothing here reads profiles.role.
--
--  ── NO MONEY MOVES ─────────────────────────────────────────────────────────
--  settlement_obligations records WHAT IS OWED and its lifecycle
--  (due -> approved -> invoiced -> paid). It initiates no transfer, touches no
--  Stripe object and no wallet. Marking `paid` is an Admin record of an
--  external bank transfer, never a payment instruction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Partner capability ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_agencies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The partner is an ACCOUNT (and optionally an organisation). Keyed on the
  -- account because acceptance and settlement need a signatory identity.
  partner_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id       uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','suspended','revoked')),
  display_name text,
  notes        text,
  approved_by  uuid REFERENCES public.profiles(id),
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_agencies_unique_account UNIQUE (partner_id)
);

COMMENT ON TABLE public.partner_agencies IS
  'Partner-agency capability. Deliberately separate from profiles.role so one '
  'organisation can buy on one engagement and partner on another.';

-- ── 2. Per-job participation policy ───────────────────────────────────────
-- A job is NEVER visible to partners unless BOTH the customer has consented
-- and an admin has approved. Two independent gates, neither implied.
CREATE TABLE IF NOT EXISTS public.job_partner_policy (
  job_id              uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  customer_consented  boolean NOT NULL DEFAULT false,
  customer_consent_by uuid REFERENCES public.profiles(id),
  customer_consent_at timestamptz,
  admin_approved      boolean NOT NULL DEFAULT false,
  admin_approved_by   uuid REFERENCES public.profiles(id),
  admin_approved_at   timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Invitations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_opportunities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  partner_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited','viewed','declined','nominated','closed')),
  invited_by  uuid REFERENCES public.profiles(id),
  invited_at  timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_opportunities_unique UNIQUE (job_id, partner_id)
);

-- ── 4. Named-inspector nominations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_nominations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.partner_opportunities(id) ON DELETE CASCADE,
  job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  partner_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- A NAMED person with their own account. "We have someone" is not a
  -- nomination, so this is NOT NULL.
  inspector_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed','withdrawn','rejected','accepted','superseded')),
  proposed_note  text,
  created_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Two partners cannot both hold a live claim on the same inspector for the
-- same job, and one partner cannot nominate the same person twice.
CREATE UNIQUE INDEX IF NOT EXISTS partner_nominations_live_claim
  ON public.partner_nominations (job_id, inspector_id)
  WHERE status IN ('proposed','accepted');

-- Only ONE accepted nomination per job per inspector slot.
CREATE UNIQUE INDEX IF NOT EXISTS partner_nominations_one_accepted
  ON public.partner_nominations (job_id, inspector_id)
  WHERE status = 'accepted';

-- ── 5. The three amounts, versioned ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_commercials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  version       integer NOT NULL DEFAULT 1,

  -- Parties. partner_id NULL = an ordinary direct-inspector engagement, which
  -- keeps working exactly as before.
  customer_id   uuid NOT NULL REFERENCES public.profiles(id),
  partner_id    uuid REFERENCES public.profiles(id),
  inspector_id  uuid REFERENCES public.profiles(id),

  currency      text NOT NULL DEFAULT 'USD',
  -- Amounts are INTEGER MINOR UNITS. Never floating point: see
  -- src/core/utils/money.ts.
  customer_amount_cents    bigint NOT NULL CHECK (customer_amount_cents    >= 0),
  inspector_payout_cents   bigint NOT NULL DEFAULT 0 CHECK (inspector_payout_cents  >= 0),
  -- Agency B's OWN fee. NOT a gross figure that already contains the
  -- inspector's payout.
  partner_commission_cents bigint NOT NULL DEFAULT 0 CHECK (partner_commission_cents >= 0),

  -- Amounts are only comparable when they share a basis. A day rate and a
  -- fixed total cannot be subtracted from each other.
  pricing_basis text NOT NULL DEFAULT 'fixed_engagement'
                  CHECK (pricing_basis IN ('fixed_engagement','per_day','per_hour','per_visit')),
  scope_units   numeric(12,2) CHECK (scope_units IS NULL OR scope_units > 0),
  scope_note    text,

  expenses_note text,
  tax_note      text,

  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','presented','accepted','superseded','cancelled')),

  -- A non-positive residual is allowed only with an explicit reason, so an
  -- overallocated engagement cannot be presented by accident.
  margin_override_reason text,

  terms_version text NOT NULL DEFAULT 'v1',
  created_by    uuid REFERENCES public.profiles(id),
  presented_by  uuid REFERENCES public.profiles(id),
  presented_at  timestamptz,
  accepted_at   timestamptz,
  superseded_by uuid REFERENCES public.engagement_commercials(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT engagement_commercials_version_unique UNIQUE (job_id, version),
  -- A partner commission with no partner would be an unowned payable.
  CONSTRAINT engagement_commercials_partner_required
    CHECK (partner_commission_cents = 0 OR partner_id IS NOT NULL),
  -- An inspector payout with no inspector, likewise.
  CONSTRAINT engagement_commercials_inspector_required
    CHECK (inspector_payout_cents = 0 OR inspector_id IS NOT NULL)
);

-- Only one live (draft/presented/accepted) version per job at a time is
-- enforced by the RPCs; the unique index guards the accepted one.
CREATE UNIQUE INDEX IF NOT EXISTS engagement_commercials_one_accepted
  ON public.engagement_commercials (job_id) WHERE status = 'accepted';

COMMENT ON COLUMN public.engagement_commercials.partner_commission_cents IS
  'Agency B''s OWN commission for this engagement. NOT a gross agency payment '
  'that includes the inspector payout. The inspector is paid separately via '
  'inspector_payout_cents.';

-- ── 6. Per-party acceptance ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_acceptances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_id uuid NOT NULL REFERENCES public.engagement_commercials(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  party_role    text NOT NULL CHECK (party_role IN ('customer','partner','inspector')),
  party_id      uuid NOT NULL REFERENCES public.profiles(id),
  terms_version text NOT NULL,
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  accepted_ip   text,
  -- Each party accepts ONE version once. A new version needs a new acceptance.
  CONSTRAINT engagement_acceptances_once UNIQUE (commercial_id, party_role)
);

-- ── 7. Settlement obligations — records, never instructions ────────────────
CREATE TABLE IF NOT EXISTS public.settlement_obligations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  commercial_id  uuid NOT NULL REFERENCES public.engagement_commercials(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES public.profiles(id),
  beneficiary_role text NOT NULL CHECK (beneficiary_role IN ('inspector','partner')),
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  currency       text NOT NULL DEFAULT 'USD',
  status         text NOT NULL DEFAULT 'due'
                   CHECK (status IN ('due','approved','invoiced','paid','cancelled')),
  approved_by    uuid REFERENCES public.profiles(id),
  approved_at    timestamptz,
  invoiced_at    timestamptz,
  paid_at        timestamptz,
  paid_reference text,
  paid_by        uuid REFERENCES public.profiles(id),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- THE double-payment guard: one obligation per accepted engagement per role.
  -- A replayed webhook, a repeated click or a mirrored row cannot create a
  -- second payable.
  CONSTRAINT settlement_obligations_once UNIQUE (commercial_id, beneficiary_role)
);

COMMENT ON TABLE public.settlement_obligations IS
  'A RECORD of what is owed and its manual lifecycle. Initiates no transfer, '
  'touches no Stripe object or wallet. "paid" is an Admin record of an '
  'external bank transfer, never a payment instruction.';

CREATE INDEX IF NOT EXISTS settlement_obligations_beneficiary_idx
  ON public.settlement_obligations (beneficiary_id, status);
CREATE INDEX IF NOT EXISTS partner_opportunities_partner_idx
  ON public.partner_opportunities (partner_id, status);
CREATE INDEX IF NOT EXISTS engagement_commercials_job_idx
  ON public.engagement_commercials (job_id, status);

COMMIT;
