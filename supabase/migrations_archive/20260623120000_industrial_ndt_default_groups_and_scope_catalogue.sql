-- ════════════════════════════════════════════════════════════════════════════
--  20260623120000_industrial_ndt_default_groups_and_scope_catalogue.sql
--
--  PHASE 1 — Industrial & NDT domain content fleshing.
--
--  WHAT THIS DOES
--  ──────────────
--  1. Expands inspection_domains.default_specialty_groups for industrial_ndt
--     to include 'Welding & joining' and 'Piping & pipelines'. The original
--     seed (20260616120000_inspection_domain_primitive.sql) listed 10 groups
--     but missed these two even though both are core to industrial NDT work
--     (most NDT is performed on welds; API 570 piping inspection is one of
--     the largest job categories).
--
--  2. Seeds 10 canonical scope templates in inspection_scope_templates,
--     covering the most common industrial-NDT job types:
--
--       1. api_653_external_tank_inspection      — API 653 AST external
--       2. api_510_pressure_vessel_external      — API 510 vessel external
--       3. api_570_piping_external               — API 570 piping external
--       4. cwi_visual_weld_inspection            — AWS D1.1 visual welding
--       5. paut_pressure_piping_weld_scan        — Phased Array UT welds
--       6. rt_radiography_pipeline_girth_welds   — Pipeline girth weld RT
--       7. mt_pt_critical_weld_inspection        — MT/PT surface NDT
--       8. nace_cip_coating_inspection           — NACE CIP coating audit
--       9. pmi_alloy_verification_piping         — XRF PMI alloy verify
--      10. rbi_walkdown_data_collection          — API 580/581 RBI walkdown
--
--  3. Seeds inspection_evidence_requirements for each scope template — the
--     structured evidence items inspectors collect on site (photos, GPS
--     pins, signed statements, documents, etc.).
--
--  IDEMPOTENCY
--  ───────────
--    • default_specialty_groups update is full-array replacement (re-runs
--      land the identical array).
--    • Scope templates use INSERT … ON CONFLICT (slug) DO UPDATE so the
--      content is refreshed but the row identity (and any FK references
--      from existing jobs) is preserved.
--    • Evidence requirements DELETE the existing set for these 10
--      templates and re-INSERT from a single VALUES list. This keeps the
--      seed list as the source of truth and avoids drift if rows are
--      edited via the admin UI in the future. (If you intentionally add
--      bespoke requirements through the UI, do it on a DIFFERENT template
--      slug or this migration will overwrite them on re-run.)
--
--  WHAT THIS DOES NOT DO
--  ─────────────────────
--    • Does NOT touch any other inspection_domains row (civil, electrical,
--      mechanical, chemical untouched — they get their own per-domain
--      Phase 2-5 commits).
--    • Does NOT modify is_launched for industrial_ndt (already true).
--    • Does NOT introduce new schemas, types, or RLS policies.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Expand default_specialty_groups
-- Add Welding & joining + Piping & pipelines to the existing 10.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.inspection_domains
   SET default_specialty_groups = ARRAY[
         'NDT methods',
         'API standards',
         'Welding & joining',
         'Piping & pipelines',
         'Coatings & corrosion',
         'Pressure equipment & boilers',
         'Storage tanks',
         'Oil & gas — upstream',
         'Oil & gas — downstream / process',
         'Marine & offshore',
         'Quality, safety & systems',
         'Special domains'
       ]::text[],
       updated_at = now()
 WHERE slug = 'industrial_ndt';

