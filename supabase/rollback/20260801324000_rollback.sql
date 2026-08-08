-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801324000_profiles_identity_mode_lockdown
--
--  ⚠  THIS REOPENS A KNOWN PRIVACY HOLE. Running it restores the 248000
--  behaviour in which any buyer can read an applicant's or assigned
--  inspector's ENTIRE profiles row — full_name, email, phone, resume_url,
--  cv_url, certifications — regardless of jobs.identity_mode. Protected
--  becomes presentation-only again.
--
--  Roll back ONLY if the lockdown breaks a production flow you cannot fix
--  forward, and treat the window as a live data-exposure incident.
--
--  The disclosure view is left in place (it is additive and harmless); only
--  the row-authorization function reverts, restoring 248000 verbatim.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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

DO $verify$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_read_profile(uuid)'::regprocedure)
       ~* 'identity_mode' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: nx_can_read_profile still consults identity_mode';
  END IF;
  RAISE WARNING '324000 rolled back — buyers can again read applicant PII regardless of identity_mode.';
END
$verify$;

COMMIT;
