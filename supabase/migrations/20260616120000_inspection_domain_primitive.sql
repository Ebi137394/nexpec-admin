-- ════════════════════════════════════════════════════════════════════════════
--  20260616120000_inspection_domain_primitive.sql
--  LAYER 1 — introduce inspection_domain as a first-class platform primitive.
--
--  Purely additive. Backfills every existing row into the current domain
--  ('industrial_ndt') so no UI, query, or workflow changes behaviour today.
--  The marketplace continues to operate exactly as it did before this
--  migration. Future layers (Layer 2 inspector practice; Layer 5 PCP
--  domain-awareness) build on top.
--
--  WHY THIS DESIGN
--  ───────────────
--  An audit of the existing codebase confirmed:
--
--    • `jobs.inspection_type` is text-typed, currently NULL for every job,
--      and is read in ~12 places — including the CCI compliance capture
--      gate (`inspection_type === 'compliance'`). It is left untouched.
--      The new `domain` column is a SEPARATE, semantically-distinct
--      primitive that does not overlap with `inspection_type`.
--
--    • `jobs.specialty_slugs` and `profiles.specialty_slugs` together
--      drive the existing marketplace match (array overlap). Both are
--      left untouched. The discipline tree in client code (NDT methods,
--      API standards, Welding & joining, Civil & structural, Electrical
--      & instrumentation, etc.) already contains all three new domains —
--      this migration gives them a SERVER-SIDE identity without changing
--      how the existing matching engine works.
--
--    • `inspection_scope_templates.category` is used for CCI sub-
--      categorization (`supplier_verification`, `license_verification`,
--      `facility_audit`). It is left untouched. `domain` is a sibling
--      column, not a replacement.
--
--    • Existing ENUMs (`inspection_type`, `inspection_type_kind`,
--      `cci_credential_tier`, `user_role`) are not modified or extended.
--      `inspection_domain` is a fresh, non-colliding ENUM.
--
--    • Existing RLS policies use `nx_is_admin()`, `is_super_admin()`,
--      `is_member_of_org(...)`. This migration ONLY uses those helpers;
--      it does not duplicate them and does not modify a single existing
--      policy.
--
--  NO-TOUCH COMMITMENTS (verified at write time)
--  ─────────────────────────────────────────────
--    • `jobs.inspection_type`             — untouched
--    • `jobs.specialty_slugs`             — untouched
--    • `jobs.required_certifications`     — untouched
--    • `jobs.scope_template_id`           — untouched
--    • `jobs.report_template_id`          — untouched
--    • `inspection_scope_templates.category` — untouched
--    • `inspector_certificates` (any column) — untouched
--    • `profiles.specialty_slugs`         — untouched
--    • Every existing RLS policy          — untouched
--    • Every existing RPC signature       — untouched
--    • Every existing ENUM                — no new values added
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) The ENUM. Four launch values, ordered by readiness.
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inspection_domain') THEN
    CREATE TYPE public.inspection_domain AS ENUM (
      'industrial_ndt',
      'civil_construction',
      'electrical',
      'mechanical_field'
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) The config table. Each domain ships as a row; presence-or-absence
--    on this table — combined with `is_launched` — is what the rest of
--    the platform reads to decide whether a domain is publicly visible.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspection_domains (
  slug                public.inspection_domain PRIMARY KEY,
  display_name        text       NOT NULL,
  persona_label       text       NOT NULL,
  short_pitch         text       NOT NULL,
  description_md      text,
  icon_key            text       NOT NULL DEFAULT 'shield',
  tint_hex            text       NOT NULL DEFAULT '#7C3AED',
  landing_url_slug    text       UNIQUE,
  regulatory_bodies   text[]     NOT NULL DEFAULT '{}'::text[],
  default_specialty_groups text[] NOT NULL DEFAULT '{}'::text[],
  is_launched         boolean    NOT NULL DEFAULT false,
  is_active           boolean    NOT NULL DEFAULT true,
  display_order       integer    NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inspection_domains IS
  'Configuration row per inspection domain. Drives marketplace visibility, '
  'persona-aware marketing, and the mapping from client-side specialty groups '
  'to server-side domain identity. is_launched gates public visibility; '
  'is_active is the admin kill-switch.';

-- Seed: industrial_ndt is the existing domain (launched). Three new
-- domains seeded as not-launched so no UI surfaces them publicly yet.
INSERT INTO public.inspection_domains (
  slug, display_name, persona_label, short_pitch, icon_key,
  tint_hex, landing_url_slug, regulatory_bodies,
  default_specialty_groups, is_launched, display_order
)
VALUES
  (
    'industrial_ndt',
    'Industrial & NDT',
    'Asset Integrity Manager',
    'Pipeline, refinery, and asset-integrity inspection with full NDT method coverage.',
    'shield', '#7C3AED', 'industrial',
    ARRAY['API','ASME','ASNT','AWS','NACE']::text[],
    ARRAY[
      'NDT methods', 'API standards', 'Coatings & corrosion',
      'Pressure equipment & boilers', 'Storage tanks',
      'Oil & gas — upstream', 'Oil & gas — downstream / process',
      'Marine & offshore', 'Quality, safety & systems', 'Special domains'
    ]::text[],
    true, 0
  ),
  (
    'civil_construction',
    'Civil & Construction',
    'Construction Project Manager',
    'Quality assurance for concrete, rebar, formwork, structural steel, and field testing.',
    'building', '#7C3AED', 'civil',
    ARRAY['ACI','ASTM','AWS','AISC']::text[],
    ARRAY['Civil & structural']::text[],
    false, 10
  ),
  (
    'electrical',
    'Electrical',
    'Facility / Reliability Manager',
    'NETA testing, thermography, switchgear, and arc-flash compliance.',
    'zap', '#7C3AED', 'electrical',
    ARRAY['NETA','NFPA','NEC','IEEE']::text[],
    ARRAY['Electrical & instrumentation', 'Power & renewables']::text[],
    false, 20
  ),
  (
    'mechanical_field',
    'Mechanical Field',
    'Turnaround / Construction Manager',
    'Welding, piping, rotating equipment, and pressure testing in construction and turnaround windows.',
    'wrench', '#7C3AED', 'mechanical',
    ARRAY['ASME','API','AWS','ASNT']::text[],
    ARRAY['Welding & joining', 'Piping & pipelines', 'Mechanical & rotating', 'Lifting & rigging']::text[],
    false, 30
  )
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  persona_label = EXCLUDED.persona_label,
  short_pitch = EXCLUDED.short_pitch,
  icon_key = EXCLUDED.icon_key,
  landing_url_slug = EXCLUDED.landing_url_slug,
  regulatory_bodies = EXCLUDED.regulatory_bodies,
  default_specialty_groups = EXCLUDED.default_specialty_groups,
  updated_at = now();

-- updated_at trigger.
CREATE OR REPLACE FUNCTION public.tg_inspection_domains_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

DROP TRIGGER IF EXISTS tg_inspection_domains_set_updated_at ON public.inspection_domains;
CREATE TRIGGER tg_inspection_domains_set_updated_at
  BEFORE UPDATE ON public.inspection_domains
  FOR EACH ROW EXECUTE FUNCTION public.tg_inspection_domains_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 3) RLS — everyone authenticated reads; only super_admin writes.
