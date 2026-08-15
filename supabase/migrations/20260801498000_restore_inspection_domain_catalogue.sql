-- ════════════════════════════════════════════════════════════════════════════
--  20260801498000_restore_inspection_domain_catalogue.sql
--
--  P0 — public.inspection_domains is EMPTY. /admin/domains renders its
--  empty state, and every surface that reads the catalogue (job creation,
--  inspector onboarding, browse filters, matching, Talent preferences,
--  reporting) has no domains to offer. Manual QA is blocked here.
--
--  ── ROOT CAUSE: ARCHIVED SEED, NOT DELETED DATA ────────────────────────────
--  Nothing was dropped, renamed, or truncated. The rows were never inserted
--  by the chain that actually runs.
--
--    • The remote baseline CREATEs the table (00000000000000:22992) and its
--      constraints, RLS, and updated_at trigger — but contains NO INSERT for
--      it. Verified: zero `INSERT INTO public.inspection_domains` anywhere in
--      supabase/migrations/ or supabase/seed.sql.
--    • Every seeding statement lives in supabase/migrations_archive/, which
--      is NOT part of the active chain:
--        20260616120000_inspection_domain_primitive.sql:106   (the first 4)
--        20260619120000_chemical_process_domain_config.sql:35 (the 5th)
--        20260620120000_chemical_process_domain_repair.sql:65 (its repair)
--        20260623..20260627120000_*_default_groups_and_scope_catalogue.sql
--                                                   (final specialty groups)
--
--  So a fresh database — local, Staging, or any rebuild — gets the table and
--  none of its contents. This is reproducible: the LOCAL database is also at
--  0 rows, identical to Staging. It is not an RLS visibility problem;
--  inspection_domains_read_all permits SELECT, and the count is 0 under
--  BYPASSRLS.
--
--  The stale empty-state text in apps/web/src/app/admin/domains/page.tsx made
--  this hard to see: it told the operator to apply
--  20260616120000_inspection_domain_primitive.sql — a file that has been
--  archived and can never apply. That text is corrected in the same commit.
--
--  ── WHY FIVE ROWS, NOT FOUR ────────────────────────────────────────────────
--  The stale UI says "the four seed rows". Four is wrong. The canonical
--  cross-platform source of truth is
--  packages/shared-core/src/schemas/inspectionDomain.ts, whose
--  INSPECTION_DOMAIN_SLUGS lists FIVE, and the database ENUM
--  public.inspection_domain already carries all five:
--      industrial_ndt, civil_construction, electrical, mechanical_field,
--      chemical_process
--  chemical_process arrived in the Layer 5 expansion after the original
--  4-row seed was written, which is why the older comment undercounts.
--  Restoring four would silently drop a whole domain.
--
--  ── PROVENANCE OF EVERY VALUE ──────────────────────────────────────────────
--  Nothing here is invented. Each field is transcribed from the archived
--  migrations named above, taking the LATEST authoritative writer per field:
--    • slug / display_name / persona_label / short_pitch / icon_key /
--      tint_hex / landing_url_slug / regulatory_bodies / display_order
--        — 20260616120000 for the first four,
--          20260620120000 (the repair, superseding 20260619120000) for
--          chemical_process.
--    • default_specialty_groups
--        — the five 20260623..20260627 catalogue migrations, which each
--          perform a FULL-ARRAY REPLACEMENT and therefore supersede the
--          arrays in the original seed. (industrial_ndt gained
--          'Welding & joining' and 'Piping & pipelines'; chemical_process
--          went from an empty array to four groups.)
--    • description_md is left NULL because no archived migration ever set
--      it. Writing prose here would be inventing catalogue content.
--
--  Specialty group labels are deliberately Title Case, NOT kebab-case.
--  20260622120000_unify_specialty_slugs_kebab.sql states in its own header
--  that it "Does NOT touch inspection_domains", so these arrays were never
--  converted and must not be converted here.
--
--  ── ADDITIVE AND IDEMPOTENT ────────────────────────────────────────────────
--  Staging has already applied the earlier migrations, so this is a NEW
--  forward migration at the next genuinely free number (the active chain
--  ends at 20260801496000). No already-applied migration is edited.
--
--  ON CONFLICT refreshes presentation fields ONLY. is_launched and is_active
--  are deliberately NOT in the UPDATE list: if an admin has already launched
--  a domain from /admin/domains, re-running this must not regress that
--  decision. That discipline is inherited from 20260620120000, which called
--  it out explicitly. On first INSERT the launch state is the seeded intent —
--  industrial_ndt launched, the other four gated pending admin action.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.inspection_domains (
  slug, display_name, persona_label, short_pitch, icon_key,
  tint_hex, landing_url_slug, regulatory_bodies,
  default_specialty_groups, is_launched, is_active, display_order
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
      'NDT methods', 'API standards', 'Welding & joining', 'Piping & pipelines',
      'Coatings & corrosion', 'Pressure equipment & boilers', 'Storage tanks',
      'Oil & gas — upstream', 'Oil & gas — downstream / process',
      'Marine & offshore', 'Quality, safety & systems', 'Special domains'
    ]::text[],
    true, true, 0
  ),
  (
    'civil_construction',
    'Civil & Construction',
    'Construction Project Manager',
    'Quality assurance for concrete, rebar, formwork, structural steel, and field testing.',
    'building', '#7C3AED', 'civil',
    ARRAY['ACI','ASTM','AWS','AISC']::text[],
    ARRAY[
      'Civil & structural', 'Welding & joining', 'Coatings & corrosion',
      'Quality, safety & systems', 'Special domains'
    ]::text[],
    false, true, 10
  ),
  (
    'electrical',
    'Electrical',
    'Facility / Reliability Manager',
    'NETA testing, thermography, switchgear, and arc-flash compliance.',
    'zap', '#7C3AED', 'electrical',
    ARRAY['NETA','NFPA','NEC','IEEE']::text[],
    ARRAY[
      'Electrical & instrumentation', 'Power & renewables', 'NDT methods',
      'Quality, safety & systems', 'Special domains'
    ]::text[],
    false, true, 20
  ),
  (
    'mechanical_field',
    'Mechanical Field',
    'Turnaround / Construction Manager',
    'Welding, piping, rotating equipment, and pressure testing in construction and turnaround windows.',
    'wrench', '#7C3AED', 'mechanical',
    ARRAY['ASME','API','AWS','ASNT']::text[],
    ARRAY[
      'Welding & joining', 'Piping & pipelines', 'Mechanical & rotating',
      'Lifting & rigging', 'NDT methods', 'Coatings & corrosion',
      'Quality, safety & systems'
    ]::text[],
    false, true, 30
  ),
  (
    'chemical_process',
    'Chemical & Process',
    'HSE / Process Safety Manager',
    'Process Safety Management, hazardous-material handling, batch chemistry validation, and environmental-release inspection across refining, petrochemical, and specialty-chemical sites.',
    'flask', '#7C3AED', 'chemical',
    ARRAY['API','ASME','OSHA-PSM','EPA-RMP','AIChE','CCPS','NFPA']::text[],
    ARRAY[
      'Chemical & process', 'Pressure equipment & boilers',
      'Piping & pipelines', 'Quality, safety & systems'
    ]::text[],
    false, true, 40
  )