-- ─────────────────────────────────────────────────────────────────────
-- 2) Scope template catalogue (10 rows)
-- All rows are tagged with domain='industrial_ndt' so the future
-- domain-aware scope picker can filter them. base_price_cents are
-- USD reference prices the admin can override per market.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.inspection_scope_templates (
  slug, name, category, region, validity_months, base_price_cents,
  requires_credential_tier, description_md, domain, is_active
) VALUES
  (
    'api_653_external_tank_inspection',
    'API 653 External AST Inspection',
    'Above-ground storage tank inspection',
    'global', 60, 450000, 'cci_advanced',
    'External (out-of-service or in-service) inspection of an above-ground welded steel storage tank per API 653 §6. Includes shell UT thickness mapping, bottom-edge settlement survey, roof condition assessment, foundation/anchor-bolt walk, and cathodic-protection readings. Authorised inspector must hold a current API 653 certification.',
    'industrial_ndt', true
  ),
  (
    'api_510_pressure_vessel_external',
    'API 510 Pressure Vessel External Inspection',
    'Pressure vessel inspection',
    'global', 60, 180000, 'cci_advanced',
    'External in-service inspection of an ASME Section VIII pressure vessel per API 510 §6. Covers nameplate verification, external visual condition, insulation / CUI examination, support and foundation condition, relief device verification, and external UT thickness readings on accessible courses.',
    'industrial_ndt', true
  ),
  (
    'api_570_piping_external',
    'API 570 Process Piping External Inspection',
    'Process piping inspection',
    'global', 60, 220000, 'cci_advanced',
    'External inspection of in-service process piping circuits per API 570 §6 / §7. Includes walkdown against the ISO drawing, support condition, coating and insulation condition, TML thickness readings at established CMLs, and review of any in-service damage indications (leaks, staining, vibration).',
    'industrial_ndt', true
  ),
  (
    'cwi_visual_weld_inspection',
    'AWS D1.1 Visual Weld Inspection (CWI)',
    'Welding inspection',
    'global', 12, 85000, 'cci_basic',
    'Visual examination of structural and pressure welding per AWS D1.1 / D1.5 by a Certified Welding Inspector. Pre-, in-process, and post-weld visual acceptance with WPS / PQR verification. Suitable for construction punch-list weld sign-off and turnaround weld witness.',
    'industrial_ndt', true
  ),
  (
    'paut_pressure_piping_weld_scan',
    'Phased Array UT — Pressure Piping Welds',
    'Advanced NDT',
    'global', 12, 350000, 'cci_advanced',
    'Phased-array ultrasonic inspection of full-penetration pressure-piping welds per ASME BPVC Sec. V Art. 4 / API 1104 Annex. Inspector must hold a current PCN PAUT or ASNT Level II PAUT certification. Includes scan plan, calibration verification, raw data archival, and an interpretation report.',
    'industrial_ndt', true
  ),
  (
    'rt_radiography_pipeline_girth_welds',
    'Radiography — Pipeline Girth Welds',
    'NDT — Radiography',
    'global', 12, 280000, 'cci_advanced',
    'Radiographic inspection of cross-country pipeline girth welds per API 1104 §11 (radiographic acceptance). Includes radiation safety survey, IQI sensitivity verification, image archival (film or CR/DR), and a radiographic interpretation report. Inspector must hold a current ASNT Level II RT certification.',
    'industrial_ndt', true
  ),
  (
    'mt_pt_critical_weld_inspection',
    'Magnetic Particle / Liquid Penetrant — Critical Welds',
    'NDT — Surface methods',
    'global', 12, 70000, 'cci_basic',
    'Surface NDT (wet/dry MT or visible/fluorescent PT) of critical welds per ASME BPVC Sec. V Art. 7 (MT) / Art. 6 (PT). Documents pre-test surface prep, indication mapping, and post-test cleanup. Inspector must hold a current ASNT Level II MT and PT certification.',
    'industrial_ndt', true
  ),
  (
    'nace_cip_coating_inspection',
    'NACE / AMPP CIP Coating Inspection',
    'Coatings inspection',
    'global', 12, 120000, 'cci_basic',
    'Protective-coating system inspection per NACE / AMPP CIP Level 2 — surface preparation acceptance (SSPC visual standards + profile / soluble salts), wet film and dry film thickness, holiday testing, and environmental conditions logging. Required on most new-construction and recoat scopes.',
    'industrial_ndt', true
  ),
  (
    'pmi_alloy_verification_piping',
    'PMI (XRF) Alloy Verification — Piping',
    'Material verification',
    'global', 36, 160000, 'cci_advanced',
    'Positive Material Identification via portable XRF on existing alloy piping per API 578. Confirms each component matches the design alloy grade; tags and reports any discrepancies. Inspector must hold a current PMI competency assessment.',
    'industrial_ndt', true
  ),
  (
    'rbi_walkdown_data_collection',
    'RBI Walkdown + Data Collection (API 580/581)',
    'Risk-based inspection',
    'global', 60, 550000, 'cci_lead',
    'On-site data collection sprint supporting a Risk-Based Inspection assessment per API 580 methodology / API 581 implementation. Captures equipment list with damage mechanisms, corrosion-circuit walkdown, CML/TML population review, and consequence-of-failure interview with operations. Output feeds the RBI software model. Lead-level inspector with prior RBI team experience required.',
    'industrial_ndt', true
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
-- 3) Evidence requirements for each scope template
--
-- Cleared then re-inserted so the migration is the source of truth and
-- a re-run lands the exact same set. If you customise an evidence row
-- through the admin UI, do it on a DIFFERENT template slug or this
-- migration will overwrite it on re-application.
-- ─────────────────────────────────────────────────────────────────────

