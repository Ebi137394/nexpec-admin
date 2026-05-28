-- ════════════════════════════════════════════════════════════════════════════
--  20260626120000_mechanical_field_default_groups_and_scope_catalogue.sql
--
--  PHASE 4 — Mechanical Field domain content fleshing.
--
--  Slightly broader than Phases 1-3 because mechanical field is genuinely
--  broader than the others — rotating equipment, lifting + rigging,
--  piping construction, and turnaround work all live here. Ships 12
--  scope templates (vs 10) with 7-8 evidence rows each (vs 5-7).
--
--  WHAT THIS DOES
--  ──────────────
--  1. Expands inspection_domains.default_specialty_groups for
--     mechanical_field from 4 → 7 groups. Pre-Phase-4 the seed had:
--       • Welding & joining
--       • Piping & pipelines
--       • Mechanical & rotating
--       • Lifting & rigging
--     Adds three groups that mechanical field demonstrably touches:
--       • NDT methods                (piping construction NDE: UT/RT/PT/MT)
--       • Coatings & corrosion       (protective coatings on field equipment)
--       • Quality, safety & systems  (PSSR, LO/TO, confined-space, rope access)
--
--  2. Seeds 12 canonical scope templates covering the most common
--     mechanical-field job types:
--
--       1. hydrostatic_pressure_test_piping_asme_b31_3 — Hydrotest ASME B31.3
--       2. piping_construction_visual_inspection       — Piping field inspection
--       3. rotating_equipment_laser_alignment           — Laser shaft alignment
--       4. api_686_machinery_installation_inspection   — Machinery install audit
--       5. vibration_baseline_acceptance_iso_20816      — Vibration baseline
--       6. crane_annual_structural_inspection_asme_b30 — Crane annual
--       7. heavy_lift_rigging_plan_witness             — Critical-lift witness
--       8. bolt_torque_pressure_boundary_asme_pcc1     — ASME PCC-1 bolted joints
--       9. pre_startup_safety_review_mechanical_package — Mechanical PSSR
--      10. hydroflushing_chemical_cleaning_acceptance  — Pipe/tank cleaning
--      11. gearbox_borescope_oil_sample_inspection     — Gearbox condition
--      12. field_machinery_baseplate_grouting          — API 686 Ch.4 grouting
--
--  3. Seeds 85 evidence requirement child rows defining the photos,
--     document uploads, GPS pins, video walkthroughs, signed statements,
--     and rep_interview events inspectors collect on site.
--
--  IDEMPOTENCY
--  ───────────
--    • default_specialty_groups update is full-array replacement.
--    • Scope templates use INSERT … ON CONFLICT (slug) DO UPDATE so
--      content refreshes but row identity is preserved.
--    • Evidence requirements DELETE the existing set for these 12
--      templates and re-INSERT from a single VALUES list.
--
--  WHAT THIS DOES NOT DO
--  ─────────────────────
--    • Does NOT touch industrial_ndt, civil_construction, electrical,
--      or chemical_process rows.
--    • Does NOT flip mechanical_field.is_launched.
--    • Does NOT modify any schema, ENUM, RLS policy, or RPC.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Expand default_specialty_groups (4 → 7)
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.inspection_domains
   SET default_specialty_groups = ARRAY[
         'Welding & joining',
         'Piping & pipelines',
         'Mechanical & rotating',
         'Lifting & rigging',
         'NDT methods',
         'Coatings & corrosion',
         'Quality, safety & systems'
       ]::text[],
       updated_at = now()
 WHERE slug = 'mechanical_field';

