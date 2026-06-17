-- ════════════════════════════════════════════════════════════════════════════
--  20260713120000_audit_events_select_tenant_scoped.sql
--
--  SECURITY HARDENING (#58) — tighten audit_events SELECT to tenant scope.
--
--  20260711 enabled RLS + append-only immutability but kept SELECT deliberately
--  permissive (USING(true) TO authenticated) for zero-breakage. That left the
--  evidence log cross-tenant readable: any authenticated user could read every
--  inspector's / every job's audit trail. This scopes reads to what a caller is
--  entitled to, completing the Fort-Knox posture.
--
--  SCOPE (verified against every real read path, 2026-05-29):
--    • admin / super_admin            → all rows               (oversight pages: audit.ts, jobsModeration, disputesQueue, dashboardMetrics)
--    • own-actor (actor_id = uid)      → your recorded actions  (clientJobReport, clientReport idempotency reads)
--    • job party                       → events on your job     (client_id / contractor_id / agency_id — all auth.users ids)
--    • org member                      → your org's events      (org_id carried in metadata; future /client/structure)
--  The PipelineSection audit query references non-existent columns (payload/
--  event_kind) and is admin-context, so it is unaffected.
--
--  SAFETY: the org_id branch regex-validates the text BEFORE the ::uuid cast, so
--  a malformed metadata value can never raise inside an RLS predicate. Reversible
--  (re-create USING(true) to roll back). Proven by supabase/tests/rls_audit_events_test.sql.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS audit_events_select_auth   ON public.audit_events;
DROP POLICY IF EXISTS audit_events_select_scoped ON public.audit_events;

CREATE POLICY audit_events_select_scoped
  ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (
    -- Platform oversight.
    public.nx_is_admin()
    -- Your own recorded actions.
    OR actor_id = auth.uid()
    -- Events on a job you are a party to (client / inspector / agency).
    OR (
      job_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = audit_events.job_id
          AND (
            j.client_id     = auth.uid()
            OR j.contractor_id = auth.uid()
            OR j.agency_id     = auth.uid()
          )
      )
    )
    -- Org-scoped events for members of that org (org_id lives in metadata).
    -- The regex guards the ::uuid cast so a malformed value can never error RLS.
    OR (
      (metadata->>'org_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND public.is_member_of_org((metadata->>'org_id')::uuid)
    )
  );

COMMENT ON POLICY audit_events_select_scoped ON public.audit_events IS
  'Tenant-scoped read: admin (all) OR own-actor OR job-party OR org-member. Replaces the deliberately-permissive USING(true) from 20260711.';

COMMIT;
