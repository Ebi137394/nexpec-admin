-- ════════════════════════════════════════════════════════════════════════════
--  20260801564000_restore_squash_lost_catalog_seeds.sql
--
--  Follow-up to 20260801560000 (Engineering Tools restore). A systematic sweep
--  of every table the ARCHIVED migrations seeded (72 tables) against live
--  Staging counts found three more squash-lost CATALOG seeds — reference data
--  a feature needs to render, as opposed to runtime rows users create:
--
--    • supplier_capability_catalog — 12-row capability taxonomy; LIVE readers
--      on web (lib/data/marketplace.ts) and mobile (useSupplierEcosystem):
--      an empty catalog renders an empty capability picker.
--    • platform_settings — the 'global' singleton row. Writers self-heal it
--      (fee-schedule RPC inserts on demand) but readers before the first
--      admin write saw no row.
--    • legal_documents — the checkpoint-5 legal registry rows (no runtime
--      reader — mobile bundles the bodies — but the registry of record
--      belongs in the database).
--
--  Everything below is copied VERBATIM from the archived sources; all inserts
--  are idempotent. Tables that are legitimately empty (runtime data such as
--  transactions, wallets, disputes, flash_reports, report_templates …) were
--  reviewed and deliberately NOT seeded.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.supplier_capability_catalog (key,label,category,sort) VALUES
 ('ndt_lab','NDT Laboratory','testing',10),
 ('calibration_lab','Calibration Laboratory','testing',20),
 ('material_testing','Material / Mechanical Testing','testing',30),
 ('equipment_rental','Equipment Rental','equipment',40),
 ('equipment_sales','Equipment Sales','equipment',50),
 ('consumables','Welding / NDT Consumables','materials',60),
 ('raw_materials','Raw Materials & Alloys','materials',70),
 ('coating_services','Coating & Surface Treatment','services',80),
 ('heat_treatment','Heat Treatment','services',90),
 ('inspection_agency','Third-Party Inspection','services',100),
 ('logistics','Logistics & Freight','services',110),
 ('training','Training & Certification','services',120)
ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, category=EXCLUDED.category, sort=EXCLUDED.sort;

-- ── 4) RFQ + quotes ──

INSERT INTO public.platform_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.legal_documents
    (id, version, language, title, tier, role, plain_english_summary, incorporates, status)
VALUES
    -- ───── Country Addenda (tier 0; framework-overlay) ─────
    ('ADDENDUM-CA-001', '1.0', 'en', 'Country Addendum — Canada', 0, NULL,
     'Canada overlay: Bill 96 French versions, Law 25 + PIPEDA, Quebec consumer-protection forum carve-out, CASL.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    ('ADDENDUM-EU-001', '1.0', 'en', 'Country Addendum — European Union / EEA', 0, NULL,
     'EU/EEA overlay: GDPR Article 28 + SCCs Module Two, EU Platform-to-Business Regulation, 14-day right of withdrawal, Brussels I bis consumer-jurisdiction. EU Rep required before activation.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    ('ADDENDUM-UK-001', '1.0', 'en', 'Country Addendum — United Kingdom', 0, NULL,
     'UK overlay: UK GDPR + IDTA in lieu of SCCs, UK Consumer Rights Act, UK worker-status reservation with indemnity hook. UK Rep required before activation.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    ('ADDENDUM-US-001', '1.0', 'en', 'Country Addendum — United States', 0, NULL,
     'US multi-state overlay: CCPA/CPRA/VCDPA/CPA/CTDPA/UCPA, California ABC test reservation, class-action + mass-action waivers, optional binding arbitration.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    ('ADDENDUM-GCC-001', '1.0', 'en', 'Country Addendum — GCC (KSA, UAE, Qatar)', 0, NULL,
     'GCC overlay: KSA PDPL + UAE PDPL + Qatar PDPPL, Arabic-version mandate (KSA), Sharia overlay on interest/penalties, anti-corruption representations.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    ('ADDENDUM-JP-001', '1.0', 'en', 'Country Addendum — Japan', 0, NULL,
     'Japan overlay: APPI cross-border under PPC-Canada adequacy, Subcontracting Act reservation, Japanese-language consumer pack, JCT via Stripe Tax.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    ('ADDENDUM-KR-001', '1.0', 'en', 'Country Addendum — South Korea', 0, NULL,
     'South Korea overlay: PIPA with mandatory local representative above thresholds, Korean platform-worker classification reservation, Korean consumer pack, K-VAT.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    ('ADDENDUM-IN-001', '1.0', 'en', 'Country Addendum — India', 0, NULL,
     'India overlay: DPDP Act 2023, IT Act 2000 intermediary safe-harbour with Grievance Officer, GST + OIDAR via Stripe Tax, CPA 2019 consumer forum carve-out.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    ('ADDENDUM-CN-001', '1.0', 'en', 'Country Addendum — China (scaffold-only)', 0, NULL,
     'China overlay (NOT-FOR-ACTIVATION). PIPL + CSL + DSL high-friction regime; PRC Foreign Investment Negative List; signup-time gating enforced by marketGating.ts.',
     '[{"id":"ADDENDUM-FRAMEWORK-001","version":"1.0"}]'::jsonb, 'draft'),

    -- ───── Enterprise Templates (tier 2; org role) ─────
    ('DPA-001', '1.0', 'en', 'Data Processing Addendum', 2, 'organization',
     'Controller-processor DPA. GDPR Article 28 + UK GDPR + Law 25 + PIPEDA. SCCs Module Two by reference. 60-day deletion-or-return election window.',
     '[{"id":"TOS-001","version":"1.0"},{"id":"PRIV-001","version":"1.0"},{"id":"ORG-AGR-001","version":"1.0"}]'::jsonb,
     'draft'),

    ('ORDER-FORM-001', '1.0', 'en', 'Enterprise Order Form (Template)', 2, 'organization',
     'Fill-in-the-blank Order Form. Overrides Master Stack on PFT discount, payment terms, SLA, data residency, dispute forum. No prejudice to end-user mandatory rights.',
     '[{"id":"ORG-AGR-001","version":"1.0"},{"id":"DPA-001","version":"1.0"}]'::jsonb,
     'draft')
ON CONFLICT (id, version, language) DO NOTHING;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.supplier_capability_catalog WHERE is_active;
  IF n < 12 THEN RAISE EXCEPTION 'RESTORE SELFTEST: capability catalog has % rows', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE id = 'global') THEN
    RAISE EXCEPTION 'RESTORE SELFTEST: platform_settings global row missing';
  END IF;
  SELECT count(*) INTO n FROM public.legal_documents;
  IF n < 1 THEN RAISE EXCEPTION 'RESTORE SELFTEST: legal_documents registry empty'; END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
