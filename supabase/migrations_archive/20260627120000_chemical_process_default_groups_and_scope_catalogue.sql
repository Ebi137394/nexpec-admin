-- ════════════════════════════════════════════════════════════════════════════
--  20260627120000_chemical_process_default_groups_and_scope_catalogue.sql
--
--  PHASE 5 — Chemical & Process domain content fleshing. FINAL phase
--  of the per-domain catalogue sprint (Phases 1-5 cover every launched
--  + unlaunched domain).
--
--  Most comprehensive of the five phases — chemical/process work has the
--  highest regulatory density (OSHA PSM, EPA RMP, IEC 61511, NFPA 70E,
--  21 CFR 211 cGMP) and the broadest scope-template surface (audits,
--  inspections, witnessing, lab + field combined). Ships 15 scope
--  templates with 7-9 evidence rows each (123 total).
--
--  PREREQUISITE: the canonical specialty taxonomy
--  (packages/shared-core/src/data/specialtyTaxonomy.ts) has been
--  expanded from 6 → 12 disciplines in the Chemical & process group in
--  the same commit. The six new kebab slugs are:
--    distillation-column-internals, hazardous-area-classification,
--    safety-instrumented-systems, epa-rmp-audit, catalyst-handling-loading,
--    batch-records-gmp-audit.
--
--  WHAT THIS DOES
--  ──────────────
--  1. Expands inspection_domains.default_specialty_groups for
--     chemical_process from 1 → 4 groups. Pre-Phase-5 the seed only
--     referenced 'Chemical & process'. Adds the three groups that
--     chemical/process work substantively touches:
--       • Pressure equipment & boilers  (vessels, heat exchangers, reactors)
--       • Piping & pipelines            (process piping, transfer lines)
--       • Quality, safety & systems     (PSM, RMP, audits, LO/TO)
--
--  2. Seeds 15 canonical scope templates covering the breadth of
--     chemical / process inspection work:
--
--       1. psm_compliance_audit_osha_1910_119         — Full PSM 14-element audit
--       2. mechanical_integrity_program_audit          — MI program audit
--       3. pha_hazop_facilitation                      — HAZOP team leadership
--       4. psv_pop_test_campaign_api_576               — PSV pop-test campaign
--       5. heat_exchanger_turnaround_inspection        — HX TA internal inspection
--       6. ldar_method_21_quarterly_campaign           — LDAR quarterly campaign
--       7. distillation_column_internals_inspection    — Distillation tray inspection
--       8. hazardous_area_classification_audit_iec_60079 — Ex equipment audit
--       9. sis_proof_testing_iec_61511                 — SIS proof testing
--      10. epa_rmp_compliance_audit                    — EPA RMP audit
--      11. catalyst_loading_unloading_qc               — Catalyst handling QC
--      12. batch_records_gmp_audit_specialty_chemical  — cGMP / batch audit
--      13. piping_class_break_audit_b31_3              — Process line material trace
--      14. reactor_internals_post_turnaround_inspection — Reactor internals
--      15. process_safety_information_audit            — PSM Element 3 audit
--
--  3. Seeds 123 evidence requirement child rows defining the photos,
--     document uploads, GPS pins, video walkthroughs, signed statements,
--     and rep_interview events inspectors collect on chemical-site work.
--
--  IDEMPOTENCY
--  ───────────
--    • default_specialty_groups update is full-array replacement.
--    • Scope templates use INSERT … ON CONFLICT (slug) DO UPDATE so
--      content refreshes but row identity is preserved.
--    • Evidence requirements DELETE the existing set for these 15
--      templates and re-INSERT from a single VALUES list.
--
--  WHAT THIS DOES NOT DO
--  ─────────────────────
--    • Does NOT touch industrial_ndt, civil_construction, electrical,
--      or mechanical_field rows.
--    • Does NOT flip chemical_process.is_launched. That stays false
--      until you toggle it from /admin/domains. Recommended pre-launch
--      checks: (a) at least one inspector has chemical_process
--      specialties selected; (b) you've reviewed the scope catalogue
--      content for your specific market.
--    • Does NOT modify any schema, ENUM, RLS policy, or RPC.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Expand default_specialty_groups (1 → 4)
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.inspection_domains
   SET default_specialty_groups = ARRAY[
         'Chemical & process',
         'Pressure equipment & boilers',
         'Piping & pipelines',
         'Quality, safety & systems'
       ]::text[],
       updated_at = now()
 WHERE slug = 'chemical_process';

