-- ════════════════════════════════════════════════════════════════════════════
--  20260624120000_civil_construction_default_groups_and_scope_catalogue.sql
--
--  PHASE 2 — Civil & Construction domain content fleshing.
--
--  WHAT THIS DOES
--  ──────────────
--  1. Expands inspection_domains.default_specialty_groups for
--     civil_construction from 1 → 5 groups. Pre-Phase-2, the seed only
--     referenced 'Civil & structural'; adds the four groups that civil
--     work demonstrably touches:
--
--       • Welding & joining          (structural steel, AWS D1.1 / D1.5)
--       • Coatings & corrosion       (rebar, structural steel, bridge decks)
--       • Quality, safety & systems  (ISO audits, rope access, confined space)
--       • Special domains            (cement plants, water/wastewater, pulp & paper)
--
--  2. Seeds 10 canonical scope templates in inspection_scope_templates
--     covering the most common civil/construction job types:
--
--       1. concrete_compressive_strength_acceptance — ACI 318 / ASTM C39
--       2. concrete_pre_pour_inspection             — rebar + formwork sign-off
--       3. structural_steel_visual_weld_aisc        — AISC 360 / AWS D1.1
--       4. structural_steel_high_strength_bolting   — RCSC slip-critical
--       5. bridge_routine_inspection_nbis           — FHWA NBIS 24-month
--       6. earthworks_compaction_modified_proctor   — ASTM D1557
--       7. asphalt_paving_qc                        — Superpave / AASHTO M323
--       8. post_tensioning_grouting_inspection      — PTI M55
--       9. shotcrete_application_aci_506            — ACI 506 nozzleman
--      10. structural_steel_coating_dft_audit       — SSPC PA 2
--
--  3. Seeds inspection_evidence_requirements for each scope template —
--     58 child rows defining the photos, GPS pins, documents, and
--     signed statements inspectors collect on site.
--
--  IDEMPOTENCY
--  ───────────
--    • default_specialty_groups update is full-array replacement (re-runs
--      land the identical array).
--    • Scope templates use INSERT … ON CONFLICT (slug) DO UPDATE so
--      content refreshes but row identity (and any FK references from
--      existing jobs) is preserved.
--    • Evidence requirements DELETE the existing set for these 10
--      templates and re-INSERT. The migration is the source of truth.
--
--  WHAT THIS DOES NOT DO
--  ─────────────────────
--    • Does NOT touch industrial_ndt, electrical, mechanical_field, or
--      chemical_process rows. Each gets its own per-domain commit.
--    • Does NOT flip civil_construction.is_launched. That stays false
--      until you toggle it from /admin/domains.
--    • Does NOT modify any schema, ENUM, RLS policy, or RPC.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Expand default_specialty_groups (1 → 5)
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.inspection_domains
   SET default_specialty_groups = ARRAY[
         'Civil & structural',
         'Welding & joining',
         'Coatings & corrosion',
         'Quality, safety & systems',
         'Special domains'
       ]::text[],
       updated_at = now()
 WHERE slug = 'civil_construction';

