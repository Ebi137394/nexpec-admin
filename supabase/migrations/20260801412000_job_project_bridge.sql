-- ════════════════════════════════════════════════════════════════════════════
--  20260801412000_job_project_bridge.sql
--
--  REPAIRS A DEFECT IN THE FROZEN QCP CONTRACT — the Lead's, not an agent's.
--
--  docs/qcp-canonical-contract.md scoped QCP to projects(id). But public.jobs
--  has no project column and public.projects has no inbound FK from the
--  operational schema. Three of the five Phase 4 lanes hit this independently:
--  a QCP could be authored, but nothing could resolve WHICH QCP governs a job.
--
--  Agent 4 worked around it by inferring the link from the shared spine
--      jobs.scope_template_id = qcp_stage_templates.template_id
--  and — correctly — labelled it ambiguous rather than asserting it. That
--  inference must NOT become the authoritative relationship: a scope template
--  is a REUSABLE inspection definition. Two plans in one organization may
--  legitimately reference the same template, so the inference is many-to-many
--  and cannot identify a governing document. It survives here as DIAGNOSTIC
--  EVIDENCE only.
--
--  ── THE CANONICAL PATH, NOW EXPLICIT ───────────────────────────────────────
--      PROJECT → JOB → VISIT / INSPECTION / ITP / REPORT
--      PROJECT → QCP
--  therefore
--      JOB → PROJECT → EFFECTIVE QCP
--
--  ── ADDITIVE AND NON-DESTRUCTIVE ───────────────────────────────────────────
--  jobs.project_id is NULLABLE with no backfill of any kind. Every existing job
--  keeps project_id NULL and behaves exactly as before: nx_job_qcp returns a
--  'no_project' verdict and every ungoverned surface is unchanged. Nothing is
--  rewritten, nothing is inferred into the column.
--
--  ── RE-PARENTING IS AN AUTHORITY, NOT A FIELD EDIT ─────────────────────────
--  Moving a job between projects moves it between governing quality documents,
--  so it is gated like one. A BEFORE trigger enforces, for any non-NULL value:
--    · the project must belong to an organization the writer may AUTHOR for
--      (nx_qcp_org_author — same predicate that authors a QCP, from 406000),
--      so an inspector, supplier or unrelated user cannot re-parent anything;
--    · the buyer principal COALESCE(agency_id, client_id) must be a reader of
--      that organization, so a job cannot be filed under a stranger's project.
--  Clearing to NULL requires the same author right over the CURRENT project.
--  service_role and migrations (auth.uid() IS NULL) are unaffected.
--
--  ── FAIL SAFE, NEVER GUESS ─────────────────────────────────────────────────
--  nx_job_qcp returns a verdict, not a bare uuid, so a caller cannot mistake
--  "no governing plan" for "plan not loaded":
--      ok | no_project | no_qcp | no_effective_revision | ambiguous
--  'ambiguous' means the data violates the contract's one-effective-revision
--  rule; it resolves to NULL and says so rather than picking a winner.
--
--  ── SCOPE ──────────────────────────────────────────────────────────────────
--  No QCP table, RPC or policy from 406000/408000/410000 is altered. No money
--  column is read or written; base_price_cents is never touched. Payment stays
--  manual and nothing here can trigger a settlement.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The explicit bridge ──────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.jobs.project_id IS
  'The project this job belongs to, or NULL for an ungoverned job. THE canonical path to the governing quality document: JOB -> PROJECT -> effective QCP revision. Nullable and never backfilled — every pre-existing job stays NULL and behaves exactly as before. Do NOT infer this from scope_template_id: a scope template is a reusable inspection definition and the same template may appear in many plans.';

CREATE INDEX IF NOT EXISTS jobs_project_idx ON public.jobs (project_id)
  WHERE project_id IS NOT NULL;