-- ─────────────────────────────────────────────────────────────────────
-- 2) Scope template catalogue (12 rows)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.inspection_scope_templates (
  slug, name, category, region, validity_months, base_price_cents,
  requires_credential_tier, description_md, domain, is_active
) VALUES
  (
    'hydrostatic_pressure_test_piping_asme_b31_3',
    'Hydrostatic Pressure Test — Process Piping (ASME B31.3)',
    'Pressure testing',
    'global', 12, 180000, 'cci_advanced',
    'Witness and document a hydrostatic leak/strength test of a process-piping system per ASME B31.3 §345. Confirms test medium and temperature, vent / drain / instrumentation isolation, pre-test calibration of the test gauge, a minimum 10-minute hold at 1.5 × design pressure, walk-down for leaks, and post-test depressurisation and drying. Accepted as the final pressure-integrity acceptance prior to system handover.',
    'mechanical_field', true
  ),
  (
    'piping_construction_visual_inspection',
    'Process Piping Construction Visual Inspection (ASME B31.3 / AWS QC1)',
    'Piping construction',
    'global', 12, 220000, 'cci_advanced',
    'Field visual inspection of new-construction process piping per ASME B31.3 §341. Covers material verification against the line list, fit-up and joint preparation, weld visual acceptance per AWS QC1, post-weld heat-treatment witnessing where applicable, and confirmation that called-out NDE method and coverage were performed and reported. Performed against marked-up isometrics with TML / weld map references.',
    'mechanical_field', true
  ),
  (
    'rotating_equipment_laser_alignment',
    'Rotating Equipment Laser Shaft Alignment',
    'Shaft alignment',
    'global', 12, 90000, 'cci_basic',
    'Cold and hot shaft alignment of pump / motor, motor / gearbox / driven, or turbine / driven trains using a laser alignment system. Records pre-alignment as-found offsets and angles, soft-foot results, achieved as-left tolerances against vendor / API 686 acceptance, and growth compensation where supplied. Suitable for installation, post-overhaul, and post-shutdown realignment scopes.',
    'mechanical_field', true
  ),
  (
    'api_686_machinery_installation_inspection',
    'Machinery Installation Inspection (API 686)',
    'Machinery installation',
    'global', 12, 320000, 'cci_advanced',
    'End-to-end installation audit of refinery / petrochemical rotating equipment per API 686 (Recommended Practice for Machinery Installation and Installation Design). Covers foundation acceptance, baseplate flatness and grout integrity, soft-foot, piping strain, anchor-bolt pre-load, coupling spacing, lube-oil flushing, and final cold-alignment acceptance. Output supports mechanical completion sign-off.',
    'mechanical_field', true
  ),
  (
    'vibration_baseline_acceptance_iso_20816',
    'Commissioning Vibration Baseline (ISO 20816 / ISO 10816)',
    'Vibration commissioning',
    'global', 12, 140000, 'cci_advanced',
    'Commissioning-time vibration baseline measurement on newly installed rotating machinery per ISO 20816 series (and legacy ISO 10816). Captures overall velocity / displacement / acceleration per axis per bearing per running condition, plots against acceptance zones, and archives the FFT spectra as the run-in reference for future condition monitoring trending.',
    'mechanical_field', true
  ),
  (
    'crane_annual_structural_inspection_asme_b30',
    'Crane Annual Structural + Functional Inspection (ASME B30 / OSHA 1910.179)',
    'Crane inspection',
    'global', 12, 200000, 'cci_advanced',
    'Annual periodic inspection of overhead, mobile, or articulating cranes per the applicable ASME B30 volume (B30.2 / B30.5 / B30.22 as relevant) and OSHA 1910.179 / 1926.1412. Covers structural members, welds, hooks (NDE per ASME B30.10), wire rope and rigging, brakes, limit switches, controls, and load test if required. Inspector must be a Qualified Person per the applicable B30 definition.',
    'mechanical_field', true
  ),
  (
    'heavy_lift_rigging_plan_witness',
    'Heavy / Critical Lift Rigging Plan Witness',
    'Critical lift witness',
    'global', 12, 150000, 'cci_advanced',
    'On-site witness of a critical / heavy lift against an engineered lift plan. Confirms the lift plan is current, the crane and rigging match the plan, the centre-of-gravity assumptions are supported, ground-bearing pressure is within crane-mat rating, and the dry-run / tag-line procedure was executed before the live lift. Sign-off feeds the project lift register.',
    'mechanical_field', true
  ),
  (
    'bolt_torque_pressure_boundary_asme_pcc1',
    'Bolted Joint Assembly Inspection (ASME PCC-1)',
    'Bolted joint assembly',
    'global', 12, 70000, 'cci_basic',
    'Inspection of bolted flanged-joint assembly on pressure-boundary joints per ASME PCC-1 (Guidelines for Pressure Boundary Bolted Flange Joint Assembly). Confirms flange-face condition, gasket material and orientation, bolt and nut compatibility, lubrication, assembly pattern (star/cross), and final target-torque or bolt-tensioning verification. Joint Integrity Technician qualification per PCC-1 Appendix A is preferred.',
    'mechanical_field', true
  ),
  (
    'pre_startup_safety_review_mechanical_package',
    'Pre-Startup Safety Review — Mechanical Package (OSHA PSM §1910.119(i))',
    'PSSR',
    'global', 12, 450000, 'cci_lead',
    'Lead-inspector facilitation of a Pre-Startup Safety Review on a new or significantly modified mechanical package per OSHA PSM 29 CFR 1910.119(i). Confirms construction is in accordance with design specs, safety / operating / maintenance procedures are in place, the Process Hazard Analysis recommendations are addressed, and training of affected personnel is complete. Output is the signed PSSR closure with action item list.',
    'mechanical_field', true
  ),
  (
    'hydroflushing_chemical_cleaning_acceptance',
    'Hydroflushing / Chemical Cleaning Acceptance',
    'Cleaning acceptance',
    'global', 12, 80000, 'cci_basic',
    'Acceptance inspection of new-construction pipe and equipment after hydroflushing, mechanical cleaning, or chemical degreasing. Verifies achieved cleanliness against project specification (typical: 100 μm strainer cleanliness, no rust / mill scale, dry condition), records cleaning medium and disposal evidence, and signs off the system as ready for hydrotest or chemical preservation.',
    'mechanical_field', true
  ),
  (
    'gearbox_borescope_oil_sample_inspection',
    'Gearbox Borescope + Oil Sample Inspection',
    'Gearbox condition',
    'global', 12, 160000, 'cci_advanced',
    'Combined condition assessment of an enclosed gearbox: external borescope of gear meshes and bearings, lube-oil sample for laboratory analysis (viscosity, water, ferrous/non-ferrous wear particles via ICP or PQ index, ISO 4406 cleanliness code), and review of vibration / temperature history. Output is a remaining-useful-life recommendation and a re-inspection interval.',
    'mechanical_field', true
  ),
  (
    'field_machinery_baseplate_grouting',
    'Field Machinery Baseplate Grouting + Soft-Foot Check (API 686 Ch.4)',
    'Baseplate grouting',
    'global', 12, 110000, 'cci_basic',
    'Field inspection of machinery baseplate epoxy or cementitious grouting per API 686 Chapter 4. Covers anchor-bolt isolation, baseplate cleanliness and surface prep, grout-mix proportions and ambient cure conditions, post-cure flatness, and final soft-foot check at each anchor location. Output supports mechanical completion of a new install or rebuild.',
    'mechanical_field', true
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
-- 3) Evidence requirements (85 rows across the 12 templates)
-- ─────────────────────────────────────────────────────────────────────