-- ─────────────────────────────────────────────────────────────────────
-- 2) Scope template catalogue (15 rows)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.inspection_scope_templates (
  slug, name, category, region, validity_months, base_price_cents,
  requires_credential_tier, description_md, domain, is_active
) VALUES
  (
    'psm_compliance_audit_osha_1910_119',
    'PSM Compliance Audit (OSHA 1910.119)',
    'Process Safety Management',
    'global', 36, 850000, 'cci_lead',
    'Full Process Safety Management compliance audit per OSHA 29 CFR 1910.119(o). Covers all 14 PSM elements: employee participation, process safety information, PHA, operating procedures, training, contractors, PSSR, mechanical integrity, hot-work permit, MOC, incident investigation, emergency planning, compliance audits, and trade secrets. OSHA 1910.119(o)(1) mandates compliance audits at least every 3 years; auditor must be a knowledgeable person.',
    'chemical_process', true
  ),
  (
    'mechanical_integrity_program_audit',
    'Mechanical Integrity Program Audit (PSM §1910.119(j) / API 580)',
    'Mechanical Integrity',
    'global', 36, 550000, 'cci_advanced',
    'Audit of the site Mechanical Integrity program per OSHA PSM Element 8 (1910.119(j)) and API 580/581 RBI principles. Covers equipment criticality classification, inspection planning, frequency justification, deficiency closure, MoC for inspection-procedure changes, training of inspection personnel, and document-control practices.',
    'chemical_process', true
  ),
  (
    'pha_hazop_facilitation',
    'PHA / HAZOP Team Facilitation (PSM §1910.119(e))',
    'Process Hazard Analysis',
    'global', 60, 1200000, 'cci_lead',
    'Multi-day Process Hazard Analysis using HAZOP, what-if, LOPA, or FMEA methodology, led by a certified facilitator with a multi-disciplinary site team. Output is the signed PHA report, recommendation register, and risk ranking. PSM §1910.119(e)(6) mandates revalidation at least every 5 years.',
    'chemical_process', true
  ),
  (
    'psv_pop_test_campaign_api_576',
    'PSV Pop-Test Campaign (API 576 / ASME PTC 25)',
    'Pressure Relief Device Testing',
    'global', 60, 420000, 'cci_advanced',
    'Multi-PSV pop-test campaign on pressure safety valves removed during turnaround. Performed at a certified VR-stamped repair shop or on-site test stand per ASME PTC 25. Covers visual condition, set-pressure verification, simmer, blowdown, seat tightness, and re-installation tagging. Output supports the site PSV inspection register and OSHA PSM MI requirement.',
    'chemical_process', true
  ),
  (
    'heat_exchanger_turnaround_inspection',
    'Heat Exchanger Turnaround Inspection (Eddy Current + Tubesheet)',
    'Heat Exchanger Inspection',
    'global', 60, 380000, 'cci_advanced',
    'Internal turnaround inspection of a shell-and-tube heat exchanger after pull and cleaning. Covers shell-side visual, channel head + tubesheet visual + dimensional, eddy current tube testing (or IRIS where ferrous), and bundle straightness. Output is the per-tube disposition (in-service / plug / re-tube) feeding the unit reliability plan.',
    'chemical_process', true
  ),
  (
    'ldar_method_21_quarterly_campaign',
    'LDAR Method 21 Quarterly Campaign (EPA 40 CFR §60.485 / §63.180)',
    'LDAR / Fugitive Emissions',
    'global', 3, 280000, 'cci_advanced',
    'Quarterly leak detection and repair (LDAR) survey on the component population (connectors, valves, flanges, pumps) per EPA Method 21. Covers calibration of the analyser at the start of every campaign, screening at each component, first-attempt repair within 5 days, final repair within 15 days, and recordkeeping of all leaks ≥ leak-definition concentration. Optical Gas Imaging (OGI) may be used as the alternative work practice per §60.18.',
    'chemical_process', true
  ),
  (
    'distillation_column_internals_inspection',
    'Distillation Column Internals Inspection (Trays + Packing)',
    'Distillation Column Internals',
    'global', 60, 350000, 'cci_advanced',
    'Internal inspection of a distillation / fractionation tower during turnaround. Covers tray flatness and bowing, downcomer condition, weir levelness, bubble caps / valves / sieve hole condition, structured / random packing condition, and liquid distributor levelness. Output is a per-tray / per-bed disposition feeding the unit revamp or continued-service decision.',
    'chemical_process', true
  ),
  (
    'hazardous_area_classification_audit_iec_60079',
    'Hazardous Area Classification + Ex Equipment Audit (IEC 60079 / NEC 500)',
    'Hazardous Area / Ex Equipment',
    'global', 36, 300000, 'cci_advanced',
    'Field audit of installed electrical equipment in classified hazardous areas against the site area-classification drawing per IEC 60079-14 (or NEC Article 500 in the US). Verifies equipment certification (Ex d / e / i / n / m / o / p), nameplate marking, cable-gland integrity, and earthing/bonding. Inspector must hold IECEx CoPC Ex 01-04 or equivalent.',
    'chemical_process', true
  ),
  (
    'sis_proof_testing_iec_61511',
    'Safety Instrumented System Proof Testing (IEC 61511 / ISA 84)',
    'Safety Instrumented Systems',
    'global', 12, 650000, 'cci_lead',
    'Proof testing of one or more Safety Instrumented Functions per IEC 61511-1 §16 (or ISA 84.00.01). Validates that each sensor → logic-solver → final-element loop meets its credited PFDavg and SIL claim. Records bypass authorisation, test procedure, results vs. acceptance criteria, fault-finding and corrective actions, and SIL re-verification calculations. Lead-level inspector with functional-safety certification (TÜV FSEng or equivalent) required.',
    'chemical_process', true
  ),
  (
    'epa_rmp_compliance_audit',
    'EPA Risk Management Program Audit (40 CFR Part 68)',
    'EPA Risk Management Program',
    'global', 60, 900000, 'cci_lead',
    'Compliance audit of the site EPA Risk Management Program per 40 CFR Part 68. Determines the applicable program level (1, 2, or 3), reviews the offsite consequence analysis, prevention program, emergency response program, and 5-year accident history. Audits are required every 3 years and at every RMP resubmission. Audit must be conducted by a knowledgeable person not directly responsible for the program.',
    'chemical_process', true
  ),
  (
    'catalyst_loading_unloading_qc',
    'Catalyst Loading / Unloading QC',
    'Catalyst Handling',
    'global', 12, 260000, 'cci_advanced',
    'QC oversight of a catalyst loading or unloading campaign on a reactor (FCC, hydrotreater, reformer, hydrocracker, fixed-bed). Verifies inert-atmosphere monitoring, breathing-air supply, drum / bulk-bag chain-of-custody from the supplier, sock-loading or dense-packing technique, layer-by-layer level surveys, and post-load nitrogen-blanketed close-out. Performed by an inspector working under the catalyst-vendor procedure.',
    'chemical_process', true
  ),
  (
    'batch_records_gmp_audit_specialty_chemical',
    'Batch Records & GMP Audit (FDA 21 CFR Part 211)',
    'GMP / Batch Records',
    'global', 12, 320000, 'cci_advanced',
    'Audit of completed manufacturing batch records, deviation reports, and CAPA closure against US FDA 21 CFR Part 211 (cGMP for finished pharmaceuticals) or the relevant ICH Q7 chapters for active pharmaceutical ingredients. Suitable for specialty-chemical and pharmaceutical-intermediate sites under FDA inspection.',
    'chemical_process', true
  ),
  (
    'piping_class_break_audit_b31_3',
    'Piping Class Break + Material Trace Audit (ASME B31.3)',
    'Piping Material Trace',
    'global', 36, 240000, 'cci_advanced',
    'Field audit of piping class-break locations and material-of-construction trace on a process unit per ASME B31.3 §M300. Confirms every pipe spool, fitting, and valve matches the piping line list and PMI of any alloy-specific runs. Identifies any class-break mis-locations (e.g. carbon-steel spool installed in an alloy-spec line) and produces an MOC item if found.',
    'chemical_process', true
  ),
  (
    'reactor_internals_post_turnaround_inspection',
    'Reactor Internals Post-Turnaround Inspection',
    'Reactor Internals',
    'global', 60, 480000, 'cci_advanced',
    'Post-turnaround internal inspection of a fixed-bed or fluidised-bed reactor. Covers refractory condition (where present), internal grid / distributor / collector condition, scallop and centerpipe condition, gasket-seat surfaces, and confirmation of catalyst-bed levelness pre-loading. Includes confined-space entry coordination and inert-atmosphere oversight.',
    'chemical_process', true
  ),
  (
    'process_safety_information_audit',
    'Process Safety Information Audit (PSM §1910.119(d))',
    'Process Safety Information',
    'global', 36, 350000, 'cci_advanced',
    'Audit of the site Process Safety Information per OSHA PSM Element 3 (1910.119(d)). Covers chemicals (SDS, reactivity, corrosivity), technology (PFDs, max intended inventory, process chemistry), and equipment (P&IDs, material of construction, ventilation, safety system design basis, RAGAGEP compliance). Output is the PSI gap register and supports the broader PSM compliance audit.',
    'chemical_process', true
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
-- 3) Evidence requirements (123 rows across the 15 templates)
-- ─────────────────────────────────────────────────────────────────────

