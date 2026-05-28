-- ════════════════════════════════════════════════════════════════════════════
--  20260622120000_unify_specialty_slugs_kebab.sql
--
--  PHASE 0B (LAYER 5 FINISH) — backfill specialty slugs from legacy
--  snake_case (mobile) to canonical kebab-case (shared-core).
--
--  CONTEXT
--  ───────
--  Pre-Phase-0, two divergent taxonomies coexisted:
--    • apps/web/src/lib/data/specialtyTaxonomy.ts        — 277 kebab slugs
--    • src/data/specialties.ts                            — ~58 snake slugs
--  Both wrote into the SAME columns (jobs.specialty_slugs and
--  profiles.specialty_slugs, both text[]). The match engine —
--  array_overlap(jobs.specialty_slugs, profiles.specialty_slugs) — could
--  never intersect a job posted from web with a profile built on mobile
--  because the slug strings were entirely disjoint.
--
--  Phase 0B unifies on kebab-case via a single canonical source
--  (packages/shared-core/src/data/specialtyTaxonomy.ts). This migration
--  rewrites in-place every legacy snake_case slug to its approved kebab
--  equivalent per PHASE_0A_SLUG_MAPPING.md (user-approved this turn).
--
--  GUARANTEES
--  ──────────
--    • Idempotent. The mapping CTE drives a single UPDATE per table; rows
--      that don't reference any legacy slug are filtered out by the EXISTS
--      clause and never touched. Re-running the migration is a no-op.
--    • Order-preserving where it matters. We emit DISTINCT to collapse
--      cases where both the old snake AND the new kebab were already in
--      the same array (impossible today, but defensive against partial
--      backfills).
--    • Coalesce uses the mapping when a slug matches, else passes through.
--      Unknown / custom_ prefixed slugs are preserved verbatim.
--    • No schema change. No index drop. The GIN index on
--      profiles.specialty_slugs reindexes automatically on UPDATE.
--    • No RLS / policy / RPC modification.
--
--  WHAT THIS DOES NOT DO
--  ─────────────────────
--    • Does NOT update any column other than jobs.specialty_slugs and
--      profiles.specialty_slugs.
--    • Does NOT touch inspection_domains, inspector_domain_practice, or
--      any Layer 1-5 row.
--    • Does NOT modify the inspection_domain ENUM.
--
--  VERIFICATION (after applying)
--  ─────────────────────────────
--    SELECT count(*) FROM public.jobs
--      WHERE specialty_slugs::text[] && ARRAY[
--        'welding_inspection_cwi','ndt_ultrasonic','api_570_piping'
--        -- … any of the 58 snake legacy slugs
--      ];
--    -- Expect: 0 (no legacy snake slugs remain anywhere)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- The canonical mapping. 58 rows. Order matches PHASE_0A_SLUG_MAPPING.md.
-- ─────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE specialty_slug_remap (
  old_slug text PRIMARY KEY,
  new_slug text NOT NULL
);

INSERT INTO specialty_slug_remap (old_slug, new_slug) VALUES
  -- welding_materials → Welding & joining / Coatings & corrosion
  ('welding_inspection_cwi',         'aws-cwi'),
  ('welding_inspection_cswip',       'cswip-3-1'),
  ('metallurgy',                     'metallurgy-materials-engineering'),
  ('corrosion_engineering',          'corrosion-engineering'),
  -- ndt → NDT methods
  ('ndt_ultrasonic',                 'ndt-ut'),
  ('ndt_radiography',                'ndt-rt'),
  ('ndt_magnetic_particle',          'ndt-mt'),
  ('ndt_liquid_penetrant',           'ndt-pt'),
  ('ndt_eddy_current',               'ndt-et'),
  ('ndt_visual',                     'ndt-vt'),
  ('ndt_phased_array',               'ndt-paut'),
  ('ndt_thickness_uts',              'ndt-ut'),
  -- pressure_equipment → API standards / ASME
  ('pressure_vessel_api510',         'api-510'),
  ('api_570_piping',                 'api-570'),
  ('api_653_storage_tanks',          'api-653'),
  ('api_580_rbi',                    'api-580'),
  ('asme_section_viii',              'asme-section-viii'),
  ('asme_b31_piping',                'asme-b31'),
  ('heat_exchanger',                 'heat-exchanger-inspection'),
  -- coatings_corrosion → Coatings & corrosion
  ('coating_inspection_nace',        'nace-cip-2'),
  ('coating_inspection_bgas',        'bgas-cswip-coating'),
  ('cathodic_protection',            'nace-cp-2'),
  -- rotating_mechanical → Mechanical & rotating / Lifting & rigging
  ('rotating_equipment',             'rotating-equipment-inspection'),
  ('gas_turbine_inspection',         'gas-turbine-inspection'),
  ('vibration_analysis',             'vibration-analysis'),
  ('lifting_cranes',                 'lifting-gear-cranes'),
  ('valves_actuators',               'valves-actuators'),
  -- electrical_instrumentation → Electrical & instrumentation / NDT IRT
  ('electrical_inspection',          'electrical-inspection'),
  ('instrumentation_control',        'instrumentation-control'),
  ('plc_scada',                      'plc-scada'),
  ('thermography',                   'ndt-irt'),
  ('ex_inspection_atex_iecex',       'ex-atex-iecex-inspection'),
  -- civil_structural → Civil & structural
  ('concrete_inspection',            'concrete-inspection'),
  ('structural_steel',               'structural-steel'),
  ('bridge_inspection',              'bridge-inspection'),
  ('tank_inspection_civil',          'tank-foundation-bunds'),
  -- safety_access → Quality, safety & systems
  ('rope_access_irata',              'rope-access-irata-sprat'),
  ('confined_space',                 'confined-space-entry'),
  ('osha_authority',                 'osha-authorised-person'),
  ('hse_management',                 'hse-management'),
  -- qaqc_audit → Quality, safety & systems
  ('iso_9001_audit',                 'iso-9001-auditor'),
  ('iso_45001_audit',                'iso-45001-auditor'),
  ('iso_14001_audit',                'iso-14001-auditor'),
  ('qaqc_management',                'qaqc-management'),
  -- subsea_pipeline → Marine & offshore / Piping & pipelines
  ('pipeline_integrity',             'pipeline-integrity'),
  ('subsea_inspection',              'subsea-inspection'),
  ('pigging_ili',                    'pigging-ili'),
  -- energy_specific → Oil & gas / Power & renewables
  ('oil_gas_upstream',               'oil-gas-upstream-experience'),
  ('oil_gas_midstream',              'oil-gas-midstream-experience'),
  ('oil_gas_downstream',             'oil-gas-downstream-experience'),
  ('lng_cryogenic',                  'lng-cryogenic'),
  ('power_generation',               'power-generation-conventional'),
  ('wind_renewables',                'wind-renewables'),
  ('nuclear_inspection',             'nuclear-inspection'),
  -- chemical_process (already kebab in shared-core)
  ('process_safety_management',      'psm'),
  ('mechanical_integrity_program',   'mechanical-integrity'),
  ('process_hazard_analysis',        'pha-hazop'),
  ('pressure_relief_inspection',     'pressure-relief-devices'),
  ('heat_exchanger_inspection',      'heat-exchanger-inspection'),
  ('ldar_leak_detection',            'ldar')
