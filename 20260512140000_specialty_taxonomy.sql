-- ════════════════════════════════════════════════════════════════════════════
--  20260512140000_specialty_taxonomy.sql
--  NEXPEC — Specialty taxonomy (Phase 1/3 schema).
--
--  Adds the canonical specialty_slugs columns to jobs and profiles. These
--  hold slug arrays drawn from the controlled taxonomy in
--  `src/data/specialties.ts`. Existing free-form columns
--  (`profiles.specialties`, `profiles.skills`) are NOT dropped — they
--  remain readable for backward compatibility. Writers are migrated to
--  the new slug columns in the same patch.
--
--  Hard guarantees
--  ───────────────
--    1. New columns are TEXT[] NOT NULL DEFAULT '{}'. NULL is forbidden;
--       absence-of-specialties is the empty array. Eliminates NULL-vs-empty
--       branching in every consumer.
--    2. GIN indexes on both columns — fast `&&` (overlap) and `@>`
--       (contains) for the job-feed matcher (server-side intersection).
--    3. Backfill is best-effort + case-insensitive. The DO block maps
--       legacy free-form strings to slugs by exact-name, then synonym,
--       then substring match against the on-disk taxonomy table that
--       this migration also seeds.
--    4. The seed table `public.specialty_catalog` is a read-only mirror
--       of the TS taxonomy used ONLY for the backfill. The TS file
--       remains the application-runtime source of truth — the catalog
--       is dropped at the end of the migration once the backfill is
--       done, leaving the database with just the slug columns and the
--       data they contain.
--    5. Idempotent: re-running the migration is safe.
--
--  Why we don't store the taxonomy in Postgres permanently:
--  ────────────────────────────────────────────────────────
--  Disciplines + groups change rarely and need to be diffable in PRs.
--  Putting them in a Postgres table means schema drift between TS and
--  SQL, plus a new write surface to RLS. The TS file is the canonical
--  artifact; the database holds only references (slugs).
--
--  Reversible. Down path at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  UP
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. New columns ────────────────────────────────────────────────────────

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS specialty_slugs text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.jobs.specialty_slugs IS
  'Canonical specialty taxonomy slugs (see src/data/specialties.ts). Set by clients/agencies on job creation; matched server-side against profiles.specialty_slugs for the inspector feed.';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS specialty_slugs text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.profiles.specialty_slugs IS
  'Canonical specialty taxonomy slugs (see src/data/specialties.ts). Set by inspectors in profile edit. Supersedes the legacy free-form profiles.specialties text column for matching purposes; the legacy column is retained for backward compatibility but no longer authoritative.';


-- ─── 2. GIN indexes for array containment / overlap ────────────────────────

CREATE INDEX IF NOT EXISTS jobs_specialty_slugs_gin
  ON public.jobs USING GIN (specialty_slugs);

CREATE INDEX IF NOT EXISTS profiles_specialty_slugs_gin
  ON public.profiles USING GIN (specialty_slugs);


-- ─── 3. Backfill scaffolding — temporary catalog table ─────────────────────
--
--  Seeded from the canonical TS taxonomy. Used solely for the backfill
--  in section 4, then dropped at section 5 so the taxonomy lives only
--  in TypeScript at runtime.
--
--  Keep these rows in sync with src/data/specialties.ts. The slug list
--  is the single fact: name + synonyms are search aides only.

CREATE TEMP TABLE _nexpec_specialty_catalog (
  slug      text PRIMARY KEY,
  name      text NOT NULL,
  synonyms  text[] NOT NULL DEFAULT '{}'::text[]
) ON COMMIT DROP;

