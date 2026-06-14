-- ════════════════════════════════════════════════════════════════════════════
--  20260801135000_public_total_jobs_rpc.sql
--
--  Marketing social-proof source. The landing page is unauthenticated (anon),
--  and RLS keeps anon from reading the jobs table directly — so a raw count
--  would return nothing. Mirror the existing public_stats() pattern: a small
--  SECURITY DEFINER function that returns ONLY an aggregate count (no rows, no
--  PII), callable by anon. Used by the conditional "social proof" CTA, which
--  renders only once the count crosses a traction threshold.
--
--  Defensive (never raises), idempotent, additive. Counts non-deleted jobs.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.public_total_jobs()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint := 0;
BEGIN
  BEGIN
    SELECT count(*) INTO v_count
    FROM public.jobs
    WHERE deleted_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    v_count := 0;
  END;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.public_total_jobs() IS
  'Marketing social-proof source. Returns the total non-deleted jobs count (aggregate only, no rows/PII). Anon-callable. Defensive — never raises on schema changes.';

GRANT EXECUTE ON FUNCTION public.public_total_jobs() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Self-test ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.public_total_jobs()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: public_total_jobs missing';
  END IF;
  PERFORM public.public_total_jobs();
  RAISE NOTICE 'public_total_jobs OK';
END $$;

COMMIT;
