-- ════════════════════════════════════════════════════════════════════════════
--  20260727120000_anonymize_inspectors_directory_view.sql
--
--  ANTI-POACHING — close the last public surface (the directory + /inspectors).
--  /p and /passport are already pseudonymous; this pushes the same guarantee into
--  the SHARED view so the directory listing cannot leak identity either. After
--  this, the entire public marketplace is pseudonymous BY CONSTRUCTION — the
--  anon-granted view physically cannot emit a name, photo, bio, headline, or city.
--
--  Rewrites public.inspectors_directory to drop every identity vector:
--    × full_name      → replaced by a client-derived NX- handle from id
--    × headline       (free-text identity/employer leak)
--    × bio            (free-text identity/employer leak)
--    × avatar_url     → replaced by a generated Trust Sigil
--    × location_city  (precise locality → poaching vector)
--  Keeps: opaque id (routing + admin-brokered hire ref), coarse region
--  (province), verified competencies, and performance metrics. Eligibility still
--  filters on full_name presence, but full_name is never SELECTed → cannot leak.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.inspectors_directory;

CREATE VIEW public.inspectors_directory
WITH (security_barrier = true)
AS
SELECT
  p.id,                       -- opaque UUID: routing + admin-brokered hire ref (not PII)
  p.location_province,        -- coarse region only; city is dropped
  p.specialty_slugs,          -- verified competency
  p.ndt_methods,              -- verified competency
  p.certifications,           -- verified competency (names only; no doc links)
  p.verification_status,      -- NEXPEC verification tier
  p.rating_average,           -- performance metric
  p.rating_count,             -- performance metric
  p.recommend_percent,        -- performance metric
  p.completed_jobs_count,     -- performance metric
  p.total_jobs,               -- performance metric (→ completion rate)
  p.travel_radius_km,         -- capability (no base location revealed)
  p.created_at                -- platform tenure
FROM public.profiles p
WHERE p.role = 'inspector'
  AND p.suspended_at IS NULL
  AND p.full_name IS NOT NULL              -- eligibility only; full_name NOT exposed
  AND char_length(trim(p.full_name)) > 0;

COMMENT ON VIEW public.inspectors_directory IS
  'ANONYMIZED public SELECT surface for inspectors. Emits ZERO PII (no name, '
  'photo, bio, headline, or city) — only a coarse region, verified competencies, '
  'performance metrics, and the opaque UUID id for routing / brokered hiring. '
  'Backs /inspectors + /p/[userId] for anon + authenticated viewers. Anti-poaching '
  'is enforced here at the data layer, not in the UI.';

GRANT SELECT ON public.inspectors_directory TO anon, authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1) \d+ public.inspectors_directory
--      -- Expect 13 columns. NO full_name, headline, bio, avatar_url, location_city.
-- 2) SELECT * FROM public.inspectors_directory LIMIT 1;
--      -- Confirm no identity columns appear in the result.
-- 3) Grants unchanged: anon=SELECT, authenticated=SELECT.
-- ─────────────────────────────────────────────────────────────────────