INSERT INTO _nexpec_specialty_catalog (slug, name, synonyms) VALUES
  ('welding_inspection_cwi',       'Welding Inspection (CWI)',                ARRAY['cwi','aws cwi','weld inspector','aws d1.1']),
  ('welding_inspection_cswip',     'Welding Inspection (CSWIP)',              ARRAY['cswip','cswip 3.1','cswip 3.2']),
  ('metallurgy',                   'Metallurgy & Materials Engineering',      ARRAY['materials','pmi','positive material id','hardness testing']),
  ('corrosion_engineering',        'Corrosion Engineering',                   ARRAY['corrosion','cp','cathodic protection']),
  ('ndt_ultrasonic',               'NDT — Ultrasonic (UT)',                   ARRAY['ut','ultrasonic','phased array','paut','tofd']),
  ('ndt_radiography',              'NDT — Radiography (RT)',                  ARRAY['rt','radiography','x-ray','gamma','cr','dr']),
  ('ndt_magnetic_particle',        'NDT — Magnetic Particle (MT)',            ARRAY['mt','mpi','magnetic particle']),
  ('ndt_liquid_penetrant',         'NDT — Liquid Penetrant (PT)',             ARRAY['pt','dpi','dye penetrant','liquid penetrant']),
  ('ndt_eddy_current',             'NDT — Eddy Current (ET)',                 ARRAY['et','eddy current','eca','tube inspection']),
  ('ndt_visual',                   'NDT — Visual (VT)',                       ARRAY['vt','visual inspection']),
  ('ndt_thickness_uts',            'NDT — Ultrasonic Thickness',              ARRAY['utm','thickness survey','corrosion mapping']),
  ('api_510_pressure_vessels',     'API 510 — Pressure Vessels',              ARRAY['api 510','pressure vessel','vessel inspection']),
  ('api_570_piping',               'API 570 — Piping',                        ARRAY['api 570','piping inspector','process piping']),
  ('api_653_storage_tanks',        'API 653 — Aboveground Storage Tanks',     ARRAY['api 653','ast','storage tank','tank inspector']),
  ('api_580_rbi',                  'API 580 / 581 — Risk-Based Inspection',   ARRAY['api 580','api 581','rbi','risk based inspection']),
  ('asme_section_viii',            'ASME Section VIII (Pressure Vessels)',    ARRAY['asme viii','asme section 8','pressure vessel code']),
  ('asme_b31_piping',              'ASME B31 — Piping Codes',                 ARRAY['asme b31','b31.1','b31.3','b31.4','b31.8']),
  ('coating_inspection_nace',      'Coating Inspection (NACE / AMPP)',        ARRAY['nace','ampp','cip','coating inspector']),
  ('coating_inspection_bgas',      'Coating Inspection (BGAS-CSWIP)',         ARRAY['bgas','bgas-cswip','painting inspector']),
  ('cathodic_protection',          'Cathodic Protection',                     ARRAY['cp','cathodic protection','nace cp']),
  ('rotating_equipment',           'Rotating Equipment',                      ARRAY['rotating','compressor','pump','gearbox']),
  ('gas_turbine_inspection',       'Gas Turbine Inspection',                  ARRAY['gas turbine','gt','boroscope','hot gas path']),
  ('vibration_analysis',           'Vibration Analysis',                      ARRAY['vibration','iso 18436','condition monitoring']),
  ('lifting_cranes',               'Lifting Gear & Cranes',                   ARRAY['cranes','lifting','loler','slings']),
  ('valves_actuators',             'Valves & Actuators',                      ARRAY['valves','psv','prv','actuators']),
  ('electrical_inspection',        'Electrical Inspection',                   ARRAY['electrical','switchgear','hv','lv']),
  ('instrumentation_control',      'Instrumentation & Control',               ARRAY['instrumentation','i&c','sil','sis','calibration']),
  ('plc_scada',                    'PLC / SCADA / DCS',                       ARRAY['plc','scada','dcs','fat','sat']),
  ('thermography',                 'Thermography (Infrared)',                 ARRAY['thermography','ir','infrared','thermal imaging']),
  ('ex_inspection_atex_iecex',     'Ex / ATEX / IECEx Inspection',            ARRAY['atex','iecex','ex inspection','hazardous area']),
  ('structural_steel',             'Structural Steel',                        ARRAY['steel','structural','fabrication']),
  ('concrete_inspection',          'Concrete Inspection',                     ARRAY['concrete','rebar','rc']),
  ('bridge_inspection',            'Bridge Inspection',                       ARRAY['bridges','bridge inspector']),
  ('tank_inspection_civil',        'Tank Foundation / Bunds',                 ARRAY['bunds','foundations']),
  ('hse_management',               'HSE Management',                          ARRAY['hse','safety','ehs']),
  ('rope_access_irata',            'Rope Access (IRATA / SPRAT)',             ARRAY['irata','sprat','rope access']),
  ('confined_space',               'Confined Space Entry',                    ARRAY['confined space','cse']),
  ('osha_authority',               'OSHA / Authorised Person',                ARRAY['osha','osha 30','authorised person']),
  ('qaqc_management',              'QA / QC Management',                      ARRAY['qaqc','qa','qc','itp','mdr']),
  ('iso_9001_audit',               'ISO 9001 Auditing',                       ARRAY['iso 9001','qms','lead auditor']),
  ('iso_45001_audit',              'ISO 45001 Auditing',                      ARRAY['iso 45001','ohsas']),
  ('iso_14001_audit',              'ISO 14001 Auditing',                      ARRAY['iso 14001','ems']),
  ('pipeline_integrity',           'Pipeline Integrity',                      ARRAY['pipeline','integrity','pim']),
  ('subsea_inspection',            'Subsea Inspection',                       ARRAY['subsea','rov','underwater inspection']),
  ('pigging_ili',                  'Pigging & In-Line Inspection',            ARRAY['pigging','ili','mfl']),
  ('oil_gas_upstream',             'Oil & Gas — Upstream',                    ARRAY['upstream','wellhead','production']),
  ('oil_gas_midstream',            'Oil & Gas — Midstream',                   ARRAY['midstream','terminal','compressor station']),
  ('oil_gas_downstream',           'Oil & Gas — Downstream (Refinery)',       ARRAY['refinery','downstream','turnaround','ta']),
  ('lng_cryogenic',                'LNG & Cryogenic',                         ARRAY['lng','cryogenic']),
  ('power_generation',             'Power Generation (Conventional)',         ARRAY['power gen','boiler','hrsg','steam turbine']),
  ('wind_renewables',              'Wind & Renewables',                       ARRAY['wind','gwo','solar','pv','renewables']),
  ('nuclear_inspection',           'Nuclear Inspection',                      ARRAY['nuclear','asme iii','n-stamp']);


