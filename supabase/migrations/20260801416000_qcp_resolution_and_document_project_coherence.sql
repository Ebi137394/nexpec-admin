-- ════════════════════════════════════════════════════════════════════════════
--  20260801416000_qcp_resolution_and_document_project_coherence.sql
--
--  The two reconciliation tasks left after 20260801412000 introduced the
--  explicit jobs.project_id bridge. Both lanes below were authored BEFORE that
--  bridge existed and were correct for the schema they were written against;
--  neither is being blamed, both are being brought onto the canonical path.
--
--  ── TASK 1: nx_qcp_for_job MUST ASK THE BRIDGE FIRST ───────────────────────
--  20260801410000 resolves a job's governing plan by matching the shared scope
--  template:  jobs.scope_template_id = qcp_stage_templates.template_id.
--  Its own comment says why it had to: "because this schema has no
--  jobs.project_id". It now does.
--
--  A scope template is a REUSABLE inspection definition. Two plans in one
--  organization may legitimately reference the same template, so that match is
--  many-to-many and cannot identify a governing document — it can only ever
--  produce candidates. 412000 made the real relationship explicit, and the
--  amended contract (docs/qcp-canonical-contract.md §0b) makes it canonical.
--
--  This rewrite keeps the function's NAME, ARGUMENT and RETURN SHAPE so every
--  existing caller (nx_report_qcp_rollup, the review queue, reportQcp.ts) keeps
--  working untouched, and changes only how it decides:
--
--    1. Ask nx_job_qcp(job). If it says 'ok', that is the answer. Done.
--    2. If it says 'ambiguous', return NOTHING. Two plans on one project is a
--       contract violation; guessing which one governs a job is exactly the
--       failure this migration exists to prevent.
--    3. If it says no_project / no_qcp / no_effective_revision, fall back to
--       the template inference — but ONLY as diagnostic candidates, and the
--       audience column is suffixed ':inferred' so no caller can mistake a
--       guess for governance without opting in.
--
--  candidate_count keeps its meaning in both branches: plans this caller may
--  read. On the explicit path it is 1 by construction.
--
--  ── TASK 2: DOCUMENT COHERENCE BECOMES PROJECT-LEVEL ───────────────────────
--  20260801408000 could only enforce ORGANIZATION-level coherence on QCP
--  required documents, and said so plainly — at the time there was no project
--  path from a job, so "same project" was inexpressible. With jobs.project_id
--  the stricter rule is now expressible and is enforced here.
--
--  Rule: when a QCP required-document row points at a document that is reachable
--  from a JOB, that job's project must equal the QCP's project.
--
--  LEGACY IS PRESERVED DELIBERATELY. A job with project_id IS NULL is
--  ungoverned and is NOT rejected — 412000 guarantees such jobs keep working
--  unchanged, and retro-blocking them here would break that promise and strand
--  existing customer documents. Only a job that HAS a project and whose project
--  DISAGREES is refused. Nothing is rewritten, nothing is deleted, and the rule
--  applies to new writes only.
--
--  ── NOT WEAKENED ───────────────────────────────────────────────────────────
--  20260801414000's project_documents lockdown is untouched: anon stays
--  revoked, RLS stays on, uploader_id stays pinned, and this migration adds no
--  grant to any table. No money column is read or written anywhere. Payment
--  remains manual.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── TASK 1 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_qcp_for_job(p_job_id uuid)
RETURNS TABLE (qcp_id uuid, revision_id uuid, candidate_count int, audience text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_v   RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  -- ── 1. THE CANONICAL PATH: JOB -> PROJECT -> EFFECTIVE QCP ───────────────
  SELECT * INTO v_v FROM public.nx_job_qcp(p_job_id) LIMIT 1;

  IF FOUND AND v_v.status = 'ok' THEN
    -- nx_job_qcp already applied nx_qcp_can_read, so reaching here means the
    -- caller may read this plan. nx_qcp_visible supplies the audience label the
    -- existing callers expect.
    RETURN QUERY
      SELECT v_v.qcp_id, v_v.revision_id, 1,
             public.nx_qcp_visible(v_v.qcp_id, v_uid);
    RETURN;
  END IF;

  -- ── 2. AMBIGUOUS MEANS STOP ──────────────────────────────────────────────
  -- More than one plan on the project violates the contract's
  -- one-plan-per-project rule. Returning nothing is the fail-safe: a report
  -- that says "no governing plan I can name" is recoverable; a report that
  -- silently names the wrong quality document is not.
  IF FOUND AND v_v.status = 'ambiguous' THEN
    RETURN;
  END IF;

  -- ── 3. DIAGNOSTIC FALLBACK, EXPLICITLY LABELLED ──────────────────────────
  -- Reached only when the job has no project, the project has no plan, or the
  -- plan has no effective revision. The template match may still be useful
  -- context to an operator, so it is offered — with ':inferred' welded onto the
  -- audience so a surface must consciously accept a guess.
  RETURN QUERY
  WITH cand AS (
    SELECT DISTINCT q.id AS c_qcp, r.id AS c_rev, r.approved_at AS c_at
      FROM public.jobs                  jb
      JOIN public.qcp_stage_templates   st ON st.template_id = jb.scope_template_id
      JOIN public.qcp_stages            s  ON s.id  = st.stage_id
      JOIN public.qcp_revisions         r  ON r.id  = s.revision_id
                                          AND r.status = 'approved'
      JOIN public.quality_control_plans q  ON q.id  = r.qcp_id
     WHERE jb.id = p_job_id
       AND jb.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.nx_qcp_scope_jobs(q.id, r.id) sj
                    WHERE sj.job_id = p_job_id)
  ), vis AS (
    SELECT c.c_qcp, c.c_rev, c.c_at,
           public.nx_qcp_visible(c.c_qcp, v_uid) AS c_aud
      FROM cand c
  )
  SELECT v.c_qcp, v.c_rev,
         (SELECT count(*)::int FROM vis w WHERE w.c_aud IS NOT NULL),
         v.c_aud || ':inferred'
    FROM vis v
   WHERE v.c_aud IS NOT NULL
   ORDER BY v.c_at DESC NULLS LAST
   LIMIT 1;