-- ─────────────────────────────────────────────────────────────────────
-- 2) Scope template catalogue (10 rows)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.inspection_scope_templates (
  slug, name, category, region, validity_months, base_price_cents,
  requires_credential_tier, description_md, domain, is_active
) VALUES
  (
    'concrete_compressive_strength_acceptance',
    'Concrete Compressive Strength Acceptance (ACI 318 / ASTM C39)',
    'Concrete acceptance testing',
    'global', 12, 40000, 'cci_basic',
    'Witness and document concrete cylinder/cube compressive-strength testing per ASTM C39 against the mix-design acceptance criteria in ACI 318 §26.12. Includes sample identification, break-machine operation, fresh-concrete properties at sampling (slump, air, temperature), and break-result acceptance.',
    'civil_construction', true
  ),
  (
    'concrete_pre_pour_inspection',
    'Concrete Pre-Pour Inspection (Rebar + Formwork)',
    'Pre-pour inspection',
    'global', 12, 120000, 'cci_advanced',
    'Pre-pour inspection of reinforcement, embedded items, and formwork per ACI 318 §26.6 and §26.11. Confirms rebar size, spacing, lap length, clear cover, and tie pattern against the structural drawing; checks formwork bracing, line/grade, and embed/anchor placement before the pour is released.',
    'civil_construction', true
  ),
  (
    'structural_steel_visual_weld_aisc',
    'Structural Steel Visual Weld Inspection (AISC 360 / AWS D1.1)',
    'Structural steel welding inspection',
    'global', 12, 180000, 'cci_advanced',
    'Visual weld inspection of structural-steel assemblies per AISC 360 Chapter N and AWS D1.1. Covers WPS / PQR verification, pre-, in-process, and post-weld visual acceptance, and connection sign-off. Inspector must hold a current AWS CWI or equivalent.',
    'civil_construction', true
  ),
  (
    'structural_steel_high_strength_bolting',
    'High-Strength Bolting Inspection (RCSC / AISC 348)',
    'Bolting inspection',
    'global', 12, 60000, 'cci_basic',
    'Inspection of slip-critical and pretensioned high-strength bolted connections per the RCSC Specification (referenced by AISC 348). Verifies bolt grade, lubrication, pre-installation verification, and the chosen installation method (turn-of-nut, calibrated wrench, twist-off, or direct-tension indicator).',
    'civil_construction', true
  ),
  (
    'bridge_routine_inspection_nbis',
    'Routine Bridge Inspection (FHWA NBIS / AASHTO MBE)',
    'Bridge inspection',
    'global', 24, 350000, 'cci_advanced',
    'Routine 24-month bridge inspection per the FHWA National Bridge Inspection Standards (NBIS, 23 CFR 650 Subpart C) and AASHTO Manual for Bridge Evaluation. Records element-level condition ratings, scour/foundation condition, deck/superstructure/substructure condition, and load-rating notes. Inspector must be a Team Leader meeting NBIS qualifications.',
    'civil_construction', true
  ),
  (
    'earthworks_compaction_modified_proctor',
    'Earthworks Compaction (Modified Proctor / ASTM D1557)',
    'Earthworks compaction',
    'global', 12, 50000, 'cci_basic',
    'Field density / compaction acceptance testing of structural fill and subgrade against a modified Proctor maximum dry density per ASTM D1557. Includes nuclear density gauge or sand-cone readings, moisture content, and lift-by-lift acceptance vs. project specification.',
    'civil_construction', true
  ),
  (
    'asphalt_paving_qc',
    'Asphalt Paving QC (Superpave / AASHTO M323)',
    'Asphalt QC',
    'global', 12, 70000, 'cci_basic',
    'Quality-control monitoring of hot-mix asphalt placement per the Superpave methodology (AASHTO M323 / M332). Covers mix temperature at delivery, mat density via cores or nuclear gauge, joint construction, and adherence to the approved JMF (job-mix formula).',
    'civil_construction', true
  ),
  (
    'post_tensioning_grouting_inspection',
    'Post-Tensioning & Grouting Inspection (PTI M55)',
    'Post-tensioning',
    'global', 12, 220000, 'cci_advanced',
    'Inspection of post-tensioned concrete tendon stressing and duct grouting per PTI M55 / FHWA HIF-13-026. Includes duct alignment verification, jacking force / elongation log, grout-mix proportions, and grout-fill verification (vacuum or strand-integrity test). Inspector must hold PTI Level 2 Field Specialist certification.',
    'civil_construction', true
  ),
  (
    'shotcrete_application_aci_506',
    'Shotcrete Application Inspection (ACI 506)',
    'Shotcrete inspection',
    'global', 12, 140000, 'cci_advanced',
    'Inspection of dry-mix or wet-mix shotcrete application per ACI 506R-16 and ACI 506.2. Verifies pre-construction nozzleman qualification (ACI CP-60 / ASA), surface preparation, nozzle distance and angle, layer thickness, rebound disposal, and curing. Required on tunnel, retaining-wall, and slope-stabilisation work.',
    'civil_construction', true
  ),
  (
    'structural_steel_coating_dft_audit',
    'Structural Steel Coating DFT Audit (SSPC PA 2)',
    'Structural coating audit',
    'global', 12, 90000, 'cci_basic',
    'Dry-film thickness (DFT) and adhesion audit of protective coatings on structural steel per SSPC PA 2. Includes statistical DFT sampling per SSPC frequency tables, pull-off adhesion testing (ASTM D4541), environmental-conditions logging, and acceptance against the project paint specification.',
    'civil_construction', true
  )
