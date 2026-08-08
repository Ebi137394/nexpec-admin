-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801322000_job_scoped_applicant_identity_and_audit_actor
--
--  Reverts to the pre-322000 behaviour EXACTLY:
--    • buyers lose application-stage identity disclosure (every proposal card
--      falls back to the NX- pseudonym — the bug this migration fixed),
--    • identity/replacement audit events go back to "Actor: Unknown",
--    • a counter bump is again reported as "Job details updated".
--
--  Safe to run: this migration only ADDED objects and replaced one function
--  body. Nothing it created is depended on by an earlier migration.
--
--  NOTE: the frontend reads job_applicant_identity_view. If you roll this back
--  without reverting the app, fetchJobApplicantDisclosure() fails closed (it
--  logs and returns an empty map), so cards render protected rather than
--  breaking. That is intentional.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TRIGGER IF EXISTS trg_audit_events_fill_actor ON public.audit_events;
DROP FUNCTION IF EXISTS public.tg_audit_events_fill_actor();

DROP VIEW IF EXISTS public.job_applicant_identity_view;
DROP FUNCTION IF EXISTS public.nx_job_effective_identity_mode(uuid);

-- Restore the 20260801294000 body verbatim (drops only the counter branch).
CREATE OR REPLACE FUNCTION public.audit_public_summary(p_summary text, p_is_buyer boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_summary IS NULL THEN NULL
    WHEN p_summary ~* '^Job fields updated:' THEN 'Job details updated'
    WHEN p_summary ~* '^Client price:' AND NOT COALESCE(p_is_buyer, false) THEN 'Pricing updated'
    ELSE regexp_replace(
           p_summary,
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
           '', 'gi')
  END;
$$;

COMMENT ON FUNCTION public.audit_public_summary(text, boolean) IS
  'Neutralises an audit summary for non-admin readers: removes the raw changed-column list the trigger appends, generalises a client-price summary for non-buyers, and strips embedded UUIDs.';

DO $verify$
BEGIN
  IF to_regclass('public.job_applicant_identity_view') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: disclosure view still present';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid='public.audit_events'::regclass
                AND tgname='trg_audit_events_fill_actor' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: actor back-fill trigger still present';
  END IF;
  RAISE NOTICE '322000 rolled back.';
END
$verify$;

COMMIT;
