-- ════════════════════════════════════════════════════════════════════════════
--  20260620120000_chemical_process_domain_repair.sql
--
--  SELF-HEALING REPAIR for the Chemical & Process Engineering domain row.
--
--  WHY THIS EXISTS
--  ───────────────
--  Layer 5 originally shipped as two migration files:
--    20260618120000_chemical_process_domain_enum.sql   (ADD VALUE)
--    20260619120000_chemical_process_domain_config.sql (INSERT row)
--
--  The split was deliberate: Postgres permits `ALTER TYPE ... ADD VALUE`
--  inside a transaction at the DDL level, but it forbids referencing the
--  new value in the SAME transaction. Putting them in separate files
--  gives each its own implicit transaction.
--
--  In production, the `chemical_process` ENUM value exists (so Part 1
--  applied), but the corresponding row is absent from
--  public.inspection_domains (the /admin/domains page renders 4 cards,
--  not 5). The most likely cause is that the migration runner wrapped
--  both files in a single transaction — Postgres then accepted Part 1
--  and rejected Part 2 with "unsafe use of new value", possibly silently.
--
--  This migration repairs that state. By the time it runs, the ENUM
--  value 'chemical_process' has been committed for at least a full
--  migration cycle — well outside any current transaction — so the
--  INSERT below is unambiguously safe.
--
--  GUARANTEES
--  ──────────
--    • Idempotent. ON CONFLICT (slug) DO UPDATE makes it safe to run
--      against a DB that already has the row (rare-but-possible drift
--      between environments).
--    • Does NOT touch is_launched or is_active — preserves whatever the
--      admin has already toggled if the row somehow already exists.
--    • Identical column values to the original Part 2 migration. No new
--      schema, no new policy, no new index.
--    • No-op on every other domain row.
--
--  HOW TO VERIFY (after applying)
--  ──────────────────────────────
--    SELECT slug, display_name, is_launched, is_active, display_order
--      FROM public.inspection_domains
--     ORDER BY display_order;
--    -- Expect 5 rows, with chemical_process at display_order=40.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Defensive: make sure the ENUM value is present. ADD VALUE IF NOT EXISTS
-- is a no-op when it already is. Note this DDL inside a TX is legal —
-- what would be illegal is REFERENCING the new value in the same TX,
-- but in production the value was added cycles ago so this is purely
-- a belt-and-braces against environments where Part 1 silently failed.
ALTER TYPE public.inspection_domain ADD VALUE IF NOT EXISTS 'chemical_process';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- Separate transaction so the row INSERT cannot collide with the
-- ALTER TYPE above on any migration runner that batches files together.
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

INSERT INTO public.inspection_domains (
  slug,
  display_name,
  persona_label,
  short_pitch,
  icon_key,
  tint_hex,
  landing_url_slug,
  regulatory_bodies,
  default_specialty_groups,
  is_launched,
  is_active,
  display_order
)
VALUES (
  'chemical_process',
  'Chemical & Process',
  'HSE / Process Safety Manager',
  'Process Safety Management, hazardous-material handling, batch chemistry validation, and environmental-release inspection across refining, petrochemical, and specialty-chemical sites.',
  'flask',
  '#7C3AED',
  'chemical',
  ARRAY['API', 'ASME', 'OSHA-PSM', 'EPA-RMP', 'AIChE', 'CCPS', 'NFPA']::text[],
  ARRAY[]::text[],
  false,  -- is_launched: stays gated until admin flips it from /admin/domains
  true,   -- is_active:  visible to admins
  40
)
ON CONFLICT (slug) DO UPDATE SET
  -- Refresh presentation data only. Critically, is_launched and is_active
  -- are NOT touched — if the row already exists and an admin has flipped
  -- is_launched=true, this migration must not regress that state.
  display_name             = EXCLUDED.display_name,
  persona_label            = EXCLUDED.persona_label,
  short_pitch              = EXCLUDED.short_pitch,
  icon_key                 = EXCLUDED.icon_key,
  tint_hex                 = EXCLUDED.tint_hex,
  landing_url_slug         = EXCLUDED.landing_url_slug,
  regulatory_bodies        = EXCLUDED.regulatory_bodies,
  default_specialty_groups = EXCLUDED.default_specialty_groups,
  updated_at               = now();

COMMIT;
