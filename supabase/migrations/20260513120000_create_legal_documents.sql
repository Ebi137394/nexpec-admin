-- =============================================================================
-- NEXPEC Legal Document System (Checkpoint 4)
--
-- Backs the in-app rendering and acceptance audit-trail for the v1 legal stack:
--   Tier-1: TOS-001, PRIV-001, AUP-001
--   Tier-2: INSP-AGR-001, AGN-AGR-001, CLI-AGR-001, ORG-AGR-001
--   Tier-3: JOB-TPL-001, ESCROW-001
--   Framework: ADDENDUM-FRAMEWORK-001
--
-- Design notes
--   * Document bodies are shipped with the app bundle (src/legal/registry.ts);
--     this table tracks METADATA only so the audit-trail join is one query.
--   * Acceptances are append-only and version-pinned. Once a user accepts
--     (TOS-001, v1.0) that acceptance survives any future amendment of TOS-001
--     — they re-accept the new version separately.
--   * This system COEXISTS with the older `legal_consents` table (left
--     untouched) which serves a different consent flow.
-- =============================================================================

-- 1) Document registry --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.legal_documents (
    id              TEXT        NOT NULL,
    version         TEXT        NOT NULL,
    language        TEXT        NOT NULL DEFAULT 'en',
    title           TEXT        NOT NULL,
    tier            SMALLINT    NOT NULL CHECK (tier IN (0, 1, 2, 3)),
    role            TEXT        CHECK (role IN ('inspector','agency','client','organization')),
    plain_english_summary TEXT,
    body_md         TEXT        NOT NULL DEFAULT '<body shipped with app bundle>',
    incorporates    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    status          TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','superseded')),
    effective_date  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, version, language)
);

COMMENT ON TABLE  public.legal_documents IS
  'Metadata registry for NEXPEC legal documents. Body text ships with app bundle (src/legal/registry.ts).';
COMMENT ON COLUMN public.legal_documents.tier IS
  '0=Framework (e.g., addendum framework), 1=Platform-level (TOS/Privacy/AUP), 2=Role agreement, 3=Per-Job (JOB-TPL/ESCROW)';
COMMENT ON COLUMN public.legal_documents.role IS
  'NULL = universal; otherwise the role this Tier-2 agreement applies to.';

CREATE INDEX IF NOT EXISTS legal_documents_active_idx
    ON public.legal_documents (id, language)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS legal_documents_role_idx
    ON public.legal_documents (role)
    WHERE role IS NOT NULL;

-- 2) Acceptance ledger --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.legal_document_acceptances (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id        TEXT        NOT NULL,
    document_version   TEXT        NOT NULL,
    language           TEXT        NOT NULL DEFAULT 'en',
    accepted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    role_at_acceptance TEXT,
    ip_address         INET,
    user_agent         TEXT,
    -- A user accepts each (doc_id, version, language) at most once.
    UNIQUE (user_id, document_id, document_version, language)
);

COMMENT ON TABLE public.legal_document_acceptances IS
  'Append-only ledger of user acceptances of legal documents. Pin to (id, version) for audit immutability.';

CREATE INDEX IF NOT EXISTS legal_doc_acc_user_idx
    ON public.legal_document_acceptances (user_id, document_id);

CREATE INDEX IF NOT EXISTS legal_doc_acc_recent_idx
    ON public.legal_document_acceptances (user_id, accepted_at DESC);

-- 3) RLS ----------------------------------------------------------------------

ALTER TABLE public.legal_documents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_document_acceptances   ENABLE ROW LEVEL SECURITY;

-- Documents: anyone authenticated can read active or draft (drafts are visible
-- during the rollout window; flip to active = 'active' only in §4 below to
-- restrict to published rows once the v1 stack is approved).
DROP POLICY IF EXISTS legal_documents_read ON public.legal_documents;
CREATE POLICY legal_documents_read
    ON public.legal_documents
    FOR SELECT TO authenticated
    USING (status IN ('active','draft'));

-- Acceptances: a user reads and inserts ONLY their own.
DROP POLICY IF EXISTS legal_doc_acc_select_own ON public.legal_document_acceptances;
CREATE POLICY legal_doc_acc_select_own
    ON public.legal_document_acceptances
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS legal_doc_acc_insert_own ON public.legal_document_acceptances;
CREATE POLICY legal_doc_acc_insert_own
    ON public.legal_document_acceptances
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- 4) Seed the v1 stack --------------------------------------------------------
-- Body text is shipped with the app bundle (src/legal/registry.ts). The
-- body_md column carries a placeholder until you elect to centralize bodies
-- in the DB.

