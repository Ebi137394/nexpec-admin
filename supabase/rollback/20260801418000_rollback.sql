-- ════════════════════════════════════════════════════════════════════════════
--  20260801418000_rollback.sql
--
--  Restores the 20260801412000 grant posture on nx_job_qcp.
--
--  WARNING: applying this rollback REOPENS the defect 418000 closes —
--  nx_job_qcp becomes a PostgREST endpoint again, and any authenticated caller
--  holding an arbitrary job uuid can read that job's project_id and a global,
--  unscoped count of quality_control_plans sharing its scope template. Roll
--  back only if a caller is discovered that genuinely needs the function from
--  the client, and prefer giving that caller a gated reader instead.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.nx_job_qcp(uuid) TO authenticated;

COMMENT ON FUNCTION public.nx_job_qcp(uuid) IS
  'THE canonical job -> governing QCP resolver, via the EXPLICIT jobs.project_id bridge. Returns a verdict (ok | no_project | no_qcp | no_effective_revision | ambiguous) so a caller can never mistake "ungoverned" for "not loaded". inferred_candidates counts plans reachable through the shared scope template and is DIAGNOSTIC EVIDENCE ONLY — a template is reusable, so that path is many-to-many and can never identify a governing document. Read authority is delegated to nx_qcp_can_read; an unauthorised caller receives no row at all.';

COMMIT;
