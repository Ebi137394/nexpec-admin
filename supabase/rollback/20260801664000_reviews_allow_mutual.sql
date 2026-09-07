-- Rollback for 20260801664000_reviews_allow_mutual.sql
--
-- Restores the legacy one-review-per-job rule on public.reviews.
--
-- NOTE what this re-breaks: UNIQUE(job_id) permits only ONE review per job in
-- total, so whichever party reviews a job first permanently locks the other
-- out, and the second party is told "You already reviewed this job." Only run
-- this if the two-sided review feature is being withdrawn.
--
-- It will FAIL if mutual reviews have been written since the drop (two rows
-- sharing a job_id). List them first:
--
--   SELECT job_id, count(*) FROM public.reviews GROUP BY 1 HAVING count(*) > 1;
--
-- reviews_job_reviewer_unique UNIQUE (job_id, reviewer_id) is unaffected by
-- this file and continues to prevent anyone reviewing the same job twice.

BEGIN;

ALTER TABLE public.reviews
  ADD CONSTRAINT unique_review_per_job UNIQUE (job_id);

COMMIT;
