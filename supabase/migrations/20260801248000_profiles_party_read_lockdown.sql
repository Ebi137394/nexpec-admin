-- ════════════════════════════════════════════════════════════════════════════
--  20260801248000_profiles_party_read_lockdown.sql
--
--  P0 — `profiles_authenticated_select_any USING(true)` let ANY authenticated
--  user bulk-read EVERY profile's PII (email/phone/cv_url/...) → anti-poaching
--  killer. Migration 160000 deliberately left it because ~19 cross-user reads
--  (direct + embedded `profiles(...)`) depend on it; dropping it blind breaks
--  job/chat/team/review screens.
--
--  ELEGANT FIX (zero app-code change, maximal stability): replace the blanket
--  policy with a PARTY-RELATIONSHIP row policy. A caller may read a profile row
--  only if they have a real relationship to that user:
--    • it's their own row            (also covered by profiles_read_self)
--    • they are admin/super_admin     (also covered by profiles_read_admin)
--    • they share a JOB               (client/agency/contractor on the same job)
--    • they are in the same ORG        (org_members)
--    • an APPLICATION links them        (job poster <-> applicant)
--
--  Why this is stable: self/admin/related reads — DIRECT and EMBEDDED, ALL
--  columns — keep working untouched (every enumerated legit reader falls into
--  one of the branches). Only a competitor with NO job/org/application tie to an
--  inspector is blocked from reading them, killing bulk enumeration. The
--  pseudonymous SECURITY DEFINER RPCs (get_marketplace_inspectors, etc.) are
--  unaffected (they run as definer). The 160000 RESTRICTIVE policy still ANDs on
--  top to hide an escrowed inspector's identity from the buyer pre-reveal.
--
--  NOTE (residual, by design): the application branch lets a job poster read
--  their OWN applicants' rows — bounded (not platform-wide) and already masked at
--  the UI projection layer (jobApplications nulls applicant PII). Long-term that
--  branch can be dropped once all applicant reads go through projections/RPCs.
--
--  Idempotent + self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Relationship oracle. SECURITY DEFINER so the existence checks see jobs/
-- org_members/applications regardless of THOSE tables' RLS (we only leak a
-- boolean). STABLE + pinned search_path.
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
      -- shares a job (any party pairing)
      OR EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
           AND p_target   IN (j.client_id, j.agency_id, j.contractor_id)
      )
      -- same organization
      OR EXISTS (
        SELECT 1 FROM public.org_members m1
          JOIN public.org_members m2 ON m1.org_id = m2.org_id
         WHERE m1.user_id = auth.uid() AND m2.user_id = p_target
      )
      -- application links a job poster and an applicant
      OR EXISTS (
        SELECT 1 FROM public.applications a
          JOIN public.jobs j ON j.id = a.job_id
         WHERE (a.applicant_id = p_target  AND auth.uid() IN (j.client_id, j.agency_id))
            OR (a.applicant_id = auth.uid() AND p_target   IN (j.client_id, j.agency_id))
      )
    );
$$;

ALTER FUNCTION public.nx_can_read_profile(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_read_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_can_read_profile(uuid) TO authenticated, service_role;

-- Swap the blanket policy for the party policy. (profiles_read_self +
-- profiles_read_admin remain as independent permissive policies — defense in
-- depth + they short-circuit the common self/admin paths cheaply.)
DROP POLICY IF EXISTS "profiles_authenticated_select_any" ON public.profiles;

DROP POLICY IF EXISTS "profiles_read_related" ON public.profiles;
CREATE POLICY "profiles_read_related" ON public.profiles FOR SELECT TO authenticated
  USING (public.nx_can_read_profile(id));

-- Self-test
DO $test$
DECLARE v_blanket int; v_related int; v_fn int;
BEGIN
  SELECT count(*) INTO v_blanket FROM pg_policies
   WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_authenticated_select_any';
  IF v_blanket > 0 THEN RAISE EXCEPTION 'SELFTEST FAILED: blanket profiles policy still present'; END IF;

  SELECT count(*) INTO v_related FROM pg_policies
   WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_read_related';
  IF v_related <> 1 THEN RAISE EXCEPTION 'SELFTEST FAILED: profiles_read_related missing'; END IF;

  SELECT count(*) INTO v_fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='nx_can_read_profile';
  IF v_fn < 1 THEN RAISE EXCEPTION 'SELFTEST FAILED: nx_can_read_profile missing'; END IF;

  -- self-read must still be permitted by the existing self policy
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_read_self') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: profiles_read_self missing (self-reads would break)';
  END IF;

  RAISE NOTICE 'profiles bulk-harvest sealed: party-relationship read policy active; self/admin/related preserved.';
END $test$;

COMMIT;
