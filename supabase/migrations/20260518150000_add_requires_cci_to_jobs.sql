-- ============================================================================
-- ADD requires_cci FLAG TO jobs — simple contract for "this job needs a
-- CCI-certified inspector". Replaces the heavier compliance-mode foundation
-- approach (inspection_type ENUM + scope_template_id FK + claimed_address_text)
-- for the web flow — one boolean per job, default false.
--
-- Reads:
--   - Inspector feed can filter by requires_cci AND inspector's verified CCI.
--   - Admin dispatch surface can route requires_cci=true jobs to the CCI queue.
--   - Client UI surfaces the flag back in the job detail header.
--
-- Writes:
--   - Client job-post form (Sprint 12 hotfix) writes the boolean.
--   - Admin can flip it during moderation if needed.
-- ============================================================================

BEGIN;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS requires_cci BOOLEAN NOT NULL DEFAULT false;

-- Partial index keeps the row count tiny — only the CCI-flagged subset is
-- indexed, so the index is cheap to maintain and instant to filter against.
CREATE INDEX IF NOT EXISTS idx_jobs_requires_cci_true
  ON public.jobs (requires_cci, created_at DESC)
  WHERE requires_cci = true;

COMMENT ON COLUMN public.jobs.requires_cci IS
  'When true, this job requires a CCI-certified inspector. Set by the client at post time, overridable by admin during moderation.';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. Column exists with correct type + default:
--      SELECT column_name, data_type, column_default, is_nullable
--        FROM information_schema.columns
--        WHERE table_schema = 'public'
--          AND table_name   = 'jobs'
--          AND column_name  = 'requires_cci';
--      -- Expected: boolean | false | NO
-- 2. Index installed:
--      SELECT indexname FROM pg_indexes
--        WHERE schemaname = 'public'
--          AND tablename  = 'jobs'
--          AND indexname  = 'idx_jobs_requires_cci_true';
-- 3. Existing rows backfilled to false:
--      SELECT COUNT(*) FROM public.jobs WHERE requires_cci IS NULL;
--      -- Expected: 0
-- ============================================================================