ON CONFLICT (slug) DO UPDATE SET
  name                     = EXCLUDED.name,
  category                 = EXCLUDED.category,
  region                   = EXCLUDED.region,
  validity_months          = EXCLUDED.validity_months,
  base_price_cents         = EXCLUDED.base_price_cents,
  requires_credential_tier = EXCLUDED.requires_credential_tier,
  description_md           = EXCLUDED.description_md,
  domain                   = EXCLUDED.domain,
  is_active                = EXCLUDED.is_active,
  updated_at               = now();

-- ─────────────────────────────────────────────────────────────────────
-- 3) Evidence requirements (58 rows across the 10 templates)
-- ─────────────────────────────────────────────────────────────────────

DELETE FROM public.inspection_evidence_requirements
 WHERE template_id IN (
   SELECT id FROM public.inspection_scope_templates
    WHERE slug IN (
      'concrete_compressive_strength_acceptance',
      'concrete_pre_pour_inspection',
      'structural_steel_visual_weld_aisc',
      'structural_steel_high_strength_bolting',
      'bridge_routine_inspection_nbis',
      'earthworks_compaction_modified_proctor',
      'asphalt_paving_qc',
      'post_tensioning_grouting_inspection',
      'shotcrete_application_aci_506',
      'structural_steel_coating_dft_audit'
    )
 );

