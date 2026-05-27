-- ════════════════════════════════════════════════════════════════════════════
--  20260601120000_multi_currency_foundation.sql
--  Phase 6 / Sprint 7 — Global enterprise multi-currency layer.
--
--  WHY
--  ───
--  Global enterprises (Shell, BP, ExxonMobil) operate across USD / EUR /
--  GBP / AED / etc. Their CFO needs to see a consolidated dashboard in
--  ONE base currency while every underlying invoice remains in its
--  native currency for legal and tax purposes.
--
--  ARCHITECTURE
--  ────────────
--  · Storage stays single-currency-per-invoice. We never rewrite
--    `invoices.total_cents` after issuance.
--  · `fx_rates` holds time-series exchange rates. Conversion is always
--    a projection layer over the immutable native values.
--  · `convert_cents()` is the single conversion primitive every RPC,
--    view, or report uses. Same function on the database side ensures
--    web and mobile see identical numbers down to the cent.
--  · Rates have an `effective_date` so historical reports stay stable
--    (an invoice issued on 2025-03-15 always converts at the 2025-03-15
--    rate, not at today's rate).
--
--  WHAT THIS LANDS
--  ───────────────
--    · public.fx_rates                     time-series rate store
--    · organizations.base_currency         per-org preferred display ccy
--    · convert_cents(...)                  conversion primitive
--    · upsert_fx_rate(...)                 Platform-Owner-only setter
--    · set_org_base_currency(...)          owner/procurement_admin setter
--    · supported-currency CHECK constraint
--
--  Idempotent. Backward-compatible — pre-existing invoices keep their
--  native currency in storage; the conversion is a read-time projection.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  Supported currencies — single source of truth at the DB layer.
--  Mirrored in @nexpec/shared-core/schemas/organizations.ts as
--  SUPPORTED_CURRENCIES so the same list governs validation everywhere.
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currency_code') THEN
    CREATE TYPE public.currency_code AS ENUM (
      'USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'SGD', 'CHF', 'JPY'
    );
  ELSE
    -- Future currency additions go here via ALTER TYPE ADD VALUE IF NOT EXISTS
    -- (each in its own DO block so the migration stays re-runnable).
    BEGIN
      ALTER TYPE public.currency_code ADD VALUE IF NOT EXISTS 'USD';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
--  fx_rates — time-series exchange-rate store
--
--  `rate` is the multiplier to convert ONE unit of `base_currency` into
--  units of `quote_currency`. So row (USD, EUR, 0.92, '2025-03-15')
--  means "1 USD = 0.92 EUR on 2025-03-15." All rates expressed against
--  USD as the pivot for consistency; cross-pairs are derived in the
--  conversion function via two hops.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fx_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL    DEFAULT now(),

  base_currency   public.currency_code NOT NULL,
  quote_currency  public.currency_code NOT NULL,
  rate            numeric(20, 10)      NOT NULL CHECK (rate > 0),
  effective_date  date                 NOT NULL DEFAULT current_date,
  source          text                 NOT NULL DEFAULT 'manual',

  -- One row per (base, quote, effective_date) — re-fetches the same day
  -- replace the rate rather than appending a duplicate.
  CONSTRAINT fx_rates_unique_pair_date UNIQUE (base_currency, quote_currency, effective_date),

  -- Self-pair is always identity — let the data enforce that, not just code.
  CONSTRAINT fx_rates_self_is_one
    CHECK (base_currency <> quote_currency OR rate = 1)
);

COMMENT ON TABLE public.fx_rates IS
  'Time-series exchange rates. Conversion is always read-time projection over immutable invoice native values.';

CREATE INDEX IF NOT EXISTS fx_rates_lookup_idx
  ON public.fx_rates (base_currency, quote_currency, effective_date DESC);

-- Identity rates for every supported currency so a self-pair always
-- resolves without a special case in the conversion function.
INSERT INTO public.fx_rates (base_currency, quote_currency, rate, effective_date, source)
SELECT c::public.currency_code, c::public.currency_code, 1, '2020-01-01'::date, 'identity'
  FROM unnest(ARRAY['USD','EUR','GBP','AED','CAD','AUD','SGD','CHF','JPY']) AS c
ON CONFLICT (base_currency, quote_currency, effective_date) DO NOTHING;