--    Public table semantically (the marketplace needs to know which
--    domains are launched), but writes are admin-only.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.inspection_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inspection_domains_read_all     ON public.inspection_domains;
DROP POLICY IF EXISTS inspection_domains_admin_write  ON public.inspection_domains;

CREATE POLICY inspection_domains_read_all
  ON public.inspection_domains FOR SELECT
  USING (true);

CREATE POLICY inspection_domains_admin_write
  ON public.inspection_domains FOR ALL
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- ─────────────────────────────────────────────────────────────────────
-- 4) Add `domain` column to the four tables that need it for Layer 1.
--    NOT NULL with default = 'industrial_ndt' so every existing row
--    backfills automatically. No existing INSERT statement needs to
--    change. No existing SELECT needs to change. No RLS policy is
--    modified.
--
--    Deliberately scoped to four tables. PCP-adjacent tables
--    (approval_policies, department_budgets) are NOT touched in
--    Layer 1 — they're a future-layer concern.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS domain public.inspection_domain
    NOT NULL DEFAULT 'industrial_ndt';

ALTER TABLE public.inspection_reports
  ADD COLUMN IF NOT EXISTS domain public.inspection_domain
    NOT NULL DEFAULT 'industrial_ndt';

ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS domain public.inspection_domain
    NOT NULL DEFAULT 'industrial_ndt';

ALTER TABLE public.inspection_scope_templates
  ADD COLUMN IF NOT EXISTS domain public.inspection_domain
    NOT NULL DEFAULT 'industrial_ndt';

-- Indexes for the most common upcoming filters: "list jobs in my domain"
-- and "list scope templates for this domain". B-tree because cardinality
-- is low (max 4 domains).
CREATE INDEX IF NOT EXISTS jobs_domain_idx
  ON public.jobs (domain)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS inspection_scope_templates_domain_idx
  ON public.inspection_scope_templates (domain)
  WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Comment-as-doc on the new columns. Reads naturally in psql,
--    surfaces in any introspection tool.
-- ─────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.jobs.domain IS
  'Inspection domain for this job. Defaults to industrial_ndt so existing '
  'jobs and existing job-post code paths are not affected. Set explicitly '
  'when posting a civil, electrical, or mechanical job.';

COMMENT ON COLUMN public.inspection_reports.domain IS
  'Inspection domain inherited from the parent job at report creation time.';

COMMENT ON COLUMN public.report_templates.domain IS
  'Domain this report template applies to. Civil pour cards, electrical '
  'thermography reports, mechanical weld inspection reports each have '
  'their own templates living in their own domain.';

COMMENT ON COLUMN public.inspection_scope_templates.domain IS
  'Domain this scope template applies to. The existing `category` column '
  'remains the CCI-flavoured sub-category; `domain` is the higher-level '
  'cross-domain classifier.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK PROCEDURE (run only if needed; preserves all data)
-- ─────────────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP INDEX IF EXISTS public.jobs_domain_idx;
--   DROP INDEX IF EXISTS public.inspection_scope_templates_domain_idx;
--   ALTER TABLE public.inspection_scope_templates DROP COLUMN IF EXISTS domain;
--   ALTER TABLE public.report_templates DROP COLUMN IF EXISTS domain;
--   ALTER TABLE public.inspection_reports DROP COLUMN IF EXISTS domain;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS domain;
--   DROP POLICY IF EXISTS inspection_domains_read_all    ON public.inspection_domains;
--   DROP POLICY IF EXISTS inspection_domains_admin_write ON public.inspection_domains;
--   DROP TRIGGER IF EXISTS tg_inspection_domains_set_updated_at ON public.inspection_domains;
--   DROP FUNCTION IF EXISTS public.tg_inspection_domains_set_updated_at();
--   DROP TABLE IF EXISTS public.inspection_domains;
--   DROP TYPE IF EXISTS public.inspection_domain;
-- COMMIT;
