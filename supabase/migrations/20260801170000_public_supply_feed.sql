-- ════════════════════════════════════════════════════════════════════════════
--  20260801170000_public_supply_feed.sql   (Teaser Marketplace — Set 1, supply)
--
--  1. profiles.public_listing_opt_in  — the inspector "Feature me publicly" flag
--     (consent). Default FALSE: nothing is public until explicitly opted in.
--
--  2. Close the inspector-identity leaks on three SECURITY DEFINER RPCs that
--     today hand the real name + avatar to ANY caller (anon included), bypassing
--     the escrow RLS (20260801160000). Migration 160000 itself flagged these as
--     "existing-but-unused". We:
--        - pseudonymize their output (display_name → public.nx_handle(id),
--          avatar_url → NULL)  ⇒ fail-safe even for authenticated callers, and
--        - REVOKE EXECUTE FROM anon                ⇒ the public path is the
--          purpose-built feed below, nothing else.
--     RPCs: get_marketplace_inspectors, get_public_profile, get_public_profiles.
--
--  3. public_supply_feed — the ONE intentional public (anon) supply projection.
--     Privacy by construction: the column list physically excludes id, real
--     name, email, avatar, bio, rate, and organization/affiliation — so no view
--     edit or `select *` can ever leak them. The WHERE clause is the security
--     boundary (the view runs with owner rights / bypasses RLS), and
--     security_barrier = true blocks predicate-pushdown leaks.
--
--  Eligibility (per product, 2026-06-24):
--     verified + opt-in + admin-featured. NO completed-jobs / rating threshold
--     (maximize visible talent). Agency-affiliated inspectors ARE shown as
--     individuals, but affiliation is NEVER emitted (organization_id is not a
--     column here) — every card is simply "vetted NEXPEC talent".
--     0 completed jobs / 0 ratings are emitted as NULL so the UI omits them
--     (never "0 jobs completed").
--
--  Idempotent. ADDITIVE (no drops of data; view is replace-safe).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Consent + curation flags ───────────────────────────────────────────────
--   profiles has NO generic is_featured (jobs.is_featured is a different table),
--   so we add a dedicated admin-curation flag alongside the opt-in flag.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_listing_opt_in   boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_listing_featured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.public_listing_opt_in IS
  'Teaser feed consent: user opted in to a sanitized public listing. Required (with public_listing_featured) for public_supply_feed. Default false.';
COMMENT ON COLUMN public.profiles.public_listing_featured IS
  'Teaser feed admin curation: admin promoted this user to the public feed. Required (with public_listing_opt_in). Default false.';

