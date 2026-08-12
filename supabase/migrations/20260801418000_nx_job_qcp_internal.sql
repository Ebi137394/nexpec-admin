-- ════════════════════════════════════════════════════════════════════════════
--  20260801418000_nx_job_qcp_internal.sql
--
--  Phase 4 closeout — the finding from the red-team pass that 30445f9 could not
--  finish. One concrete defect, one grant, no behaviour change for any caller.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  20260801412000 shipped nx_job_qcp(uuid) with the READER grant template:
--
--      REVOKE ALL ... FROM PUBLIC, anon;
--      GRANT EXECUTE ... TO authenticated, service_role;
--
--  but nx_job_qcp is not a reader. It is an INTERNAL resolver, and it performs
--  no authorization on the JOB it is handed. It authorises the PLAN — once, on
--  one of five branches:
--
--      p_job_id IS NULL          -> no row                    (safe)
--      job not found             -> no row                    (safe)
--      project_id IS NULL        -> 'no_project'    + count   ** UNGATED **
--      no plan on project        -> 'no_qcp'        + count   ** UNGATED **
--                                   ...AND project_id
--      >1 plan on project        -> 'ambiguous'     + count   ** UNGATED **
--                                   ...AND project_id
--      exactly one plan          -> nx_qcp_can_read(v_qcp)      (gated)
--
--  Three verdicts return before the only authorization check in the function,
--  and two of them return the project's uuid.
--
--  ── THE EXPLOIT PATH ───────────────────────────────────────────────────────
--  The function is SECURITY DEFINER and granted to `authenticated`, so it is a
--  PostgREST endpoint: POST /rest/v1/rpc/nx_job_qcp {"p_job_id": "..."}.
--
--  Any authenticated user of any organization, holding any job uuid they are
--  not a party to, learns:
--
--    * that the job exists at all                     (row vs no row)
--    * the uuid of the project governing it           ('no_qcp' | 'ambiguous')
--    * whether that project has 0, exactly 1, or >1 governing plans
--    * inferred_candidates — a count of quality_control_plans sharing the
--      job's scope template computed with NO organization scoping whatsoever,
--      i.e. a global census across every tenant on the platform.
--
--  None of it is content, pricing or a document. It is cross-tenant structural
--  metadata plus a project uuid that feeds every other uuid-guessing surface,
--  handed to a caller with no relationship to the job.
--
--  ── WHY THE GRANT IS SIMPLY WRONG ──────────────────────────────────────────
--  nx_job_qcp has no application caller. The web layer reaches QCP reporting
--  through nx_report_qcp_rollup / nx_qcp_rollup / nx_qcp_stage_progress only
--  (apps/web/src/lib/data/reportQcp.ts). Its sole caller anywhere is
--  nx_qcp_for_job (20260801416000), which is itself SECURITY DEFINER and so
--  executes it as owner — a path REVOKE does not touch.
--
--  20260801410000 already established the correct posture for exactly this
--  shape of function, on nx_qcp_scope_jobs:
--
--      REVOKE ALL ... FROM PUBLIC, anon, authenticated;
--      GRANT EXECUTE ... TO service_role;
--      COMMENT: 'INTERNAL. ... Performs no authorization and is granted to
--                service_role only; the gated readers call it as owner.'
--
--  412000 reached for the reader template instead of that internal template.
--  This migration corrects the grant. It is the smallest forward-only change
--  that closes the path: no function body is rewritten, no verdict changes, no
--  row is touched, and every existing caller keeps working byte-for-byte.
--
--  DELIBERATELY NOT CHANGED: the ungated early-return branches themselves. Once
--  the function is unreachable from PostgREST, its only caller is a gated
--  reader that already discards those verdicts' metadata (416000 returns rows
--  only on 'ok' — authorised by nx_qcp_can_read — or from the fallback, gated
--  by nx_qcp_visible IS NOT NULL). Rewriting the body would be a larger change
--  defending a door this migration locks.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The fix ──────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.nx_job_qcp(uuid) FROM authenticated;

