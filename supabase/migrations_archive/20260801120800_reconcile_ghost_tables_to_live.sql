-- ════════════════════════════════════════════════════════════════════════════
--  20260801120800_reconcile_ghost_tables_to_live.sql
--
--  SINGLE SOURCE OF TRUTH — sync the versioned floor to the EXACT live schema of
--  the four ghost tables, captured from the live DB via
--  docs/ops/ghost-ddl-introspection.sql (2026-06-02).
--
--  The baseline fold + 20260801120500/120700 created APPROXIMATE versions (text
--  where the live columns are ENUMs; missing the pre-existing report_templates
--  columns scope/owner_id/schema_json/header/footer/is_default/deleted_at/domain;
--  missing several constraints/indexes/RLS/triggers). This migration is the
--  authoritative reconciliation: it adds every missing column with the CORRECT
--  type (enum-guarded), fixes the few text→enum drifts, and lays down the exact
--  live constraints, indexes, RLS policies, and triggers.
--
--  100% IDEMPOTENT + NON-DESTRUCTIVE:
--   • on the LIVE DB everything already exists → a pure no-op convergence;
--   • on a FRESH DB it fills in/corrects whatever the scaffolding approximated.
--   • enum-typed work is guarded by to_regtype(...) so it no-ops if an enum
--     isn't present yet; type fixes only fire when a column is currently text.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
--  1) country_codes  (PK code; seeded ISO list = 249 rows)
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS name         text;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS region_group text;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS calling_code text;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS region       text;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS is_active    boolean NOT NULL DEFAULT true;
ALTER TABLE public.country_codes ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='country_codes_code_shape' AND conrelid='public.country_codes'::regclass) THEN
    ALTER TABLE public.country_codes ADD CONSTRAINT country_codes_code_shape CHECK (code ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='country_codes_region_group_known' AND conrelid='public.country_codes'::regclass) THEN
    ALTER TABLE public.country_codes ADD CONSTRAINT country_codes_region_group_known
      CHECK (region_group IS NULL OR region_group = ANY (ARRAY['EU','EEA','GCC','USMCA'])) NOT VALID;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'country_codes constraints: %', SQLERRM; END $$;

CREATE INDEX IF NOT EXISTS country_codes_region_group_idx
  ON public.country_codes USING btree (region_group) WHERE (region_group IS NOT NULL);

ALTER TABLE public.country_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS country_codes_select       ON public.country_codes;
CREATE POLICY country_codes_select ON public.country_codes FOR SELECT USING (true);
DROP POLICY IF EXISTS country_codes_write_admin  ON public.country_codes;
CREATE POLICY country_codes_write_admin ON public.country_codes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['super_admin','admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['super_admin','admin'])));

-- ════════════════════════════════════════════════════════════════════════
--  2) organizations  (PK id)
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS name                   text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug                   text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url               text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_at             timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS kind                   text NOT NULL DEFAULT 'enterprise';
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS owner_id               uuid;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS website_url            text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS contact_email          text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_active              boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS uses_department_scoping boolean NOT NULL DEFAULT false;

-- base_currency is the currency_code ENUM on live (the floor had it as text).
DO $$ BEGIN
  IF to_regtype('public.currency_code') IS NULL THEN
    RAISE NOTICE 'currency_code enum missing — base_currency left as-is';
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='base_currency') THEN
    ALTER TABLE public.organizations ADD COLUMN base_currency public.currency_code NOT NULL DEFAULT 'USD';
  ELSIF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='base_currency') = 'text' THEN
    ALTER TABLE public.organizations ALTER COLUMN base_currency DROP DEFAULT;
    ALTER TABLE public.organizations ALTER COLUMN base_currency TYPE public.currency_code USING base_currency::public.currency_code;
    ALTER TABLE public.organizations ALTER COLUMN base_currency SET DEFAULT 'USD';
    ALTER TABLE public.organizations ALTER COLUMN base_currency SET NOT NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'organizations.base_currency reconcile: %', SQLERRM; END $$;

