-- ════════════════════════════════════════════════════════════════════════════
--  20260801300000_profiles_rich_rates_columns.sql
--
--  P0 — an inspector cannot save their profile AT ALL. /inspector/settings
--  redirects back with "Could not save profile. Try again or contact support."
--
--  ROOT CAUSE: updateInspectorSettings writes seven "rich rates" columns that
--  exist only in the ARCHIVED migration
--  supabase/migrations_archive/20260518140000_work_experience_resume_rates.sql
--  and were never promoted into the live schema:
--
--      currency · travel_rate_cents · overtime_multiplier · weekend_multiplier
--      holiday_multiplier · payment_terms · minimum_engagement_hours
--
--  PostgREST rejects the statement with PGRST204 ("Could not find the
--  'currency' column of 'profiles' in the schema cache"). That message contains
--  neither "check" nor "constraint", so the action's error branch falls through
--  to the generic copy. Because ONE statement carries every field, the whole
--  UPDATE is refused atomically — full_name included. That empty profile is in
--  turn why the inspector is excluded from inspectors_directory (it requires a
--  non-empty full_name) and why every identity column resolves to NULL for the
--  authorized client under a "Full" disclosure policy. One missing-column bug,
--  four visible symptoms.
--
--  FIX: promote ONLY the seven profiles columns, forward-only and additive.
--
--  EXPLICITLY NOT INCLUDED from the archived file (all already live, and out of
--  scope here): the inspector_work_experience table, its index and RLS policies,
--  and the `resumes` storage bucket and its policies.
--
--  SAFETY CONTRACT — this migration performs ADD COLUMN and ADD CONSTRAINT only:
--    • no DROP, no RENAME, no DELETE, no UPDATE, no backfill, no data rewrite;
--    • NO COLUMN DEFAULTS. The archived version defaulted currency/multipliers/
--      payment_terms ('USD', 1.50, 1.50, 2.00, 'net30'). Defaults would make
--      every existing profile suddenly read values nobody entered. Columns are
--      added NULL so existing rows are genuinely untouched, and the application
--      already handles NULL: the read mapper does (r.currency ?? 'USD') and
--      parseNumeric(...) → null, and the write path sends 'USD' explicitly when
--      the field is left blank.
--    • every CHECK is `<col> IS NULL OR …`, so no existing row can violate one;
--    • every ADD is guarded (IF NOT EXISTS / pg_constraint lookup), so the file
--      is safe to re-run and safe on a database that already has some columns.
--
--  Constraint bands are pinned to the form's own Zod contract in
--  apps/web/src/lib/actions/inspectorSettings.ts, so nothing the UI accepts can
--  violate the database:
--      currency                 /^[A-Z]{3}$/
--      travelRateDollars        0 … 10 000        → 0 … 1 000 000 cents
--      overtime/weekend/holiday 1 … 5
--      paymentTerms             PAYMENT_TERMS enum (inspectorProfile.types.ts)
--      minimumEngagementHours   1 … 240
--
--  NOTE: the archived migration had no range check for travel_rate_cents; one is
--  added here to match the form's accepted range.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The seven columns — additive, no defaults ────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS currency                 TEXT,
  ADD COLUMN IF NOT EXISTS travel_rate_cents        BIGINT,
  ADD COLUMN IF NOT EXISTS overtime_multiplier      NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS weekend_multiplier       NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS holiday_multiplier       NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS payment_terms            TEXT,
  ADD COLUMN IF NOT EXISTS minimum_engagement_hours INT;

COMMENT ON COLUMN public.profiles.currency IS
  'ISO 4217 code for this inspector''s rates. NULL = never set; the app reads it as USD.';
COMMENT ON COLUMN public.profiles.travel_rate_cents IS
  'Per-hour rate while travelling, in cents. NULL = not offered.';
COMMENT ON COLUMN public.profiles.payment_terms IS
  'Preferred settlement terms: net7 | net15 | net30 | net45 | net60 | on_completion. NULL = unspecified.';

-- ── 2) Guarded CHECK constraints ────────────────────────────────────────────
--  Each is added only when absent, and each tolerates NULL so no pre-existing
--  row can fail validation at ALTER time.
DO $rates$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_currency_iso') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_currency_iso
        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
  END IF;

  -- Not in the archived migration: mirrors optionalInt(0, 10_000) dollars,
  -- which the action multiplies by 100 before writing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_travel_rate_cents_band') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_travel_rate_cents_band
        CHECK (travel_rate_cents IS NULL OR (travel_rate_cents BETWEEN 0 AND 1000000));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_overtime_multiplier_band') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_overtime_multiplier_band
        CHECK (overtime_multiplier IS NULL OR (overtime_multiplier BETWEEN 1.00 AND 5.00));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_weekend_multiplier_band') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_weekend_multiplier_band
        CHECK (weekend_multiplier IS NULL OR (weekend_multiplier BETWEEN 1.00 AND 5.00));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_holiday_multiplier_band') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_holiday_multiplier_band
        CHECK (holiday_multiplier IS NULL OR (holiday_multiplier BETWEEN 1.00 AND 5.00));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_payment_terms_enum') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_payment_terms_enum
        CHECK (payment_terms IS NULL OR payment_terms IN
          ('net7','net15','net30','net45','net60','on_completion'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_minimum_engagement_band') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_minimum_engagement_band
        CHECK (minimum_engagement_hours IS NULL OR (minimum_engagement_hours BETWEEN 1 AND 240));
  END IF;
END
$rates$;

-- ── 3) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_cols  int;
  v_cons  int;
  v_dflt  int;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name IN ('currency','travel_rate_cents','overtime_multiplier',
                         'weekend_multiplier','holiday_multiplier','payment_terms',
                         'minimum_engagement_hours');
  IF v_cols <> 7 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: expected 7 rich-rate columns on profiles, found %', v_cols;
  END IF;

  SELECT count(*) INTO v_cons
    FROM pg_constraint
   WHERE conrelid = 'public.profiles'::regclass
     AND conname IN ('profiles_currency_iso','profiles_travel_rate_cents_band',
                     'profiles_overtime_multiplier_band','profiles_weekend_multiplier_band',
                     'profiles_holiday_multiplier_band','profiles_payment_terms_enum',
                     'profiles_minimum_engagement_band');
  IF v_cons <> 7 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: expected 7 rich-rate CHECK constraints, found %', v_cons;
  END IF;

  -- No defaults: existing rows must stay NULL for anything they never entered.
  SELECT count(*) INTO v_dflt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name IN ('currency','travel_rate_cents','overtime_multiplier',
                         'weekend_multiplier','holiday_multiplier','payment_terms',
                         'minimum_engagement_hours')
     AND column_default IS NOT NULL;
  IF v_dflt <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % rich-rate column(s) carry a DEFAULT; existing profiles must remain NULL', v_dflt;
  END IF;

  RAISE NOTICE 'profiles rich-rate columns added (7 columns, 7 checks, no defaults, no data touched).';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