INSERT INTO public.legal_documents
    (id, version, language, title, tier, role, plain_english_summary, incorporates, status)
VALUES
    ('TOS-001',  '1.0', 'en', 'Master Platform Terms of Service', 1, NULL,
     'NEXPEC is a marketplace that connects Clients with Inspectors. We are a neutral platform — not an employer or inspection firm. 10% Platform Facilitation & Technology Fee on every contract.',
     '[]'::jsonb, 'draft'),

    ('PRIV-001', '1.0', 'en', 'Privacy Policy', 1, NULL,
     'We collect only what we need to run the platform. We do not sell your data. International transfers use Standard Contractual Clauses and equivalent mechanisms.',
     '[]'::jsonb, 'draft'),

    ('AUP-001',  '1.0', 'en', 'Acceptable Use Policy', 1, NULL,
     'Use NEXPEC honestly. No fake credentials, fabricated reports, off-platform circumvention, or abusive behaviour.',
     '[{"id":"TOS-001","version":"1.0"}]'::jsonb, 'draft'),

    ('INSP-AGR-001', '1.0', 'en', 'Inspector Agreement', 2, 'inspector',
     'You are an independent contractor — not a NEXPEC employee. You decide where, when, and how you work, and you carry your own insurance, training, taxes, and PPE.',
     '[{"id":"TOS-001","version":"1.0"},{"id":"PRIV-001","version":"1.0"},{"id":"AUP-001","version":"1.0"}]'::jsonb,
     'draft'),

    ('AGN-AGR-001', '1.0', 'en', 'Agency Agreement', 2, 'agency',
     'Your Agency is responsible for everyone on its roster — vetting, training, insuring, paying, and standing behind their work. NEXPEC does not vet your Inspectors.',
     '[{"id":"TOS-001","version":"1.0"},{"id":"PRIV-001","version":"1.0"},{"id":"AUP-001","version":"1.0"}]'::jsonb,
     'draft'),

    ('CLI-AGR-001', '1.0', 'en', 'Client Agreement', 2, 'client',
     'You hire Inspectors directly — NEXPEC just makes the match. NEXPEC does not warrant Inspector work. You are responsible for site safety and your hiring decisions.',
     '[{"id":"TOS-001","version":"1.0"},{"id":"PRIV-001","version":"1.0"},{"id":"AUP-001","version":"1.0"}]'::jsonb,
     'draft'),

    ('ORG-AGR-001', '1.0', 'en', 'Organization Agreement', 2, 'organization',
     'Enterprise account terms — multi-seat management, audit rights, data processing, and custom commercial Order Forms. Applies on top of the Client Agreement.',
     '[{"id":"TOS-001","version":"1.0"},{"id":"PRIV-001","version":"1.0"},{"id":"AUP-001","version":"1.0"},{"id":"CLI-AGR-001","version":"1.0"}]'::jsonb,
     'draft'),

    ('JOB-TPL-001', '1.0', 'en', 'Job Contract Template', 3, NULL,
     'The auto-generated contract between Client and Inspector for one Job. NEXPEC is not a party — we host the contract and the escrow.',
     '[{"id":"TOS-001","version":"1.0"},{"id":"INSP-AGR-001","version":"1.0"},{"id":"CLI-AGR-001","version":"1.0"},{"id":"ESCROW-001","version":"1.0"}]'::jsonb,
     'draft'),

    ('ESCROW-001', '1.0', 'en', 'Payment & Escrow Rider', 3, NULL,
     'How the money works: Client funds Stripe-managed escrow upfront. Inspector delivers. Client has 7 days to accept; auto-release after Day-3 and Day-5 reminders.',
     '[{"id":"TOS-001","version":"1.0"},{"id":"CLI-AGR-001","version":"1.0"},{"id":"INSP-AGR-001","version":"1.0"},{"id":"AGN-AGR-001","version":"1.0"},{"id":"JOB-TPL-001","version":"1.0"}]'::jsonb,
     'draft'),

    ('ADDENDUM-FRAMEWORK-001', '1.0', 'en', 'Country Addendum Framework', 0, NULL,
     'How country-specific legal overlays attach to the master stack. Quebec law applies by default; per-country addenda overlay only where mandatory local law requires it.',
     '[]'::jsonb, 'draft')
ON CONFLICT (id, version, language) DO NOTHING;