-- ─── 4. Backfill profiles.specialty_slugs from legacy free-form text ───────
--
--  We look at TWO legacy sources on profiles: `specialties` and `skills`.
--  CRITICAL: the column SHAPE differs across deployments —
--    • Some Supabase projects store these as text[] (canonical).
--    • Other projects store them as plain text (CSV-shaped, comma
--      separated). DATABASE_FIXES.sql adds them as text[] but does NOT
--      DROP a pre-existing text column, so legacy projects keep the
--      text shape.
--
--  The defensive probe inspects information_schema.columns.udt_name to
--  emit the correct array-producing expression for each column:
--    • text[]   (udt_name = '_text')     → COALESCE(col, '{}'::text[])
--    • text     (udt_name = 'text')      → string_to_array(COALESCE(col,''), ',')
--    • absent / other types              → skip silently
--
--  Algorithm for each token, case-insensitive:
--    1. Exact match on name
--    2. Exact match on a synonym
--    3. Substring containment (name contains token) — last-resort
--  Unmatched tokens are silently skipped.

DO $$
DECLARE
  v_specialties_udt text;
  v_skills_udt      text;
  v_specialties_expr text := '';
  v_skills_expr      text := '';
  v_sources          text[] := ARRAY[]::text[];
  v_unnest_arg       text;
  v_updated_count    int := 0;
  v_dynamic_sql      text;
