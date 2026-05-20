-- ============================================================================
-- reviews · moderation schema + RPC + public view
--
-- Background:
--   The reviews table from migration 20260518170000 had only the immutable
--   review payload — direction, rating, body, would_recommend. The mobile
--   admin command center already shipped a "Reviews Moderation" surface
--   that expects four moderation states (visible / hidden / disputed /
--   flagged) plus moderator notes and a dedicated SECURITY DEFINER RPC.
--   The DB never had those columns, so the mobile feature has been
--   reading undefined and the RPC call has been failing silently.
--
--   This migration closes that gap and unblocks the web admin parity
--   build (apps/web/src/app/admin/reviews/page.tsx).
--
-- What's added:
--   1. moderation_status text column (CHECK enum)
--   2. moderator_notes + private_admin_note text columns
--   3. hidden_at / hidden_by + disputed_at/reason + flagged_at/reason
--   4. SECURITY DEFINER public.moderate_review(p_review_id, p_action, p_notes)
--   5. reviews_public view — non-admin SELECT path, filtered to visible
--   6. RLS update — non-admin SELECT on the base table is restricted to
--      visible rows (matches the mobile assumption baked into src/lib/reviews)
--   7. Aggregate trigger refresh — recompute profiles.rating_average +
--      rating_count using only `visible` rows after any moderation action
--
-- Sister RPC contract — moderate_review actions:
--   • hide     status='hidden'   + sets hidden_at/hidden_by, recompute aggregates
--   • unhide   status='visible'  + clears hidden_at/hidden_by, recompute
--   • dispute  status='disputed' + sets disputed_at/reason
--   • flag     status='flagged'  + sets flagged_at/reason
--   • note     status unchanged + appends moderator_notes / private_admin_note
-- ============================================================================

BEGIN;

-- ── 1) Columns (idempotent) ─────────────────────────────────────────────
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS moderation_status   text NOT NULL DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS moderator_notes     text,
  ADD COLUMN IF NOT EXISTS private_admin_note  text,
  ADD COLUMN IF NOT EXISTS hidden_at           timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by           uuid,
  ADD COLUMN IF NOT EXISTS disputed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_reason     text,
  ADD COLUMN IF NOT EXISTS flagged_at          timestamptz,
  ADD COLUMN IF NOT EXISTS flagged_reason      text,
  ADD COLUMN IF NOT EXISTS last_moderated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_moderated_by   uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reviews_moderation_status_check'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_moderation_status_check
      CHECK (moderation_status IN ('visible','hidden','disputed','flagged'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reviews_moderation_status
  ON public.reviews(moderation_status, created_at DESC);

-- ── 2) RLS — restrict non-admin SELECT to visible rows ──────────────────
-- The original policy used `USING (true)` which exposed hidden rows in
-- normal reads. We tighten it: admins see everything (via nx_is_admin),
-- anyone else sees only `visible`. This matches what the mobile and
-- public-facing surfaces have been expecting.
DROP POLICY IF EXISTS "reviews_read_public" ON public.reviews;
CREATE POLICY "reviews_read_visible_or_admin" ON public.reviews FOR SELECT
  USING (
    moderation_status = 'visible'
    OR public.nx_is_admin()
  );

-- Admin UPDATE policy so the SECURITY DEFINER RPC isn't the only path
-- to mutate moderation columns. (The RPC is still the recommended path
-- because it handles audit + aggregate refresh; this just keeps the
-- DB honest if a service_role tool needs to patch a row directly.)
DROP POLICY IF EXISTS "reviews_update_admin" ON public.reviews;
CREATE POLICY "reviews_update_admin" ON public.reviews FOR UPDATE
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- ── 3) reviews_public view — schema-tolerant SELECT * ───────────────────
-- Rev 2 (2026-05-20): the deployed `reviews` table column shape varies
-- between environments (some have direction/body, others use
-- reviewer_role_snap/comment from an alternate schema). Using SELECT *
-- here lets the view capture whatever columns actually exist at deploy
-- time — the WHERE is the only thing this view enforces. Non-admin
-- surfaces should still prefer this view over the base table for the
-- moderation-visibility guarantee.
DROP VIEW IF EXISTS public.reviews_public;
CREATE VIEW public.reviews_public AS
SELECT *
FROM public.reviews
WHERE moderation_status = 'visible';

GRANT SELECT ON public.reviews_public TO authenticated, anon;

-- ── 4) moderate_review RPC ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.moderate_review(uuid, text, text);

