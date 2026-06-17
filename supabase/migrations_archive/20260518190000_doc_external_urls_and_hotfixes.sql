-- ============================================================================
-- SPRINT 12B-HOTFIX — external_url support + repair pre-existing schema gaps
--
-- THREE FIXES IN ONE MIGRATION (idempotent):
--
-- 1. Repair `reviews` table — pre-existing baseline reviews table may have
--    been missing the columns Sprint 12E expects. CREATE TABLE IF NOT EXISTS
--    would have silently skipped the create. We backfill columns + indexes.
--
-- 2. Self-define _touch_updated_at — Sprint 10 was the only place it was
--    defined; if that migration didn't fully apply (or got rolled back),
--    every subsequent table that wired a trigger to it broke. Recreate
--    defensively.
--
-- 3. EXTERNAL_URL SUPPORT — client_documents now accepts EITHER an uploaded
--    file (file_path) OR an external link (external_url). Industrial files
--    routinely exceed 25 MB (CAD, 4K video, ZIPs); external links route to
--    Google Drive / Dropbox / OneDrive / SharePoint / S3-presigned / etc.
--
-- The same external_url pattern will be applied to `reports` (custom report
-- templates + inspector submissions) and `contracts` (custom client legal
-- packs) in their respective sprints — see commentary at the bottom.
-- ============================================================================

BEGIN;

-- ─── FIX 1: ensure _touch_updated_at exists ───────────────────────────
CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

-- ─── FIX 2: repair reviews table for Sprint 12E ───────────────────────
-- These ALTERs are no-ops if the table is already at the Sprint-12E shape.
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS job_id          uuid,
  ADD COLUMN IF NOT EXISTS reviewer_id     uuid,
  ADD COLUMN IF NOT EXISTS reviewee_id     uuid,
  ADD COLUMN IF NOT EXISTS direction       text,
  ADD COLUMN IF NOT EXISTS rating          smallint,
  ADD COLUMN IF NOT EXISTS would_recommend boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS body            text,
  ADD COLUMN IF NOT EXISTS published_at    timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT NOW();

-- Backfill published_at on rows where it might be NULL (defensive)
UPDATE public.reviews
   SET published_at = COALESCE(published_at, created_at, NOW())
 WHERE published_at IS NULL;

-- FKs — drop-then-add for idempotency
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_job_id_fkey') THEN
    ALTER TABLE public.reviews DROP CONSTRAINT reviews_job_id_fkey;
  END IF;
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_reviewer_id_fkey') THEN
    ALTER TABLE public.reviews DROP CONSTRAINT reviews_reviewer_id_fkey;
  END IF;
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_reviewee_id_fkey') THEN
    ALTER TABLE public.reviews DROP CONSTRAINT reviews_reviewee_id_fkey;
  END IF;
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_reviewee_id_fkey
    FOREIGN KEY (reviewee_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- CHECK constraints — drop-then-add for idempotency
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_direction_check') THEN
    ALTER TABLE public.reviews DROP CONSTRAINT reviews_direction_check;
  END IF;
  ALTER TABLE public.reviews
    ADD CONSTRAINT reviews_direction_check
      CHECK (direction IN ('client_to_inspector','inspector_to_client')) NOT VALID;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_rating_check') THEN
    ALTER TABLE public.reviews DROP CONSTRAINT reviews_rating_check;
  END IF;
  ALTER TABLE public.reviews
    ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5) NOT VALID;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_body_len') THEN
    ALTER TABLE public.reviews DROP CONSTRAINT reviews_body_len;
  END IF;
  ALTER TABLE public.reviews
    ADD CONSTRAINT reviews_body_len
      CHECK (body IS NULL OR char_length(body) <= 2000) NOT VALID;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_no_self') THEN
    ALTER TABLE public.reviews DROP CONSTRAINT reviews_no_self;
  END IF;
  ALTER TABLE public.reviews
    ADD CONSTRAINT reviews_no_self CHECK (reviewer_id <> reviewee_id) NOT VALID;