BEGIN
  -- Probe the actual column types. `udt_name = '_text'` is Postgres'
  -- internal name for text[]; '_int4' for int[], etc.
  SELECT udt_name INTO v_specialties_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'specialties';

  SELECT udt_name INTO v_skills_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'skills';

  -- Build the array-producing expression for each candidate source.
  IF v_specialties_udt = '_text' THEN
    v_specialties_expr := 'COALESCE(p.specialties, ''{}''::text[])';
  ELSIF v_specialties_udt = 'text' THEN
    -- CSV-shaped text column: split on comma, trim whitespace happens
    -- later in the lower(trim(t)) clause.
    v_specialties_expr := 'string_to_array(COALESCE(p.specialties, ''''), '','')';
  ELSIF v_specialties_udt IS NOT NULL THEN
    RAISE NOTICE '[specialty-taxonomy] profiles.specialties has unexpected type %; skipping as a backfill source.', v_specialties_udt;
  END IF;

  IF v_skills_udt = '_text' THEN
    v_skills_expr := 'COALESCE(p.skills, ''{}''::text[])';
  ELSIF v_skills_udt = 'text' THEN
    v_skills_expr := 'string_to_array(COALESCE(p.skills, ''''), '','')';
  ELSIF v_skills_udt IS NOT NULL THEN
    RAISE NOTICE '[specialty-taxonomy] profiles.skills has unexpected type %; skipping as a backfill source.', v_skills_udt;
  END IF;

  -- Assemble the unnest() argument by concatenating present sources
  -- with the array-concatenation operator `||`. text[] || text[] is
  -- well-typed; both sides now produce text[] regardless of column
  -- storage shape.
  IF v_specialties_expr <> '' THEN
    v_sources := array_append(v_sources, v_specialties_expr);
  END IF;
  IF v_skills_expr <> '' THEN
    v_sources := array_append(v_sources, v_skills_expr);
  END IF;

  IF cardinality(v_sources) = 0 THEN
    RAISE NOTICE '[specialty-taxonomy] No usable legacy specialties/skills sources on profiles — skipping backfill.';
    RETURN;
  END IF;

  v_unnest_arg := array_to_string(v_sources, ' || ');

  -- Build the final UPDATE statement. The CTE chain:
  --   legacy     → one row per (profile, legacy_token)
  --   matched    → legacy joined to the catalog by name / synonym / substring
  --   aggregated → distinct slugs per profile, aggregated
  v_dynamic_sql := format($sql$
    WITH legacy AS (
      SELECT p.id AS profile_id, lower(trim(t)) AS token
      FROM public.profiles p,
           LATERAL unnest(%s) AS t
      WHERE t IS NOT NULL AND length(trim(t)) > 0
    ),
    matched AS (
      SELECT DISTINCT l.profile_id, c.slug
      FROM legacy l
      JOIN _nexpec_specialty_catalog c ON (
        lower(c.name) = l.token
        OR l.token = ANY (
          SELECT lower(syn) FROM unnest(c.synonyms) AS syn
        )
        OR lower(c.name) LIKE '%%' || l.token || '%%'
      )
    ),
    aggregated AS (
      SELECT profile_id, array_agg(DISTINCT slug ORDER BY slug) AS slugs
      FROM matched
      GROUP BY profile_id
    )
    UPDATE public.profiles p
       SET specialty_slugs = aggregated.slugs
      FROM aggregated
     WHERE p.id = aggregated.profile_id
       AND (p.specialty_slugs IS NULL OR cardinality(p.specialty_slugs) = 0)
  $sql$, v_unnest_arg);

  -- Execute the DML statement and capture the affected row count via
  -- GET DIAGNOSTICS — the canonical PL/pgSQL pattern. We deliberately
  -- avoid wrapping the dynamic SQL in another WITH (PostgreSQL doesn't
  -- allow nested top-level WITH clauses); `GET DIAGNOSTICS` reads the
  -- count of rows mutated by the last EXECUTE'd statement directly.
  EXECUTE v_dynamic_sql;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RAISE NOTICE '[specialty-taxonomy] Backfilled specialty_slugs for % profiles.', v_updated_count;
END $$;


-- ─── 5. Backfill jobs.specialty_slugs from jobs.required_certifications ────
--
--  Best-effort. required_certifications is a free-form cert-name array
--  written by the legacy post-job flow. Mapping cert → specialty is
--  approximate (a certificate often implies a discipline, e.g.
--  "API 510" → api_510_pressure_vessels). We use the same name +
--  synonym + substring algorithm; the screens will start writing
--  specialty_slugs directly going forward.
--
--  Same defensive type probe as section 4: if required_certifications
--  is text (not text[]) we split on comma; if absent or an unexpected
--  type we skip.