END $fn$;
ALTER FUNCTION public.nx_qcp_for_job(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_for_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_for_job(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_for_job(uuid) IS
  'The quality control plan governing a job. Resolves through the CANONICAL bridge first — nx_job_qcp(job): JOB -> PROJECT -> EFFECTIVE QCP. Returns nothing when that verdict is ''ambiguous'', because two plans on one project is a contract violation and guessing which governs is worse than declining. Only when the job has no project, no plan or no effective revision does it fall back to matching the shared scope template, and that result carries audience suffixed '':inferred'' — a scope template is a REUSABLE definition, so the match is many-to-many and is diagnostic evidence, never governance. Returns no pricing column.';

-- ── TASK 2 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_qcp_document_project_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_qcp_project uuid;
  v_doc_project uuid;
BEGIN
  IF NEW.document_id IS NULL THEN
    RETURN NEW;                      -- required but not yet supplied
  END IF;

  SELECT q.project_id INTO v_qcp_project
    FROM public.qcp_required_documents d
    JOIN public.qcp_revisions          r ON r.id = d.revision_id
    JOIN public.quality_control_plans  q ON q.id = r.qcp_id
   WHERE d.id = NEW.id;

  IF v_qcp_project IS NULL THEN
    -- The row's own revision resolves the plan; if that is not yet visible the
    -- FK chain will fail on its own. Nothing to police here.
    RETURN NEW;
  END IF;

  -- The project this document is reachable from, via its job. project_documents
  -- is job-scoped (its job_id column), so the job is the bridge.
  SELECT j.project_id INTO v_doc_project
    FROM public.project_documents pd
    JOIN public.jobs j ON j.id = pd.job_id
   WHERE pd.id = NEW.document_id;

  -- Not job-reachable, or the job is ungoverned (project_id IS NULL): allowed.
  -- 412000 guarantees NULL-project jobs keep working exactly as before, and
  -- retro-blocking legacy documents here would break that promise.
  IF v_doc_project IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_doc_project IS DISTINCT FROM v_qcp_project THEN
    RAISE EXCEPTION
      'QCP_DOCUMENT_CROSS_PROJECT: document % belongs to project %, but this quality plan governs project % — a requirement cannot be satisfied by another project''s document',
      NEW.document_id, v_doc_project, v_qcp_project
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION public.tg_qcp_document_project_coherence() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_qcp_document_project_coherence ON public.qcp_required_documents;
CREATE TRIGGER trg_qcp_document_project_coherence
  BEFORE INSERT OR UPDATE OF document_id ON public.qcp_required_documents
  FOR EACH ROW
  WHEN (NEW.document_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_qcp_document_project_coherence();

COMMENT ON TRIGGER trg_qcp_document_project_coherence ON public.qcp_required_documents IS
  'A QCP requirement may only be satisfied by a document from its own project. 20260801408000 could enforce organization-level coherence only, because no project path existed from a job until 20260801412000 added jobs.project_id. Legacy is preserved on purpose: a document on a job with project_id IS NULL is ungoverned and still accepted, matching 412000''s guarantee that pre-existing jobs behave exactly as before. New writes only; no row is rewritten.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE v_src text;
BEGIN
  IF to_regprocedure('public.nx_job_qcp(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ORDERING: 20260801412000 must apply before 416000';
  END IF;
  IF to_regprocedure('public.nx_qcp_for_job(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ORDERING: 20260801410000 must apply before 416000';
  END IF;

  v_src := regexp_replace(
             pg_get_functiondef('public.nx_qcp_for_job(uuid)'::regprocedure),
             '--[^\n]*', '', 'g');

  IF strpos(v_src, 'nx_job_qcp') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: nx_qcp_for_job does not consult the canonical bridge — scope-template inference would still govern';
  END IF;
  IF strpos(v_src, '''ambiguous''') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: nx_qcp_for_job does not fail safe on an ambiguous verdict';
  END IF;
  IF strpos(v_src, ':inferred') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the diagnostic fallback is not labelled — a guess could be read as governance';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_qcp_document_project_coherence' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: QCP document coherence is still organization-level only';
  END IF;

  -- 414000 must not have been weakened by anything here.
  IF has_table_privilege('anon', 'public.project_documents', 'SELECT')
     OR has_table_privilege('authenticated', 'public.project_documents', 'DELETE') THEN
    RAISE EXCEPTION 'REGRESSION: the 20260801414000 project_documents lockdown was weakened';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname='public' AND tablename='project_documents' AND rowsecurity) THEN
    RAISE EXCEPTION 'REGRESSION: RLS was disabled on project_documents';
  END IF;

  -- No price surface introduced.
  IF strpos(pg_get_functiondef('public.nx_qcp_for_job(uuid)'::regprocedure), 'base_price_cents') > 0 THEN
    RAISE EXCEPTION 'SELFTEST: nx_qcp_for_job touches base_price_cents';
  END IF;
  IF has_function_privilege('anon', 'public.nx_qcp_for_job(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: nx_qcp_for_job is reachable by anon';
  END IF;
END
$verify$;

COMMIT;