-- RLS — everyone reads (rates aren't sensitive). Only the Platform Owner
-- writes via the dedicated RPC.
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_rates_select_all ON public.fx_rates;
CREATE POLICY fx_rates_select_all
  ON public.fx_rates FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────────────
--  organizations.base_currency — per-org preferred display currency
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS base_currency public.currency_code NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN public.organizations.base_currency IS
  'Preferred display currency for this organization''s dashboards. Underlying invoices retain their native currency; this only changes the read-time projection.';

-- ─────────────────────────────────────────────────────────────────────
--  convert_cents — THE conversion primitive
--
--  Rules:
--    · Same source/target → return amount unchanged (no FK lookup).
--    · Otherwise, find the rate row for (source, target) with the
--      latest effective_date <= as_of_date. Walk back to most recent
--      available if no exact-date match.
--    · If no direct rate exists, hop through USD as the pivot.
--    · If no path exists, RETURN NULL — callers must handle this.
--
--  Returning NULL is intentional — silently substituting zero would
--  hide data-availability gaps in the UI.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.convert_cents(
  p_amount_cents   bigint,
  p_from_currency  text,
  p_to_currency    text,
  p_as_of          timestamptz DEFAULT now()
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of_date  date := (p_as_of AT TIME ZONE 'UTC')::date;
  v_from        public.currency_code;
  v_to          public.currency_code;
  v_rate        numeric(20, 10);
  v_to_usd      numeric(20, 10);
  v_from_usd    numeric(20, 10);
BEGIN
  -- NULL / empty amount → NULL (let the caller decide what to render).
  IF p_amount_cents IS NULL THEN
    RETURN NULL;
  END IF;

  -- Defensive casting — if the strings aren't valid enum values we
  -- can't even attempt conversion; the caller falls back to native.
  BEGIN
    v_from := (COALESCE(p_from_currency, 'USD'))::public.currency_code;
    v_to   := (COALESCE(p_to_currency,   'USD'))::public.currency_code;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  -- Identity case — no lookup needed.
  IF v_from = v_to THEN
    RETURN p_amount_cents;
  END IF;

  -- Path A — direct rate available.
  SELECT rate INTO v_rate
    FROM public.fx_rates
   WHERE base_currency  = v_from
     AND quote_currency = v_to
     AND effective_date <= v_as_of_date
   ORDER BY effective_date DESC
   LIMIT 1;

  IF v_rate IS NOT NULL THEN
    RETURN (p_amount_cents::numeric * v_rate)::bigint;
  END IF;

  -- Path B — pivot through USD when no direct rate exists.
  --   from → USD: look up (v_from, USD)
  --   USD  → to:  look up (USD, v_to)
  SELECT rate INTO v_from_usd
    FROM public.fx_rates
   WHERE base_currency  = v_from
     AND quote_currency = 'USD'::public.currency_code
     AND effective_date <= v_as_of_date
   ORDER BY effective_date DESC
   LIMIT 1;

  SELECT rate INTO v_to_usd
    FROM public.fx_rates
   WHERE base_currency  = 'USD'::public.currency_code
     AND quote_currency = v_to
     AND effective_date <= v_as_of_date
   ORDER BY effective_date DESC
   LIMIT 1;

  IF v_from_usd IS NOT NULL AND v_to_usd IS NOT NULL THEN
    RETURN (p_amount_cents::numeric * v_from_usd * v_to_usd)::bigint;
  END IF;

  -- Path C — give up. Caller renders "rate unavailable".
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_cents(bigint, text, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.convert_cents(bigint, text, text, timestamptz) IS
  'The single FX conversion primitive. Used by every roll-up RPC and view. Returns NULL when no rate path exists — callers handle the unavailable case explicitly.';

-- ─────────────────────────────────────────────────────────────────────
--  upsert_fx_rate — Platform-Owner-only rate setter
--
--  In production this is called by a scheduled job pulling rates from
--  an FX provider (openexchangerates, ECB, etc.). For now Platform
--  Owner can call it manually to seed rates.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_fx_rate(
  p_base_currency   text,
  p_quote_currency  text,
  p_rate            numeric,
  p_effective_date  date DEFAULT current_date,
  p_source          text DEFAULT 'manual'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_base       public.currency_code;
  v_quote      public.currency_code;
  v_id         uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Singular Platform Owner doctrine — only the NEXPEC Platform Owner
  -- writes FX rates. Tenant-level operators cannot influence the
  -- exchange-rate set; that would let an org rewrite its own dashboards.
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only the NEXPEC Platform Owner can set FX rates'
      USING ERRCODE = '42501';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'rate must be > 0 (got %)', p_rate USING ERRCODE = '22000';
  END IF;

  v_base  := p_base_currency::public.currency_code;
  v_quote := p_quote_currency::public.currency_code;

  INSERT INTO public.fx_rates (base_currency, quote_currency, rate, effective_date, source)
    VALUES (v_base, v_quote, p_rate, p_effective_date, COALESCE(p_source, 'manual'))
    ON CONFLICT (base_currency, quote_currency, effective_date) DO UPDATE
      SET rate = EXCLUDED.rate,
          source = EXCLUDED.source,
          created_at = now()
    RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'fx_rate_id',     v_id,
    'base',           v_base,
    'quote',          v_quote,
    'rate',           p_rate,
    'effective_date', p_effective_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_fx_rate(text, text, numeric, date, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  set_org_base_currency — Tenant-scoped setter
--
--  Owner / procurement_admin of the org (and the Platform Owner) can
--  pick the org's preferred display currency. Same can_manage_org_structure
--  predicate used everywhere else.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_org_base_currency(
  p_org_id   uuid,
  p_currency text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_actor_lbl  text;
  v_old        public.currency_code;
  v_new        public.currency_code;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_manage_org_structure(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to change this organization''s base currency'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_new := p_currency::public.currency_code;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Unsupported currency: %', p_currency USING ERRCODE = '22000';
  END;

  SELECT base_currency INTO v_old
    FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.organizations
     SET base_currency = v_new,
         updated_at = now()
   WHERE id = p_org_id;

  -- Best-effort audit.
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT actor_role, actor_label INTO v_actor_role, v_actor_lbl
      FROM public._dept_actor_profile(v_actor);

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id
    ) VALUES (
      'organization.base_currency.changed',
      v_actor,
      v_actor_role,
      v_actor_lbl,
      'organizations',
      p_org_id,
      format('Org base currency changed: %s → %s', v_old, v_new),
      jsonb_build_object('from', v_old, 'to', v_new),
      jsonb_build_object('org_id', p_org_id),
      v_correlation
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'org_id',        p_org_id,
    'base_currency', v_new,
    'from',          v_old,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_org_base_currency(uuid, text) TO authenticated;

COMMIT;
