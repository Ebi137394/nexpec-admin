-- ============================================================================
-- SPRINT 12E — Two-way reviews + ratings
--
-- One `reviews` table, two directions:
--   client_to_inspector  — the client/agency/enterprise rates the inspector
--   inspector_to_client  — the inspector rates the client
--
-- Writes are RLS-gated:
--   - reviewer must be auth.uid()
--   - job must be status='completed'
--   - the (reviewer, reviewee, direction) tuple must match the job's parties
--   - one review per (job, reviewer, direction) — no double-rating
--
-- Reads are public — review counts and aggregates surface on profiles for
-- marketplace trust. A trigger keeps profiles.{rating_average, rating_count,
-- reviews_count, total_reviews, recommend_percent} atomic on every change.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  reviewer_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewee_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('client_to_inspector','inspector_to_client')),
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  would_recommend boolean NOT NULL DEFAULT true,
  body            text CHECK (body IS NULL OR char_length(body) <= 2000),
  published_at    timestamptz NOT NULL DEFAULT NOW(),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  -- One review per direction per job
  UNIQUE (job_id, reviewer_id, direction),
  -- A reviewer cannot rate themselves
  CONSTRAINT reviews_no_self CHECK (reviewer_id <> reviewee_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee
  ON public.reviews(reviewee_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer
  ON public.reviews(reviewer_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_job
  ON public.reviews(job_id);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Read: public (anonymous + authenticated). Reviews are marketplace social proof.
DROP POLICY IF EXISTS "reviews_read_public" ON public.reviews;
CREATE POLICY "reviews_read_public" ON public.reviews FOR SELECT USING (true);

-- Insert: reviewer must be auth.uid() AND the (job, direction, reviewee) tuple
-- must structurally match the job's parties AND status='completed'.
DROP POLICY IF EXISTS "reviews_insert_reviewer_completed" ON public.reviews;
CREATE POLICY "reviews_insert_reviewer_completed" ON public.reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_id
         AND j.status = 'completed'
         AND (
           (direction = 'client_to_inspector'
             AND j.client_id = auth.uid()
             AND j.assigned_inspector_id = reviewee_id)
           OR
           (direction = 'inspector_to_client'
             AND j.assigned_inspector_id = auth.uid()
             AND j.client_id = reviewee_id)
         )
    )
  );

-- No UPDATE policy — v1 reviews are immutable once written.
-- DELETE only via admin (cleanup of bad-faith reviews).
DROP POLICY IF EXISTS "reviews_delete_admin" ON public.reviews;
CREATE POLICY "reviews_delete_admin" ON public.reviews FOR DELETE
  USING (public.nx_is_admin());

-- ─── Aggregate trigger ─────────────────────────────────────────────────
-- After every review INSERT / UPDATE / DELETE, recompute the reviewee's
-- profile aggregates. Single statement, atomic.
CREATE OR REPLACE FUNCTION public._reviews_recompute_aggregates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_target uuid;
BEGIN
  v_target := COALESCE(NEW.reviewee_id, OLD.reviewee_id);
  IF v_target IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE public.profiles p SET
    rating_average = COALESCE(
      (SELECT AVG(rating)::numeric(3,2) FROM public.reviews WHERE reviewee_id = v_target),
      0
    ),
    rating_count = COALESCE(
      (SELECT COUNT(*)::int FROM public.reviews WHERE reviewee_id = v_target),
      0
    ),
    reviews_count = COALESCE(
      (SELECT COUNT(*)::int FROM public.reviews WHERE reviewee_id = v_target),
      0
    ),
    total_reviews = COALESCE(
      (SELECT COUNT(*)::int FROM public.reviews WHERE reviewee_id = v_target),
      0
    ),
    recommend_percent = COALESCE(
      (SELECT (SUM(CASE WHEN would_recommend THEN 1 ELSE 0 END) * 100
                / NULLIF(COUNT(*), 0))::int
         FROM public.reviews WHERE reviewee_id = v_target),
      0
    )
   WHERE id = v_target;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS reviews_aggregate ON public.reviews;
CREATE TRIGGER reviews_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public._reviews_recompute_aggregates();

-- ─── Convenience RPC: can_review_job(job_id, direction) → boolean ────
-- Lets the UI decide whether to render the "Leave a review" CTA without
-- the client having to enumerate all the gating logic.
CREATE OR REPLACE FUNCTION public.can_review_job(p_job_id uuid, p_direction text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_eligible boolean := false;
  v_already boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF p_direction NOT IN ('client_to_inspector','inspector_to_client') THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job_id
       AND j.status = 'completed'
       AND (
         (p_direction = 'client_to_inspector' AND j.client_id = v_uid)
         OR
         (p_direction = 'inspector_to_client' AND j.assigned_inspector_id = v_uid)
       )
  ) INTO v_eligible;

  IF NOT v_eligible THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.reviews
     WHERE job_id = p_job_id
       AND reviewer_id = v_uid
       AND direction = p_direction
  ) INTO v_already;

  RETURN NOT v_already;
END $$;

GRANT EXECUTE ON FUNCTION public.can_review_job(uuid, text) TO authenticated;

COMMIT;
