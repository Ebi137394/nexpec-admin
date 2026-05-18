-- ════════════════════════════════════════════════════════════════════════════
--  reviews-system.sql
--  NEXPEC — Premium Review & Reputation Engine (Patch 1 / v1)
--
--  Minimalist data model (per architectural decision):
--    • One overall rating (1-5)
--    • Free-text comment
--    • is_public toggle
--    • private_admin_note channel
--    • Two-way: Inspector ↔ Client / Agency / Enterprise
--    • No sub-categories, no would_recommend in NEW code (legacy columns
--      kept on the table for back-compat with 5 deprecated rating UIs; the
--      new RPC ignores them; they'll be dropped in a follow-up migration).
--
--  Architecture:
--    • Additive schema migration — `reviews` table is generalized via
--      reviewer_id/reviewee_id + snapshot columns. Legacy inspector_id /
--      client_id columns are preserved and auto-populated by a BEFORE
--      INSERT trigger so old code keeps working through the transition.
--    • Trigger-based weighted-average reputation recompute fires on
--      every INSERT / UPDATE / DELETE — `profiles.rating_average` and
--      `profiles.rating_count` are always current; no client-side scans.
--    • Weighting constants live in `review_weights_config` (key/value)
--      so the formula is tunable via SQL without code changes.
--    • Two RPCs: submit_review (gatekeeped — completion required) and
--      moderate_review (admin only).
--    • RLS: admin sees all; reviewer sees own; reviewee sees about-them
--      when visible; public sees is_public+visible. Private admin note
--      is column-masked via the `reviews_public` view for non-admins.
--    • Audit trigger from Phase 5 attaches to `reviews` — every
--      moderation action shows in the Audit Trail automatically.
--
--  Safe to re-run. Wrapped in a transaction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — WEIGHTING CONFIG (DB-driven, hot-tunable)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.review_weights_config (
  key        text PRIMARY KEY,
  value      numeric NOT NULL,
  notes      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.review_weights_config IS
  'Tunable constants for compute_review_weight(). Admin can adjust via SQL UPDATE without a code change.';

-- Seed defaults. ON CONFLICT keeps existing values intact on re-run.
INSERT INTO public.review_weights_config (key, value, notes) VALUES
  ('base_weight',                  1.0, 'Starting weight for every review'),
  ('verified_multiplier',          1.5, 'Multiplier when reviewer.is_verified = true'),
  ('jobs_count_tier_1_min',        1,   'Threshold for tier 1 (>=1 completed jobs)'),
  ('jobs_count_tier_1_multiplier', 1.0, 'Multiplier for reviewers with 1-2 completed jobs'),
  ('jobs_count_tier_2_min',        3,   'Threshold for tier 2 (>=3 completed jobs)'),
  ('jobs_count_tier_2_multiplier', 1.2, 'Multiplier for reviewers with 3-9 completed jobs'),
  ('jobs_count_tier_3_min',        10,  'Threshold for tier 3 (>=10 completed jobs)'),
  ('jobs_count_tier_3_multiplier', 1.5, 'Multiplier for reviewers with 10+ completed jobs'),
  ('no_jobs_multiplier',           0.5, 'Multiplier for brand-new reviewers (0 completed jobs)'),
  ('role_multiplier_client',       1.0, 'Role multiplier for clients'),
  ('role_multiplier_agency',       1.0, 'Role multiplier for agencies'),
  ('role_multiplier_enterprise',   1.2, 'Role multiplier for enterprise reviewers'),
  ('role_multiplier_inspector',    1.0, 'Role multiplier for inspectors')
ON CONFLICT (key) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — SCHEMA: ADDITIVE ALTERS ON `reviews`
-- ════════════════════════════════════════════════════════════════════════════
-- Existing columns kept as-is for back-compat with legacy UIs:
--   id, job_id, client_id, inspector_id, rating, comment, is_public,
--   would_recommend (deprecated — ignored by new code), tags (deprecated),
--   created_at.
--
-- New columns are nullable initially; backfilled in Section 3; then we
-- promote them to NOT NULL in Section 4.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reviewer_id              uuid,
  ADD COLUMN IF NOT EXISTS reviewee_id              uuid,
  ADD COLUMN IF NOT EXISTS reviewer_role_snap       text,
  ADD COLUMN IF NOT EXISTS reviewee_role_snap       text,
  ADD COLUMN IF NOT EXISTS reviewer_verified_snap   boolean,
  ADD COLUMN IF NOT EXISTS reviewer_jobs_count_snap integer,
  ADD COLUMN IF NOT EXISTS weight                   numeric(5,3),
  ADD COLUMN IF NOT EXISTS moderation_status        text,
  ADD COLUMN IF NOT EXISTS hidden_at                timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by                uuid,
  ADD COLUMN IF NOT EXISTS moderator_notes          text,
  ADD COLUMN IF NOT EXISTS private_admin_note       text;

COMMENT ON COLUMN public.reviews.reviewer_id IS
  'Generalized reviewer (replaces legacy semantics where client_id was always the reviewer). Reviewer can be the inspector OR the client/agency/enterprise.';
COMMENT ON COLUMN public.reviews.reviewee_id IS
  'Generalized reviewee. The OTHER party to the job.';
COMMENT ON COLUMN public.reviews.reviewer_role_snap IS
  'Snapshot of reviewer''s role at write time. Used for weighting and survives later role changes.';
COMMENT ON COLUMN public.reviews.weight IS
  'Anti-fraud / quality weighting. Computed at write time by compute_review_weight() so retroactive reviewer changes do not rewrite history.';
COMMENT ON COLUMN public.reviews.moderation_status IS
  'visible | hidden | disputed | flagged. Only ''visible'' reviews count toward reputation.';
COMMENT ON COLUMN public.reviews.private_admin_note IS
  'Strictly internal feedback channel. Masked from non-admin SELECTs by reviews_public view.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — BACKFILL LEGACY ROWS
-- ════════════════════════════════════════════════════════════════════════════
-- Legacy assumption: every existing row was client_id reviewing inspector_id.

UPDATE public.reviews
SET
  reviewer_id              = COALESCE(reviewer_id, client_id),
  reviewee_id              = COALESCE(reviewee_id, inspector_id),
  reviewer_role_snap       = COALESCE(reviewer_role_snap, 'client'),
  reviewee_role_snap       = COALESCE(reviewee_role_snap, 'inspector'),
  reviewer_verified_snap   = COALESCE(reviewer_verified_snap, false),
  reviewer_jobs_count_snap = COALESCE(reviewer_jobs_count_snap, 0),
  weight                   = COALESCE(weight, 1.0),
  moderation_status        = COALESCE(moderation_status, 'visible')
WHERE reviewer_id IS NULL
   OR reviewee_id IS NULL
   OR weight IS NULL
   OR moderation_status IS NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — CONSTRAINTS + DEFAULTS
-- ════════════════════════════════════════════════════════════════════════════

-- Make new columns NOT NULL now that backfill is done.
ALTER TABLE public.reviews
  ALTER COLUMN reviewer_id              SET NOT NULL,
  ALTER COLUMN reviewee_id              SET NOT NULL,
  ALTER COLUMN reviewer_role_snap       SET NOT NULL,
  ALTER COLUMN reviewee_role_snap       SET NOT NULL,
  ALTER COLUMN reviewer_verified_snap   SET NOT NULL,
  ALTER COLUMN reviewer_jobs_count_snap SET NOT NULL,
  ALTER COLUMN weight                   SET NOT NULL,
  ALTER COLUMN moderation_status        SET NOT NULL;

-- Defaults for future direct inserts that omit them (legacy fallback).
ALTER TABLE public.reviews
  ALTER COLUMN moderation_status        SET DEFAULT 'visible',
  ALTER COLUMN weight                   SET DEFAULT 1.0,
  ALTER COLUMN reviewer_verified_snap   SET DEFAULT false,
  ALTER COLUMN reviewer_jobs_count_snap SET DEFAULT 0,
  ALTER COLUMN reviewer_role_snap       SET DEFAULT 'client',
  ALTER COLUMN reviewee_role_snap       SET DEFAULT 'inspector';

-- CHECK constraints (drop-and-recreate so this file is idempotent).
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_rating_range_check;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_rating_range_check
  CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_no_self_review_check;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_no_self_review_check
  CHECK (reviewer_id <> reviewee_id);

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_moderation_status_check;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_moderation_status_check
  CHECK (moderation_status IN ('visible', 'hidden', 'disputed', 'flagged'));

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_role_snap_check;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_role_snap_check
  CHECK (
    reviewer_role_snap IN ('client', 'agency', 'enterprise', 'inspector')
    AND reviewee_role_snap IN ('client', 'agency', 'enterprise', 'inspector')
  );


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — UNIQUE CONSTRAINT (one review per party per job)
-- ════════════════════════════════════════════════════════════════════════════
-- Drop common legacy unique-constraint names if present; then add the new
-- canonical one. Because the new constraint is on (job_id, reviewer_id),
-- the two-way case works: inspector_id-as-reviewer and client_id-as-reviewer
-- have different reviewer_id values.

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_job_id_client_id_key;
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_job_client_unique;
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS unique_job_client_review;
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_job_reviewer_unique;

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_job_reviewer_unique UNIQUE (job_id, reviewer_id);


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — INDEXES
-- ════════════════════════════════════════════════════════════════════════════
-- Profile reputation queries: "all visible reviews ABOUT user X, newest first".
CREATE INDEX IF NOT EXISTS reviews_reviewee_visible_idx
  ON public.reviews (reviewee_id, created_at DESC)
  WHERE moderation_status = 'visible';

-- "All reviews this user has written" (for their account history view).
CREATE INDEX IF NOT EXISTS reviews_reviewer_idx
  ON public.reviews (reviewer_id, created_at DESC);

-- Admin moderation queue: hidden/disputed/flagged surface first.
CREATE INDEX IF NOT EXISTS reviews_moderation_queue_idx
  ON public.reviews (moderation_status, created_at DESC)
  WHERE moderation_status <> 'visible';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — WEIGHT FUNCTION (reads config table)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_review_weight(
  p_verified   boolean,
  p_jobs_count integer,
  p_role       text
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_base          numeric;
  v_verified_mult numeric;
  v_role_mult     numeric;
  v_count_mult    numeric;
  v_tier3_min     numeric;
  v_tier2_min     numeric;
  v_tier1_min     numeric;
  v_tier3_mult    numeric;
  v_tier2_mult    numeric;
  v_tier1_mult    numeric;
  v_no_jobs_mult  numeric;
BEGIN
  SELECT value INTO v_base          FROM public.review_weights_config WHERE key = 'base_weight';
  SELECT value INTO v_verified_mult FROM public.review_weights_config WHERE key = 'verified_multiplier';
  SELECT value INTO v_tier3_min     FROM public.review_weights_config WHERE key = 'jobs_count_tier_3_min';
  SELECT value INTO v_tier2_min     FROM public.review_weights_config WHERE key = 'jobs_count_tier_2_min';
  SELECT value INTO v_tier1_min     FROM public.review_weights_config WHERE key = 'jobs_count_tier_1_min';
  SELECT value INTO v_tier3_mult    FROM public.review_weights_config WHERE key = 'jobs_count_tier_3_multiplier';
  SELECT value INTO v_tier2_mult    FROM public.review_weights_config WHERE key = 'jobs_count_tier_2_multiplier';
  SELECT value INTO v_tier1_mult    FROM public.review_weights_config WHERE key = 'jobs_count_tier_1_multiplier';
  SELECT value INTO v_no_jobs_mult  FROM public.review_weights_config WHERE key = 'no_jobs_multiplier';
  SELECT value INTO v_role_mult     FROM public.review_weights_config
    WHERE key = 'role_multiplier_' || COALESCE(p_role, 'client');

  v_base          := COALESCE(v_base,          1.0);
  v_verified_mult := CASE WHEN p_verified THEN COALESCE(v_verified_mult, 1.5) ELSE 1.0 END;
  v_role_mult     := COALESCE(v_role_mult,     1.0);
  v_tier3_min     := COALESCE(v_tier3_min,     10);
  v_tier2_min     := COALESCE(v_tier2_min,     3);
  v_tier1_min     := COALESCE(v_tier1_min,     1);
  v_tier3_mult    := COALESCE(v_tier3_mult,    1.5);
  v_tier2_mult    := COALESCE(v_tier2_mult,    1.2);
  v_tier1_mult    := COALESCE(v_tier1_mult,    1.0);
  v_no_jobs_mult  := COALESCE(v_no_jobs_mult,  0.5);

  IF p_jobs_count >= v_tier3_min THEN
    v_count_mult := v_tier3_mult;
  ELSIF p_jobs_count >= v_tier2_min THEN
    v_count_mult := v_tier2_mult;
  ELSIF p_jobs_count >= v_tier1_min THEN
    v_count_mult := v_tier1_mult;
  ELSE
    v_count_mult := v_no_jobs_mult;
  END IF;

  RETURN round(v_base * v_verified_mult * v_role_mult * v_count_mult, 3);
END;
$$;

COMMENT ON FUNCTION public.compute_review_weight(boolean, integer, text) IS
  'Returns the weighting multiplier for a single review based on reviewer attributes. Reads tuning constants from public.review_weights_config — adjust via SQL UPDATE for hot-tunable behavior.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — REPUTATION RECOMPUTE
-- ════════════════════════════════════════════════════════════════════════════
-- Single function: given a user_id, recompute their profiles.rating_average
-- + profiles.rating_count from the weighted, visible-only set of reviews
-- ABOUT them. Called by the AFTER trigger on reviews.
--
-- WEIGHTED FORMULA: rating_average = SUM(rating * weight) / SUM(weight)
--   • Equivalent to a regular average when every weight = 1.0.
--   • Verified high-volume reviewers carry more signal automatically.

CREATE OR REPLACE FUNCTION public.recompute_reputation(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg          numeric;
  v_count        integer;
  v_weighted_sum numeric;
  v_weight_sum   numeric;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(r.rating::numeric * r.weight), 0),
    COALESCE(SUM(r.weight), 0),
    COUNT(*)
  INTO v_weighted_sum, v_weight_sum, v_count
  FROM public.reviews r
  WHERE r.reviewee_id = p_user_id
    AND r.moderation_status = 'visible';

  IF v_weight_sum > 0 THEN
    v_avg := round(v_weighted_sum / v_weight_sum, 2);
  ELSE
    v_avg := 0;
  END IF;

  UPDATE public.profiles
  SET rating_average = v_avg,
      rating_count   = v_count
  WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.recompute_reputation(uuid) IS
  'Atomically updates profiles.rating_average + rating_count from the weighted average of VISIBLE reviews. Idempotent. Owned by postgres so it can write to profiles regardless of caller.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

-- ── 9A. BEFORE INSERT — populate generalized fields from legacy fields.
--       Keeps the 5 legacy rating UIs working through the transition.
CREATE OR REPLACE FUNCTION public.reviews_populate_generalized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Legacy insert sites only set client_id / inspector_id. Mirror them
  -- into the generalized columns when the caller didn't provide them.
  IF NEW.reviewer_id IS NULL THEN
    NEW.reviewer_id := NEW.client_id;
  END IF;
  IF NEW.reviewee_id IS NULL THEN
    NEW.reviewee_id := NEW.inspector_id;
  END IF;

  -- Make sure inspector_id / client_id reflect the actual inspector +
  -- non-inspector party for the new general case where an inspector is
  -- the REVIEWER. This keeps legacy SELECTs that filter by inspector_id
  -- = userId returning the right set of rows for that user.
  IF NEW.inspector_id IS NULL THEN
    IF NEW.reviewer_role_snap = 'inspector' THEN
      NEW.inspector_id := NEW.reviewer_id;
    ELSIF NEW.reviewee_role_snap = 'inspector' THEN
      NEW.inspector_id := NEW.reviewee_id;
    END IF;
  END IF;
  IF NEW.client_id IS NULL THEN
    IF NEW.reviewer_role_snap IN ('client', 'agency', 'enterprise') THEN
      NEW.client_id := NEW.reviewer_id;
    ELSIF NEW.reviewee_role_snap IN ('client', 'agency', 'enterprise') THEN
      NEW.client_id := NEW.reviewee_id;
    END IF;
  END IF;

  -- Defaults for the rest. The column-level DEFAULTs handle most cases;
  -- this is the safety net.
  NEW.reviewer_role_snap       := COALESCE(NEW.reviewer_role_snap, 'client');
  NEW.reviewee_role_snap       := COALESCE(NEW.reviewee_role_snap, 'inspector');
  NEW.reviewer_verified_snap   := COALESCE(NEW.reviewer_verified_snap, false);
  NEW.reviewer_jobs_count_snap := COALESCE(NEW.reviewer_jobs_count_snap, 0);
  NEW.weight                   := COALESCE(NEW.weight, 1.0);
  NEW.moderation_status        := COALESCE(NEW.moderation_status, 'visible');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_populate_generalized_trigger ON public.reviews;
CREATE TRIGGER reviews_populate_generalized_trigger
  BEFORE INSERT ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.reviews_populate_generalized();


-- ── 9B. AFTER INSERT/UPDATE/DELETE — recompute reputation aggregates.
CREATE OR REPLACE FUNCTION public.reviews_recompute_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_reviewee uuid;
  v_new_reviewee uuid;
BEGIN
  -- Use the generalized column; legacy backfill ensures it's populated.
  v_old_reviewee := CASE WHEN TG_OP <> 'INSERT' THEN OLD.reviewee_id END;
  v_new_reviewee := CASE WHEN TG_OP <> 'DELETE' THEN NEW.reviewee_id END;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_reputation(v_old_reviewee);
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_reputation(v_new_reviewee);
  ELSE -- UPDATE
    IF v_old_reviewee IS DISTINCT FROM v_new_reviewee THEN
      PERFORM public.recompute_reputation(v_old_reviewee);
      PERFORM public.recompute_reputation(v_new_reviewee);
    ELSE
      PERFORM public.recompute_reputation(v_new_reviewee);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_recompute_trigger ON public.reviews;
CREATE TRIGGER reviews_recompute_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.reviews_recompute_trigger();


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — SUBMIT REVIEW RPC (the canonical write path)
-- ════════════════════════════════════════════════════════════════════════════
-- Gatekeeping:
--   • Reviewer must be authenticated.
--   • Reviewee must be a party to the job AND different from reviewer.
--   • Job must be status='completed' AND admin_confirmed_at IS NOT NULL
--     (NEXPEC's admin-gatekeeper model — admin sign-off required).
--   • UNIQUE(job_id, reviewer_id) blocks duplicates.
-- Computed at write time:
--   • Reviewer role / verification / completed-jobs-count snapshots.
--   • Weight from compute_review_weight().

CREATE OR REPLACE FUNCTION public.submit_review(
  p_job_id             uuid,
  p_reviewee_id        uuid,
  p_rating             integer,
  p_comment            text    DEFAULT NULL,
  p_is_public          boolean DEFAULT true,
  p_private_admin_note text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviewer_id          uuid;
  v_job                  public.jobs%ROWTYPE;
  v_reviewer_role        text;
  v_reviewee_role        text;
  v_reviewer_verified    boolean;
  v_reviewer_jobs        integer;
  v_weight               numeric;
  v_review_id            uuid;
  v_client_id_for_legacy uuid;
  v_inspector_id_for_legacy uuid;
BEGIN
  v_reviewer_id := auth.uid();
  IF v_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5' USING ERRCODE = '22000';
  END IF;
  IF p_reviewee_id IS NULL THEN
    RAISE EXCEPTION 'Reviewee is required' USING ERRCODE = '22000';
  END IF;
  IF v_reviewer_id = p_reviewee_id THEN
    RAISE EXCEPTION 'Cannot review yourself' USING ERRCODE = '22000';
  END IF;

  -- Load job
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = '02000';
  END IF;

  -- Strict gatekeeping: admin-confirmed completion only
  IF v_job.status <> 'completed' OR v_job.admin_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Job must be fully completed (admin-confirmed) before review' USING ERRCODE = '22000';
  END IF;

  -- Reviewer must be a party
  IF v_reviewer_id NOT IN (
    COALESCE(v_job.client_id,     '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(v_job.agency_id,     '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(v_job.contractor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION 'Only parties to the job can submit reviews' USING ERRCODE = '42501';
  END IF;

  -- Reviewee must also be a party (the OTHER party — checked via inequality above)
  IF p_reviewee_id NOT IN (
    COALESCE(v_job.client_id,     '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(v_job.agency_id,     '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(v_job.contractor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION 'Reviewee was not a party to this job' USING ERRCODE = '22000';
  END IF;

  -- Snapshot reviewer + reviewee roles + verification
  SELECT COALESCE(role, 'client'), COALESCE(is_verified, false)
    INTO v_reviewer_role, v_reviewer_verified
  FROM public.profiles WHERE id = v_reviewer_id;
  v_reviewer_role := COALESCE(v_reviewer_role, 'client');

  SELECT COALESCE(role, 'inspector') INTO v_reviewee_role
  FROM public.profiles WHERE id = p_reviewee_id;
  v_reviewee_role := COALESCE(v_reviewee_role, 'inspector');

  -- Count reviewer's completed jobs across roles (party = client OR agency OR contractor)
  SELECT COUNT(*) INTO v_reviewer_jobs
  FROM public.jobs
  WHERE status = 'completed'
    AND (
         client_id     = v_reviewer_id
      OR agency_id     = v_reviewer_id
      OR contractor_id = v_reviewer_id
    );

  v_weight := public.compute_review_weight(v_reviewer_verified, v_reviewer_jobs, v_reviewer_role);

  -- Populate legacy inspector_id / client_id based on roles.
  IF v_reviewer_role = 'inspector' THEN
    v_inspector_id_for_legacy := v_reviewer_id;
    v_client_id_for_legacy    := p_reviewee_id;
  ELSE
    v_inspector_id_for_legacy := p_reviewee_id;
    v_client_id_for_legacy    := v_reviewer_id;
  END IF;

  BEGIN
    INSERT INTO public.reviews (
      job_id,
      client_id, inspector_id,                    -- legacy mirror
      reviewer_id, reviewee_id,
      reviewer_role_snap, reviewee_role_snap,
      reviewer_verified_snap, reviewer_jobs_count_snap, weight,
      rating, comment, is_public, private_admin_note,
      moderation_status
    ) VALUES (
      p_job_id,
      v_client_id_for_legacy, v_inspector_id_for_legacy,
      v_reviewer_id, p_reviewee_id,
      v_reviewer_role, v_reviewee_role,
      v_reviewer_verified, v_reviewer_jobs, v_weight,
      p_rating,
      NULLIF(TRIM(COALESCE(p_comment, '')), ''),
      COALESCE(p_is_public, true),
      NULLIF(TRIM(COALESCE(p_private_admin_note, '')), ''),
      'visible'
    )
    RETURNING id INTO v_review_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'You have already reviewed this job' USING ERRCODE = '23505';
  END;

  RETURN v_review_id;
END;
$$;

COMMENT ON FUNCTION public.submit_review(uuid, uuid, integer, text, boolean, text) IS
  'Canonical entry point for submitting a review. Validates job completion + party membership, snapshots reviewer attributes, computes weight. Returns the new review id.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 11 — MODERATION RPC (admin only)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.moderate_review(
  p_review_id uuid,
  p_action    text,                  -- 'hide' | 'unhide' | 'dispute' | 'flag' | 'note'
  p_notes     text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid;
  v_actor_role  text;
  v_new_status  text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can moderate reviews' USING ERRCODE = '42501';
  END IF;

  v_new_status := CASE p_action
    WHEN 'hide'     THEN 'hidden'
    WHEN 'unhide'   THEN 'visible'
    WHEN 'dispute'  THEN 'disputed'
    WHEN 'flag'     THEN 'flagged'
    WHEN 'note'     THEN NULL          -- note-only: no status change
    ELSE                  NULL
  END;

  IF p_action = 'note' THEN
    IF p_notes IS NULL OR LENGTH(TRIM(p_notes)) = 0 THEN
      RAISE EXCEPTION 'Note text is required when action = ''note''' USING ERRCODE = '22000';
    END IF;
    UPDATE public.reviews
    SET moderator_notes = COALESCE(moderator_notes || E'\n---\n', '')
                       || '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] ' || p_notes
    WHERE id = p_review_id;
  ELSIF v_new_status IS NOT NULL THEN
    UPDATE public.reviews
    SET
      moderation_status = v_new_status,
      hidden_at         = CASE WHEN v_new_status = 'hidden' THEN now()    ELSE hidden_at END,
      hidden_by         = CASE WHEN v_new_status = 'hidden' THEN v_actor  ELSE hidden_by END,
      moderator_notes   = CASE WHEN p_notes IS NOT NULL
                                THEN COALESCE(moderator_notes || E'\n---\n', '')
                                   || '[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] '
                                   || p_action || ': ' || p_notes
                                ELSE moderator_notes
                               END
    WHERE id = p_review_id;
  ELSE
    RAISE EXCEPTION 'Unknown moderation action: %', p_action USING ERRCODE = '22000';
  END IF;

  -- The AFTER trigger on reviews recomputes the reviewee's reputation
  -- automatically (hidden reviews are excluded from the average).
END;
$$;

COMMENT ON FUNCTION public.moderate_review(uuid, text, text) IS
  'Admin-only moderation entry point. Actions: hide, unhide, dispute, flag, note. Status changes trigger reputation recompute via the AFTER trigger.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 12 — PUBLIC VIEW (column-masked for non-admins)
-- ════════════════════════════════════════════════════════════════════════════
-- security_invoker=true so the underlying RLS still applies; the view only
-- handles column-level masking.

CREATE OR REPLACE VIEW public.reviews_public
WITH (security_invoker = true) AS
SELECT
  id, created_at, job_id,
  client_id, inspector_id,           -- legacy mirror, kept readable
  reviewer_id, reviewee_id,
  reviewer_role_snap, reviewee_role_snap,
  rating, comment, is_public,
  moderation_status,
  weight                              -- visible — useful for the timeline UI
FROM public.reviews;

COMMENT ON VIEW public.reviews_public IS
  'Non-admin facing view. Masks private_admin_note, moderator_notes, hidden_by, hidden_at, and reviewer attribute snapshots used internally for weighting.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 13 — RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.reviews                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_weights_config  ENABLE ROW LEVEL SECURITY;

-- ── reviews — SELECT policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS reviews_select_admin     ON public.reviews;
DROP POLICY IF EXISTS reviews_select_own       ON public.reviews;
DROP POLICY IF EXISTS reviews_select_about_me  ON public.reviews;
DROP POLICY IF EXISTS reviews_select_public    ON public.reviews;

CREATE POLICY reviews_select_admin ON public.reviews FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  )
);

CREATE POLICY reviews_select_own ON public.reviews FOR SELECT
USING (reviewer_id = auth.uid());

CREATE POLICY reviews_select_about_me ON public.reviews FOR SELECT
USING (
  reviewee_id = auth.uid()
  AND moderation_status = 'visible'
);

CREATE POLICY reviews_select_public ON public.reviews FOR SELECT
USING (
  is_public = true
  AND moderation_status = 'visible'
);

-- ── reviews — INSERT policy ───────────────────────────────────────────────
-- Allow INSERT when reviewer_id = auth.uid(). The BEFORE trigger populates
-- reviewer_id from client_id when legacy code omits it (so the old UIs
-- continue to work — the inserted client_id equals auth.uid()).
DROP POLICY IF EXISTS reviews_insert_self ON public.reviews;
CREATE POLICY reviews_insert_self ON public.reviews FOR INSERT
WITH CHECK (
  COALESCE(reviewer_id, client_id) = auth.uid()
);

-- ── reviews — UPDATE / DELETE: forbidden by default ───────────────────────
-- Only the moderate_review RPC (SECURITY DEFINER, owned by postgres) can
-- update rows. Direct user UPDATE / DELETE has no matching policy → denied.

-- ── review_weights_config — read everyone, write admin only ──────────────
DROP POLICY IF EXISTS rwc_select_all   ON public.review_weights_config;
DROP POLICY IF EXISTS rwc_modify_admin ON public.review_weights_config;

CREATE POLICY rwc_select_all ON public.review_weights_config FOR SELECT
USING (true);

CREATE POLICY rwc_modify_admin ON public.review_weights_config FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  )
);


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 14 — AUDIT INTEGRATION (Phase 5)
-- ════════════════════════════════════════════════════════════════════════════
-- Attach the existing audit_capture trigger to `reviews` so every INSERT
-- (review submitted), UPDATE (moderation, edits), and DELETE shows up in
-- the Audit Trail. The audit function's generic else-branch produces
-- event_types `reviews.created`, `reviews.updated`, `reviews.deleted` —
-- already enough for the Command Center to surface them.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'audit_capture'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS audit_capture_trigger ON public.reviews';
    EXECUTE 'CREATE TRIGGER audit_capture_trigger
             AFTER INSERT OR UPDATE OR DELETE ON public.reviews
             FOR EACH ROW EXECUTE FUNCTION public.audit_capture()';
  ELSE
    RAISE NOTICE '[reviews-system] audit_capture() not found — audit trigger skipped. Run audit-trail.sql first if you want audit integration.';
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 15 — GRANTS
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.recompute_reputation(uuid)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reviews_populate_generalized()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reviews_recompute_trigger()            FROM PUBLIC;

GRANT  EXECUTE ON FUNCTION public.compute_review_weight(boolean, integer, text)
                                                                          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.submit_review(uuid, uuid, integer, text, boolean, text)
                                                                          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.moderate_review(uuid, text, text)       TO authenticated;

GRANT SELECT ON public.reviews               TO authenticated;
GRANT SELECT ON public.reviews_public        TO authenticated;
GRANT SELECT ON public.review_weights_config TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 16 — INITIAL REPUTATION BACKFILL (one-time)
-- ════════════════════════════════════════════════════════════════════════════
-- Recomputes rating_average + rating_count for every user who has at least
-- one review. Fixes the existing client-side-averaging staleness bug —
-- after this runs, profiles.rating_average is the canonical truth.

DO $$
DECLARE
  v_user uuid;
BEGIN
  FOR v_user IN
    SELECT DISTINCT reviewee_id
    FROM public.reviews
    WHERE reviewee_id IS NOT NULL
  LOOP
    PERFORM public.recompute_reputation(v_user);
  END LOOP;
END $$;


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS — run after the COMMIT to verify the pipeline works.
-- Commented out so the migration itself is side-effect free beyond schema.
-- ════════════════════════════════════════════════════════════════════════════

-- A. Confirm new columns landed on `reviews`
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'reviews'
--   AND column_name IN (
--     'reviewer_id','reviewee_id','reviewer_role_snap','reviewee_role_snap',
--     'reviewer_verified_snap','reviewer_jobs_count_snap','weight',
--     'moderation_status','hidden_at','hidden_by','moderator_notes',
--     'private_admin_note'
--   )
-- ORDER BY ordinal_position;

-- B. Confirm the unique constraint + indexes
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'public.reviews'::regclass AND contype = 'u';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'reviews';

-- C. Weight sanity — a verified 5-job client should weight 1.0 * 1.5 * 1.2 = 1.8
-- SELECT public.compute_review_weight(true, 5, 'client');
-- A new unverified inspector should weight 1.0 * 1.0 * 0.5 = 0.5
-- SELECT public.compute_review_weight(false, 0, 'inspector');

-- D. Submit a review end-to-end (replace UUIDs with real ones).
-- The job MUST be status='completed' AND admin_confirmed_at IS NOT NULL.
-- SELECT public.submit_review(
--   p_job_id       := '00000000-0000-0000-0000-000000000000'::uuid,
--   p_reviewee_id  := '00000000-0000-0000-0000-000000000000'::uuid,
--   p_rating       := 5,
--   p_comment      := 'Outstanding work',
--   p_is_public    := true,
--   p_private_admin_note := NULL
-- );

-- E. Verify reputation aggregate updated automatically
-- SELECT id, rating_average, rating_count
-- FROM public.profiles
-- WHERE id = '<reviewee uuid>';

-- F. Moderate (admin must run this)
-- SELECT public.moderate_review('<review-id>', 'hide', 'Spam content');
-- SELECT public.moderate_review('<review-id>', 'unhide', NULL);

-- G. Verify the AFTER trigger recomputes when moderation flips
-- SELECT rating_average, rating_count
-- FROM public.profiles WHERE id = '<reviewee uuid>';
-- (Hide → average drops; unhide → average restores.)

-- H. Confirm audit events fire (if audit-trail.sql is deployed)
-- SELECT created_at, event_type, summary, severity
-- FROM public.audit_events
-- WHERE subject_table = 'reviews'
-- ORDER BY created_at DESC
-- LIMIT 10;