ON CONFLICT (slug) DO UPDATE SET
  display_name             = EXCLUDED.display_name,
  persona_label            = EXCLUDED.persona_label,
  short_pitch              = EXCLUDED.short_pitch,
  icon_key                 = EXCLUDED.icon_key,
  tint_hex                 = EXCLUDED.tint_hex,
  landing_url_slug         = EXCLUDED.landing_url_slug,
  regulatory_bodies        = EXCLUDED.regulatory_bodies,
  default_specialty_groups = EXCLUDED.default_specialty_groups,
  display_order            = EXCLUDED.display_order,
  updated_at               = now();
  -- is_launched / is_active intentionally omitted — see header.

-- ─── Selftest — the catalogue must be complete and coherent ─────────────────
DO $selftest$
DECLARE v_n int; v_missing text; v_enum int;
BEGIN
  -- 1. Every ENUM member has a config row. This is the assertion that would
  --    have caught the original defect: the ENUM and the table must agree,
  --    and comparing against the ENUM rather than a hard-coded 5 means a
  --    future sixth domain cannot be half-added.
  FOR v_missing IN
    SELECT e.enumlabel::text
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid AND t.typname = 'inspection_domain'
     WHERE NOT EXISTS (SELECT 1 FROM public.inspection_domains d
                        WHERE d.slug::text = e.enumlabel::text)
  LOOP
    RAISE EXCEPTION
      'SELFTEST: inspection_domain ENUM member % has no inspection_domains row', v_missing;
  END LOOP;

  -- 2. And the table is not EMPTY or truncated — the literal failure mode.
  SELECT count(*) INTO v_n FROM public.inspection_domains;
  SELECT count(*) INTO v_enum
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'inspection_domain';
  IF v_n < v_enum THEN
    RAISE EXCEPTION
      'SELFTEST: catalogue is truncated — % rows for % ENUM members', v_n, v_enum;
  END IF;

  -- 3. No row may carry an empty specialty mapping. An all-empty
  --    default_specialty_groups is how chemical_process shipped before its
  --    catalogue migration, and it silently yields a domain that matches
  --    no inspector.
  FOR v_missing IN
    SELECT slug::text FROM public.inspection_domains
     WHERE cardinality(default_specialty_groups) = 0
  LOOP
    RAISE EXCEPTION
      'SELFTEST: domain % has no default_specialty_groups — it would match no inspector', v_missing;
  END LOOP;

  -- 4. At least one domain must be launched, or every consumer surface is
  --    empty even though the table is populated.
  IF NOT EXISTS (SELECT 1 FROM public.inspection_domains
                  WHERE is_launched AND is_active) THEN
    RAISE EXCEPTION
      'SELFTEST: no domain is both launched and active — consumer surfaces would still be empty';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
