-- ════════════════════════════════════════════════════════════════════════════
--  reviews-system-hotfix.sql
--  HOTFIX for reviews-system.sql
--
--  Bug: The Reviews Moderation screen (and any embedded read like
--       `select(..., reviewer:profiles!reviewer_id(...))`) failed with:
--          "Could not find a relationship between 'reviews' and
--           'profiles' in the schema cache"
--
--  Root cause: when reviews-system.sql added the generalized columns
--    reviewer_id, reviewee_id, hidden_by (all referencing profiles.id),
--    it did not declare FOREIGN KEY constraints. PostgREST resolves
--    embedded-resource joins by following declared FKs — with none
--    declared on the new columns, the embed cannot be planned.
--
--  Fix: add FK constraints to the new columns. ON DELETE NO ACTION is
--    the default and intentional — we don't auto-cascade review deletes
--    when a profile is removed; an admin should explicitly hide or
--    moderate first. hidden_by uses SET NULL since it's nullable and
--    the row should outlive its moderator's profile.
--
--  Then signal PostgREST to refresh its schema cache so the new FKs
--  become available without a Supabase restart.
--
--  Safe to re-run. Wrapped in a transaction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── reviewer_id → profiles.id ───────────────────────────────────────────
ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_reviewer_id_fkey;

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id);

-- ─── reviewee_id → profiles.id ───────────────────────────────────────────
ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_reviewee_id_fkey;

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_reviewee_id_fkey
  FOREIGN KEY (reviewee_id) REFERENCES public.profiles(id);

-- ─── hidden_by → profiles.id (nullable, SET NULL on profile delete) ──────
ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_hidden_by_fkey;

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_hidden_by_fkey
  FOREIGN KEY (hidden_by) REFERENCES public.profiles(id)
  ON DELETE SET NULL;

-- ─── Defensive: ensure job_id → jobs.id is also wired ────────────────────
-- (Almost certainly already exists from the legacy schema, but adding
-- IF NOT EXISTS via DO block keeps this hotfix self-sufficient.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'reviews'
      AND c.contype = 'f'
      AND c.conname  = 'reviews_job_id_fkey'
  ) AND NOT EXISTS (
    -- Don't add if ANY FK from reviews to jobs already exists under any name
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t  ON c.conrelid = t.oid
    JOIN pg_class rt ON c.confrelid = rt.oid
    WHERE t.relname  = 'reviews'
      AND rt.relname = 'jobs'
      AND c.contype  = 'f'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;

-- ─── Tell PostgREST to reload its schema cache ───────────────────────────
-- Supabase listens on this channel and refreshes within ~1s. Without this,
-- you'd need to restart the API. Outside the transaction so it fires
-- immediately on commit.
NOTIFY pgrst, 'reload schema';


-- ─── Verify ──────────────────────────────────────────────────────────────
-- All three new FKs should be present after the COMMIT:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.reviews'::regclass
--   AND contype  = 'f'
-- ORDER BY conname;
--
-- Then in the app: pull-to-refresh on the Reviews Moderation screen —
-- the schema-cache error should be gone and rows should load.