-- Drop the redundant NOT-VALID kind check the floor added (20260700); keep canonical.
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_kind_chk;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organizations_kind_check' AND conrelid='public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_kind_check CHECK (kind = ANY (ARRAY['enterprise','agency']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organizations_owner_id_fkey' AND conrelid='public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organizations_slug_key' AND conrelid='public.organizations'::regclass) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'organizations constraints: %', SQLERRM; END $$;

CREATE INDEX IF NOT EXISTS organizations_kind_idx ON public.organizations USING btree (kind, created_at DESC);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_admin_write    ON public.organizations;
CREATE POLICY organizations_admin_write ON public.organizations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin','super_admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin','super_admin'])));
DROP POLICY IF EXISTS organizations_select_admin   ON public.organizations;
CREATE POLICY organizations_select_admin ON public.organizations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin','super_admin'])));
DROP POLICY IF EXISTS organizations_select_members ON public.organizations;
CREATE POLICY organizations_select_members ON public.organizations FOR SELECT
  USING (public.is_member_of_org(id));

-- ════════════════════════════════════════════════════════════════════════
--  3) inspection_scope_templates  (PK id; 60 rows)
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS slug                text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS name                text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS version             integer NOT NULL DEFAULT 1;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS category            text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS region              text NOT NULL DEFAULT 'global';
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS validity_months     integer NOT NULL DEFAULT 12;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS base_price_cents    bigint  NOT NULL DEFAULT 0;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS description_md      text;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS is_active           boolean NOT NULL DEFAULT true;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS created_by_admin_id uuid;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS created_by          uuid;
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS created_at          timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.inspection_scope_templates ADD COLUMN IF NOT EXISTS updated_at          timestamptz NOT NULL DEFAULT now();

-- requires_credential_tier = cci_credential_tier ENUM; domain = inspection_domain ENUM.
DO $$ BEGIN
  IF to_regtype('public.cci_credential_tier') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_scope_templates' AND column_name='requires_credential_tier') THEN
      ALTER TABLE public.inspection_scope_templates ADD COLUMN requires_credential_tier public.cci_credential_tier NOT NULL DEFAULT 'cci_basic';
    ELSIF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_scope_templates' AND column_name='requires_credential_tier') = 'text' THEN
      ALTER TABLE public.inspection_scope_templates ALTER COLUMN requires_credential_tier DROP DEFAULT;
      ALTER TABLE public.inspection_scope_templates ALTER COLUMN requires_credential_tier TYPE public.cci_credential_tier USING requires_credential_tier::public.cci_credential_tier;
      ALTER TABLE public.inspection_scope_templates ALTER COLUMN requires_credential_tier SET DEFAULT 'cci_basic';
      ALTER TABLE public.inspection_scope_templates ALTER COLUMN requires_credential_tier SET NOT NULL;
    END IF;
  END IF;
  IF to_regtype('public.inspection_domain') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_scope_templates' AND column_name='domain') THEN
      ALTER TABLE public.inspection_scope_templates ADD COLUMN domain public.inspection_domain NOT NULL DEFAULT 'industrial_ndt';
    ELSIF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_scope_templates' AND column_name='domain') = 'text' THEN
      ALTER TABLE public.inspection_scope_templates ALTER COLUMN domain DROP DEFAULT;
      ALTER TABLE public.inspection_scope_templates ALTER COLUMN domain TYPE public.inspection_domain USING domain::public.inspection_domain;
      ALTER TABLE public.inspection_scope_templates ALTER COLUMN domain SET DEFAULT 'industrial_ndt';
      ALTER TABLE public.inspection_scope_templates ALTER COLUMN domain SET NOT NULL;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'scope_templates enum reconcile: %', SQLERRM; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inspection_scope_templates_slug_key' AND conrelid='public.inspection_scope_templates'::regclass) THEN
    ALTER TABLE public.inspection_scope_templates ADD CONSTRAINT inspection_scope_templates_slug_key UNIQUE (slug);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scope_template_slug_format' AND conrelid='public.inspection_scope_templates'::regclass) THEN
    ALTER TABLE public.inspection_scope_templates ADD CONSTRAINT scope_template_slug_format CHECK (slug ~ '^[a-z0-9_]+$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='scope_template_validity_positive' AND conrelid='public.inspection_scope_templates'::regclass) THEN
    ALTER TABLE public.inspection_scope_templates ADD CONSTRAINT scope_template_validity_positive CHECK (validity_months > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inspection_scope_templates_created_by_admin_id_fkey' AND conrelid='public.inspection_scope_templates'::regclass) THEN
    ALTER TABLE public.inspection_scope_templates ADD CONSTRAINT inspection_scope_templates_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'scope_templates constraints: %', SQLERRM; END $$;

CREATE INDEX IF NOT EXISTS idx_scope_templates_active ON public.inspection_scope_templates USING btree (is_active, category) WHERE (is_active = true);
DO $$ BEGIN
  IF to_regtype('public.inspection_domain') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS inspection_scope_templates_domain_idx ON public.inspection_scope_templates USING btree (domain) WHERE (is_active = true)';
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'scope_templates domain idx: %', SQLERRM; END $$;

ALTER TABLE public.inspection_scope_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS templates_admin_write  ON public.inspection_scope_templates;
CREATE POLICY templates_admin_write ON public.inspection_scope_templates FOR ALL
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
DROP POLICY IF EXISTS templates_read_active  ON public.inspection_scope_templates;
CREATE POLICY templates_read_active ON public.inspection_scope_templates FOR SELECT
  USING ((is_active = true) OR public.nx_is_admin());

DO $$ BEGIN
  IF to_regprocedure('public.tg_touch_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.inspection_scope_templates;
    CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.inspection_scope_templates
      FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'scope_templates touch trigger: %', SQLERRM; END $$;

-- ════════════════════════════════════════════════════════════════════════
--  4) report_templates  (PK id; pre-existing agency/client report-template table
--     that Phase 4 extended — reconcile the FULL live shape)
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS scope            text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS owner_id         uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS name             text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS description      text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS schema_json      jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS attachments_urls text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS header_template  text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS footer_template  text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS is_default       boolean NOT NULL DEFAULT false;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS is_active        boolean NOT NULL DEFAULT true;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS version          integer NOT NULL DEFAULT 1;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS created_at       timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS deleted_at       timestamptz;
-- Phase-4 columns (also ensured by 20260801120500): client_id/org_id/source_document_id/
-- template_spec/spec_sha256/is_locked/locked_at/locked_by/created_by.
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS client_id          uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS org_id             uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS source_document_id uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS template_spec      jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS spec_sha256        text;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS is_locked          boolean NOT NULL DEFAULT false;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS locked_at          timestamptz;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS locked_by          uuid;
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS created_by         uuid DEFAULT auth.uid();

DO $$ BEGIN
  IF to_regtype('public.inspection_domain') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='report_templates' AND column_name='domain') THEN
      ALTER TABLE public.report_templates ADD COLUMN domain public.inspection_domain NOT NULL DEFAULT 'industrial_ndt';
    ELSIF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='report_templates' AND column_name='domain') = 'text' THEN
      ALTER TABLE public.report_templates ALTER COLUMN domain DROP DEFAULT;
      ALTER TABLE public.report_templates ALTER COLUMN domain TYPE public.inspection_domain USING domain::public.inspection_domain;
      ALTER TABLE public.report_templates ALTER COLUMN domain SET DEFAULT 'industrial_ndt';
      ALTER TABLE public.report_templates ALTER COLUMN domain SET NOT NULL;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'report_templates.domain reconcile: %', SQLERRM; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='report_templates_owner_id_fkey' AND conrelid='public.report_templates'::regclass) THEN
    ALTER TABLE public.report_templates ADD CONSTRAINT report_templates_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='report_templates_client_id_fkey' AND conrelid='public.report_templates'::regclass) THEN
    ALTER TABLE public.report_templates ADD CONSTRAINT report_templates_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='report_templates_scope_check' AND conrelid='public.report_templates'::regclass) THEN
    ALTER TABLE public.report_templates ADD CONSTRAINT report_templates_scope_check CHECK (scope = ANY (ARRAY['agency','client'])) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='report_templates_spec_sha256_fmt' AND conrelid='public.report_templates'::regclass) THEN
    ALTER TABLE public.report_templates ADD CONSTRAINT report_templates_spec_sha256_fmt CHECK (spec_sha256 IS NULL OR spec_sha256 ~ '^[a-f0-9]{64}$') NOT VALID;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'report_templates constraints: %', SQLERRM; END $$;