-- ── 2. Coherence: who may file a job under which project ────────────────────
CREATE OR REPLACE FUNCTION public.tg_jobs_project_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_new_org   uuid;
  v_old_org   uuid;
  v_principal uuid;
BEGIN
  -- Unchanged pointer on UPDATE: nothing to police.
  IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;

  -- service_role, migrations and triggers run with no session user. They are
  -- already trusted; policing them here would break seeding and backfills.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Clearing the pointer still moves the job out of a governed plan.
  IF TG_OP = 'UPDATE' AND OLD.project_id IS NOT NULL THEN
    SELECT p.organization_id INTO v_old_org FROM public.projects p WHERE p.id = OLD.project_id;
    IF v_old_org IS NOT NULL AND NOT public.nx_qcp_org_author(v_old_org, v_uid) THEN
      RAISE EXCEPTION
        'JOB_REPARENT_DENIED: you may not move job % out of its current project — that changes which quality plan governs it',
        NEW.id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.organization_id INTO v_new_org FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_new_org IS NULL THEN
    RAISE EXCEPTION 'project % does not exist', NEW.project_id USING ERRCODE = '23503';
  END IF;

  -- Only someone who could author that organization's quality plan may file a
  -- job under it. Inspectors, suppliers and unrelated users are excluded by
  -- construction — this is the same predicate 406000 uses to author a QCP.
  IF NOT public.nx_qcp_org_author(v_new_org, v_uid) THEN
    RAISE EXCEPTION
      'JOB_REPARENT_DENIED: you may not file a job under project % — it belongs to another organization',
      NEW.project_id USING ERRCODE = '42501';
  END IF;

  -- …and the job's own buyer must belong to that organization, so a job cannot
  -- be filed under a project the buyer has no relationship with.
  v_principal := COALESCE(NEW.agency_id, NEW.client_id);
  IF v_principal IS NOT NULL AND NOT public.nx_qcp_org_reader(v_new_org, v_principal) THEN
    RAISE EXCEPTION
      'JOB_PROJECT_INCOHERENT: the buyer of job % is not part of the organization that owns project %',
      NEW.id, NEW.project_id USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION public.tg_jobs_project_coherence() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_jobs_project_coherence ON public.jobs;
CREATE TRIGGER trg_jobs_project_coherence
  BEFORE INSERT OR UPDATE OF project_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_project_coherence();

COMMENT ON TRIGGER trg_jobs_project_coherence ON public.jobs IS
  'Re-parenting a job moves it between governing quality documents, so it is gated like an authority rather than a field edit: the writer must be able to AUTHOR for the target project''s organization, and the job''s buyer principal must be a reader of it. Structural, so it binds PostgREST and any future writer, not just an RPC.';

