-- ════════════════════════════════════════════════════════════════════════════
--  20260801664000_reviews_allow_mutual.sql
--
--  P1 — public.reviews carries TWO uniqueness rules that contradict each other,
--  and the stricter one makes the two-way review feature impossible.
--
--      reviews_job_reviewer_unique   UNIQUE (job_id, reviewer_id)   <- correct
--      unique_review_per_job         UNIQUE (job_id)                <- legacy
--
--  The product is explicitly two-sided: a client reviews the inspector and the
--  inspector reviews the client, and the read layer models exactly that —
--  lib/data/reviews.ts derives a `direction` per row from reviewer_role_snap,
--  and lib/actions/reviews.ts validates direction as
--  'client_to_inspector' | 'inspector_to_client'. Its header comment even says
--  "only one per direction".
--
--  UNIQUE(job_id) permits only ONE review per job in total, so whichever party
--  reviews first permanently locks the other out. Proven on Production
--  (rolled back): inserting the client's review of a job succeeded; the
--  inspector's review of the SAME job was rejected with
--      23505 duplicate key value violates unique constraint "unique_review_per_job"
--  The action maps 23505 to "You already reviewed this job." — so the second
--  party is told they already reviewed a job they have never reviewed.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Drop the legacy constraint. reviews_job_reviewer_unique already enforces the
--  real rule — one review per job PER REVIEWER — so the invariant that matters
--  (nobody reviews the same job twice) is unchanged.
--
--  ── WHY THIS IS SAFE ───────────────────────────────────────────────────────
--   • Dropping a UNIQUE constraint only ever PERMITS rows; it cannot corrupt or
--     delete anything. No data is read, written or removed by this migration.
--   • public.reviews holds ZERO rows on Production (the web write path has been
--     broken since it shipped — see 20260801664000's companion fix in
--     apps/web/src/lib/actions/reviews.ts), so there is no existing data whose
--     validity could depend on the dropped rule.
--   • The narrower, correct constraint stays in place and is NOT touched.
--   • Reversible: recreating it is a one-line ALTER, recorded in
--     supabase/rollback/20260801664000_reviews_allow_mutual.sql.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Guard: refuse to run if the correct constraint is not present, so this can
-- never leave the table with NO per-reviewer uniqueness at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.reviews'::regclass
       AND conname  = 'reviews_job_reviewer_unique'
  ) THEN
    RAISE EXCEPTION
      'reviews_job_reviewer_unique is missing; refusing to drop unique_review_per_job';
  END IF;
END $$;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS unique_review_per_job;

COMMIT;