CREATE OR REPLACE FUNCTION public.moderate_review(
  p_review_id uuid,
  p_action    text,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_review RECORD;
  v_new_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'moderate_review: not authenticated';
  END IF;
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'moderate_review: admin only';
  END IF;
  IF p_action NOT IN ('hide', 'unhide', 'dispute', 'flag', 'note') THEN
    RAISE EXCEPTION 'moderate_review: invalid action %', p_action;
  END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'moderate_review: review not found';
  END IF;

  -- Decide the new status and apply the side-effects per action.
  IF p_action = 'hide' THEN
    v_new_status := 'hidden';
    UPDATE public.reviews SET
      moderation_status  = v_new_status,
      hidden_at          = NOW(),
      hidden_by          = v_uid,
      moderator_notes    = COALESCE(p_notes, moderator_notes),
      last_moderated_at  = NOW(),
      last_moderated_by  = v_uid
    WHERE id = p_review_id;

  ELSIF p_action = 'unhide' THEN
    v_new_status := 'visible';
    UPDATE public.reviews SET
      moderation_status  = v_new_status,
      hidden_at          = NULL,
      hidden_by          = NULL,
      disputed_at        = NULL,
      disputed_reason    = NULL,
      flagged_at         = NULL,
      flagged_reason     = NULL,
      moderator_notes    = COALESCE(p_notes, moderator_notes),
      last_moderated_at  = NOW(),
      last_moderated_by  = v_uid
    WHERE id = p_review_id;

  ELSIF p_action = 'dispute' THEN
    v_new_status := 'disputed';
    UPDATE public.reviews SET
      moderation_status  = v_new_status,
      disputed_at        = NOW(),
      disputed_reason    = COALESCE(p_notes, disputed_reason),
      last_moderated_at  = NOW(),
      last_moderated_by  = v_uid
    WHERE id = p_review_id;

  ELSIF p_action = 'flag' THEN
    v_new_status := 'flagged';
    UPDATE public.reviews SET
      moderation_status  = v_new_status,
      flagged_at         = NOW(),
      flagged_reason     = COALESCE(p_notes, flagged_reason),
      last_moderated_at  = NOW(),
      last_moderated_by  = v_uid
    WHERE id = p_review_id;

  ELSIF p_action = 'note' THEN
    v_new_status := v_review.moderation_status;
    UPDATE public.reviews SET
      moderator_notes    = COALESCE(p_notes, moderator_notes),
      last_moderated_at  = NOW(),
      last_moderated_by  = v_uid
    WHERE id = p_review_id;
  END IF;

  -- Recompute the reviewee's aggregate over ONLY visible reviews. The
  -- existing aggregate trigger on the reviews table also fires on UPDATE,
  -- but it's filter-agnostic — we explicitly recompute here using only
  -- moderation_status='visible' so hidden / disputed / flagged content
  -- doesn't pollute reputation.
  WITH agg AS (
    SELECT
      AVG(rating)::numeric(3,2) AS avg_rating,
      COUNT(*)::int             AS cnt
    FROM public.reviews
    WHERE reviewee_id = v_review.reviewee_id
      AND moderation_status = 'visible'
  )
  UPDATE public.profiles p
     SET rating_average = COALESCE((SELECT avg_rating FROM agg), 0),
         rating_count   = COALESCE((SELECT cnt        FROM agg), 0)
   WHERE p.id = v_review.reviewee_id;

  RETURN jsonb_build_object(
    'ok', true,
    'review_id', p_review_id,
    'new_status', v_new_status,
    'moderated_by', v_uid,
    'moderated_at', NOW()
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.moderate_review(uuid, text, text)
  TO authenticated;

COMMIT;

-- Verify:
--   SELECT proname, prosecdef FROM pg_proc WHERE proname='moderate_review';
--     -> prosecdef = true
--
--   SELECT polname, polcmd FROM pg_policies WHERE tablename='reviews';
--     -> reviews_read_visible_or_admin (SELECT)
--     -> reviews_update_admin          (UPDATE)
--     -> reviews_insert_reviewer_completed (INSERT) [from earlier migration]
--     -> reviews_delete_admin          (DELETE)    [from earlier migration]
--
-- Smoke test (as admin in SQL editor):
--   SELECT public.moderate_review(
--     (SELECT id FROM public.reviews LIMIT 1)::uuid,
--     'hide',
--     'Smoke test from migration verification.'
--   );