DELETE FROM public.inspection_evidence_requirements
 WHERE template_id IN (
   SELECT id FROM public.inspection_scope_templates
    WHERE slug IN (
      'hydrostatic_pressure_test_piping_asme_b31_3',
      'piping_construction_visual_inspection',
      'rotating_equipment_laser_alignment',
      'api_686_machinery_installation_inspection',
      'vibration_baseline_acceptance_iso_20816',
      'crane_annual_structural_inspection_asme_b30',
      'heavy_lift_rigging_plan_witness',
      'bolt_torque_pressure_boundary_asme_pcc1',
      'pre_startup_safety_review_mechanical_package',
      'hydroflushing_chemical_cleaning_acceptance',
      'gearbox_borescope_oil_sample_inspection',
      'field_machinery_baseplate_grouting'
    )
 );

INSERT INTO public.inspection_evidence_requirements (
  template_id, sort_order, kind, label, hint, required, min_count, max_count
)
SELECT t.id, e.sort_order, e.kind::public.compliance_evidence_kind,
       e.label, e.hint, e.required, e.min_count, e.max_count
  FROM (VALUES

    -- ── hydrostatic_pressure_test_piping_asme_b31_3 (7 rows) ──
    ('hydrostatic_pressure_test_piping_asme_b31_3',  0, 'document_upload',  'Test package / line list',
       'Approved test package showing systems, design pressure, test pressure, and isolation boundary.', true, 1, 4),
    ('hydrostatic_pressure_test_piping_asme_b31_3', 10, 'document_upload',  'Test-gauge calibration certificate',
       'Calibration in date, range ≤4× test pressure per B31.3 §345.4.3.',                            true, 1, 2),
    ('hydrostatic_pressure_test_piping_asme_b31_3', 20, 'photo',            'System isolation walkdown photos',
       'Vents, drains, instrumentation isolation, blinds installed.',                                  true, 4, 30),
    ('hydrostatic_pressure_test_piping_asme_b31_3', 30, 'document_upload',  'Pressure-time chart',
       'Recorded chart for the full hold period (minimum 10 min @ 1.5× design).',                     true, 1, 2),
    ('hydrostatic_pressure_test_piping_asme_b31_3', 40, 'photo',            'Leak walk-down photos',
       'Every weld, flange, and threaded joint photographed under test pressure.',                    true, 6, 60),
    ('hydrostatic_pressure_test_piping_asme_b31_3', 50, 'document_upload',  'Post-test dry-out / preservation record',
       'Means of depressurisation, water removal, and preservation pending start-up.',                 true, 1, 2),
    ('hydrostatic_pressure_test_piping_asme_b31_3', 60, 'signed_statement', 'Authorised inspector sign-off',
       'Test witnessed by name + credential; accept/reject decision recorded.',                        true, 1, 1),

    -- ── piping_construction_visual_inspection (7 rows) ──
    ('piping_construction_visual_inspection',  0, 'document_upload',  'Marked-up isometric drawings',
       'Walkdown markup against the released isometric showing welds visited.',                       true, 1, 8),
    ('piping_construction_visual_inspection', 10, 'document_upload',  'Material verification (PMI / MTR review)',
       'Spreadsheet of fittings + pipe heat numbers cross-referenced to MTRs.',                       true, 1, 4),
    ('piping_construction_visual_inspection', 20, 'photo',            'Fit-up and joint preparation photos',
       'Bevel angle, root gap, alignment on representative joints.',                                  true, 4, 40),
    ('piping_construction_visual_inspection', 30, 'photo',            'Completed weld visual photos',
       'Cap, root (where accessible), and starts/stops on representative welds.',                     true, 6, 80),
    ('piping_construction_visual_inspection', 40, 'document_upload',  'PWHT chart (where applicable)',
       'Time / temperature chart for any post-weld heat-treated joints.',                             false, 0, 8),
    ('piping_construction_visual_inspection', 50, 'document_upload',  'NDE coverage register',
       'Per-weld NDE method, coverage %, and report reference.',                                      true, 1, 2),
    ('piping_construction_visual_inspection', 60, 'signed_statement', 'Piping inspector sign-off',
       'Inspector statement of compliance with ASME B31.3 §341.',                                     true, 1, 1),

    -- ── rotating_equipment_laser_alignment (7 rows) ──
    ('rotating_equipment_laser_alignment',  0, 'photo',            'Train identification photos',
       'Nameplates of driver and driven units in alignment scope.',                                   true, 1, 6),
    ('rotating_equipment_laser_alignment', 10, 'document_upload',  'As-found alignment report',
       'Pre-alignment offsets, angles, and soft-foot from laser tool.',                               true, 1, 1),
    ('rotating_equipment_laser_alignment', 20, 'document_upload',  'Soft-foot correction record',
       'Per-foot soft-foot values before/after shimming.',                                            true, 1, 1),
    ('rotating_equipment_laser_alignment', 30, 'document_upload',  'As-left alignment report',
       'Final offsets and angles vs. tolerance (API 686 / vendor).',                                  true, 1, 1),
    ('rotating_equipment_laser_alignment', 40, 'document_upload',  'Thermal-growth compensation',
       'Where applicable, the growth targets applied (cold offset).',                                 false, 0, 1),
    ('rotating_equipment_laser_alignment', 50, 'photo',            'Coupling configuration photos',
       'Coupling spacing, shim stack at each foot, lock-wire / bolting evidence.',                    true, 2, 12),
    ('rotating_equipment_laser_alignment', 60, 'signed_statement', 'Millwright / inspector sign-off',
       'Sign-off including credential number and acceptance to tolerance.',                            true, 1, 1),

    -- ── api_686_machinery_installation_inspection (8 rows) ──
    ('api_686_machinery_installation_inspection',  0, 'document_upload',  'Installation package',
       'Vendor installation manual + project mechanical-completion checklist.',                       true, 1, 6),
    ('api_686_machinery_installation_inspection', 10, 'photo',            'Foundation acceptance photos',
       'Foundation top condition, anchor-bolt embedment, surface preparation.',                       true, 4, 16),
    ('api_686_machinery_installation_inspection', 20, 'document_upload',  'Baseplate flatness + grout record',
       'Flatness verification before grouting; grout product, mix, ambient cure.',                    true, 1, 2),
    ('api_686_machinery_installation_inspection', 30, 'document_upload',  'Soft-foot + piping strain check',
       'Soft-foot at each anchor; pipe-strain dial readings on suction/discharge.',                   true, 1, 2),
    ('api_686_machinery_installation_inspection', 40, 'document_upload',  'Anchor-bolt pre-load record',
       'Torque or tensioning record per anchor with target value.',                                   true, 1, 2),
    ('api_686_machinery_installation_inspection', 50, 'document_upload',  'Lube-oil flushing record',
       'Flushing duration, achieved cleanliness, final mesh inspection.',                             true, 1, 2),
    ('api_686_machinery_installation_inspection', 60, 'document_upload',  'Cold alignment as-left',
       'Final cold alignment against API 686 / vendor tolerance.',                                    true, 1, 1),
    ('api_686_machinery_installation_inspection', 70, 'signed_statement', 'Mechanical completion sign-off',
       'Lead inspector statement supporting mechanical completion turnover.',                          true, 1, 1),

    -- ── vibration_baseline_acceptance_iso_20816 (7 rows) ──
    ('vibration_baseline_acceptance_iso_20816',  0, 'photo',            'Machine identification',
       'Nameplate photos of every machine in the baseline scope.',                                    true, 1, 8),
    ('vibration_baseline_acceptance_iso_20816', 10, 'document_upload',  'Measurement plan',
       'Sensor locations per bearing per axis (H/V/A) with sensor mount type.',                       true, 1, 2),
    ('vibration_baseline_acceptance_iso_20816', 20, 'document_upload',  'Process / loading conditions',
       'Speed, flow, suction/discharge pressure, ambient at each test point.',                        true, 1, 2),
    ('vibration_baseline_acceptance_iso_20816', 30, 'document_upload',  'Overall vibration log',
       'Velocity/acceleration overall per location vs. ISO 20816 zone.',                              true, 1, 2),
    ('vibration_baseline_acceptance_iso_20816', 40, 'document_upload',  'FFT spectra archive',
       'Spectrum and waveform files (CSV / proprietary) archived per location.',                       true, 1, 50),
    ('vibration_baseline_acceptance_iso_20816', 50, 'document_upload',  'Instrument calibration certificate',
       'Vibration analyser + accelerometer calibration in date.',                                     true, 1, 2),
    ('vibration_baseline_acceptance_iso_20816', 60, 'signed_statement', 'Vibration analyst sign-off',
       'ISO 18436 Cat II/III analyst credential number + accept/reject.',                              true, 1, 1),

    -- ── crane_annual_structural_inspection_asme_b30 (8 rows) ──
    ('crane_annual_structural_inspection_asme_b30',  0, 'photo',            'Crane identification photos',
       'Nameplate, capacity chart, last load test sticker, serial number.',                           true, 1, 6),
    ('crane_annual_structural_inspection_asme_b30', 10, 'photo',            'Structural condition photos',
       'Boom sections, lattice (if applicable), turntable, outriggers, hooks.',                        true, 8, 60),
    ('crane_annual_structural_inspection_asme_b30', 20, 'document_upload',  'Hook NDE report (ASME B30.10)',
       'MT or PT report on the load hook.',                                                            true, 1, 2),
    ('crane_annual_structural_inspection_asme_b30', 30, 'photo',            'Wire rope condition photos',
       'Photos of rope at sheaves + drum showing wear, broken wires, lubrication.',                   true, 4, 24),
    ('crane_annual_structural_inspection_asme_b30', 40, 'document_upload',  'Functional test record',
       'Brakes, limit switches, anti-two-block, load-moment indicator response.',                     true, 1, 2),
    ('crane_annual_structural_inspection_asme_b30', 50, 'document_upload',  'Annual load-test record (if required)',
       'Load test certificate for the inspection year if applicable.',                                 false, 0, 2),
    ('crane_annual_structural_inspection_asme_b30', 60, 'photo',            'Cab / control condition',
       'Operator station, controls, decals, fire extinguisher, exits.',                                true, 2, 12),
    ('crane_annual_structural_inspection_asme_b30', 70, 'signed_statement', 'Qualified Person sign-off',
       'Inspector statement per applicable ASME B30 volume; QP per OSHA definition.',                  true, 1, 1),

    -- ── heavy_lift_rigging_plan_witness (7 rows) ──
    ('heavy_lift_rigging_plan_witness',  0, 'document_upload',  'Engineered lift plan',
       'Stamped lift plan including load weight, CoG, crane chart capacity, ground bearing.',         true, 1, 4),
    ('heavy_lift_rigging_plan_witness', 10, 'gps_pin',          'GPS pin at lift location',
       'Pin at the crane / lift centre at the time of witness.',                                       true, 1, 1),
    ('heavy_lift_rigging_plan_witness', 20, 'photo',            'Crane + rigging photos',
       'Crane configuration matches plan; slings, shackles, spreader bar identifiable.',              true, 4, 20),
    ('heavy_lift_rigging_plan_witness', 30, 'document_upload',  'Rigging gear certifications',
       'Sling, shackle, and below-the-hook device current proof-test certificates.',                  true, 1, 8),
    ('heavy_lift_rigging_plan_witness', 40, 'photo',            'Ground-bearing pressure verification',
       'Crane mats, tracked stations against published ground-pressure limit.',                       true, 1, 8),
    ('heavy_lift_rigging_plan_witness', 50, 'video_walkthrough', 'Dry-run / live-lift walkthrough',
       'Short video of the dry run and live lift execution.',                                          false, 0, 4),
    ('heavy_lift_rigging_plan_witness', 60, 'signed_statement', 'Lift witness sign-off',
       'Witness statement, registered lift number, accept/reject.',                                    true, 1, 1),

    -- ── bolt_torque_pressure_boundary_asme_pcc1 (6 rows) ──
    ('bolt_torque_pressure_boundary_asme_pcc1',  0, 'photo',            'Flange face condition photos',
       'Both flange faces clean, undamaged, gasket area free of pitting.',                            true, 2, 16),
    ('bolt_torque_pressure_boundary_asme_pcc1', 10, 'document_upload',  'Gasket + bolt material certs',
       'Gasket material data sheet + bolt/nut MTRs.',                                                   true, 1, 4),
    ('bolt_torque_pressure_boundary_asme_pcc1', 20, 'photo',            'Lubrication evidence',
       'Photos of stud + nut threads + nut bearing face lubricated.',                                 true, 1, 8),
    ('bolt_torque_pressure_boundary_asme_pcc1', 30, 'document_upload',  'Target torque or tension values',
       'Calculated bolt-up sheet per ASME PCC-1 Appendix L.',                                          true, 1, 1),
    ('bolt_torque_pressure_boundary_asme_pcc1', 40, 'document_upload',  'Final torque / tension record',
       'Per-bolt achieved torque / tension reading; pattern step recorded.',                          true, 1, 2),
    ('bolt_torque_pressure_boundary_asme_pcc1', 50, 'signed_statement', 'Joint Integrity Technician sign-off',
       'Technician credential per PCC-1 Appendix A; accept/reject.',                                   true, 1, 1),

    -- ── pre_startup_safety_review_mechanical_package (8 rows) ──
    ('pre_startup_safety_review_mechanical_package',  0, 'document_upload',  'PSSR checklist',
       'Site-specific PSSR checklist used by the team.',                                               true, 1, 1),
    ('pre_startup_safety_review_mechanical_package', 10, 'document_upload',  'Design intent / specs verification',
       'Construction-vs-design verification (P&IDs, isometrics, datasheets).',                        true, 1, 6),
    ('pre_startup_safety_review_mechanical_package', 20, 'document_upload',  'PHA action item closure',
       'PHA recommendation register with status of each item.',                                       true, 1, 2),
    ('pre_startup_safety_review_mechanical_package', 30, 'document_upload',  'Operating procedure verification',
       'Operating procedure in place and approved.',                                                  true, 1, 4),
    ('pre_startup_safety_review_mechanical_package', 40, 'document_upload',  'Maintenance procedure verification',
       'Maintenance / LO-TO / mechanical-integrity procedures in place.',                             true, 1, 4),
    ('pre_startup_safety_review_mechanical_package', 50, 'rep_interview',     'Operations training confirmation',
       'Operations representative confirms personnel are trained on the new package.',                true, 1, 4),
    ('pre_startup_safety_review_mechanical_package', 60, 'document_upload',  'PSSR action item register',
       'Open / closed items captured at PSSR closure.',                                                true, 1, 1),
    ('pre_startup_safety_review_mechanical_package', 70, 'signed_statement', 'PSSR lead sign-off',
       'Lead inspector statement of PSSR closure; ready for start-up.',                               true, 1, 1),

    -- ── hydroflushing_chemical_cleaning_acceptance (6 rows) ──
    ('hydroflushing_chemical_cleaning_acceptance',  0, 'document_upload',  'Cleaning procedure',
       'Approved cleaning method, chemistry, target cleanliness specification.',                       true, 1, 2),
    ('hydroflushing_chemical_cleaning_acceptance', 10, 'photo',            'Final mesh / strainer condition',
       'Photo of the final-pass strainer / mesh after cleaning.',                                     true, 1, 8),
    ('hydroflushing_chemical_cleaning_acceptance', 20, 'document_upload',  'Cleanliness verification',
       'Particle count or visual cleanliness vs. spec; pH if chemical clean.',                        true, 1, 2),
    ('hydroflushing_chemical_cleaning_acceptance', 30, 'document_upload',  'Effluent disposal record',
       'Manifest or disposal record for spent cleaning medium.',                                       true, 1, 2),
    ('hydroflushing_chemical_cleaning_acceptance', 40, 'photo',            'Post-clean preservation',
       'System left dry / inerted / preserved per project preservation plan.',                         true, 1, 8),
    ('hydroflushing_chemical_cleaning_acceptance', 50, 'signed_statement', 'Inspector sign-off',
       'Acceptance for next step (hydrotest / start-up).',                                             true, 1, 1),

    -- ── gearbox_borescope_oil_sample_inspection (7 rows) ──
    ('gearbox_borescope_oil_sample_inspection',  0, 'photo',            'Gearbox identification',
       'Nameplate (ratio, model, S/N) + installation photo for context.',                              true, 1, 4),
    ('gearbox_borescope_oil_sample_inspection', 10, 'video_walkthrough', 'Borescope footage',
       'Video walkthrough of accessible gear meshes and bearings.',                                    true, 1, 8),
    ('gearbox_borescope_oil_sample_inspection', 20, 'photo',            'Borescope still images of findings',
       'Photos of any pitting, scuffing, scoring, debris.',                                            false, 0, 24),
    ('gearbox_borescope_oil_sample_inspection', 30, 'document_upload',  'Oil sample chain-of-custody',
       'Sample bottle ID + handover sheet to lab.',                                                    true, 1, 2),
    ('gearbox_borescope_oil_sample_inspection', 40, 'document_upload',  'Lab oil analysis report',
       'Viscosity, water content, ISO 4406 cleanliness, ICP / PQ wear results.',                      true, 1, 1),
    ('gearbox_borescope_oil_sample_inspection', 50, 'document_upload',  'Vibration / temperature history review',
       'Recent CMMS / condition-monitoring trend snapshot.',                                            false, 0, 4),
    ('gearbox_borescope_oil_sample_inspection', 60, 'signed_statement', 'Reliability engineer sign-off',
       'Finding summary + re-inspection / overhaul recommendation.',                                    true, 1, 1),

    -- ── field_machinery_baseplate_grouting (7 rows) ──
    ('field_machinery_baseplate_grouting',  0, 'photo',            'Baseplate cleanliness + surface prep',
       'Underside of baseplate clean to bright metal; chamfered edges.',                              true, 2, 12),
    ('field_machinery_baseplate_grouting', 10, 'photo',            'Anchor-bolt isolation',
       'Anchor-bolt sleeves / tape isolation prior to grout pour.',                                    true, 1, 8),
    ('field_machinery_baseplate_grouting', 20, 'document_upload',  'Grout mix + product datasheet',
       'Approved epoxy or cementitious grout product datasheet + mix ratio.',                          true, 1, 2),
    ('field_machinery_baseplate_grouting', 30, 'document_upload',  'Ambient conditions during cure',
       'Temperature, humidity log over the cure window.',                                              true, 1, 2),
    ('field_machinery_baseplate_grouting', 40, 'photo',            'Post-cure grout condition',
       'No voids visible; expansion-joint sealing as required.',                                       true, 2, 12),
    ('field_machinery_baseplate_grouting', 50, 'document_upload',  'Final flatness + soft-foot',
       'Baseplate flatness + soft-foot check after cure.',                                             true, 1, 2),
    ('field_machinery_baseplate_grouting', 60, 'signed_statement', 'Inspector sign-off',
       'Acceptance per API 686 Chapter 4 with credential reference.',                                  true, 1, 1)

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
   WHERE domain = 'mechanical_field' AND is_active = true;

  SELECT count(*) INTO req_count
    FROM public.inspection_evidence_requirements r
    JOIN public.inspection_scope_templates t ON t.id = r.template_id
   WHERE t.domain = 'mechanical_field';

  SELECT array_length(default_specialty_groups, 1) INTO group_count
    FROM public.inspection_domains WHERE slug = 'mechanical_field';

  RAISE NOTICE 'Phase 4 (mechanical_field) post-state:';
  RAISE NOTICE '  default_specialty_groups: % (expect 7)', group_count;
  RAISE NOTICE '  scope templates:          % (expect >= 12)', tmpl_count;
  RAISE NOTICE '  evidence requirements:    % (expect >= 85)', req_count;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Confirm default_specialty_groups has 7 entries:
--      SELECT slug, default_specialty_groups
--        FROM public.inspection_domains
--       WHERE slug = 'mechanical_field';
--
-- 2) Confirm 12 scope templates:
--      SELECT slug, name, base_price_cents, requires_credential_tier
--        FROM public.inspection_scope_templates
--       WHERE domain = 'mechanical_field'
--       ORDER BY slug;
--
-- 3) Evidence row count by template:
--      SELECT t.slug, count(r.*) AS req_count
--        FROM public.inspection_scope_templates t
--   LEFT JOIN public.inspection_evidence_requirements r ON r.template_id = t.id
--       WHERE t.domain = 'mechanical_field'
--    GROUP BY t.slug ORDER BY t.slug;
-- ─────────────────────────────────────────────────────────────────────