INSERT INTO public.inspection_evidence_requirements (
  template_id, sort_order, kind, label, hint, required, min_count, max_count
)
SELECT t.id, e.sort_order, e.kind::public.compliance_evidence_kind,
       e.label, e.hint, e.required, e.min_count, e.max_count
  FROM (VALUES

    -- ── concrete_compressive_strength_acceptance (6 rows) ──
    ('concrete_compressive_strength_acceptance',  0, 'photo',            'Cylinder / cube identification',
       'Each specimen labelled with pour ID, date, and location.',                  true, 3, 12),
    ('concrete_compressive_strength_acceptance', 10, 'photo',            'Break-machine setup',
       'Specimen centred, end caps in place, machine zeroed.',                      true, 1, 6),
    ('concrete_compressive_strength_acceptance', 20, 'document_upload',  'Break results log',
       'Per-specimen failure load, calculated strength, age.',                      true, 1, 2),
    ('concrete_compressive_strength_acceptance', 30, 'document_upload',  'Fresh-concrete properties',
       'Slump, air content, temperature recorded at sampling.',                     true, 1, 2),
    ('concrete_compressive_strength_acceptance', 40, 'text_input',        'Mix-design reference',
       'Approved mix-design number and required strength (f''c).',                  true, 1, 1),
    ('concrete_compressive_strength_acceptance', 50, 'signed_statement', 'Technician sign-off',
       'ACI Concrete Field-Testing Technician Grade I number, accept/reject.',      true, 1, 1),

    -- ── concrete_pre_pour_inspection (6 rows) ──
    ('concrete_pre_pour_inspection',  0, 'document_upload',  'Structural drawing reference',
       'Approved drawing sheet for the element being poured.',                      true, 1, 4),
    ('concrete_pre_pour_inspection', 10, 'photo',            'Rebar layout photos',
       'Plan view of bar size, spacing, and lap locations.',                        true, 4, 24),
    ('concrete_pre_pour_inspection', 20, 'photo',            'Clear-cover verification',
       'Cover blocks / chairs in place with measurement reference.',                true, 2, 16),
    ('concrete_pre_pour_inspection', 30, 'photo',            'Embeds and anchor placement',
       'Anchor bolts, plates, sleeves correctly located and braced.',               true, 1, 16),
    ('concrete_pre_pour_inspection', 40, 'photo',            'Formwork bracing and tie-down',
       'Wall ties, kickers, shore stability evidence.',                             true, 2, 16),
    ('concrete_pre_pour_inspection', 50, 'signed_statement', 'Inspector pre-pour sign-off',
       'Release-to-pour statement with inspector name and date.',                   true, 1, 1),

    -- ── structural_steel_visual_weld_aisc (6 rows) ──
    ('structural_steel_visual_weld_aisc',  0, 'document_upload',  'WPS / PQR reference',
       'Welding procedure spec for each joint type inspected.',                     true, 1, 8),
    ('structural_steel_visual_weld_aisc', 10, 'photo',            'Fit-up and joint preparation',
       'Root opening, bevel angle, alignment.',                                     true, 2, 16),
    ('structural_steel_visual_weld_aisc', 20, 'photo',            'Completed weld photos',
       'Close-up of cap, root (where accessible), and termination.',                true, 4, 32),
    ('structural_steel_visual_weld_aisc', 30, 'document_upload',  'Weld map / connection log',
       'Per-weld disposition keyed to the connection drawing.',                     true, 1, 4),
    ('structural_steel_visual_weld_aisc', 40, 'text_input',        'Acceptance code reference',
       'AWS D1.1 Table 8.1 (statically loaded) or 8.2 (cyclically loaded).',        true, 1, 1),
    ('structural_steel_visual_weld_aisc', 50, 'signed_statement', 'CWI sign-off',
       'AWS CWI number, expiration, accept/reject summary.',                        true, 1, 1),

    -- ── structural_steel_high_strength_bolting (5 rows) ──
    ('structural_steel_high_strength_bolting',  0, 'document_upload',  'Bolt batch certifications',
       'Mill test reports for the fasteners installed.',                            true, 1, 6),
    ('structural_steel_high_strength_bolting', 10, 'document_upload',  'Pre-installation verification',
       'Skidmore record or torque-tension calibration as applicable.',              true, 1, 2),
    ('structural_steel_high_strength_bolting', 20, 'photo',            'Installation method evidence',
       'Match-marks (turn-of-nut), wrench setup, DTI compression.',                 true, 4, 24),
    ('structural_steel_high_strength_bolting', 30, 'document_upload',  'Installation log',
       'Per-connection record of method, torque/turn, inspector verification.',     true, 1, 4),
    ('structural_steel_high_strength_bolting', 40, 'signed_statement', 'Inspector sign-off',
       'Inspector statement of compliance with the RCSC Specification.',            true, 1, 1),

    -- ── bridge_routine_inspection_nbis (7 rows) ──
    ('bridge_routine_inspection_nbis',  0, 'gps_pin',          'GPS pin at bridge centerline',
       'One pin at the structure''s mid-span on the centerline.',                   true, 1, 1),
    ('bridge_routine_inspection_nbis', 10, 'photo',            'Bridge identification photos',
       'Span overview, bridge plate (if present), approach and underside.',         true, 6, 24),
    ('bridge_routine_inspection_nbis', 20, 'photo',            'Element-level condition photos',
       'Deck, superstructure, substructure, bearings — keyed to element list.',     true, 20, 200),
    ('bridge_routine_inspection_nbis', 30, 'document_upload',  'Element condition rating sheet',
       'AASHTO MBE element-level conditions states (CS1-CS4) per element.',         true, 1, 1),
    ('bridge_routine_inspection_nbis', 40, 'photo',            'Hammer-sound / chain-drag findings',
       'Photographs of any delaminated, spalled, or unsound areas.',                false, 0, 32),
    ('bridge_routine_inspection_nbis', 50, 'photo',            'Scour and foundation condition',
       'Channel bed, pier scour, abutment condition.',                              true, 4, 20),
    ('bridge_routine_inspection_nbis', 60, 'signed_statement', 'NBIS Team Leader statement',
       'Team Leader name, NBIS qualification reference, inspection date.',          true, 1, 1),

    -- ── earthworks_compaction_modified_proctor (5 rows) ──
    ('earthworks_compaction_modified_proctor',  0, 'document_upload',  'Modified Proctor curve',
       'Laboratory ASTM D1557 curve with max dry density and OMC.',                 true, 1, 4),
    ('earthworks_compaction_modified_proctor', 10, 'document_upload',  'Field density readings log',
       'Nuclear density gauge or sand-cone results per location and lift.',         true, 1, 4),
    ('earthworks_compaction_modified_proctor', 20, 'photo',            'Test location photos',
       'Photo of each test point with station/offset reference visible.',           true, 4, 30),
    ('earthworks_compaction_modified_proctor', 30, 'text_input',        'Acceptance criterion',
       'Project-specified percent of max dry density (e.g. ≥95%).',                 true, 1, 1),
    ('earthworks_compaction_modified_proctor', 40, 'signed_statement', 'Technician sign-off',
       'Technician certification number, accept/reject per location.',              true, 1, 1),

    -- ── asphalt_paving_qc (6 rows) ──
    ('asphalt_paving_qc',  0, 'document_upload',  'Job-Mix Formula',
       'Approved JMF for the placed mix.',                                          true, 1, 1),
    ('asphalt_paving_qc', 10, 'document_upload',  'Mix delivery temperature log',
       'Truck-by-truck delivered temperature vs. acceptance range.',                true, 1, 2),
    ('asphalt_paving_qc', 20, 'document_upload',  'Core density results',
       'Lab core results or nuclear-gauge readings per lot.',                       true, 1, 4),
    ('asphalt_paving_qc', 30, 'photo',            'Paving operation photos',
       'Paver, breakdown roller, finish roller in operation.',                      true, 4, 20),
    ('asphalt_paving_qc', 40, 'photo',            'Joint construction photos',
       'Longitudinal and transverse joint condition.',                              true, 2, 16),
    ('asphalt_paving_qc', 50, 'signed_statement', 'QC technician sign-off',
       'Technician name, certification, acceptance per lot.',                       true, 1, 1),

    -- ── post_tensioning_grouting_inspection (6 rows) ──
    ('post_tensioning_grouting_inspection',  0, 'document_upload',  'Approved tendon shop drawings',
       'PT-supplier shop drawings showing tendon profile, anchorage details.',      true, 1, 4),
    ('post_tensioning_grouting_inspection', 10, 'document_upload',  'Jacking force / elongation log',
       'Per-tendon stressing record with computed vs. measured elongation.',        true, 1, 2),
    ('post_tensioning_grouting_inspection', 20, 'photo',            'Anchorage and wedge bite photos',
       'Wedge engagement, anchor-head condition post-stressing.',                   true, 4, 24),
    ('post_tensioning_grouting_inspection', 30, 'document_upload',  'Grout mix proportions',
       'Project-specified grout mix and admixtures.',                               true, 1, 2),
    ('post_tensioning_grouting_inspection', 40, 'document_upload',  'Grout-fill verification',
       'Vacuum test record or strand-integrity report per duct.',                   true, 1, 2),
    ('post_tensioning_grouting_inspection', 50, 'signed_statement', 'PTI Field Specialist sign-off',
       'PTI Level 2 certification number, accept/reject summary.',                  true, 1, 1),

    -- ── shotcrete_application_aci_506 (6 rows) ──
    ('shotcrete_application_aci_506',  0, 'document_upload',  'Nozzleman qualification',
       'ACI CP-60 or ASA nozzleman certification for each operator.',               true, 1, 4),
    ('shotcrete_application_aci_506', 10, 'document_upload',  'Pre-construction test panel results',
       'Cores from the qualification panel showing compressive strength.',          true, 1, 2),
    ('shotcrete_application_aci_506', 20, 'photo',            'Nozzle distance and angle',
       'Photos demonstrating compliant standoff and angle of attack.',              true, 4, 20),
    ('shotcrete_application_aci_506', 30, 'document_upload',  'Thickness gauge readings',
       'Per-panel as-placed thickness vs. design.',                                 true, 1, 4),
    ('shotcrete_application_aci_506', 40, 'photo',            'Rebound disposal',
       'Evidence that rebound material is removed and not re-incorporated.',        true, 1, 8),
    ('shotcrete_application_aci_506', 50, 'signed_statement', 'Inspector sign-off',
       'ACI shotcrete inspector certification number, accept/reject.',              true, 1, 1),

    -- ── structural_steel_coating_dft_audit (5 rows) ──
    ('structural_steel_coating_dft_audit',  0, 'document_upload',  'Paint specification',
       'Project paint specification with required system and DFT range.',           true, 1, 1),
    ('structural_steel_coating_dft_audit', 10, 'document_upload',  'DFT readings log',
       'Statistical readings per SSPC PA 2 frequency tables.',                      true, 1, 4),
    ('structural_steel_coating_dft_audit', 20, 'photo',            'Pull-off adhesion test',
       'Dolly, test result, and surface after dolly removal.',                      true, 2, 12),
    ('structural_steel_coating_dft_audit', 30, 'document_upload',  'Environmental conditions log',
       'Temperature, dewpoint, RH at inspection windows.',                          false, 0, 4),
    ('structural_steel_coating_dft_audit', 40, 'signed_statement', 'Coatings inspector sign-off',
       'NACE / AMPP CIP or equivalent certification, accept/reject.',               true, 1, 1)

  ) AS e(template_slug, sort_order, kind, label, hint, required, min_count, max_count)
  JOIN public.inspection_scope_templates t ON t.slug = e.template_slug;