END $$;

-- Unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'reviews_job_id_reviewer_id_direction_key'
  ) THEN
    BEGIN
      ALTER TABLE public.reviews
        ADD CONSTRAINT reviews_job_id_reviewer_id_direction_key
          UNIQUE (job_id, reviewer_id, direction);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END;
  END IF;
END $$;

-- Indexes (now that columns exist)
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON public.reviews(reviewee_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON public.reviews(reviewer_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_job ON public.reviews(job_id);

-- ─── FIX 3a: client_documents — relax + add external_url ───────────────
ALTER TABLE public.client_documents
  ADD COLUMN IF NOT EXISTS external_url text;

-- Relax NOT NULL on file_path — a doc can now be a link instead.
ALTER TABLE public.client_documents
  ALTER COLUMN file_path DROP NOT NULL;

-- XOR-style CHECK: exactly one of (file_path, external_url) must be present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_documents_has_content') THEN
    ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_has_content;
  END IF;
  ALTER TABLE public.client_documents
    ADD CONSTRAINT client_documents_has_content
      CHECK (
        (file_path IS NOT NULL AND external_url IS NULL)
        OR
        (file_path IS NULL AND external_url IS NOT NULL)
      ) NOT VALID;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_documents_external_url_format') THEN
    ALTER TABLE public.client_documents DROP CONSTRAINT client_documents_external_url_format;
  END IF;
  ALTER TABLE public.client_documents
    ADD CONSTRAINT client_documents_external_url_format
      CHECK (external_url IS NULL OR external_url ~* '^https?://') NOT VALID;
END $$;

-- Reassert the updated_at trigger now that _touch_updated_at definitely exists.
DROP TRIGGER IF EXISTS client_documents_touch ON public.client_documents;
CREATE TRIGGER client_documents_touch
  BEFORE UPDATE ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ─── FIX 3b: re-attach inspector_documents trigger too (if it's missing) ─
-- Sprint 10 wires these triggers; recreating defensively in case any were
-- lost when _touch_updated_at went missing.
DROP TRIGGER IF EXISTS inspector_documents_touch ON public.inspector_documents;
CREATE TRIGGER inspector_documents_touch
  BEFORE UPDATE ON public.inspector_documents
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS inspector_equipment_touch ON public.inspector_equipment;
CREATE TRIGGER inspector_equipment_touch
  BEFORE UPDATE ON public.inspector_equipment
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS inspector_certifications_touch ON public.inspector_certifications;
CREATE TRIGGER inspector_certifications_touch
  BEFORE UPDATE ON public.inspector_certifications
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

COMMIT;

-- ============================================================================
-- ARCHITECTURE NOTE — external_url across the platform
-- ----------------------------------------------------------------------------
-- The (file_path XOR external_url) pattern installed here on client_documents
-- is the canonical "user-attached content" shape. Sprints 12D (Contracts) and
-- the future Reports submission flow will adopt the exact same pattern:
--
--   contracts.pdf_path           — uploaded canonical PDF
--   contracts.external_url       — link to a DocuSign / Adobe Sign envelope,
--                                  or a client-supplied URL to their own
--                                  legal pack
--   contracts CHECK: pdf_path XOR external_url
--
--   jobs.custom_report_template_path     — uploaded template (Excel/Word/PDF)
--   jobs.custom_report_template_url      — link to the client's report portal
--                                          OR a template file too large for
--                                          our 25 MB cap
--   jobs CHECK: at most one (both nullable — template is optional)
--
--   reports.file_path            — uploaded signed report PDF
--   reports.external_url         — inspector's submission via their own
--                                  storage (e.g., Dropbox-share link for
--                                  a 200 MB 4K video walk-through)
--   reports CHECK: file_path XOR external_url
--
-- All three follow the same UI pattern: a single radio toggle "Upload" vs
-- "Link", with the action branching the INSERT accordingly. The DB CHECK is
-- the source of truth on shape — actions and Zod refinements mirror it.
-- ============================================================================