CREATE INDEX IF NOT EXISTS report_templates_alive_idx ON public.report_templates USING btree (id) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS report_templates_client_idx ON public.report_templates USING btree (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_templates_owner_idx ON public.report_templates USING btree (owner_id, scope, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS report_templates_one_default_per_owner
  ON public.report_templates USING btree (scope, owner_id) WHERE ((is_default = true) AND (deleted_at IS NULL));

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
-- RESTRICTIVE: hide soft-deleted from everyone but super admin.
DROP POLICY IF EXISTS hide_soft_deleted ON public.report_templates;
DO $$ BEGIN
  IF to_regprocedure('public.is_super_admin()') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY hide_soft_deleted ON public.report_templates AS RESTRICTIVE FOR ALL USING ((deleted_at IS NULL) OR public.is_super_admin()) WITH CHECK (true)';
    EXECUTE 'DROP POLICY IF EXISTS report_templates_admin_all ON public.report_templates';
    EXECUTE 'CREATE POLICY report_templates_admin_all ON public.report_templates FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())';
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'report_templates is_super_admin policies: %', SQLERRM; END $$;

DROP POLICY IF EXISTS report_templates_owner_all ON public.report_templates;
CREATE POLICY report_templates_owner_all ON public.report_templates FOR ALL
  USING ((client_id = auth.uid()) OR public.nx_is_admin())
  WITH CHECK ((client_id = auth.uid()) OR public.nx_is_admin());
DROP POLICY IF EXISTS report_templates_inspector_read ON public.report_templates;
CREATE POLICY report_templates_inspector_read ON public.report_templates FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.report_template_id = report_templates.id AND j.contractor_id = auth.uid()));
DROP POLICY IF EXISTS report_templates_participants ON public.report_templates;
CREATE POLICY report_templates_participants ON public.report_templates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.report_template_id = report_templates.id
                 AND (j.client_id = auth.uid() OR j.contractor_id = auth.uid() OR j.agency_id = auth.uid())));

DO $$ BEGIN
  IF to_regprocedure('public.tg_report_templates_touch()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tg_report_templates_touch ON public.report_templates;
    CREATE TRIGGER tg_report_templates_touch BEFORE UPDATE ON public.report_templates
      FOR EACH ROW EXECUTE FUNCTION public.tg_report_templates_touch();
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'report_templates touch trigger: %', SQLERRM; END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION — re-run docs/ops/ghost-ddl-introspection.sql; the four tables'
-- columns/constraints/indexes/RLS/triggers should now match this file 1:1.
-- (On a brand-new DB, also load the country_codes (249) + inspection_scope_templates
--  (60) seed data — schema alone leaves them empty.)
-- ─────────────────────────────────────────────────────────────────────