-- ─────────────────────────────────────────────────────────────────────
-- Verification — surface counts so they appear in the migration log.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tmpl_count integer;
  req_count integer;
  group_count integer;
BEGIN
  SELECT count(*) INTO tmpl_count
    FROM public.inspection_scope_templates
   WHERE domain = 'civil_construction' AND is_active = true;

  SELECT count(*) INTO req_count
    FROM public.inspection_evidence_requirements r
    JOIN public.inspection_scope_templates t ON t.id = r.template_id
   WHERE t.domain = 'civil_construction';

  SELECT array_length(default_specialty_groups, 1) INTO group_count
    FROM public.inspection_domains WHERE slug = 'civil_construction';

  RAISE NOTICE 'Phase 2 (civil_construction) post-state:';
  RAISE NOTICE '  default_specialty_groups: % (expect 5)', group_count;
  RAISE NOTICE '  scope templates:          % (expect >= 10)', tmpl_count;
  RAISE NOTICE '  evidence requirements:    % (expect >= 58)', req_count;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Confirm default_specialty_groups has 5 entries:
--      SELECT slug, default_specialty_groups
--        FROM public.inspection_domains
--       WHERE slug = 'civil_construction';
--
-- 2) Confirm 10 scope templates:
--      SELECT slug, name, base_price_cents, requires_credential_tier
--        FROM public.inspection_scope_templates
--       WHERE domain = 'civil_construction'
--       ORDER BY slug;
--
-- 3) Evidence row count by template:
--      SELECT t.slug, count(r.*) AS req_count
--        FROM public.inspection_scope_templates t
--   LEFT JOIN public.inspection_evidence_requirements r ON r.template_id = t.id
--       WHERE t.domain = 'civil_construction'
--    GROUP BY t.slug ORDER BY t.slug;
-- ─────────────────────────────────────────────────────────────────────
