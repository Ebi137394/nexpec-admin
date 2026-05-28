-- ════════════════════════════════════════════════════════════════════════════
--  20260619120000_chemical_process_domain_config.sql
--
--  DOMAIN #5 — Chemical & Process Engineering — PART 2 of 2.
--
--  Adds the configuration row for `chemical_process` to
--  public.inspection_domains. Depends on the ENUM value committed by
--  the previous migration (20260618120000_chemical_process_domain_enum.sql).
--
--  LAUNCH POSTURE
--  ──────────────
--    is_launched = false   → invisible to consumer surfaces by default.
--                            Inspector / client job-detail pages already
--                            gate the InspectionDomainBadge on
--                            inspection_domains.is_launched, so this
--                            row's debut is silent until you flip it on
--                            from /admin/domains.
--    is_active   = true    → visible to admins and ready to be launched.
--    display_order = 40    → renders after mechanical_field (30) on the
--                            /admin/domains management page.
--
--  REGULATORY BODIES
--  ─────────────────
--  Chemical & Process work in the US sits under a wider regulatory net
--  than O&G NDT. Captured here so the admin page can render meaningful
--  context. None of these bodies have schema-enforced semantics yet —
--  they're presentation data.
--
--  Idempotent — ON CONFLICT (slug) DO UPDATE makes re-running this
--  migration safe and refreshes the human-readable copy.
-- ════════════════════════════════════════════════════════════════════════════

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
  -- Default specialty groups intentionally empty for v1. The current
  -- client-side specialty taxonomy (specialtyTaxonomy.ts / specialties.ts)
  -- does not yet carve a dedicated "Chemical & process" group; we'll add
  -- one in a follow-up once we ship the chemical scope catalogue.
  ARRAY[]::text[],
  false,  -- is_launched: gated until you flip it on from /admin/domains
  true,   -- is_active: visible to admins
  40
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

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying both migrations)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Confirm the ENUM has the new value:
--      SELECT enum_range(NULL::public.inspection_domain);
--      -- Expect: {industrial_ndt,civil_construction,electrical,mechanical_field,chemical_process}
--
-- 2) Confirm the config row exists:
--      SELECT slug, display_name, is_launched, is_active, display_order
--        FROM public.inspection_domains
--       ORDER BY display_order;
--      -- Expect a 5th row at display_order=40, is_launched=false, is_active=true
--
-- 3) Confirm /admin/domains renders the new card:
--      Open the admin domain management surface in the browser.
--      The Chemical & Process card should appear after Mechanical Field
--      with the FlaskConical icon and the regulatory-body chips populated.
--
-- 4) Confirm consumer surfaces remain unchanged:
--      Open an inspector or client job-detail page.
--      No new badge should appear — every existing job is still in
--      industrial_ndt, and chemical_process is is_launched=false anyway.
-- ─────────────────────────────────────────────────────────────────────