DELETE FROM public.inspection_evidence_requirements
 WHERE template_id IN (
   SELECT id FROM public.inspection_scope_templates
    WHERE slug IN (
      'api_653_external_tank_inspection',
      'api_510_pressure_vessel_external',
      'api_570_piping_external',
      'cwi_visual_weld_inspection',
      'paut_pressure_piping_weld_scan',
      'rt_radiography_pipeline_girth_welds',
      'mt_pt_critical_weld_inspection',
      'nace_cip_coating_inspection',
      'pmi_alloy_verification_piping',
      'rbi_walkdown_data_collection'
    )
 );

INSERT INTO public.inspection_evidence_requirements (
  template_id, sort_order, kind, label, hint, required, min_count, max_count
)
SELECT t.id, e.sort_order, e.kind::public.compliance_evidence_kind,
       e.label, e.hint, e.required, e.min_count, e.max_count
  FROM (VALUES

    -- ── api_653_external_tank_inspection (7 rows) ──
    ('api_653_external_tank_inspection',  0, 'photo',            'Tank nameplate photo',
       'Capture make, ID, design pressure, year of manufacture, working temperature.', true, 1, 4),
    ('api_653_external_tank_inspection', 10, 'gps_pin',          'GPS pin at tank centre',
       'Drop a pin at the geometric centre of the tank shell.',                       true, 1, 1),
    ('api_653_external_tank_inspection', 20, 'photo',            'External shell condition photos',
       '360° photo walk: minimum one photo per shell course per cardinal direction.', true, 16, 64),
    ('api_653_external_tank_inspection', 30, 'document_upload',  'Shell UT thickness map',
       'Spreadsheet or PDF of UT readings keyed to the standard grid.',               true, 1, 4),
    ('api_653_external_tank_inspection', 40, 'photo',            'Bottom-edge settlement photos',
       'Photographic survey of the tank-to-foundation interface, evenly spaced.',     true, 8, 24),
    ('api_653_external_tank_inspection', 50, 'document_upload',  'Cathodic protection readings',
       'Last 12 months of CP test station readings if available.',                    false, 0, 4),
    ('api_653_external_tank_inspection', 60, 'signed_statement', 'API 653 inspector certification',
       'Statement of certification number, expiration, and finding summary.',         true, 1, 1),

    -- ── api_510_pressure_vessel_external (6 rows) ──
    ('api_510_pressure_vessel_external',  0, 'photo',            'Vessel nameplate photo',
       'Nameplate must be legible in full.',                                          true, 1, 2),
    ('api_510_pressure_vessel_external', 10, 'gps_pin',          'GPS pin at vessel',
       'One pin at vessel location.',                                                 true, 1, 1),
    ('api_510_pressure_vessel_external', 20, 'photo',            'External condition photos',
       'Multiple angles of shell, heads, nozzles, supports.',                          true, 8, 32),
    ('api_510_pressure_vessel_external', 30, 'document_upload',  'External UT thickness readings',
       'Course-by-course thickness readings keyed to the inspection map.',            true, 1, 4),
    ('api_510_pressure_vessel_external', 40, 'photo',            'Insulation / CUI inspection photos',
       'Areas inspected for corrosion under insulation.',                              true, 4, 16),
    ('api_510_pressure_vessel_external', 50, 'signed_statement', 'API 510 inspector statement',
       'Certification number, expiration, recommended next inspection interval.',     true, 1, 1),

    -- ── api_570_piping_external (6 rows) ──
    ('api_570_piping_external',  0, 'document_upload',  'Marked-up ISO drawing',
       'Walkdown markup of the piping isometric showing TMLs visited.',               true, 1, 4),
    ('api_570_piping_external', 10, 'photo',            'Walkdown photos at each TML',
       'One representative photo per thickness measurement location.',                true, 8, 50),
    ('api_570_piping_external', 20, 'document_upload',  'TML thickness readings',
       'Spreadsheet of UT readings paired with the ISO TML IDs.',                     true, 1, 2),
    ('api_570_piping_external', 30, 'photo',            'Support condition photos',
       'Anchor, guide, spring-hanger condition.',                                     true, 4, 20),
    ('api_570_piping_external', 40, 'photo',            'Coating / insulation condition',
       'Photos showing any coating breakdown, CUI risk, or wet insulation.',           true, 4, 20),
    ('api_570_piping_external', 50, 'signed_statement', 'API 570 inspector statement',
       'Certification number, expiration, finding summary.',                          true, 1, 1),

    -- ── cwi_visual_weld_inspection (5 rows) ──
    ('cwi_visual_weld_inspection',  0, 'document_upload',  'WPS / PQR reference',
       'Welding procedure spec for the joint being inspected.',                       true, 1, 4),
    ('cwi_visual_weld_inspection', 10, 'photo',            'Pre-weld fitup photo',
       'Joint preparation, root gap, alignment.',                                     true, 1, 8),
    ('cwi_visual_weld_inspection', 20, 'photo',            'In-process welding photo',
       'Heat-affected zone, interpass condition.',                                    false, 0, 8),
    ('cwi_visual_weld_inspection', 30, 'photo',            'Completed weld close-up',
       'Cap, toe, undercut visibility.',                                              true, 2, 8),
    ('cwi_visual_weld_inspection', 40, 'signed_statement', 'CWI sign-off',
       'AWS CWI number, expiration, acceptance per applicable code.',                 true, 1, 1),

    -- ── paut_pressure_piping_weld_scan (6 rows) ──
    ('paut_pressure_piping_weld_scan',  0, 'document_upload',  'Scan plan',
       'Approved PAUT scan plan including focal law, wedge, probe specs.',            true, 1, 2),
    ('paut_pressure_piping_weld_scan', 10, 'photo',            'Calibration block setup',
       'Calibration block, probe, wedge in position.',                                true, 2, 4),
    ('paut_pressure_piping_weld_scan', 20, 'document_upload',  'Calibration sheet',
       'Sensitivity, TCG, wedge-delay calibration record.',                           true, 1, 1),
    ('paut_pressure_piping_weld_scan', 30, 'document_upload',  'Raw scan data files',
       'A-scan / S-scan / strip-chart export per weld.',                              true, 1, 50),
    ('paut_pressure_piping_weld_scan', 40, 'photo',            'Defect indication evidence',
       'Photo of marked-up weld map plus screenshot of indication.',                  false, 0, 20),
    ('paut_pressure_piping_weld_scan', 50, 'document_upload',  'Interpretation report',
       'Final report with PCN/ASNT PAUT certification number.',                       true, 1, 1),

    -- ── rt_radiography_pipeline_girth_welds (6 rows) ──
    ('rt_radiography_pipeline_girth_welds',  0, 'document_upload',  'Weld map',
       'Sequential weld map showing each girth weld and station.',                    true, 1, 1),
    ('rt_radiography_pipeline_girth_welds', 10, 'document_upload',  'IQI sensitivity record',
       'IQI type, hole / wire visibility per shot.',                                  true, 1, 4),
    ('rt_radiography_pipeline_girth_welds', 20, 'document_upload',  'Radiograph images',
       'Film scans or digital exposures, one set per weld.',                          true, 1, 100),
    ('rt_radiography_pipeline_girth_welds', 30, 'document_upload',  'Radiation safety survey',
       'Daily survey-meter log and dosimetry records.',                               true, 1, 30),
    ('rt_radiography_pipeline_girth_welds', 40, 'document_upload',  'Interpretation report',
       'Per-weld disposition (accept/reject) keyed to the weld map.',                 true, 1, 1),
    ('rt_radiography_pipeline_girth_welds', 50, 'signed_statement', 'ASNT Level II RT statement',
       'Certification number, expiration, interpretation summary.',                   true, 1, 1),

    -- ── mt_pt_critical_weld_inspection (5 rows) ──
    ('mt_pt_critical_weld_inspection',  0, 'photo',            'Pre-test surface prep',
       'Cleaned weld surface before applicant medium / yoke.',                        true, 1, 8),
    ('mt_pt_critical_weld_inspection', 10, 'photo',            'Indication photos',
       'Any linear / rounded indications under the applicable method.',               false, 0, 16),
    ('mt_pt_critical_weld_inspection', 20, 'photo',            'Post-test cleanup',
       'Surface returned to acceptable condition.',                                   true, 1, 4),
    ('mt_pt_critical_weld_inspection', 30, 'text_input',        'Technique / procedure reference',
       'Procedure number and acceptance code.',                                       true, 1, 1),
    ('mt_pt_critical_weld_inspection', 40, 'signed_statement', 'Level II MT/PT statement',
       'ASNT certification number, expiration, accept/reject summary.',               true, 1, 1),

    -- ── nace_cip_coating_inspection (6 rows) ──
    ('nace_cip_coating_inspection',  0, 'photo',            'Surface preparation photo',
       'Final blast profile reference shows SSPC SP-grade meeting spec.',             true, 1, 8),
    ('nace_cip_coating_inspection', 10, 'document_upload',  'Environmental conditions log',
       'Temp / humidity / dewpoint at intervals throughout coating window.',          true, 1, 4),
    ('nace_cip_coating_inspection', 20, 'document_upload',  'DFT readings log',
       'Per-area dry-film-thickness measurements vs. spec.',                          true, 1, 4),
    ('nace_cip_coating_inspection', 30, 'photo',            'Holiday detector setup',
       'Detector type, voltage setting, calibration verification.',                   true, 1, 2),
    ('nace_cip_coating_inspection', 40, 'document_upload',  'Coating system data sheets',
       'Product TDS / safety data sheets for each layer applied.',                    true, 1, 6),
    ('nace_cip_coating_inspection', 50, 'signed_statement', 'NACE / AMPP CIP statement',
       'Certification number, expiration, final acceptance.',                         true, 1, 1),

    -- ── pmi_alloy_verification_piping (5 rows) ──
    ('pmi_alloy_verification_piping',  0, 'photo',            'XRF instrument calibration',
       'Calibration block reading at start of campaign.',                             true, 1, 2),
    ('pmi_alloy_verification_piping', 10, 'photo',            'Per-component PMI photo',
       'Photo of each component with XRF tag visible.',                               true, 5, 200),
    ('pmi_alloy_verification_piping', 20, 'document_upload',  'PMI readings log',
       'Component ID, design grade, measured composition, accept/reject.',            true, 1, 2),
    ('pmi_alloy_verification_piping', 30, 'document_upload',  'Discrepancy report',
       'Required only if any non-conforming components found.',                       false, 0, 4),
    ('pmi_alloy_verification_piping', 40, 'signed_statement', 'PMI competency statement',
       'Operator competency assessment number and expiration.',                       true, 1, 1),

    -- ── rbi_walkdown_data_collection (7 rows) ──
    ('rbi_walkdown_data_collection',  0, 'document_upload',  'Unit equipment list',
       'Spreadsheet of equipment items in the RBI scope.',                            true, 1, 1),
    ('rbi_walkdown_data_collection', 10, 'document_upload',  'Damage mechanism tagging',
       'Per-equipment damage mechanisms identified during walkdown.',                 true, 1, 1),
    ('rbi_walkdown_data_collection', 20, 'document_upload',  'Corrosion circuit drawings',
       'Marked-up P&ID excerpts showing corrosion-circuit boundaries.',               true, 1, 8),
    ('rbi_walkdown_data_collection', 30, 'document_upload',  'CML / TML population review',
       'Existing CML/TML coverage assessment with proposed additions.',               true, 1, 4),
    ('rbi_walkdown_data_collection', 40, 'rep_interview',     'Operations consequence-of-failure interview',
       'Brief from operations on consequence rationale per equipment.',               true, 1, 4),
    ('rbi_walkdown_data_collection', 50, 'photo',            'Unit overview photos',
       'Plot-plan-level photos to anchor the equipment list.',                        true, 8, 40),
    ('rbi_walkdown_data_collection', 60, 'signed_statement', 'Lead inspector statement',
       'Lead-level inspector statement of completeness.',                             true, 1, 1)

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
   WHERE domain = 'industrial_ndt' AND is_active = true;

  SELECT count(*) INTO req_count
    FROM public.inspection_evidence_requirements r
    JOIN public.inspection_scope_templates t ON t.id = r.template_id
   WHERE t.domain = 'industrial_ndt';

  SELECT array_length(default_specialty_groups, 1) INTO group_count
    FROM public.inspection_domains WHERE slug = 'industrial_ndt';

  RAISE NOTICE 'Phase 1 (industrial_ndt) post-state:';
  RAISE NOTICE '  default_specialty_groups: % (expect 12)', group_count;
  RAISE NOTICE '  scope templates:          % (expect >= 10)', tmpl_count;
  RAISE NOTICE '  evidence requirements:    % (expect >= 59)', req_count;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Confirm default_specialty_groups now has 12 entries:
--      SELECT slug, default_specialty_groups
--        FROM public.inspection_domains
--       WHERE slug = 'industrial_ndt';
--
-- 2) Confirm 10 scope templates:
--      SELECT slug, name, category, base_price_cents, requires_credential_tier
--        FROM public.inspection_scope_templates
--       WHERE domain = 'industrial_ndt'
--       ORDER BY slug;
--
-- 3) Confirm 59 evidence requirement rows (one count below; spot-check one
--    template):
--      SELECT t.slug, count(r.*) AS req_count
--        FROM public.inspection_scope_templates t
--   LEFT JOIN public.inspection_evidence_requirements r ON r.template_id = t.id
--       WHERE t.domain = 'industrial_ndt'
--    GROUP BY t.slug
--    ORDER BY t.slug;
-- ─────────────────────────────────────────────────────────────────────