DO $$
DECLARE
  v_req_certs_udt text;
  v_unnest_arg    text := '';
  v_updated_count int := 0;
  v_dynamic_sql   text;
BEGIN
  SELECT udt_name INTO v_req_certs_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'jobs'
    AND column_name = 'required_certifications';

  IF v_req_certs_udt = '_text' THEN
    v_unnest_arg := 'COALESCE(j.required_certifications, ''{}''::text[])';
  ELSIF v_req_certs_udt = 'text' THEN
    v_unnest_arg := 'string_to_array(COALESCE(j.required_certifications, ''''), '','')';
  ELSIF v_req_certs_udt IS NULL THEN
    RAISE NOTICE '[specialty-taxonomy] No jobs.required_certifications column — skipping job backfill.';
    RETURN;
  ELSE
    RAISE NOTICE '[specialty-taxonomy] jobs.required_certifications has unexpected type %; skipping job backfill.', v_req_certs_udt;
    RETURN;
  END IF;

  v_dynamic_sql := format($sql$
    WITH legacy AS (
      SELECT j.id AS job_id, lower(trim(t)) AS token
      FROM public.jobs j,
           LATERAL unnest(%s) AS t
      WHERE t IS NOT NULL AND length(trim(t)) > 0
    ),
    matched AS (
      SELECT DISTINCT l.job_id, c.slug
      FROM legacy l
      JOIN _nexpec_specialty_catalog c ON (
        lower(c.name) = l.token
        OR l.token = ANY (
          SELECT lower(syn) FROM unnest(c.synonyms) AS syn
        )
        OR lower(c.name) LIKE '%%' || l.token || '%%'
      )
    ),
    aggregated AS (
      SELECT job_id, array_agg(DISTINCT slug ORDER BY slug) AS slugs
      FROM matched
      GROUP BY job_id
    )
    UPDATE public.jobs j
       SET specialty_slugs = aggregated.slugs
      FROM aggregated
     WHERE j.id = aggregated.job_id
       AND (j.specialty_slugs IS NULL OR cardinality(j.specialty_slugs) = 0)
  $sql$, v_unnest_arg);

  EXECUTE v_dynamic_sql;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RAISE NOTICE '[specialty-taxonomy] Backfilled specialty_slugs for % jobs.', v_updated_count;
END $$;


-- _nexpec_specialty_catalog was declared ON COMMIT DROP, so it goes
-- away cleanly when this transaction ends. No DROP TABLE required.

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. Columns + defaults landed
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public'
--   AND table_name IN ('jobs','profiles')
--   AND column_name='specialty_slugs';
-- Expected: two rows, both ARRAY of text, default '{}'::text[], is_nullable=NO

-- B. Indexes
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname='public'
--   AND indexname IN ('jobs_specialty_slugs_gin','profiles_specialty_slugs_gin');
-- Expected: two rows

-- C. Backfill spot check — pick an inspector who has legacy specialties:
-- SELECT id, specialties, skills, specialty_slugs
-- FROM public.profiles
-- WHERE cardinality(specialty_slugs) > 0
-- LIMIT 5;

-- D. Insert / contains query
-- BEGIN;
--   UPDATE public.jobs
--      SET specialty_slugs = ARRAY['ndt_ultrasonic','api_510_pressure_vessels']
--    WHERE id = '<job-uuid>';
--   SELECT id, specialty_slugs
--   FROM public.jobs
--   WHERE specialty_slugs && ARRAY['ndt_ultrasonic'];
-- ROLLBACK;
-- Expected: the row above is returned by the && query.


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback — Supabase CLI does not auto-execute down sections)
-- ────────────────────────────────────────────────────────────────────────────
--  Copy/paste the block below into the SQL editor if a rollback is needed.
--
--  BEGIN;
--    DROP INDEX IF EXISTS public.profiles_specialty_slugs_gin;
--    DROP INDEX IF EXISTS public.jobs_specialty_slugs_gin;
--    ALTER TABLE public.profiles DROP COLUMN IF EXISTS specialty_slugs;
--    ALTER TABLE public.jobs     DROP COLUMN IF EXISTS specialty_slugs;
--  COMMIT;
