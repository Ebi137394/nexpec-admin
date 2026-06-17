-- ════════════════════════════════════════════════════════════════════════════
--  20260630120000_public_inspectors_directory_view.sql
--
--  Sprint 13.2 — Public Inspector Directory
--
--  Creates public.inspectors_directory — the controlled SELECT surface
--  that the new /inspectors listing page and the existing /p/[userId]
--  page both read from. The underlying profiles table stays locked
--  down (profiles_read_self + profiles_read_admin only); this view is
--  how the marketing-to-conversion funnel reaches profile data without
--  loosening that lockdown.
--
--  WHY A VIEW (and not a relaxed RLS policy on profiles directly)
--  ─────────────────────────────────────────────────────────────
--    • RLS policies are row-level. They cannot restrict which columns
--      a SELECT may reach. We need column-level filtering because
--      profiles holds sensitive data (rates, balances, residency, etc.)
--      that anonymous visitors must not see.
--    • A view projects an exact column whitelist and is the standard
--      Supabase pattern for safe public surfaces.
--    • By default a Postgres view runs with the privileges of the
--      view owner (here: postgres → bypasses RLS) — exactly what we
--      want for a controlled read.
--
--  GOLDEN_RULE_2 — STRICT PROJECTION
--  ─────────────────────────────────
--  The view exposes ONLY the columns required to render the public
--  trust card + directory filters. It explicitly DOES NOT include:
--    × email, phone, last_sign_in_at
--    × hourly_rate_cents, travel_rate_cents
--    × balance_cents, stripe_*
--    × country_of_residence, work_authorized_countries, sponsored_countries,
--      open_to_sponsored_work
--    × resume_path
--    × suspension_reason, suspended_by, suspended_at
--    × terms_accepted_at, terms_version, onboarding_*
--    × payment_terms
--  If a future column is added to profiles that is sensitive, the
--  view's whitelist will not auto-include it — the safe default.
--
--  ELIGIBILITY FILTERING
--  ─────────────────────
--  The view filters rows to inspectors who are SAFE to surface:
--    • role = 'inspector'
--    • not suspended (suspended_at IS NULL) — this is profiles' soft-delete
--      signal; profiles does not carry a separate deleted_at column
--    • has a non-empty display name
--  Suspended inspectors disappear from the directory and from public
--  profile reads — exactly what we want.
--
--  GRANTS
--  ──────
--  SELECT is granted to anon + authenticated so unauthenticated
--  visitors and signed-in users (clients, peers, admins) all read
--  through the same surface. Admins can additionally read the raw
--  profiles table for admin tooling — the view does not replace
--  that, it complements it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── View ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.inspectors_directory;

CREATE VIEW public.inspectors_directory
WITH (security_barrier = true)
AS
SELECT
  p.id,
  p.full_name,
  p.headline,
  p.bio,
  p.avatar_url,
  p.location_city,
  p.location_province,
  p.specialty_slugs,
  p.ndt_methods,
  p.certifications,
  p.verification_status,
  p.rating_average,
  p.rating_count,
  p.recommend_percent,
  p.completed_jobs_count,
  p.total_jobs,
  p.travel_radius_km,
  p.created_at
FROM public.profiles p
WHERE p.role = 'inspector'
  AND p.suspended_at IS NULL
  AND p.full_name IS NOT NULL
  AND char_length(trim(p.full_name)) > 0;

COMMENT ON VIEW public.inspectors_directory IS
  'Public SELECT surface for inspector profiles. Backs /inspectors '
  '(directory listing) and /p/[userId] (single profile card) for both '
  'anonymous and authenticated viewers. Strict column projection per '
  'GOLDEN_RULE_2. Suspended / deleted / nameless inspectors are filtered '
  'out at the view layer.';

-- ─── Grants ──────────────────────────────────────────────────────────
GRANT SELECT ON public.inspectors_directory TO anon, authenticated;

-- ─── Helpful indexes on the underlying table for view performance ───
-- These indexes accelerate the directory's typical filter dimensions.
-- All are idempotent and additive — no existing index is touched.
CREATE INDEX IF NOT EXISTS profiles_inspector_directory_idx
  ON public.profiles (role, rating_average DESC NULLS LAST, created_at DESC)
  WHERE suspended_at IS NULL AND role = 'inspector';

CREATE INDEX IF NOT EXISTS profiles_inspector_city_idx
  ON public.profiles (location_city)
  WHERE suspended_at IS NULL AND role = 'inspector';

CREATE INDEX IF NOT EXISTS profiles_inspector_specialty_gin_idx
  ON public.profiles USING gin (specialty_slugs)
  WHERE suspended_at IS NULL AND role = 'inspector';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Confirm the view exists with the safe column projection:
--      \d+ public.inspectors_directory
--      -- Expect exactly 18 columns. NO email, NO rates, NO residency.
--
-- 2) Confirm grants:
--      SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema='public' AND table_name='inspectors_directory'
--       ORDER BY grantee;
--      -- Expect anon=SELECT, authenticated=SELECT.
--
-- 3) Confirm anonymous read works (sign-out, then):
--      SELECT count(*) FROM public.inspectors_directory;
--      -- Expect a positive integer (every non-suspended named inspector).
-- ─────────────────────────────────────────────────────────────────────
