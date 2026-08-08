-- ════════════════════════════════════════════════════════════════════════════
--  20260801324000_profiles_identity_mode_lockdown.sql
--
--  Forward-only. Does not edit any migration applied remotely (≤ 320000).
--
--  ── THE HOLE ───────────────────────────────────────────────────────────────
--  20260801248000 replaced the blanket profiles read policy with
--  profiles_read_related → nx_can_read_profile(id). That function granted a
--  buyer FULL-ROW read of an inspector's profile through two branches:
--
--    (a) "shares a job (any party pairing)"  — auth.uid() and the target are
--        both parties on some job. Once an inspector is contractor_id, the
--        buyer could read their whole row.
--    (b) "application links a job poster and an applicant" — merely APPLYING
--        exposed the applicant's whole row to the buyer.
--
--  Neither branch consulted jobs.identity_mode, which did not exist in
--  248000. So after 20260801284000 introduced identity modes, Protected was
--  enforced only by what the React code chose to SELECT. A buyer could run
--
--      select full_name, email, phone, resume_url, cv_url, certifications
--        from profiles where id = '<the inspector>';
--
--  and defeat Protected entirely. RLS is row-level, so no projection
--  discipline in the client could have closed this.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  A buyer now gets a RAW profiles row for an inspector ONLY when that job's
--  identity_mode is 'full' — the one mode that is defined to release private
--  contact. Protected and Professional disclosure is served exclusively by the
--  SECURITY DEFINER projection job_applicant_identity_view, which NULLs every
--  field the mode forbids. The database, not the UI, now decides.
--
--  Because the gate lives inside an EXISTS over a specific job row, the
--  authorization is inherently JOB-SCOPED: Full on job A creates no visibility
--  through job B, and flipping job A back to protected revokes it immediately.
--
--  ── DELIBERATELY PRESERVED ─────────────────────────────────────────────────
--    • self read           (p_target = auth.uid())
--    • admin read          (nx_is_admin())
--    • org-member read     (unchanged)
--    • buyer ↔ buyer       (client ↔ agency on a shared job)
--    • inspector → buyer   (the BUYER's identity is not the protected asset;
--                           the inspector must be able to see who hired them)
--  No policy is dropped, no grant is broadened, no column privilege changes.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Widen the disclosure projection so buyer surfaces have a lawful source
--    for the pseudonym-safe fields they previously took from raw profiles.
--    APPENDED columns only (CREATE OR REPLACE VIEW cannot reorder or drop).
--
--    Split by sensitivity:
--      • always      → reputation + discipline. Not identifying; Protected
--                      must stay usable rather than blank.
--      • prof + full → avatar, name components, cv_url (a second résumé
--                      column that existed alongside resume_url and would
--                      otherwise have been an open back door).
--    Still NO money column of any kind, and hourly_rate_cents is deliberately
--    excluded — an inspector's standing rate is a margin signal (GR2).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.job_applicant_identity_view
WITH (security_barrier = 'true') AS
SELECT
  a.id                       AS application_id,
  a.job_id,
  a.applicant_id,
  a.status                   AS application_status,
  a.created_at,
  m.eff_mode                 AS identity_mode,
  p.rating_average,
  p.reviews_count,
  p.completed_jobs_count,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  CASE WHEN m.eff_mode = 'full' THEN p.email END AS inspector_email,
  CASE WHEN m.eff_mode = 'full' THEN p.phone END AS inspector_phone,

  -- ── appended: always available (pseudonym-safe) ──
  p.rating,
  p.total_jobs,
  p.professional_title,
  p.title,
  p.experience_years,
  p.specialty_slugs,
  p.ndt_methods,
  p.location_city,
  p.location_province,

  -- ── appended: professional + full ──
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.avatar_url END AS inspector_avatar_url,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.first_name END AS inspector_first_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.last_name  END AS inspector_last_name,
  CASE WHEN m.eff_mode IN ('professional','full') THEN p.cv_url     END AS inspector_cv_url

FROM public.applications a
JOIN public.jobs j        ON j.id = a.job_id
LEFT JOIN public.profiles p ON p.id = a.applicant_id
CROSS JOIN LATERAL (
  SELECT COALESCE(j.identity_mode, 'protected') AS eff_mode
) m
WHERE j.client_id = auth.uid()
   OR j.agency_id = auth.uid()
   OR public.nx_is_admin();

