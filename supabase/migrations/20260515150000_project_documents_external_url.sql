-- ============================================================================
--  20260515150000_project_documents_external_url.sql
--
--  Docs Tab — External Link support for project_documents
--
--  WHY:
--    Clients, agencies, and inspectors need to attach heavy artifacts
--    (large drawings, Drone-survey videos, full DWG packages) to a job's
--    Docs tab without forcing them through our storage bucket. Today the
--    only path is to upload a file; this migration adds a parallel
--    "External Link" path (Google Drive / Dropbox / OneDrive / etc.).
--
--  WHAT THIS DOES:
--    1. Adds `document_url` (text) — the external URL pointer.
--    2. Drops NOT NULL on the file-bearing columns (file_url, file_size,
--       file_type) so a link-only row is permitted. Existing rows are
--       unaffected.
--    3. Adds a CHECK constraint: every row must point to SOMETHING —
--       either an uploaded file (file_url) or an external link
--       (document_url). At least one of the two must be non-null.
--    4. Sanity check: document_url, if present, must look like an
--       http(s) URL.
--
--  IDEMPOTENT — safe to re-run.
-- ============================================================================

BEGIN;

-- 1) Add the column ─────────────────────────────────────────────────────────
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS document_url text;

COMMENT ON COLUMN public.project_documents.document_url IS
  'External evidence link (Google Drive / Dropbox / OneDrive / etc.). '
  'Used when an artifact is too heavy to push through our documents bucket. '
  'A row MUST have either file_url OR document_url (not necessarily both).';

-- 2) Relax NOT NULL on the file-bearing columns only when they actually are NOT NULL
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['file_url', 'file_size', 'file_type']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'project_documents'
         AND column_name  = col
         AND is_nullable  = 'NO'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.project_documents ALTER COLUMN %I DROP NOT NULL',
        col
      );
    END IF;
  END LOOP;
END $$;

-- 3) Invariant: at least one evidence pointer must be populated ────────────
ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_has_pointer;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_has_pointer
  CHECK (file_url IS NOT NULL OR document_url IS NOT NULL);

-- 4) URL format sanity check ────────────────────────────────────────────────
ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_url_http;

ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_url_http
  CHECK (document_url IS NULL OR document_url ~* '^https?://');

-- 5) Partial index for "external link" filtering ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_documents_external
  ON public.project_documents (job_id)
  WHERE document_url IS NOT NULL;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
-- SELECT column_name, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'project_documents'
--    AND column_name IN ('file_url', 'file_size', 'file_type', 'document_url');
--
-- Expected: all four YES (nullable). Existing rows continue to satisfy the
-- CHECK constraint because file_url is populated for every legacy row.
-- ============================================================================
