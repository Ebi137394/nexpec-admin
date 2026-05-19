-- ============================================================================
-- Signed-docs URL on reports + application bid index for admin queue.
-- ============================================================================

BEGIN;

-- 1) Add signed-docs metadata to inspection_reports (or jobs.report_* — we
--    add to both since the project has used either at different points).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='inspection_reports' AND relnamespace='public'::regnamespace) THEN
    ALTER TABLE public.inspection_reports
      ADD COLUMN IF NOT EXISTS signed_docs_url text,
      ADD COLUMN IF NOT EXISTS signed_docs_notes text;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'inspection_reports patch: %', SQLERRM; END $$;

-- Also stash on jobs as a fallback for tenants where reports live on the
-- jobs row itself.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS report_signed_docs_url text,
  ADD COLUMN IF NOT EXISTS report_signed_docs_notes text;

-- 2) Admin needs to see the inspector's bid_amount_cents — index for fast
--    sort/filter in the admin applications surface.
CREATE INDEX IF NOT EXISTS idx_applications_bid_admin
  ON public.applications(job_id, bid_amount_cents)
  WHERE bid_amount_cents IS NOT NULL;

COMMIT;