-- Re-assert the rest of the posture rather than assuming it survived.
REVOKE ALL     ON FUNCTION public.nx_job_qcp(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nx_job_qcp(uuid) TO service_role;

COMMENT ON FUNCTION public.nx_job_qcp(uuid) IS
  'INTERNAL. THE canonical job -> governing QCP resolver, via the EXPLICIT jobs.project_id bridge. Returns a verdict (ok | no_project | no_qcp | no_effective_revision | ambiguous) so a caller can never mistake "ungoverned" for "not loaded". inferred_candidates counts plans reachable through the shared scope template and is DIAGNOSTIC EVIDENCE ONLY — a template is reusable, so that path is many-to-many and can never identify a governing document. Read authority on the resolved PLAN is delegated to nx_qcp_can_read, but this function performs NO authorization on the JOB and three of its five verdicts return before that check, two of them carrying project_id. It is therefore granted to service_role ONLY (20260801418000) and is not a PostgREST endpoint; the gated reader nx_qcp_for_job calls it as owner. Do not grant it to authenticated.';

-- ── 2. Correct one stale comment, same class of drift as 30445f9 ────────────
--  nx_qcp_scope_jobs still tells the next reader "There is no jobs.project_id
--  in this schema, so this is the only available linkage" — false since 412000,
--  and precisely the sentence that would justify reinstating inference as
--  primary. Comment only; the function body is Agent 4's and is not touched.
COMMENT ON FUNCTION public.nx_qcp_scope_jobs(uuid, uuid) IS
  'INTERNAL. The jobs whose execution a QCP revision governs, inferred from the shared template spine (jobs.scope_template_id = qcp_stage_templates.template_id) and constrained to the plan organisation via the buyer principal or the job department. SUPERSEDED AS GOVERNANCE by 20260801412000: jobs.project_id is now the canonical bridge and nx_job_qcp is the authoritative resolver. This template match is many-to-many and survives as DIAGNOSTIC scope only — it must never identify a governing document. Performs no authorization and is granted to service_role only; the gated readers call it as owner. Returns no pricing column.';

-- ── 3. Regression assertions ────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regprocedure('public.nx_job_qcp(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the canonical resolver is missing';
  END IF;

  -- The defect this migration exists to close.
  IF has_function_privilege('authenticated', 'public.nx_job_qcp(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'SELFTEST: nx_job_qcp is still EXECUTE-able by authenticated — it is a PostgREST endpoint leaking project_id and cross-tenant plan counts on its ungated verdicts';
  END IF;

  IF has_function_privilege('anon', 'public.nx_job_qcp(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: nx_job_qcp is reachable by anon';
  END IF;

  -- ...but the internal caller must still work.
  IF NOT has_function_privilege('service_role', 'public.nx_job_qcp(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: service_role lost EXECUTE on nx_job_qcp — nx_qcp_for_job cannot resolve';
  END IF;

  -- The canonical path must still be the canonical path.
  IF to_regprocedure('public.nx_qcp_for_job(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: nx_qcp_for_job is missing';
  END IF;

  IF strpos(pg_get_functiondef('public.nx_qcp_for_job(uuid)'::regprocedure), 'nx_job_qcp') = 0 THEN
    RAISE EXCEPTION
      'SELFTEST: nx_qcp_for_job no longer calls nx_job_qcp — scope-template inference would be authoritative again';
  END IF;

  -- nx_qcp_for_job stays a reader: revoking the internal must not cascade.
  IF NOT has_function_privilege('authenticated', 'public.nx_qcp_for_job(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: nx_qcp_for_job lost EXECUTE for authenticated — the reporting surface is dead';
  END IF;

  -- The money guard, restated because this migration touches the resolver.
  IF strpos(pg_get_functiondef('public.nx_job_qcp(uuid)'::regprocedure), 'base_price_cents') > 0 THEN
    RAISE EXCEPTION 'SELFTEST: the resolver touches base_price_cents';
  END IF;

  -- Ordering: the function must already exist from 412000.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_qcp_scope_jobs'
  ) THEN
    RAISE EXCEPTION 'ORDERING: 20260801410000 must apply before 418000';
  END IF;
END
$selftest$;

COMMIT;