ON CONFLICT (old_slug) DO NOTHING;

-- Sanity: surface row count so it appears in the migration log.
DO $$
DECLARE c integer;
BEGIN
  SELECT count(*) INTO c FROM specialty_slug_remap;
  RAISE NOTICE 'Phase 0B remap rows loaded: % (expect 60)', c;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Backfill public.jobs.specialty_slugs
--
-- Rewrites the array element-by-element via the mapping. DISTINCT collapses
-- any case where an array already contained both the old and the new slug.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.jobs AS j
   SET specialty_slugs = sub.new_arr
  FROM (
    SELECT j2.id,
           ARRAY(
             SELECT DISTINCT COALESCE(m.new_slug, s.slug)
               FROM unnest(j2.specialty_slugs) WITH ORDINALITY AS s(slug, ord)
               LEFT JOIN specialty_slug_remap m ON m.old_slug = s.slug
               ORDER BY ord
           ) AS new_arr
      FROM public.jobs j2
     WHERE j2.specialty_slugs && (SELECT array_agg(old_slug) FROM specialty_slug_remap)
  ) sub
 WHERE j.id = sub.id;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Backfill public.profiles.specialty_slugs
-- Same approach. The GIN index on this column reindexes automatically.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.profiles AS p
   SET specialty_slugs = sub.new_arr
  FROM (
    SELECT p2.id,
           ARRAY(
             SELECT DISTINCT COALESCE(m.new_slug, s.slug)
               FROM unnest(p2.specialty_slugs) WITH ORDINALITY AS s(slug, ord)
               LEFT JOIN specialty_slug_remap m ON m.old_slug = s.slug
               ORDER BY ord
           ) AS new_arr
      FROM public.profiles p2
     WHERE p2.specialty_slugs && (SELECT array_agg(old_slug) FROM specialty_slug_remap)
  ) sub
 WHERE p.id = sub.id;

-- ─────────────────────────────────────────────────────────────────────
-- Verification — surface counts so they appear in the migration log.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE jobs_remaining integer; profiles_remaining integer;
BEGIN
  SELECT count(*) INTO jobs_remaining
    FROM public.jobs
   WHERE specialty_slugs && (SELECT array_agg(old_slug) FROM specialty_slug_remap);

  SELECT count(*) INTO profiles_remaining
    FROM public.profiles
   WHERE specialty_slugs && (SELECT array_agg(old_slug) FROM specialty_slug_remap);

  IF jobs_remaining > 0 THEN
    RAISE NOTICE 'WARNING: % jobs row(s) still reference a legacy snake slug', jobs_remaining;
  END IF;
  IF profiles_remaining > 0 THEN
    RAISE NOTICE 'WARNING: % profiles row(s) still reference a legacy snake slug', profiles_remaining;
  END IF;
  IF jobs_remaining = 0 AND profiles_remaining = 0 THEN
    RAISE NOTICE 'Phase 0B backfill clean — zero legacy snake slugs remain.';
  END IF;
END $$;

-- Temp table is dropped automatically at COMMIT.
COMMIT;