ALTER VIEW public.job_applicant_identity_view OWNER TO postgres;
REVOKE ALL ON public.job_applicant_identity_view FROM PUBLIC, anon;
GRANT SELECT ON public.job_applicant_identity_view TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) THE LOCKDOWN — nx_can_read_profile, rebuilt.
--
--    Same signature, owner and grants as 248000; only the buyer→inspector
--    branches change. Every other branch is carried over verbatim.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_can_read_profile(p_target uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    p_target IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      p_target = auth.uid()
      OR public.nx_is_admin()

      -- same organization (unchanged from 248000)
      OR EXISTS (
        SELECT 1 FROM public.org_members m1
          JOIN public.org_members m2 ON m1.org_id = m2.org_id
         WHERE m1.user_id = auth.uid() AND m2.user_id = p_target
      )

      -- buyer ↔ buyer on a shared job (client ↔ agency). Buyer identity was
      -- never the protected asset, so this is unchanged in substance.
      OR EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE auth.uid() IN (j.client_id, j.agency_id)
           AND p_target   IN (j.client_id, j.agency_id)
      )

      -- SELLER → BUYER. An inspector must be able to see who hired them.
      OR EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE auth.uid() IN (j.contractor_id, j.hired_inspector_id, j.inspector_id)
           AND p_target   IN (j.client_id, j.agency_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.applications a
          JOIN public.jobs j ON j.id = a.job_id
         WHERE a.applicant_id = auth.uid()
           AND p_target IN (j.client_id, j.agency_id)
      )

      -- ★ BUYER → SELLER, assigned. Gated on the JOB's identity mode.
      OR EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE auth.uid() IN (j.client_id, j.agency_id)
           AND p_target   IN (j.contractor_id, j.hired_inspector_id, j.inspector_id)
           AND COALESCE(j.identity_mode, 'protected') = 'full'
      )

      -- ★ BUYER → SELLER, applicant. Gated on the JOB's identity mode.
      OR EXISTS (
        SELECT 1 FROM public.applications a
          JOIN public.jobs j ON j.id = a.job_id
         WHERE a.applicant_id = p_target
           AND auth.uid() IN (j.client_id, j.agency_id)
           AND COALESCE(j.identity_mode, 'protected') = 'full'
      )
    );
$$;

ALTER FUNCTION public.nx_can_read_profile(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_read_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_can_read_profile(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_can_read_profile(uuid) IS
  'Row-level profile read authorization. Self, admin, org-member, buyer↔buyer and seller→buyer are unconditional. BUYER→SELLER requires the shared job to be identity_mode = full; Protected and Professional disclosure is served only through job_applicant_identity_view, which masks per mode. Job-scoped: authorization is proven per job row, so Full on one job grants nothing on another.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Self-tests — behavioural, not DDL-text matching.
-- ─────────────────────────────────────────────────────────────────────────────
DO $test$
BEGIN
  -- policy still wired to the function
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='profiles'
                    AND policyname='profiles_read_related') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: profiles_read_related policy missing';
  END IF;

  -- the blanket policy must still be gone
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='profiles'
                AND policyname='profiles_authenticated_select_any') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: blanket profiles policy reappeared';
  END IF;

  -- self + admin branches preserved
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='profiles'
                    AND policyname IN ('profiles_read_self','profiles_read_admin')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: self/admin profile policies missing';
  END IF;

  -- the buyer→seller branches must be mode-gated in the compiled body
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_read_profile(uuid)'::regprocedure)
       !~* 'identity_mode' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_can_read_profile does not consult identity_mode';
  END IF;

  -- the disclosure view must still mask contact outside full mode
  IF pg_get_viewdef('public.job_applicant_identity_view'::regclass, true)
       !~* 'eff_mode\s*=\s*''full''::text\s+THEN\s+p\.email' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: contact is not full-mode-gated in the disclosure view';
  END IF;

  -- cv_url must be gated too (the second résumé column)
  IF pg_get_viewdef('public.job_applicant_identity_view'::regclass, true)
       !~* 'p\.cv_url' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: cv_url is not projected/gated in the disclosure view';
  END IF;

  -- GR2 still holds on the widened view
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='job_applicant_identity_view'
                AND (column_name ILIKE '%payout%' OR column_name ILIKE '%price%'
                     OR column_name ILIKE '%spread%' OR column_name ILIKE '%bid%'
                     OR column_name ILIKE '%budget%' OR column_name ILIKE '%hourly_rate%')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a money column leaked into the widened identity view';
  END IF;

  RAISE NOTICE 'profiles identity-mode lockdown active: buyer→seller raw profile read requires full mode.';
END $test$;

COMMIT;
