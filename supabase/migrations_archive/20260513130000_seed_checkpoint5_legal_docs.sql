-- =============================================================================
-- NEXPEC Checkpoint 5 — Seed the 9 Country Addenda + DPA + Order Form
--
-- Builds on top of 20260513120000_create_legal_documents.sql. The table,
-- RLS policies, and Tier-1/2/3 seed rows already exist; this migration
-- adds metadata rows for the Checkpoint 5 documents so the
-- acceptance-tracking join (legal_document_acceptances → legal_documents)
-- remains intact for the new docs.
--
-- Bodies for these docs ship with the app bundle (src/legal/bodies.ts);
-- the body_md column carries a placeholder.
-- =============================================================================

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
