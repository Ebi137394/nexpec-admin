-- ════════════════════════════════════════════════════════════════════════════
--  20260801426000_vca_claimed_address_text.sql
--
--  Corrects a misclassification made in the previous session, and closes the
--  owner's VCA decision.
--
--  ── WHAT WAS GOT WRONG ─────────────────────────────────────────────────────
--  b5790be classified BOTH vca_load_job and vca_claimed_address_text as
--  "(D) optional accelerator, fallback proven at generate-vca/index.ts:424" and
--  allowlisted the pair together. That is true of vca_load_job. It is NOT true
--  of vca_claimed_address_text, and re-reading the call site line by line shows
--  why the two are not the same case:
--
--    vca_load_job          index.ts:420  followed by an explicit fallback
--                                        ("If the RPC isn't installed yet, fall
--                                        back to a single-query view-style
--                                        fetch") that selects every job field
--                                        the function actually consumes.
--                                        Genuinely optional. Its dead call is
--                                        removed in this same change.
--
--    vca_claimed_address_text index.ts:518  has NO fallback of any kind.
--                                        `pt` goes straight into parsePointWkt
--                                        and then into
--                                        job.claimed_address_geocoded_point.
--                                        Missing RPC -> null -> the compliance
--                                        attestation silently loses its
--                                        geocoded address claim.
--
--  And it cannot be replaced by a PostgREST select. The function's own comment
--  says so:
--
--      "We don't fetch the raw geography column directly (Supabase returns
--       EWKB). Instead, ... re-fetch via ST_AsText"
--
--  jobs.claimed_address_geocoded is a geography column. Selecting it over
--  PostgREST yields hex EWKB, not the WKT parsePointWkt expects. Server-side
--  ST_AsText is the whole point of the function.
--
--  ── SO THIS IS NOT "OPTIONAL ACCELERATION" ─────────────────────────────────
--  The owner's instruction was: do NOT restore archived VCA RPCs merely to
--  satisfy optional acceleration. This one is not optional acceleration — it is
--  the only path to a value the attestation renders, and its absence fails
--  silently rather than loudly. Restoring it is the correct reading of that
--  instruction, not an exception to it.
--
--  Recovered from supabase/migrations_archive/20260514100500_vca_helper_rpcs.sql
--  with the body unchanged, and hardened on the way in.
--
--  ── HARDENING APPLIED VS THE ARCHIVED COPY ─────────────────────────────────
--  The archive declares SECURITY INVOKER with no explicit grants, which under
--  Supabase defaults leaves it EXECUTE-able by anon and authenticated. The
--  caller (generate-vca) is a service-role Edge Function and needs nothing
--  more, and a job's geocoded location is not public: revoked from PUBLIC,
--  anon and authenticated, granted to service_role only.
--
--  SECURITY INVOKER is deliberately KEPT. As invoker the function is still
--  subject to RLS on public.jobs, so it cannot become a way to read any job's
--  location; it only reformats a row the caller could already read. Making it
--  DEFINER would turn a formatting helper into an authorization bypass.
--
--  Additive: one read-only function. No table, no column, no policy touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.vca_claimed_address_text(p_job_id uuid)
RETURNS TABLE (wkt text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT ST_AsText(j.claimed_address_geocoded::geometry) AS wkt
    FROM public.jobs j
   WHERE j.id = p_job_id;
$fn$;

ALTER FUNCTION public.vca_claimed_address_text(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.vca_claimed_address_text(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vca_claimed_address_text(uuid) TO service_role;

COMMENT ON FUNCTION public.vca_claimed_address_text(uuid) IS
  'Returns jobs.claimed_address_geocoded as WKT for the generate-vca Edge Function. Exists because PostgREST returns a geography column as hex EWKB, which parsePointWkt cannot read — server-side ST_AsText is the only path to the value, and the call site has no fallback, so its absence silently nulls the geocoded address claim on a compliance attestation. Restored from migrations_archive by 20260801426000 after being misclassified as an optional accelerator. SECURITY INVOKER on purpose: it stays subject to RLS on public.jobs and only reformats a row the caller could already read. service_role only.';

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regprocedure('public.vca_claimed_address_text(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: vca_claimed_address_text was not created';
  END IF;

  -- Must NOT become an authorization bypass.
  IF (SELECT p.prosecdef FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'vca_claimed_address_text') THEN
    RAISE EXCEPTION
      'SELFTEST: vca_claimed_address_text is SECURITY DEFINER — it would read any job''s location regardless of RLS';
  END IF;

  IF has_function_privilege('anon', 'public.vca_claimed_address_text(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon can execute vca_claimed_address_text';
  END IF;
  IF has_function_privilege('authenticated', 'public.vca_claimed_address_text(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can execute vca_claimed_address_text — tighten to service_role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.vca_claimed_address_text(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: service_role cannot execute it — generate-vca loses the geocoded claim silently';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'jobs'
       AND column_name = 'claimed_address_geocoded'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: jobs.claimed_address_geocoded is missing';
  END IF;
END
$selftest$;

COMMIT;
