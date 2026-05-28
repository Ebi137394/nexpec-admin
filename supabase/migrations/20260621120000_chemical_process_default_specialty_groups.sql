-- ════════════════════════════════════════════════════════════════════════════
--  20260621120000_chemical_process_default_specialty_groups.sql
--
--  LAYER 5 FINISH — set the default_specialty_groups for chemical_process.
--
--  The original Layer 5 INSERT (20260619120000) intentionally seeded
--  default_specialty_groups as ARRAY[]::text[] because the client-side
--  specialty taxonomies (apps/web/src/lib/data/specialtyTaxonomy.ts and
--  src/data/specialties.ts) did not yet carve a dedicated "Chemical &
--  process" group. That group has now landed in both taxonomies in the
--  same commit as this migration — six foundational disciplines:
--
--    1. Process Safety Management (PSM)        — OSHA 1910.119
--    2. Mechanical Integrity (MI)              — OSHA 1910.119(j)
--    3. Process Hazard Analysis (PHA / HAZOP)
--    4. Pressure Relief Device Inspection      — API 576 / ASME PTC 25
--    5. Heat Exchanger Inspection              — eddy current, IRIS, hydro
--    6. LDAR (Leak Detection & Repair)         — EPA Method 21
--
--  This migration updates the row so that when a client posts a chemical
--  job from the /post-job surface (or any future inspector match flow),
--  the system can pre-select these specialty groups by default.
--
--  WHAT THIS DOES NOT DO
--  ─────────────────────
--    • Does NOT flip is_launched=true. Chemical_process stays admin-only
--      until you flip it manually from /admin/domains. Recommended next
--      pre-launch checks:
--         (a) at least one inspector has chemical_process specialties
--             selected in their profile;
--         (b) the chemical scope-template catalogue has at least a
--             handful of seed rows (separate sprint).
--    • Does NOT modify is_active, display_order, or any presentation
--      column. Pure data-attribute repair.
--
--  IDEMPOTENT — re-running just refreshes updated_at.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.inspection_domains
   SET default_specialty_groups = ARRAY['Chemical & process']::text[],
       updated_at                = now()
 WHERE slug = 'chemical_process';

-- Defensive verification — surfaces in the migration log if for some
-- reason the row is missing. NOTICE only, never raises an exception
-- so the migration is still safe to apply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inspection_domains WHERE slug = 'chemical_process'
  ) THEN
    RAISE NOTICE 'inspection_domains.chemical_process row missing — '
                 'apply 20260620120000_chemical_process_domain_repair.sql first.';
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
--   SELECT slug, display_name, default_specialty_groups
--     FROM public.inspection_domains
--    WHERE slug = 'chemical_process';
--   -- Expect default_specialty_groups = {Chemical & process}
-- ─────────────────────────────────────────────────────────────────────
