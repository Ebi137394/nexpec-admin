-- ════════════════════════════════════════════════════════════════════════════
--  20260625120000_electrical_default_groups_and_scope_catalogue.sql
--
--  PHASE 3 — Electrical domain content fleshing.
--
--  WHAT THIS DOES
--  ──────────────
--  1. Expands inspection_domains.default_specialty_groups for electrical
--     from 2 → 5 groups. Pre-Phase-3 the seed referenced only:
--       • Electrical & instrumentation
--       • Power & renewables
--     Adds the three groups that electrical work demonstrably touches:
--       • NDT methods                (thermography is also NDT IRT;
--                                     partial discharge testing classed as NDT)
--       • Quality, safety & systems  (arc-flash, NFPA 70E electrical safety,
--                                     LO/TO, confined-space entries)
--       • Special domains            (data centers, semiconductor fabs,
--                                     pulp & paper, cement plants)
--
--  2. Seeds 10 canonical scope templates in inspection_scope_templates
--     covering the most common electrical inspection job types:
--
--       1. neta_ats_acceptance_testing            — NETA ATS new equipment
--       2. ir_thermography_electrical_survey       — Infrared survey
--       3. arc_flash_hazard_analysis               — IEEE 1584 / NFPA 70E study
--       4. transformer_oil_sampling_dga            — IEEE C57.104 DGA
--       5. mv_switchgear_inspection                — MV (5-38 kV) switchgear
--       6. grounding_bonding_verification          — IEEE 81 grounding system
--       7. motor_circuit_analysis_offline          — Off-line motor testing
--       8. circuit_breaker_primary_injection_testing — Protective device testing
--       9. ups_battery_bank_acceptance             — IEEE 1188 / 450
--      10. pv_solar_string_acceptance_testing      — IEC 62446-1 PV
--
--  3. Seeds inspection_evidence_requirements for each scope template —
--     64 child rows defining the photos, document uploads, and signed
--     statements inspectors collect on site.
--
--  IDEMPOTENCY
--  ───────────
--    • default_specialty_groups update is full-array replacement (re-runs
--      land the identical array).
--    • Scope templates use INSERT … ON CONFLICT (slug) DO UPDATE so
--      content refreshes but row identity (and any FK references from
--      existing jobs) is preserved.
--    • Evidence requirements DELETE the existing set for these 10
--      templates and re-INSERT from a single VALUES list.
--
--  WHAT THIS DOES NOT DO
--  ─────────────────────
--    • Does NOT touch industrial_ndt, civil_construction, mechanical_field,
--      or chemical_process rows.
--    • Does NOT flip electrical.is_launched. Stays false until you toggle
--      it from /admin/domains.
--    • Does NOT modify any schema, ENUM, RLS policy, or RPC.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Expand default_specialty_groups (2 → 5)
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.inspection_domains
   SET default_specialty_groups = ARRAY[
         'Electrical & instrumentation',
         'Power & renewables',
         'NDT methods',
         'Quality, safety & systems',
         'Special domains'
       ]::text[],
       updated_at = now()
 WHERE slug = 'electrical';

