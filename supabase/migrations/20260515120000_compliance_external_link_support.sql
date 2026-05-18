-- ============================================================================
--  20260515120000_compliance_external_link_support.sql
--
--  Compliance Mode — External Evidence Link support
--
--  WHY:
--    Suppliers often have artifacts too heavy to push through our storage
--    bucket — large facility-survey PDFs, multi-page TÜV/SGS audit reports
--    hosted on Google Drive / Dropbox / OneDrive, certified videos, etc.
--    Forcing them to re-upload everything into our `compliance` bucket
--    creates friction and burns storage quota for evidence we don't need
--    to retain ourselves.
--
--  WHAT THIS DOES:
--    Adds `document_url` (text) to public.compliance_documents so a row
--    can reference an external link INSTEAD of a storage_path. Existing
--    rows are unaffected. A row is valid if AT LEAST ONE of
--    (storage_path, document_url) is non-null.
--
--  DOWNSTREAM:
--    - generate-vca Edge Function emits an `is_external_evidence` flag
--      + the URL into the canonical VCA payload.
--    - The HTML affidavit template renders a "External" badge + clickable
--      link for external rows, "Uploaded" + signed-URL for storage rows.
--    - The buyer post-flow gets a new UI affordance to attach a URL.
-- ============================================================================

BEGIN;

-- 1) Add document_url column ───────────────────────────────────────────────
ALTER TABLE public.compliance_documents
  ADD COLUMN IF NOT EXISTS document_url text;

COMMENT ON COLUMN public.compliance_documents.document_url IS
  'External evidence link (e.g. Google Drive / Dropbox / OneDrive / video host). '
  'Use this when the artifact is too heavy for our compliance bucket. '
  'A row MUST have either storage_path OR document_url (not necessarily both).';

-- 2) Make storage_path nullable so external-only rows can exist ────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'compliance_documents'
       AND column_name  = 'storage_path'
       AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.compliance_documents
      ALTER COLUMN storage_path DROP NOT NULL;
  END IF;
END $$;

-- 3) Invariant: at least one evidence pointer must be populated ────────────
ALTER TABLE public.compliance_documents
  DROP CONSTRAINT IF EXISTS compliance_documents_has_pointer;

ALTER TABLE public.compliance_documents
  ADD CONSTRAINT compliance_documents_has_pointer
  CHECK (storage_path IS NOT NULL OR document_url IS NOT NULL);

-- 4) Sanity: document_url, if present, must look like an http(s) URL ───────
ALTER TABLE public.compliance_documents
  DROP CONSTRAINT IF EXISTS compliance_documents_url_http;

ALTER TABLE public.compliance_documents
  ADD CONSTRAINT compliance_documents_url_http
  CHECK (document_url IS NULL OR document_url ~* '^https?://');

-- 5) Index for "external evidence" filtering on the verify page summary ───
CREATE INDEX IF NOT EXISTS idx_docs_external
  ON public.compliance_documents (job_id)
  WHERE document_url IS NOT NULL;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
-- SELECT column_name, is_nullable, data_type
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'compliance_documents'
--    AND column_name IN ('storage_path','document_url');
--
-- Expected:
--   storage_path  YES  text
--   document_url  YES  text
-- ============================================================================
