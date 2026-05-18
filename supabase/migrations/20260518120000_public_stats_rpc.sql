-- ════════════════════════════════════════════════════════════════════════════
--  20260518120000_public_stats_rpc.sql
--  Phase 6 / Sprint 2 — public marketing-page stats.
--
--  Anon + authenticated callers read three aggregate metrics that drive the
--  landing-page live ticker. NO row-level data is exposed — only counts and
--  sums. SECURITY DEFINER + search_path lock so a hostile schema can't
--  shadow `jobs` or `reviews`.
--
--  Defensive coding throughout: every section is wrapped in a DO block that
--  swallows table-missing / column-missing errors. The function will return
--  zeros rather than crash if a downstream table is renamed or dropped.
--  The marketing surface must NEVER 500 because of an upstream schema change.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.public_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobs_30d   int    := 0;
  v_escrow     bigint := 0;
  v_avg_rating numeric := 0;
BEGIN
  -- ── Jobs dispatched in the last 30 days ──────────────────────────
  BEGIN
    SELECT count(*) INTO v_jobs_30d
    FROM public.jobs
    WHERE created_at >= now() - interval '30 days'
      AND status IN ('assigned', 'in_progress', 'completed');
  EXCEPTION WHEN OTHERS THEN
    v_jobs_30d := 0;
  END;

  -- ── Currently held in escrow (assigned + in_progress) ────────────
  BEGIN
    SELECT COALESCE(sum(client_price_cents), 0)::bigint
      INTO v_escrow
    FROM public.jobs
    WHERE status IN ('assigned', 'in_progress')
      AND client_price_cents IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_escrow := 0;
  END;

  -- ── Average inspector rating across all reviews ──────────────────
  -- We average ALL ratings regardless of reviewer role — the user-
  -- facing copy is "average inspector rating" so we want every
  -- direction of review here.
  BEGIN
    SELECT COALESCE(round(avg(rating)::numeric, 2), 0)
      INTO v_avg_rating
    FROM public.reviews
    WHERE rating IS NOT NULL
      AND rating BETWEEN 1 AND 5;
  EXCEPTION WHEN OTHERS THEN
    v_avg_rating := 0;
  END;

  RETURN jsonb_build_object(
    'jobs_30d',     v_jobs_30d,
    'escrow_cents', v_escrow,
    'avg_rating',   v_avg_rating,
    'as_of',        now()
  );
END;
$$;

COMMENT ON FUNCTION public.public_stats() IS
  'Marketing-page live ticker source. Returns jsonb with jobs_30d, escrow_cents, avg_rating, as_of. Anon-callable. Defensive — never raises on schema changes.';

GRANT EXECUTE ON FUNCTION public.public_stats() TO anon, authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TEST — run after the COMMIT
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT public.public_stats();
-- Expected: { "jobs_30d": <n>, "escrow_cents": <n>, "avg_rating": <n>, "as_of": "..." }