-- ─────────────────────────────────────────────────────────────────────
-- 2) Scope template catalogue (10 rows)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.inspection_scope_templates (
  slug, name, category, region, validity_months, base_price_cents,
  requires_credential_tier, description_md, domain, is_active
) VALUES
  (
    'neta_ats_acceptance_testing',
    'NETA ATS Acceptance Testing (Newly Installed Equipment)',
    'Electrical acceptance testing',
    'global', 12, 420000, 'cci_advanced',
    'Acceptance testing of newly installed electrical power equipment per the InterNational Electrical Testing Association ANSI/NETA ATS specification. Covers insulation resistance, contact resistance, TTR/CT/PT verification, protective-relay calibration, and final functional testing prior to energisation. Inspector must hold a current NETA Level III or IV certification.',
    'electrical', true
  ),
  (
    'ir_thermography_electrical_survey',
    'Infrared Thermography — Electrical Survey (NETA MTS / NFPA 70B)',
    'Predictive maintenance — thermography',
    'global', 12, 180000, 'cci_advanced',
    'Infrared thermographic survey of energised electrical distribution equipment per the NETA MTS guideline and NFPA 70B Chapter 11. Captures thermogram + visible-light pairs of every accessible connection, ranks findings by severity (ΔT above ambient / above similar-component baseline), and recommends corrective actions. Inspector must hold a Level II Infrared Thermographer certification (ITC or ASNT TC-1A).',
    'electrical', true
  ),
  (
    'arc_flash_hazard_analysis',
    'Arc-Flash Hazard Analysis (IEEE 1584 / NFPA 70E)',
    'Arc-flash hazard analysis',
    'global', 60, 850000, 'cci_lead',
    'Engineered arc-flash hazard analysis per IEEE 1584-2018 and NFPA 70E-2024. Builds the system one-line, runs the short-circuit and arc-flash incident-energy calculation, produces incident-energy / PPE category labels for each piece of equipment, and issues mitigation recommendations. NFPA 70E §130.5 mandates a 5-year update interval. PE stamp on the analysis report is required for equipment over 50 V where the AHJ requires it.',
    'electrical', true
  ),
  (
    'transformer_oil_sampling_dga',
    'Transformer Oil Sampling — DGA (IEEE C57.104)',
    'Transformer condition monitoring',
    'global', 12, 80000, 'cci_basic',
    'On-site collection of oil samples from oil-immersed power transformers for laboratory Dissolved Gas Analysis (DGA) per IEEE C57.104. Includes sampling-valve cleaning, sample-bottle/syringe identification, chain-of-custody, and field interpretation of returned lab results against the Doernenburg / Rogers / IEC 60599 ratio methods.',
    'electrical', true
  ),
  (
    'mv_switchgear_inspection',
    'Medium-Voltage Switchgear Inspection (5–38 kV)',
    'Switchgear inspection',
    'global', 12, 280000, 'cci_advanced',
    'De-energised inspection and electrical testing of medium-voltage (5–38 kV) metal-clad or metal-enclosed switchgear per NETA MTS §7.5. Covers visual condition of bus and primary contacts, insulation resistance (megger) at multiple voltages, contact resistance (ductor) on all primary disconnects, breaker time-travel test, and partial-discharge survey on accessible terminations.',
    'electrical', true
  ),
  (
    'grounding_bonding_verification',
    'Grounding & Bonding System Verification (IEEE 81)',
    'Grounding & bonding',
    'global', 36, 70000, 'cci_basic',
    'On-site verification of grounding electrode and bonding system effectiveness per IEEE 81-2012 and NEC Article 250. Performs fall-of-potential (3-point) or clamp-on ground resistance testing on each electrode, continuity checks on bonding jumpers, and a system one-line markup with measured values. Recommended retest interval per IEEE 81 §8 is 36 months for facility grounds.',
    'electrical', true
  ),
  (
    'motor_circuit_analysis_offline',
    'Motor Circuit Analysis — Off-line (Insulation, PI, Winding R)',
    'Rotating machinery electrical testing',
    'global', 12, 120000, 'cci_advanced',
    'Off-line electrical testing of three-phase induction or synchronous motors. Includes insulation-resistance (megger) at multiple voltages (500 V / 1000 V / 5000 V as appropriate), polarisation-index and dielectric-absorption-ratio computation, winding resistance balance, and optional surge-comparison test for inter-turn faults. Suitable for both routine maintenance and post-trip diagnostics.',
    'electrical', true
  ),
  (
    'circuit_breaker_primary_injection_testing',
    'Circuit Breaker Primary Current Injection Testing',
    'Protective device testing',
    'global', 12, 150000, 'cci_advanced',
    'Primary current injection testing of LV/MV power circuit breakers per NETA MTS §7.6. Confirms long-time, short-time, instantaneous, and (where applicable) ground-fault trip behaviour against the protective-device-coordination study. Records as-found and as-left trip-unit settings for the asset record.',
    'electrical', true
  ),
  (
    'ups_battery_bank_acceptance',
    'UPS + Battery Bank Acceptance Testing (IEEE 1188 / 450)',
    'UPS & battery testing',
    'global', 12, 100000, 'cci_basic',
    'Acceptance and condition testing of static UPS systems and their VRLA or vented lead-acid battery strings per IEEE 1188-2005 (VRLA) and IEEE 450-2020 (vented). Includes per-cell voltage and internal resistance / impedance readings, inter-cell connection torque verification, optional capacity discharge test, and a runtime transfer test on the UPS.',
    'electrical', true
  ),
  (
    'pv_solar_string_acceptance_testing',
    'PV Solar String Acceptance Testing (IEC 62446-1)',
    'PV solar acceptance',
    'global', 12, 240000, 'cci_advanced',
    'String-level acceptance testing of utility-scale or commercial PV arrays per IEC 62446-1 §6 (electrical tests). Covers continuity of protective conductors, polarity, open-circuit voltage and short-circuit current per string, insulation resistance to ground, and I-V curve traces on a representative sample. Output feeds the EPC commissioning package.',
    'electrical', true
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
-- 3) Evidence requirements (64 rows across the 10 templates)
-- ─────────────────────────────────────────────────────────────────────