-- ── 3. The canonical resolver — a verdict, never a guess ────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_qcp(p_job_id uuid)
RETURNS TABLE (
  status              text,   -- ok | no_project | no_qcp | no_effective_revision | ambiguous
  project_id          uuid,
  qcp_id              uuid,
  revision_id         uuid,
  revision_no         int,
  inferred_candidates int     -- DIAGNOSTIC ONLY, never authoritative
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job      RECORD;
  v_qcp      uuid;
  v_n        int;
  v_rev      RECORD;
  v_inferred int := 0;
BEGIN
  IF p_job_id IS NULL THEN RETURN; END IF;

  SELECT j.id, j.project_id, j.scope_template_id INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Authorisation is delegated, never restated: if you cannot read the job's
  -- QCP you get nothing. nx_qcp_can_read comes from 406000.
  -- Diagnostic inference, computed for evidence only and never returned as an
  -- identity. It exists so an operator can SEE that a job looks like it should
  -- belong to a plan while project_id is unset.
  IF v_job.scope_template_id IS NOT NULL THEN
    SELECT count(DISTINCT q.id)::int INTO v_inferred
      FROM public.qcp_stage_templates qst
      JOIN public.qcp_stages    s ON s.id = qst.stage_id
      JOIN public.qcp_revisions r ON r.id = s.revision_id
      JOIN public.quality_control_plans q ON q.id = r.qcp_id
     WHERE qst.template_id = v_job.scope_template_id;
  END IF;

  IF v_job.project_id IS NULL THEN
    RETURN QUERY SELECT 'no_project'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::int, v_inferred;
    RETURN;
  END IF;

  SELECT count(*)::int INTO v_n
    FROM public.quality_control_plans q WHERE q.project_id = v_job.project_id;
  IF v_n = 0 THEN
    RETURN QUERY SELECT 'no_qcp'::text, v_job.project_id, NULL::uuid, NULL::uuid, NULL::int, v_inferred;
    RETURN;
  END IF;
  IF v_n > 1 THEN
    -- More than one plan per project is outside the contract. Say so; do not
    -- pick one and pretend the platform knows which document governs.
    RETURN QUERY SELECT 'ambiguous'::text, v_job.project_id, NULL::uuid, NULL::uuid, NULL::int, v_inferred;
    RETURN;
  END IF;

  SELECT q.id INTO v_qcp
    FROM public.quality_control_plans q WHERE q.project_id = v_job.project_id;

  IF NOT public.nx_qcp_can_read(v_qcp) THEN
    RETURN;                                  -- no row: not yours to see
  END IF;

  SELECT r.id, r.revision_no INTO v_rev
    FROM public.qcp_revisions r
   WHERE r.qcp_id = v_qcp AND r.status = 'approved';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_effective_revision'::text, v_job.project_id, v_qcp, NULL::uuid, NULL::int, v_inferred;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_job.project_id, v_qcp, v_rev.id, v_rev.revision_no, v_inferred;
END;
$$;
ALTER FUNCTION public.nx_job_qcp(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_qcp(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_qcp(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_job_qcp(uuid) IS
  'THE canonical job -> governing QCP resolver, via the EXPLICIT jobs.project_id bridge. Returns a verdict (ok | no_project | no_qcp | no_effective_revision | ambiguous) so a caller can never mistake "ungoverned" for "not loaded". inferred_candidates counts plans reachable through the shared scope template and is DIAGNOSTIC EVIDENCE ONLY — a template is reusable, so that path is many-to-many and can never identify a governing document. Read authority is delegated to nx_qcp_can_read; an unauthorised caller receives no row at all.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='jobs' AND column_name='project_id') THEN
    RAISE EXCEPTION 'SELFTEST: the jobs->projects bridge column is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='jobs' AND column_name='project_id'
                AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'SELFTEST: jobs.project_id must be NULLABLE — existing jobs are never backfilled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_jobs_project_coherence' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: job re-parenting is ungated';
  END IF;
  IF to_regprocedure('public.nx_job_qcp(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the canonical resolver is missing';
  END IF;

  -- The inference must never be the authority.
  IF strpos(regexp_replace(pg_get_functiondef('public.nx_job_qcp(uuid)'::regprocedure),
                           '--[^\n]*','','g'),
            'v_job.project_id IS NULL') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: nx_job_qcp does not branch on the explicit project bridge';
  END IF;

  -- Ordering + nothing disturbed.
  IF to_regprocedure('public.nx_qcp_can_read(uuid)') IS NULL
     OR to_regprocedure('public.nx_qcp_org_author(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ORDERING: 20260801406000 must apply before 412000';
  END IF;
  IF has_function_privilege('anon', 'public.nx_job_qcp(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: nx_job_qcp is reachable by anon';
  END IF;

  -- No money surface may have been introduced.
  IF strpos(pg_get_functiondef('public.nx_job_qcp(uuid)'::regprocedure), 'base_price_cents') > 0 THEN
    RAISE EXCEPTION 'SELFTEST: the resolver touches base_price_cents';
  END IF;
END
$verify$;

COMMIT;