DELETE FROM public.inspection_evidence_requirements
 WHERE template_id IN (
   SELECT id FROM public.inspection_scope_templates
    WHERE slug IN (
      'psm_compliance_audit_osha_1910_119',
      'mechanical_integrity_program_audit',
      'pha_hazop_facilitation',
      'psv_pop_test_campaign_api_576',
      'heat_exchanger_turnaround_inspection',
      'ldar_method_21_quarterly_campaign',
      'distillation_column_internals_inspection',
      'hazardous_area_classification_audit_iec_60079',
      'sis_proof_testing_iec_61511',
      'epa_rmp_compliance_audit',
      'catalyst_loading_unloading_qc',
      'batch_records_gmp_audit_specialty_chemical',
      'piping_class_break_audit_b31_3',
      'reactor_internals_post_turnaround_inspection',
      'process_safety_information_audit'
    )
 );

INSERT INTO public.inspection_evidence_requirements (
  template_id, sort_order, kind, label, hint, required, min_count, max_count
)
SELECT t.id, e.sort_order, e.kind::public.compliance_evidence_kind,
       e.label, e.hint, e.required, e.min_count, e.max_count
  FROM (VALUES

    -- ── psm_compliance_audit_osha_1910_119 (9 rows) ──
    ('psm_compliance_audit_osha_1910_119',  0, 'document_upload',  'Audit plan + 14-element checklist',
       'Approved audit plan tied to the 14 PSM elements per 1910.119(a)-(o).',                    true, 1, 2),
    ('psm_compliance_audit_osha_1910_119', 10, 'document_upload',  'PSI completeness review',
       'PSI gap register per Element 3 (1910.119(d)).',                                            true, 1, 1),
    ('psm_compliance_audit_osha_1910_119', 20, 'document_upload',  'PHA register + revalidation status',
       'Per-process PHA register with revalidation dates (5-year max).',                          true, 1, 2),
    ('psm_compliance_audit_osha_1910_119', 30, 'document_upload',  'Operating procedure currency review',
       'Per-unit operating procedure version, annual certification status.',                       true, 1, 4),
    ('psm_compliance_audit_osha_1910_119', 40, 'document_upload',  'Training records + competency proof',
       'Initial + refresher training per 1910.119(g).',                                             true, 1, 4),
    ('psm_compliance_audit_osha_1910_119', 50, 'document_upload',  'MoC + PSSR register',
       'MoC log with PSSR closure references per Element 11.',                                     true, 1, 2),
    ('psm_compliance_audit_osha_1910_119', 60, 'rep_interview',     'Field worker / contractor interviews',
       'Brief interviews verifying training awareness and procedure access.',                      true, 4, 20),
    ('psm_compliance_audit_osha_1910_119', 70, 'document_upload',  'Audit findings + corrective-action register',
       'Findings ranked by significance with target closure dates.',                              true, 1, 1),
    ('psm_compliance_audit_osha_1910_119', 80, 'signed_statement', 'Lead auditor sign-off',
       'Knowledgeable-person auditor statement per 1910.119(o).',                                  true, 1, 1),

    -- ── mechanical_integrity_program_audit (8 rows) ──
    ('mechanical_integrity_program_audit',  0, 'document_upload',  'Equipment criticality register',
       'Criticality / consequence ranking per equipment item in scope.',                          true, 1, 2),
    ('mechanical_integrity_program_audit', 10, 'document_upload',  'Inspection plan + frequency basis',
       'Per-equipment inspection plan with frequency justification (RBI / RP).',                  true, 1, 2),
    ('mechanical_integrity_program_audit', 20, 'document_upload',  'Inspector qualification records',
       'API 510 / 570 / 653 / NACE certifications on file.',                                       true, 1, 4),
    ('mechanical_integrity_program_audit', 30, 'document_upload',  'Recent inspection report sample',
       'Representative report set vs. inspection plan.',                                            true, 1, 10),
    ('mechanical_integrity_program_audit', 40, 'document_upload',  'Deficiency closure register',
       'Open / closed deficiencies with target dates and MoC linkages.',                           true, 1, 2),
    ('mechanical_integrity_program_audit', 50, 'document_upload',  'Test + inspection procedure currency',
       'Procedure index showing review cycle in date.',                                            true, 1, 2),
    ('mechanical_integrity_program_audit', 60, 'rep_interview',     'MI engineer interview',
       'MI engineer walkthrough of the program structure and KPIs.',                              true, 1, 2),
    ('mechanical_integrity_program_audit', 70, 'signed_statement', 'Auditor sign-off',
       'Auditor statement with credential reference.',                                              true, 1, 1),

    -- ── pha_hazop_facilitation (8 rows) ──
    ('pha_hazop_facilitation',  0, 'document_upload',  'PHA scope + node list',
       'Approved scope with the node / section boundaries.',                                       true, 1, 2),
    ('pha_hazop_facilitation', 10, 'document_upload',  'Team roster + qualifications',
       'Roster with operations, engineering, process safety roles.',                                true, 1, 1),
    ('pha_hazop_facilitation', 20, 'document_upload',  'PHA worksheet (HAZOP / what-if)',
       'Full worksheet with deviations, causes, consequences, safeguards.',                        true, 1, 1),
    ('pha_hazop_facilitation', 30, 'document_upload',  'LOPA where credited',
       'Layer of Protection Analysis for any SIL-credited functions.',                              false, 0, 4),
    ('pha_hazop_facilitation', 40, 'document_upload',  'Recommendation register',
       'Final recommendation list with ranking, target closure, accountable owner.',                true, 1, 1),
    ('pha_hazop_facilitation', 50, 'document_upload',  'PHA closure / report',
       'Signed final PHA report.',                                                                  true, 1, 1),
    ('pha_hazop_facilitation', 60, 'rep_interview',     'Team consensus minutes',
       'Sign-off minutes acknowledging team consensus on the worksheet.',                          true, 1, 2),
    ('pha_hazop_facilitation', 70, 'signed_statement', 'Facilitator sign-off',
       'Certified facilitator statement with credential reference.',                                true, 1, 1),

    -- ── psv_pop_test_campaign_api_576 (8 rows) ──
    ('psv_pop_test_campaign_api_576',  0, 'document_upload',  'PSV register + as-found settings',
       'Per-PSV tag, set pressure, last test date, capacity.',                                      true, 1, 1),
    ('psv_pop_test_campaign_api_576', 10, 'photo',            'PSV pre-test condition photos',
       'Inlet/outlet flange condition, body corrosion, nameplate.',                                 true, 2, 60),
    ('psv_pop_test_campaign_api_576', 20, 'document_upload',  'Test-bench calibration',
       'Test-stand pressure gauge calibration certificate in date.',                                 true, 1, 1),
    ('psv_pop_test_campaign_api_576', 30, 'document_upload',  'Per-PSV pop-test record',
       'Set pressure, simmer, full pop, blowdown, seat-tightness leakage class.',                  true, 1, 30),
    ('psv_pop_test_campaign_api_576', 40, 'photo',            'Internal teardown photos',
       'Internal condition, seat, disc, spring, where teardown is performed.',                      false, 0, 60),
    ('psv_pop_test_campaign_api_576', 50, 'document_upload',  'Re-installation tag / data report',
       'VR data-report or shop-traveler attached to each repaired PSV.',                            true, 1, 30),
    ('psv_pop_test_campaign_api_576', 60, 'photo',            'Post-installation seal photos',
       'Field photos of each PSV reinstalled with tamper seal in place.',                           true, 1, 30),
    ('psv_pop_test_campaign_api_576', 70, 'signed_statement', 'Test technician sign-off',
       'NB VR / API SIRE technician credential reference.',                                          true, 1, 1),

    -- ── heat_exchanger_turnaround_inspection (9 rows) ──
    ('heat_exchanger_turnaround_inspection',  0, 'photo',            'Exchanger nameplate + tag photos',
       'TEMA designation, design pressure / temperature, tube count.',                              true, 1, 4),
    ('heat_exchanger_turnaround_inspection', 10, 'photo',            'Pre-cleaning shell-side condition',
       'Internal photos as-pulled showing fouling extent.',                                          true, 2, 16),
    ('heat_exchanger_turnaround_inspection', 20, 'photo',            'Post-cleaning condition',
       'Internal condition after hydrojetting / chemical cleaning.',                                 true, 4, 24),
    ('heat_exchanger_turnaround_inspection', 30, 'document_upload',  'Channel head + tubesheet visual',
       'Tubesheet ligament condition, partition-plate condition, gasket-face condition.',           true, 1, 4),
    ('heat_exchanger_turnaround_inspection', 40, 'document_upload',  'Eddy current / IRIS tube report',
       'Per-tube indications with wall-loss percentage and plug recommendations.',                  true, 1, 4),
    ('heat_exchanger_turnaround_inspection', 50, 'document_upload',  'Tube plug / re-tube plan',
       'Plug count / location and any retubing requirement.',                                       true, 1, 2),
    ('heat_exchanger_turnaround_inspection', 60, 'document_upload',  'Hydrostatic test record',
       'Post-reassembly hydro at 1.5× design with pressure-time chart.',                            true, 1, 2),
    ('heat_exchanger_turnaround_inspection', 70, 'photo',            'Re-installation photos',
       'Bonneted / installed photos with new gaskets visible.',                                     true, 2, 12),
    ('heat_exchanger_turnaround_inspection', 80, 'signed_statement', 'Inspector sign-off',
       'API 510 inspector statement with credential number, fitness-for-service summary.',          true, 1, 1),

    -- ── ldar_method_21_quarterly_campaign (8 rows) ──
    ('ldar_method_21_quarterly_campaign',  0, 'document_upload',  'Component population list',
       'Per-component tag, type, service category for the audit scope.',                            true, 1, 2),
    ('ldar_method_21_quarterly_campaign', 10, 'document_upload',  'Analyser calibration record',
       'Pre- and post-campaign calibration with the calibration gas record.',                       true, 1, 4),
    ('ldar_method_21_quarterly_campaign', 20, 'document_upload',  'Per-component screening results',
       'PPM / OGI screening per component with timestamp.',                                          true, 1, 4),
    ('ldar_method_21_quarterly_campaign', 30, 'document_upload',  'Leak tag log',
       'Tagged leaks with leak-definition concentration and component class.',                       true, 1, 4),
    ('ldar_method_21_quarterly_campaign', 40, 'document_upload',  'First-attempt repair (FAR) record',
       'Repairs attempted within 5 days per 40 CFR §60.482-7.',                                     true, 1, 4),
    ('ldar_method_21_quarterly_campaign', 50, 'document_upload',  'Final repair / DOR log',
       'Repairs completed within 15 days or DoR list per applicable subpart.',                      true, 1, 4),
    ('ldar_method_21_quarterly_campaign', 60, 'photo',            'OGI evidence (where used)',
       'Optical gas imaging stills of confirmed leaks.',                                              false, 0, 30),
    ('ldar_method_21_quarterly_campaign', 70, 'signed_statement', 'LDAR technician sign-off',
       'Method 21 / OGI competency credential reference.',                                            true, 1, 1),

    -- ── distillation_column_internals_inspection (8 rows) ──
    ('distillation_column_internals_inspection',  0, 'document_upload',  'Column drawing + tray detail',
       'Tower drawing showing every tray / packed-bed location.',                                   true, 1, 4),
    ('distillation_column_internals_inspection', 10, 'photo',            'Per-tray condition photos',
       'Each tray photographed top / bottom side.',                                                   true, 8, 80),
    ('distillation_column_internals_inspection', 20, 'document_upload',  'Tray flatness / bowing log',
       'Levelness measurements per tray vs. acceptance.',                                            true, 1, 2),
    ('distillation_column_internals_inspection', 30, 'photo',            'Bubble cap / valve / sieve condition',
       'Per-tray inserts condition (active area).',                                                  true, 4, 40),
    ('distillation_column_internals_inspection', 40, 'photo',            'Downcomer / weir condition',
       'Downcomer clearance and weir levelness.',                                                    true, 4, 24),
    ('distillation_column_internals_inspection', 50, 'photo',            'Packing / distributor condition',
       'Where packed bed: distributor levelness and packing integrity.',                              false, 0, 30),
    ('distillation_column_internals_inspection', 60, 'document_upload',  'Per-tray disposition register',
       'Replace / repair / accept disposition per tray.',                                            true, 1, 1),
    ('distillation_column_internals_inspection', 70, 'signed_statement', 'Inspector sign-off',
       'Inspector statement supporting the unit revamp / restart decision.',                          true, 1, 1),

    -- ── hazardous_area_classification_audit_iec_60079 (8 rows) ──
    ('hazardous_area_classification_audit_iec_60079',  0, 'document_upload',  'Site area classification drawing',
       'Current classification drawing covering the audited equipment scope.',                       true, 1, 4),
    ('hazardous_area_classification_audit_iec_60079', 10, 'photo',            'Per-equipment Ex nameplate photos',
       'Nameplate certificates visible (Ex d/e/i/n/m/o/p, IECEx / ATEX / UL).',                       true, 10, 200),
    ('hazardous_area_classification_audit_iec_60079', 20, 'document_upload',  'Equipment certificate register',
       'IECEx / ATEX certificate number per item with file reference.',                                true, 1, 1),
    ('hazardous_area_classification_audit_iec_60079', 30, 'photo',            'Cable gland integrity',
       'Per-item cable-gland sealing condition.',                                                       true, 4, 50),
    ('hazardous_area_classification_audit_iec_60079', 40, 'photo',            'Earthing / bonding evidence',
       'Earthing terminal connections, bonding straps.',                                                true, 4, 40),
    ('hazardous_area_classification_audit_iec_60079', 50, 'document_upload',  'Non-conformance register',
       'Per-item findings with severity and corrective action.',                                       true, 1, 1),
    ('hazardous_area_classification_audit_iec_60079', 60, 'rep_interview',     'Maintenance interview',
       'Discussion of inspection routines and Ex maintenance training.',                              true, 1, 2),
    ('hazardous_area_classification_audit_iec_60079', 70, 'signed_statement', 'IECEx CoPC sign-off',
       'IECEx CoPC Ex 01-04 (or equivalent) competency credential.',                                   true, 1, 1),

    -- ── sis_proof_testing_iec_61511 (9 rows) ──
    ('sis_proof_testing_iec_61511',  0, 'document_upload',  'SIF / SRS reference',
       'Safety Requirements Specification for each function tested.',                                 true, 1, 4),
    ('sis_proof_testing_iec_61511', 10, 'document_upload',  'Proof-test procedure',
       'Approved proof-test procedure per SIF.',                                                       true, 1, 4),
    ('sis_proof_testing_iec_61511', 20, 'document_upload',  'Bypass authorisation',
       'MoC-controlled bypass authorisation for the test window.',                                     true, 1, 4),
    ('sis_proof_testing_iec_61511', 30, 'document_upload',  'Sensor + transmitter test results',
       'Initiator test results vs. acceptance criteria.',                                              true, 1, 8),
    ('sis_proof_testing_iec_61511', 40, 'document_upload',  'Logic solver test results',
       'Logic solver / final-element output verification.',                                            true, 1, 4),
    ('sis_proof_testing_iec_61511', 50, 'document_upload',  'Final element + stroking test',
       'Valve stroking, ESDV closure time, full operational verification.',                            true, 1, 4),
    ('sis_proof_testing_iec_61511', 60, 'document_upload',  'PFDavg / SIL re-verification',
       'PFDavg calculation update + SIL claim verification.',                                          true, 1, 4),
    ('sis_proof_testing_iec_61511', 70, 'document_upload',  'Bypass removal + return-to-service',
       'Bypass removed, MoC closed, SIF returned to service.',                                         true, 1, 4),
    ('sis_proof_testing_iec_61511', 80, 'signed_statement', 'TÜV FSEng sign-off',
       'Functional Safety Engineer credential (TÜV FSEng / CFSE) reference.',                          true, 1, 1),

    -- ── epa_rmp_compliance_audit (9 rows) ──
    ('epa_rmp_compliance_audit',  0, 'document_upload',  'RMP program-level determination',
       'Program 1 / 2 / 3 determination per 40 CFR §68.10.',                                         true, 1, 1),
    ('epa_rmp_compliance_audit', 10, 'document_upload',  'Offsite consequence analysis',
       'Worst-case + alternative-release scenario modelling.',                                        true, 1, 2),
    ('epa_rmp_compliance_audit', 20, 'document_upload',  'Prevention program review',
       'PSI, PHA, operating procedures, training, mechanical integrity.',                              true, 1, 2),
    ('epa_rmp_compliance_audit', 30, 'document_upload',  'Emergency response program review',
       'Emergency response plan, training, equipment inventory.',                                      true, 1, 2),
    ('epa_rmp_compliance_audit', 40, 'document_upload',  '5-year accident history',
       'Accident register with thresholds per §68.42.',                                                true, 1, 1),
    ('epa_rmp_compliance_audit', 50, 'document_upload',  'Latest RMP submission',
       'Current RMP*eSubmit submission record.',                                                       true, 1, 2),
    ('epa_rmp_compliance_audit', 60, 'rep_interview',     'EHS lead interview',
       'EHS / process safety lead walkthrough of the program.',                                       true, 1, 2),
    ('epa_rmp_compliance_audit', 70, 'document_upload',  'Audit findings + corrective actions',
       'Per-finding ranking with target closure dates.',                                              true, 1, 1),
    ('epa_rmp_compliance_audit', 80, 'signed_statement', 'Lead auditor sign-off',
       'Knowledgeable-person auditor statement.',                                                      true, 1, 1),

    -- ── catalyst_loading_unloading_qc (8 rows) ──
    ('catalyst_loading_unloading_qc',  0, 'document_upload',  'Catalyst-vendor procedure',
       'Approved loading / unloading procedure from the catalyst vendor.',                            true, 1, 2),
    ('catalyst_loading_unloading_qc', 10, 'photo',            'Catalyst chain-of-custody photos',
       'Drum / bulk-bag receiving photos with batch identification.',                                  true, 4, 80),
    ('catalyst_loading_unloading_qc', 20, 'document_upload',  'Inert atmosphere monitoring log',
       'Continuous O2 / N2 / CO monitoring throughout the entry.',                                    true, 1, 4),
    ('catalyst_loading_unloading_qc', 30, 'document_upload',  'Breathing-air / SCBA records',
       'Daily breathing-air integrity check + air monitor calibration.',                              true, 1, 4),
    ('catalyst_loading_unloading_qc', 40, 'photo',            'Layer-level survey photos',
       'Bed-level survey photographs per layer.',                                                      true, 4, 50),
    ('catalyst_loading_unloading_qc', 50, 'document_upload',  'Layer-level survey log',
       'Calculated levelness per layer vs. acceptance.',                                              true, 1, 4),
    ('catalyst_loading_unloading_qc', 60, 'document_upload',  'Post-load nitrogen blanket log',
       'Final blanket conditions post catalyst-load.',                                                 true, 1, 2),
    ('catalyst_loading_unloading_qc', 70, 'signed_statement', 'Catalyst supervisor sign-off',
       'Catalyst supervisor + site mechanical integrity engineer co-sign.',                            true, 1, 1),

    -- ── batch_records_gmp_audit_specialty_chemical (7 rows) ──
    ('batch_records_gmp_audit_specialty_chemical',  0, 'document_upload',  'Audit scope + master records',
       'Approved audit scope tied to the master batch records reviewed.',                              true, 1, 2),
    ('batch_records_gmp_audit_specialty_chemical', 10, 'document_upload',  'Batch records sample review',
       'Per-batch records sample including yield, deviations, signatures.',                            true, 1, 30),
    ('batch_records_gmp_audit_specialty_chemical', 20, 'document_upload',  'Deviation + CAPA register',
       'Open / closed deviations and CAPA with target dates.',                                          true, 1, 2),
    ('batch_records_gmp_audit_specialty_chemical', 30, 'document_upload',  'Annual product review (where applicable)',
       'APR / PQR summary for the audit window.',                                                       false, 0, 4),
    ('batch_records_gmp_audit_specialty_chemical', 40, 'document_upload',  'Validation / qualification status',
       'IQ / OQ / PQ status of process equipment in scope.',                                            true, 1, 4),
    ('batch_records_gmp_audit_specialty_chemical', 50, 'rep_interview',     'Quality unit interview',
       'Walk-through with the site quality unit lead.',                                                 true, 1, 2),
    ('batch_records_gmp_audit_specialty_chemical', 60, 'signed_statement', 'Auditor sign-off',
       'Auditor statement against 21 CFR Part 211 / ICH Q7.',                                          true, 1, 1),

    -- ── piping_class_break_audit_b31_3 (7 rows) ──
    ('piping_class_break_audit_b31_3',  0, 'document_upload',  'Piping line list + class breaks',
       'Approved line list with material specification per line.',                                     true, 1, 2),
    ('piping_class_break_audit_b31_3', 10, 'document_upload',  'Marked-up isometrics / P&IDs',
       'Walkdown markup showing class-break verifications.',                                            true, 1, 8),
    ('piping_class_break_audit_b31_3', 20, 'photo',            'Spool stencil photos',
       'Per-spool stencil photos with heat-number / material visible.',                                true, 8, 80),
    ('piping_class_break_audit_b31_3', 30, 'document_upload',  'PMI readings log',
       'XRF results on alloy-spec runs.',                                                              true, 1, 4),
    ('piping_class_break_audit_b31_3', 40, 'document_upload',  'Non-conformance register',
       'Mis-installed spool list with MoC linkage.',                                                    false, 0, 4),
    ('piping_class_break_audit_b31_3', 50, 'document_upload',  'Audit closure register',
       'Open / closed items with target dates.',                                                        true, 1, 1),
    ('piping_class_break_audit_b31_3', 60, 'signed_statement', 'API 570 inspector sign-off',
       'API 570 inspector credential reference.',                                                       true, 1, 1),

    -- ── reactor_internals_post_turnaround_inspection (9 rows) ──
    ('reactor_internals_post_turnaround_inspection',  0, 'document_upload',  'Reactor design drawing',
       'Internal-arrangement drawings showing grid, distributor, internals.',                          true, 1, 4),
    ('reactor_internals_post_turnaround_inspection', 10, 'gps_pin',          'GPS pin at reactor',
       'Single pin at the reactor location for the audit trail.',                                      true, 1, 1),
    ('reactor_internals_post_turnaround_inspection', 20, 'photo',            'Internal-condition photos',
       'Multi-angle internal photos top to bottom.',                                                    true, 10, 80),
    ('reactor_internals_post_turnaround_inspection', 30, 'document_upload',  'Refractory condition map',
       'Where applicable: refractory thickness mapping vs. baseline.',                                  false, 0, 4),
    ('reactor_internals_post_turnaround_inspection', 40, 'photo',            'Distributor + scallop condition',
       'Per-component condition photos with damage close-ups.',                                         true, 4, 40),
    ('reactor_internals_post_turnaround_inspection', 50, 'document_upload',  'Gasket-seat condition mapping',
       'Sealing-surface condition map for the head + manway.',                                          true, 1, 4),
    ('reactor_internals_post_turnaround_inspection', 60, 'document_upload',  'Pre-loading levelness survey',
       'Internal levelness survey supporting catalyst-bed loading.',                                    true, 1, 2),
    ('reactor_internals_post_turnaround_inspection', 70, 'rep_interview',     'Inert-entry coordinator interview',
       'Confirm O2-monitoring + breathing-air supply procedure was followed.',                          true, 1, 2),
    ('reactor_internals_post_turnaround_inspection', 80, 'signed_statement', 'API 510 inspector sign-off',
       'API 510 inspector statement with fitness-for-service summary.',                                 true, 1, 1),

    -- ── process_safety_information_audit (8 rows) ──
    ('process_safety_information_audit',  0, 'document_upload',  'PSI scope + element checklist',
       'PSI audit scope per 1910.119(d)(1)(2)(3).',                                                   true, 1, 1),
    ('process_safety_information_audit', 10, 'document_upload',  'Chemical hazard inventory + SDS',
       'Highly hazardous chemical inventory + current SDS coverage.',                                  true, 1, 4),
    ('process_safety_information_audit', 20, 'document_upload',  'Process chemistry + PFDs',
       'Process chemistry documentation + current PFDs.',                                              true, 1, 8),
    ('process_safety_information_audit', 30, 'document_upload',  'P&IDs + as-built verification',
       'P&IDs reviewed for as-built accuracy; redline samples.',                                       true, 1, 12),
    ('process_safety_information_audit', 40, 'document_upload',  'Equipment design basis',
       'MoC, ventilation, safety system, design code (RAGAGEP).',                                       true, 1, 4),
    ('process_safety_information_audit', 50, 'document_upload',  'PSI gap register',
       'Identified gaps with severity and corrective actions.',                                         true, 1, 1),
    ('process_safety_information_audit', 60, 'rep_interview',     'Process engineering interview',
       'Process engineering walkthrough confirming PSI ownership.',                                     true, 1, 2),
    ('process_safety_information_audit', 70, 'signed_statement', 'Auditor sign-off',
       'Auditor statement against 1910.119(d).',                                                        true, 1, 1)

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
   WHERE domain = 'chemical_process' AND is_active = true;

  SELECT count(*) INTO req_count
    FROM public.inspection_evidence_requirements r
    JOIN public.inspection_scope_templates t ON t.id = r.template_id
   WHERE t.domain = 'chemical_process';

  SELECT array_length(default_specialty_groups, 1) INTO group_count
    FROM public.inspection_domains WHERE slug = 'chemical_process';

  RAISE NOTICE 'Phase 5 (chemical_process) post-state:';
  RAISE NOTICE '  default_specialty_groups: % (expect 4)', group_count;
  RAISE NOTICE '  scope templates:          % (expect >= 15)', tmpl_count;
  RAISE NOTICE '  evidence requirements:    % (expect >= 123)', req_count;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Confirm default_specialty_groups has 4 entries:
--      SELECT slug, default_specialty_groups
--        FROM public.inspection_domains
--       WHERE slug = 'chemical_process';
--
-- 2) Confirm 15 scope templates:
--      SELECT slug, name, base_price_cents, requires_credential_tier
--        FROM public.inspection_scope_templates
--       WHERE domain = 'chemical_process'
--       ORDER BY slug;
--
-- 3) Evidence row count by template:
--      SELECT t.slug, count(r.*) AS req_count
--        FROM public.inspection_scope_templates t
--   LEFT JOIN public.inspection_evidence_requirements r ON r.template_id = t.id
--       WHERE t.domain = 'chemical_process'
--    GROUP BY t.slug ORDER BY t.slug;
-- ─────────────────────────────────────────────────────────────────────