DELETE FROM public.inspection_evidence_requirements
 WHERE template_id IN (
   SELECT id FROM public.inspection_scope_templates
    WHERE slug IN (
      'neta_ats_acceptance_testing',
      'ir_thermography_electrical_survey',
      'arc_flash_hazard_analysis',
      'transformer_oil_sampling_dga',
      'mv_switchgear_inspection',
      'grounding_bonding_verification',
      'motor_circuit_analysis_offline',
      'circuit_breaker_primary_injection_testing',
      'ups_battery_bank_acceptance',
      'pv_solar_string_acceptance_testing'
    )
 );

INSERT INTO public.inspection_evidence_requirements (
  template_id, sort_order, kind, label, hint, required, min_count, max_count
)
SELECT t.id, e.sort_order, e.kind::public.compliance_evidence_kind,
       e.label, e.hint, e.required, e.min_count, e.max_count
  FROM (VALUES

    -- ── neta_ats_acceptance_testing (7 rows) ──
    ('neta_ats_acceptance_testing',  0, 'photo',            'Equipment nameplate photos',
       'Capture each piece of equipment in the test scope: make, kV class, kVA, S/N.',  true, 1, 20),
    ('neta_ats_acceptance_testing', 10, 'document_upload',  'Megger insulation-resistance log',
       'Phase-to-phase and phase-to-ground readings, with applied voltage and duration.', true, 1, 4),
    ('neta_ats_acceptance_testing', 20, 'document_upload',  'TTR / CT / PT verification',
       'Transformer turns ratio, current/potential transformer polarity + ratio.',     true, 1, 4),
    ('neta_ats_acceptance_testing', 30, 'document_upload',  'Contact resistance (ductor) log',
       'Microhm readings on each primary disconnect / bus connection.',                true, 1, 4),
    ('neta_ats_acceptance_testing', 40, 'document_upload',  'Protective-relay calibration record',
       'Settings as-found and as-left for each relay.',                                true, 1, 4),
    ('neta_ats_acceptance_testing', 50, 'document_upload',  'Final functional test record',
       'Trip / close logic, interlock, control-power-loss behaviour.',                 true, 1, 2),
    ('neta_ats_acceptance_testing', 60, 'signed_statement', 'NETA Level III/IV technician sign-off',
       'NETA certification number, expiration, acceptance per ANSI/NETA ATS.',         true, 1, 1),

    -- ── ir_thermography_electrical_survey (6 rows) ──
    ('ir_thermography_electrical_survey',  0, 'document_upload',  'Equipment route list',
       'Spreadsheet of every panel, switchgear, disconnect surveyed.',                 true, 1, 2),
    ('ir_thermography_electrical_survey', 10, 'document_upload',  'Thermogram + visible-light pairs',
       'Side-by-side IR + visible image per finding location.',                         true, 1, 200),
    ('ir_thermography_electrical_survey', 20, 'document_upload',  'Per-finding severity rating sheet',
       'NETA MTS Table 100.18 or NFPA 70B Annex G severity classification.',           true, 1, 1),
    ('ir_thermography_electrical_survey', 30, 'document_upload',  'Ambient + load-conditions log',
       'Ambient temperature, RH, and per-circuit loading at time of scan.',            true, 1, 1),
    ('ir_thermography_electrical_survey', 40, 'document_upload',  'IR camera calibration certificate',
       'Calibration certificate in date for the camera used.',                          true, 1, 1),
    ('ir_thermography_electrical_survey', 50, 'signed_statement', 'Level II Thermographer sign-off',
       'ITC or ASNT TC-1A Level II certification number, expiration.',                 true, 1, 1),

    -- ── arc_flash_hazard_analysis (6 rows) ──
    ('arc_flash_hazard_analysis',  0, 'document_upload',  'System one-line diagram',
       'Current as-built one-line covering every bus in the study scope.',              true, 1, 4),
    ('arc_flash_hazard_analysis', 10, 'document_upload',  'Short-circuit calculation report',
       'Three-phase bolted-fault and line-to-ground fault duties per bus.',            true, 1, 1),
    ('arc_flash_hazard_analysis', 20, 'document_upload',  'Arc-flash incident-energy table',
       'Per-bus incident energy (cal/cm²), arc-flash boundary, working distance.',     true, 1, 1),
    ('arc_flash_hazard_analysis', 30, 'photo',            'Labeled equipment photos',
       'Photographs of each piece of equipment with the new arc-flash label applied.', true, 4, 80),
    ('arc_flash_hazard_analysis', 40, 'document_upload',  'Mitigation recommendations',
       'Engineering controls — settings changes, maintenance switches, remote racking.', true, 1, 1),
    ('arc_flash_hazard_analysis', 50, 'signed_statement', 'PE engineer statement',
       'Stamped PE statement with license number and jurisdiction where required.',     true, 1, 1),

    -- ── transformer_oil_sampling_dga (7 rows) ──
    ('transformer_oil_sampling_dga',  0, 'photo',            'Transformer nameplate photos',
       'Make, kVA, voltage class, year of manufacture, oil type.',                     true, 1, 4),
    ('transformer_oil_sampling_dga', 10, 'photo',            'Sample valve cleaning',
       'Pre-sample cleanliness of the sampling valve and area.',                       true, 1, 4),
    ('transformer_oil_sampling_dga', 20, 'photo',            'Sample container identification',
       'Each bottle / syringe labelled with transformer ID, date, sampler.',            true, 1, 8),
    ('transformer_oil_sampling_dga', 30, 'document_upload',  'Chain-of-custody form',
       'Signed handover sheet from sampler → lab.',                                    true, 1, 1),
    ('transformer_oil_sampling_dga', 40, 'document_upload',  'Lab DGA results',
       'Lab report with concentrations of H2, CH4, C2H2, C2H4, C2H6, CO, CO2.',        true, 1, 1),
    ('transformer_oil_sampling_dga', 50, 'document_upload',  'IEEE C57.104 interpretation',
       'Diagnostic classification (Doernenburg / Rogers / IEC 60599 ratios).',          true, 1, 1),
    ('transformer_oil_sampling_dga', 60, 'signed_statement', 'Inspector sign-off',
       'Sampler / inspector statement with finding summary.',                           true, 1, 1),

    -- ── mv_switchgear_inspection (7 rows) ──
    ('mv_switchgear_inspection',  0, 'photo',            'Switchgear nameplate photos',
       'kV class, ampacity, S/N, manufacturer drawings reference.',                    true, 1, 8),
    ('mv_switchgear_inspection', 10, 'photo',            'Bus + primary contact condition',
       'De-energised photos of bus, contact wear, lubrication condition.',             true, 4, 40),
    ('mv_switchgear_inspection', 20, 'document_upload',  'Insulation-resistance log',
       'Megger readings phase-to-phase and phase-to-ground at multiple voltages.',     true, 1, 4),
    ('mv_switchgear_inspection', 30, 'document_upload',  'Contact-resistance (ductor) log',
       'Microhm readings on each primary disconnect.',                                  true, 1, 4),
    ('mv_switchgear_inspection', 40, 'document_upload',  'Breaker time-travel test',
       'Open/close times and travel curve per breaker.',                               true, 1, 8),
    ('mv_switchgear_inspection', 50, 'document_upload',  'Partial-discharge survey (optional)',
       'PD survey on accessible terminations (if equipment supports it).',              false, 0, 4),
    ('mv_switchgear_inspection', 60, 'signed_statement', 'Inspector sign-off',
       'NETA technician certification number, accept/reject per ANSI/NETA MTS §7.5.',  true, 1, 1),

    -- ── grounding_bonding_verification (6 rows) ──
    ('grounding_bonding_verification',  0, 'photo',            'Ground electrode photos',
       'Each rod / mat / ring with location reference.',                                true, 2, 20),
    ('grounding_bonding_verification', 10, 'document_upload',  'Fall-of-potential test data',
       '3-point or clamp-on resistance readings per electrode.',                        true, 1, 4),
    ('grounding_bonding_verification', 20, 'document_upload',  'Bonding continuity checks',
       'Continuity / low-resistance readings on bonding jumpers.',                      true, 1, 4),
    ('grounding_bonding_verification', 30, 'document_upload',  'System one-line markup',
       'One-line annotated with measured values + connection points.',                  true, 1, 2),
    ('grounding_bonding_verification', 40, 'text_input',        'Acceptance criterion',
       'Project / NEC §250.53 target (typical ≤25 Ω for single rod) or facility spec.', true, 1, 1),
    ('grounding_bonding_verification', 50, 'signed_statement', 'Inspector sign-off',
       'Inspector statement of compliance with IEEE 81 and NEC Article 250.',           true, 1, 1),

    -- ── motor_circuit_analysis_offline (6 rows) ──
    ('motor_circuit_analysis_offline',  0, 'photo',            'Motor nameplate photo',
       'HP/kW, voltage class, FLA, insulation class, S/N.',                            true, 1, 4),
    ('motor_circuit_analysis_offline', 10, 'document_upload',  'Insulation resistance log',
       'Megger readings at 500 / 1000 / 5000 V as appropriate.',                       true, 1, 2),
    ('motor_circuit_analysis_offline', 20, 'document_upload',  'Polarisation index calculation',
       'PI = R10min / R1min — recorded per phase.',                                    true, 1, 2),
    ('motor_circuit_analysis_offline', 30, 'document_upload',  'Winding resistance balance',
       'DC resistance per phase + percent imbalance.',                                 true, 1, 2),
    ('motor_circuit_analysis_offline', 40, 'document_upload',  'Surge comparison test (optional)',
       'Surge waveforms per phase if equipment available.',                            false, 0, 2),
    ('motor_circuit_analysis_offline', 50, 'signed_statement', 'Inspector sign-off',
       'Certification number, expiration, finding summary.',                           true, 1, 1),

    -- ── circuit_breaker_primary_injection_testing (6 rows) ──
    ('circuit_breaker_primary_injection_testing',  0, 'photo',            'Breaker nameplate photos',
       'Frame size, trip unit type, settings as found.',                                true, 1, 8),
    ('circuit_breaker_primary_injection_testing', 10, 'document_upload',  'Settings as found / as left',
       'Long-time, short-time, instantaneous, ground-fault settings recorded.',         true, 1, 4),
    ('circuit_breaker_primary_injection_testing', 20, 'document_upload',  'Primary injection test results',
       'Pickup and trip-time per zone, per breaker.',                                  true, 1, 4),
    ('circuit_breaker_primary_injection_testing', 30, 'document_upload',  'Time-current coordination chart',
       'Reference TCC chart showing breaker in study coordination.',                    true, 1, 4),
    ('circuit_breaker_primary_injection_testing', 40, 'document_upload',  'Instantaneous trip test record',
       'Verified instantaneous trip operation and time.',                              true, 1, 2),
    ('circuit_breaker_primary_injection_testing', 50, 'signed_statement', 'Inspector sign-off',
       'NETA certification number, expiration, finding summary.',                       true, 1, 1),

    -- ── ups_battery_bank_acceptance (6 rows) ──
    ('ups_battery_bank_acceptance',  0, 'photo',            'UPS nameplate photos',
       'kVA / kW, voltage, configuration (online / line-interactive), S/N.',           true, 1, 4),
    ('ups_battery_bank_acceptance', 10, 'document_upload',  'Per-cell voltage log',
       'Float voltage per cell at the time of inspection.',                            true, 1, 2),
    ('ups_battery_bank_acceptance', 20, 'document_upload',  'Internal resistance / impedance log',
       'IR/impedance per cell with deviation from baseline.',                          true, 1, 2),
    ('ups_battery_bank_acceptance', 30, 'document_upload',  'Inter-cell connection torque + IR',
       'Torque + microhm readings on each inter-cell connection.',                     true, 1, 2),
    ('ups_battery_bank_acceptance', 40, 'document_upload',  'Capacity discharge / runtime test',
       'If a discharge or transfer test was performed, attach the record.',            false, 0, 2),
    ('ups_battery_bank_acceptance', 50, 'signed_statement', 'Inspector sign-off',
       'Inspector statement of compliance with IEEE 1188 / IEEE 450 §7.',              true, 1, 1),

    -- ── pv_solar_string_acceptance_testing (7 rows) ──
    ('pv_solar_string_acceptance_testing',  0, 'document_upload',  'Array layout drawing',
       'As-built layout showing combiners, string IDs, module model.',                 true, 1, 4),
    ('pv_solar_string_acceptance_testing', 10, 'document_upload',  'Per-string Voc + Isc readings',
       'Per-string open-circuit voltage and short-circuit current vs. expected.',      true, 1, 4),
    ('pv_solar_string_acceptance_testing', 20, 'document_upload',  'Insulation resistance per string',
       'IR to ground with array isolated.',                                            true, 1, 4),
    ('pv_solar_string_acceptance_testing', 30, 'document_upload',  'Polarity check log',
       'Per-string DC polarity verified before energising.',                           true, 1, 4),
    ('pv_solar_string_acceptance_testing', 40, 'document_upload',  'I-V curve traces',
       'I-V curve traces for at least one string per combiner.',                       true, 1, 50),
    ('pv_solar_string_acceptance_testing', 50, 'document_upload',  'Continuity test record',
       'Continuity of protective conductors per IEC 62446-1 §6.1.',                    true, 1, 2),
    ('pv_solar_string_acceptance_testing', 60, 'signed_statement', 'Inspector sign-off',
       'IEC 62446-1 § Verifier statement with credential number.',                     true, 1, 1)

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
   WHERE domain = 'electrical' AND is_active = true;

  SELECT count(*) INTO req_count
    FROM public.inspection_evidence_requirements r
    JOIN public.inspection_scope_templates t ON t.id = r.template_id
   WHERE t.domain = 'electrical';

  SELECT array_length(default_specialty_groups, 1) INTO group_count
    FROM public.inspection_domains WHERE slug = 'electrical';

  RAISE NOTICE 'Phase 3 (electrical) post-state:';
  RAISE NOTICE '  default_specialty_groups: % (expect 5)', group_count;
  RAISE NOTICE '  scope templates:          % (expect >= 10)', tmpl_count;
  RAISE NOTICE '  evidence requirements:    % (expect >= 64)', req_count;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Confirm default_specialty_groups has 5 entries:
--      SELECT slug, default_specialty_groups
--        FROM public.inspection_domains
--       WHERE slug = 'electrical';
--
-- 2) Confirm 10 scope templates:
--      SELECT slug, name, base_price_cents, requires_credential_tier
--        FROM public.inspection_scope_templates
--       WHERE domain = 'electrical'
--       ORDER BY slug;
--
-- 3) Evidence row count by template:
--      SELECT t.slug, count(r.*) AS req_count
--        FROM public.inspection_scope_templates t
--   LEFT JOIN public.inspection_evidence_requirements r ON r.template_id = t.id
--       WHERE t.domain = 'electrical'
--    GROUP BY t.slug ORDER BY t.slug;
-- ─────────────────────────────────────────────────────────────────────