-- ── 2a. get_marketplace_inspectors → pseudonymized (handle, no avatar) ─────────
--   Body is unchanged EXCEPT: display_name now = public.nx_handle(p.id) and
--   avatar_url is suppressed. Return shape is identical (REPLACE-compatible).
CREATE OR REPLACE FUNCTION public.get_marketplace_inspectors(
  p_search        text    DEFAULT NULL,
  p_min_rating    numeric DEFAULT NULL,
  p_only_verified boolean DEFAULT false,
  p_only_available boolean DEFAULT false,
  p_location_city text    DEFAULT NULL,
  p_ndt_methods   text[]  DEFAULT NULL,
  p_sort_by       text    DEFAULT 'rating',
  p_limit         integer DEFAULT 20,
  p_offset        integer DEFAULT 0
) RETURNS TABLE(
  id uuid, display_name text, avatar_url text, bio text, is_verified boolean,
  is_available boolean, hourly_rate_cents integer, years_experience integer,
  skills text[], ndt_methods text[], certifications text[], location_city text,
  location_province text, rating_average numeric, rating_count integer,
  completed_jobs_count integer, response_time_hours numeric, is_featured boolean,
  availability_status text
)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_search_like text;
BEGIN
  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_search_like := '%' || trim(p_search) || '%';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    public.nx_handle(p.id)::text AS display_name,   -- pseudonym, never real name
    NULL::text                   AS avatar_url,      -- avatar suppressed (anti-poaching)
    p.bio,
    COALESCE(p.is_verified,  false),
    COALESCE(p.is_available, false),
    p.hourly_rate_cents,
    p.experience_years,                              -- real column (years_of_experience is text)
    p.skills,
    p.ndt_methods,
    p.certifications,
    p.location_city,
    p.location_province,
    COALESCE(p.rating_average, 0)::numeric,
    COALESCE(p.rating_count,   0)::integer,
    COALESCE(p.completed_jobs_count, 0)::integer,
    p.response_time_hours,
    COALESCE(p.public_listing_featured, false),      -- profiles has no is_featured
    p.availability_status
  FROM public.profiles p
  WHERE p.role = 'inspector'
    AND p.status = 'active'                          -- real gate (no is_active column)
    AND (NOT p_only_verified  OR COALESCE(p.is_verified,  false) = true)
    AND (NOT p_only_available OR COALESCE(p.is_available, false) = true)
    AND (p_min_rating  IS NULL OR COALESCE(p.rating_average, 0) >= p_min_rating)
    AND (p_location_city IS NULL OR p.location_city ILIKE '%' || p_location_city || '%')
    AND (p_ndt_methods IS NULL OR p.ndt_methods @> p_ndt_methods)
    AND (
      v_search_like IS NULL
      OR p.first_name ILIKE v_search_like
      OR p.last_name  ILIKE v_search_like
      OR p.bio        ILIKE v_search_like
      OR (p.skills IS NOT NULL AND p.skills && ARRAY[trim(p_search)]::text[])
    )
  ORDER BY
    CASE WHEN p_sort_by = 'rating'     THEN p.rating_average       END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'reviews'    THEN p.rating_count         END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'experience' THEN p.experience_years     END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'jobs'       THEN p.completed_jobs_count END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'price_low'  THEN p.hourly_rate_cents    END ASC  NULLS LAST,
    CASE WHEN p_sort_by = 'price_high' THEN p.hourly_rate_cents    END DESC NULLS LAST,
    p.id
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

COMMENT ON FUNCTION public.get_marketplace_inspectors(text,numeric,boolean,boolean,text,text[],text,integer,integer) IS
  'Pseudonymized buyer-side inspector directory (authenticated). display_name = nx_handle(id); avatar suppressed. anon access revoked — the public surface is public_supply_feed.';

