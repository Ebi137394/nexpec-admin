-- ════════════════════════════════════════════════════════════════════════════
--  20260801120700_adopt_ghost_fk_target_tables.sql
--
--  ERADICATE SCHEMA DRIFT — bring the four "ghost" FK-target tables under version
--  control: report_templates, organizations, country_codes, inspection_scope_templates.
--
--  THE PROBLEM (root cause of the 42703 we just hit): the baseline
--  (00000000000000_baseline_core_tables.sql) FK-references all four, but its own
--  header says they "must be created by their own baseline / migration before
--  this file runs" — and NONE of them has a CREATE TABLE anywhere in the migration
--  set. They exist on the live DB only, created out of band → their schema is
--  invisible to git, unreviewable, and absent on any fresh environment.
--
--  THE FIX: a RECONCILE-SAFE adoption. For each table we CREATE IF NOT EXISTS the
--  PK only (so a fresh DB gets the table), then ADD COLUMN IF NOT EXISTS every
--  column the codebase actually uses (nullable/defaulted → applies whether the
--  table is brand-new or pre-existing-with-rows). NON-DESTRUCTIVE: never drops or
--  retypes anything the live table already has; only fills gaps. Columns are
--  derived from real usage (create_organization insert; scope-template data/actions;
--  the jobs FK PKs), NOT invented. The live table remains authoritative for any
--  extra columns it carries; this migration is the versioned FLOOR.
--
--  ⚠️ FRESH-DB ORDERING: on a brand-new environment the baseline runs FIRST and
--  its jobs FK needs these tables to already exist. This file (dated after the
--  baseline) makes the LIVE DB correct + versioned NOW, but to make from-scratch
--  provisioning work end-to-end these four CREATE blocks should be FOLDED INTO
--  (or ordered BEFORE) the baseline — exactly what the baseline header recommends.
--  On the existing live DB this migration is a safe reconcile no-op. (Triggers,
--  RLS, indexes for these tables are layered by the existing migration set and
--  are intentionally NOT duplicated here — this is a column-adoption pass.)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) country_codes — PK is `code` (jobs.job_country → country_codes(code)).
--    Reference data (the ISO list) is SEED, not schema; this only versions the
--    shape. A fresh DB still needs the country seed loaded separately.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.country_codes (
  code text PRIMARY KEY
);
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS name         text;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS calling_code text;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS region       text;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS is_active    boolean NOT NULL DEFAULT true;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now();

-- ─────────────────────────────────────────────────────────────────────
-- 2) organizations — verified columns: name/kind/owner_id/is_active
--    (create_organization insert + 20260521 header) + base_currency/slug/ts.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS name          text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS kind          text NOT NULL DEFAULT 'enterprise';
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS owner_id      uuid;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_active     boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS base_currency text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug          text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_at    timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_kind_chk') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_kind_chk CHECK (kind IN ('enterprise','agency')) NOT VALID;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'organizations kind check skipped: %', SQLERRM; END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) inspection_scope_templates — well-attested across scope-template
--    data/actions + compliance_mode_foundation usage.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspection_scope_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS slug                     text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS name                     text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS version                  integer NOT NULL DEFAULT 1;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS category                 text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS region                   text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS validity_months          integer;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS base_price_cents         bigint;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS requires_credential_tier text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS description_md           text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS is_active                boolean NOT NULL DEFAULT true;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS domain                   text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS created_by               uuid;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS created_at               timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS updated_at               timestamptz NOT NULL DEFAULT now();

-- ─────────────────────────────────────────────────────────────────────
-- 4) report_templates — canonical record (already reconciled in 20260801120500;
--    repeated here idempotently so the four ghosts live in ONE adoption file).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS client_id          uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS org_id             uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS source_document_id uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS name               text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS template_spec      jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS spec_sha256        text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS is_locked          boolean NOT NULL DEFAULT false;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS locked_at          timestamptz;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS locked_by          uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS created_by         uuid DEFAULT auth.uid();
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS created_at         timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION — the four ghosts now have a versioned column floor:
--   SELECT table_name, count(*) AS columns
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND table_name IN ('country_codes','organizations','inspection_scope_templates','report_templates')
--    GROUP BY table_name ORDER BY table_name;
--
-- DRIFT GUARD (recommended next step): dump the live DDL of these four with
--   `supabase db dump --schema public -t <table>` and diff against this file so
--   the versioned floor matches reality, then fold the CREATEs into the baseline
--   for from-scratch provisioning.
-- ─────────────────────────────────────────────────────────────────────