-- ── 2b. get_public_profile → pseudonymized ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_profile(p_uid uuid)
RETURNS TABLE(id uuid, role text, display_name text, avatar_url text,
              rating_average numeric, rating_count integer, is_verified boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    p.id,
    p.role,
    public.nx_handle(p.id)::text          AS display_name,   -- pseudonym
    NULL::text                            AS avatar_url,      -- suppressed
    COALESCE(p.rating_average, 0)::numeric AS rating_average,
    COALESCE(p.rating_count,   0)::integer AS rating_count,
    COALESCE(p.is_verified,    false)      AS is_verified
  FROM public.profiles p
  WHERE p.id = p_uid
  LIMIT 1;
$$;

-- ── 2c. get_public_profiles → pseudonymized ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_profiles(p_uids uuid[])
RETURNS TABLE(id uuid, role text, display_name text, avatar_url text,
              rating_average numeric, rating_count integer, is_verified boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    p.id,
    p.role,
    public.nx_handle(p.id)::text          AS display_name,   -- pseudonym
    NULL::text                            AS avatar_url,      -- suppressed
    COALESCE(p.rating_average, 0)::numeric AS rating_average,
    COALESCE(p.rating_count,   0)::integer AS rating_count,
    COALESCE(p.is_verified,    false)      AS is_verified
  FROM public.profiles p
  WHERE p_uids IS NOT NULL
    AND p.id = ANY(p_uids);
$$;

-- ── 2d. Revoke anon on all three (keep authenticated + service_role) ───────────
REVOKE ALL ON FUNCTION public.get_marketplace_inspectors(text,numeric,boolean,boolean,text,text[],text,integer,integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_profile(uuid)    FROM anon;
REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM anon;

-- ── 3. The public supply feed (anon) ──────────────────────────────────────────
DROP VIEW IF EXISTS public.public_supply_feed;
CREATE VIEW public.public_supply_feed
  WITH (security_barrier = true) AS
SELECT
  public.nx_handle(p.id)                          AS handle,
  'inspector'::text                               AS source_kind,
  p.specialty_slugs                               AS specialty_slugs,   -- web maps to i18n labels
  p.certifications                                AS certifications,    -- category names only
  p.location_city                                 AS location_city,
  p.location_province                             AS location_province,
  p.country_of_residence                          AS country,
  CASE WHEN COALESCE(p.rating_count, 0) > 0 THEN p.rating_average END  AS rating_average,
  NULLIF(COALESCE(p.rating_count, 0), 0)          AS rating_count,
  NULLIF(COALESCE(p.completed_jobs_count, 0), 0)  AS completed_jobs_count,
  COALESCE(p.is_available, false)                 AS is_available,
  true                                            AS is_featured
FROM public.profiles p
WHERE p.role = 'inspector'
  AND p.verification_status = 'verified'           -- vetted baseline (kept)
  AND COALESCE(p.public_listing_opt_in, false) = true       -- consent
  AND COALESCE(p.public_listing_featured, false) = true     -- admin curation
  AND p.status = 'active'                                    -- live (excludes suspended/anonymized)
  AND p.deleted_at IS NULL;                                  -- not soft-deleted

COMMENT ON VIEW public.public_supply_feed IS
  'Public (anon) pseudonymous talent spotlights. Privacy by construction: emits nx_handle + sanitized fields only — no id/name/email/avatar/bio/rate/affiliation. Eligibility = verified + public_listing_opt_in + is_featured + live account.';

REVOKE ALL    ON public.public_supply_feed FROM PUBLIC;
GRANT  SELECT ON public.public_supply_feed TO anon, authenticated, service_role;

-- ── 4. Self-tests ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def_mi text := pg_get_functiondef(to_regprocedure('public.get_marketplace_inspectors(text,numeric,boolean,boolean,text,text[],text,integer,integer)'));
  v_def_gp text := pg_get_functiondef(to_regprocedure('public.get_public_profile(uuid)'));
BEGIN
  -- consent column present
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles'
                   AND column_name='public_listing_opt_in') THEN
    RAISE EXCEPTION 'SELFTEST: profiles.public_listing_opt_in missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles'
                   AND column_name='public_listing_featured') THEN
    RAISE EXCEPTION 'SELFTEST: profiles.public_listing_featured missing';
  END IF;

  -- view present + anon can read it
  IF to_regclass('public.public_supply_feed') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: public_supply_feed missing';
  END IF;
  IF NOT has_table_privilege('anon','public.public_supply_feed','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon cannot SELECT public_supply_feed';
  END IF;

  -- NO forbidden columns in the public projection (privacy by construction)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='public_supply_feed'
      AND ( column_name = ANY (ARRAY['id','full_name','first_name','last_name',
                                     'email','avatar_url','bio','organization_id',
                                     'hourly_rate_cents'])
            OR column_name LIKE '%cents%' )
  ) THEN
    RAISE EXCEPTION 'SELFTEST: public_supply_feed exposes a forbidden column';
  END IF;

  -- anon EXECUTE revoked on the three RPCs
  IF has_function_privilege('anon','public.get_marketplace_inspectors(text,numeric,boolean,boolean,text,text[],text,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon still has get_marketplace_inspectors';
  END IF;
  IF has_function_privilege('anon','public.get_public_profile(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon still has get_public_profile';
  END IF;
  IF has_function_privilege('anon','public.get_public_profiles(uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon still has get_public_profiles';
  END IF;

  -- RPCs are actually pseudonymized (body now calls nx_handle)
  IF v_def_mi IS NULL OR position('nx_handle' in v_def_mi) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: get_marketplace_inspectors not pseudonymized';
  END IF;
  IF v_def_gp IS NULL OR position('nx_handle' in v_def_gp) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: get_public_profile not pseudonymized';
  END IF;

  RAISE NOTICE 'public_supply_feed + RPC hardening OK (anon revoked, feed sanitized, RPCs pseudonymized).';
END $$;

COMMIT;
