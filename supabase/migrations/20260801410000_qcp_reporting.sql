-- ════════════════════════════════════════════════════════════════════════════
--  20260801410000_qcp_reporting.sql
--
--  PHASE 4 — QCP ↔ REPORTING / ANALYTICS INTEGRATION. Additive, read-only.
--
--  This migration integrates the QCP layer (20260801406000, Agent 1) into the
--  reporting system that ALREADY EXISTS. It builds no Reports v2 and no
--  Analytics v2. It adds no table, no column, no report row, no report status,
--  no second template model, no second publish path, no second NCR record and
--  no progress column.
--
--  ── THE MODEL IT COPIES ────────────────────────────────────────────────────
--  20260801390000 (visits) and 20260801400000 (ITP) solved the identical
--  problem twice. Their three decisions are reproduced here in shape:
--
--    1. A REPORT-SCOPED READER, not a report column. inspection_reports stays
--       one row per (job, inspector); the QCP dimension lives where it already
--       is and is READ per report.
--    2. THE ROLLUP RIDES INSIDE THE EXISTING QUEUE RPC. qcp_rollup is APPENDED
--       to nx_admin_report_review_queue exactly as visit_rollup (390000) and
--       itp_rollup (400000) were, and both of those columns are preserved in
--       place and in order so every existing reader keeps working.
--    3. FALLBACK DISCIPLINE. has_qcp=false means the report's job is governed
--       by no quality control plan and the surface MUST render NOTHING. An
--       empty "0 of 0 plan" is a claim about quality governance the engagement
--       never made — the same discipline from_fallback and has_itp carry.
--
--  ── WHAT THE INVENTORY ACTUALLY FOUND (evidence, not assumption) ───────────
--
--  A. THE LIVE REPORTING SPINE, and what is dead in it:
--     LIVE   inspection_reports (baseline 23076), one row per (job,inspector),
--            pinned by unique_report_per_job_inspector.
--     LIVE   report_templates (baseline 11291) + get_template_for_job (11328) +
--            lock_report_template (13230) + set_default_template (17287);
--            spec_sha256 / is_locked are the template hash-and-freeze path.
--     LIVE   get_client_branding (baseline 10556) — logo/header/footer.
--     LIVE   pi_report_seals (14958) + pi_seal_inspection_report (15326) +
--            pi_countersign_inspection_report (15006) + inspection_seal_anchors
--            (23139) — the report hash / notarisation path.
--     LIVE   nx_admin_review_inspection_report (20260801364000:48) — admin
--            review; approve_inspection_report (20260801162000:30) — client
--            publishing, which publishes BY JOB, not by report row.
--     LIVE   nx_report_visit_rollup / nx_report_visit_log (390000:219,281),
--            nx_report_contributors (390000:93), nx_report_itp_log /
--            nx_report_itp_rollup (400000:94,262).
--     DEAD   handle_inspection_report_state_machine (baseline 11725),
--            handle_report_status_change (12079), handle_report_submission
--            (12123): they write revision_count / revision_history /
--            revision_notes / submitted_at / approved_at, NONE of which exist
--            on inspection_reports, and none of the three is attached. 390000
--            and 400000 both pin that they stay unattached because the first
--            one contains UPDATE jobs SET status='completed', which fires
--            settlement. Re-pinned below: this file touches the same queue.
--     DEAD   REPORT REVISIONING as a first-class object. There is no revision
--            table and no revision column on inspection_reports. The live trail
--            is audit_events + job_events + status='revision_requested'. QCP
--            revisioning is a DIFFERENT thing (qcp_revisions, Agent 1) and this
--            file does not conflate the two.
--     UI-DEAD nothing in apps/ reads itp_rollup yet (400000 shipped it into the
--            queue; reportReview.ts maps visit_rollup only). qcp_rollup lands
--            in the same place and is likewise DB-live / UI-pending.
--
--  B. THE "EXISTING ANALYTICS INFRASTRUCTURE" — the honest finding:
--     There is no non-money, non-dead analytics surface to hang QCP on.
--       • get_dashboard_analytics()  (baseline 10588) is DEAD: it selects
--         jobs.client_price and jobs.payout_amount, neither of which exists on
--         jobs (the live columns are the *_cents pair). It raises 42703 the
--         moment it is called.
--       • get_spending_dashboard(project) (11261) and public_stats() (15707)
--         are money surfaces (budget / payments / escrow_cents).
--       • get_inspector_dashboard_stats() (10770), inspector_integrity_analytics
--         (12394) and get_project_dispute_stats (11182) are live but are about
--         inspectors and disputes, not quality plans.
--     Extending any of them would either resurrect a dead function or push
--     quality data into a commercial one. Neither is done. QCP analytics are
--     therefore delivered as money-free readers, and the single LIVE report
--     surface (the admin review queue) is the only existing function widened.
--
--  C. THE PROJECT ↔ JOB GAP — reported, not papered over.
--     The frozen contract scopes a QCP to projects(id). inspection_reports is
--     scoped to jobs. THERE IS NO LINK: public.jobs has no project_id, no
--     bridge table exists, and public.projects has no inbound foreign key at
--     all in the baseline. A report therefore cannot reach its QCP through a
--     project, and inventing jobs.project_id would be a schema change in
--     Agent 1's lane and a model change in nobody's.
--
--     The contract itself supplies the only non-inventive bridge. Both sides
--     already point at the SAME template spine:
--         jobs.scope_template_id           → inspection_scope_templates(id)
--         qcp_stage_templates.template_id  → inspection_scope_templates(id)
--     A job is GOVERNED BY a QCP revision when that revision's stages link the
--     job's scope template AND the plan's organization is the job's buyer-side
--     organization. That inference is implemented once, in nx_qcp_for_job, is
--     labelled in every payload it feeds (from_scope_template_link), reports
--     candidate_count so an ambiguous match can be declined by the surface, and
--     degrades to has_qcp=false rather than guessing. It adds no schema.
--     THIS IS AN INFERRED LINKAGE AND IS FLAGGED AS A CONTRACT GAP.
--
--  ── PROGRESS IS DERIVED, NEVER STORED (contract §2) ────────────────────────
--  There is no progress column and this migration adds none. Progress is
--  computed at read time along the path the contract names:
--        itp_point_results → itp_points → (template_id)
--                          ← qcp_stage_templates → qcp_stages → qcp_revisions
--  The UNIT of progress is the (job, point) checkpoint instance: for every job
--  the plan governs, every ACTIVE point on that job's scope template. The state
--  of an instance is the LAST result recorded for it across every visit —
--  exactly the rule nx_report_itp_log already uses — and the blocking rule is
--  lifted from nx_job_itp unchanged: a blocking point neither passed/waived/
--  not_applicable nor released. A plan with templates but no dispatched jobs
--  reports plan_point_count > 0, instance_count = 0 and percent_complete NULL,
--  so a surface can say "the plan defines 42 points; no work dispatched" and
--  never invent a denominator.
--
--  ── PRICE PRIVACY — THE PRIMARY RISK IN THIS LANE ──────────────────────────
--  inspection_scope_templates carries a PRICE column, and every function here
--  joins that table to resolve the stage↔template link. Three defences:
--    1. No function selects * from it, or from any join containing it. Only
--       id and name are ever read, named explicitly.
--    2. No function here selects, joins or returns any *_cents column, wallet,
--       transaction, buyer price, inspector payout or platform spread. There is
--       nowhere for them to land.
--    3. The negative price guard below scans the compiled bodies and the
--       declared parameters, and names the scope-template price column
--       EXPLICITLY in addition to the 400000/402000 list. It also sweeps every
--       view in public for a QCP view leaking it, because this file creates NO
--       view precisely so that no PostgREST surface can.
--
--  ── IDENTITY ───────────────────────────────────────────────────────────────
--  20260801390000 fixed a real leak of exactly this kind: nx_report_contributors
--  returned full_name to buyers with no gate. It is not reintroduced. The rule
--  here is stronger than a gate and cannot silently regress: NO function in
--  this migration returns full_name, email, phone or company_name AT ALL.
--  Actors appear as nx_handle() pseudonyms or as counts, never as names, in
--  every direction — buyer, supplier and inspector alike. nx_report_qcp_rollup
--  additionally consults nx_job_effective_identity_mode (fail-closed to
--  'protected') and publishes identity_disclosed, so any future surface that
--  wants a name must pass the same gate every other buyer surface passes.
--  Both facts are self-tested.
--
--  ── AUTHORIZATION (contract §4, fail closed) ───────────────────────────────
--  nx_qcp_visible returns the caller's audience — 'admin' | 'org' | 'supplier'
--  | 'inspector' — or NULL, and NULL means refused. Supplier output is masked
--  to requirements / documents / revision status: never another party's
--  execution detail, never another supplier, never a price. Inspector output is
--  restricted to the EFFECTIVE approved revision and further narrowed to the
--  jobs that inspector is actually engaged on, so a plan spanning ten jobs
--  never shows one crew the other nine crews' findings.
--
--  ── ZERO PAYMENT EFFECT ────────────────────────────────────────────────────
--  Every function here is STABLE and reads only. Nothing credits, settles,
--  transfers or moves a balance; nothing writes admin_confirmed_at,
--  is_published or is_client_approved; no approval and no report has a payment
--  side effect. Self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0) Precondition: the frozen QCP schema must be present ──────────────────
--  Forward-only ordering puts 20260801406000 ahead of this file. Saying so
--  explicitly turns a confusing cascade of "relation does not exist" into one
--  sentence naming the lane that owes the dependency.
DO $pre$
BEGIN
  IF to_regclass('public.quality_control_plans') IS NULL
     OR to_regclass('public.qcp_revisions')          IS NULL
     OR to_regclass('public.qcp_stages')             IS NULL
     OR to_regclass('public.qcp_stage_templates')    IS NULL
     OR to_regclass('public.qcp_required_documents') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: the frozen QCP schema (20260801406000, Agent 1) is not applied. QCP reporting has nothing to read.';
  END IF;
  IF to_regclass('public.itp_points') IS NULL
     OR to_regclass('public.itp_point_results') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: the ITP foundation (20260801398000) is missing — derived progress has no source.';
  END IF;
END
$pre$;

-- ── 1) The governed job set — the ONE place the linkage is expressed ────────
--  INTERNAL DERIVATION, deliberately not granted to authenticated: it performs
--  no authorization of its own, because nx_qcp_visible below needs it to decide
--  whether a caller is an engaged inspector, and a helper that gated itself
--  would make that circular. Every public reader in this file gates first and
--  then calls this as its owner. Granted to service_role only.
--
--  Two organisation paths, both pre-existing: the buyer principal's org
--  membership, and the job's department. Job ownership is NOT re-defined here —
--  nx_job_buyer_principal is the single definition of COALESCE(agency_id,
--  client_id) and is called rather than copied.
--
--  The scope-template table is NEVER read here, not even by name: the link is
--  followed by key, template_id to template_id, so there is no column list to
--  get wrong.
--
--  The revision is re-tied to the plan (r.qcp_id = q.id) rather than trusted
--  from the argument. Every caller already passes a revision that belongs to
--  the plan, but a helper that answers for a revision of some OTHER plan while
--  applying THIS plan's organisation filter is a confused deputy waiting to
--  happen.
CREATE OR REPLACE FUNCTION public.nx_qcp_scope_jobs(p_qcp_id uuid, p_revision_id uuid)
RETURNS TABLE (job_id uuid, template_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT DISTINCT j.id, st.template_id
    FROM public.quality_control_plans q
    JOIN public.qcp_revisions        r  ON r.id = p_revision_id
                                       AND r.qcp_id = q.id
    JOIN public.qcp_stages           s  ON s.revision_id = r.id
    JOIN public.qcp_stage_templates  st ON st.stage_id   = s.id
    JOIN public.jobs                 j  ON j.scope_template_id = st.template_id
                                       AND j.deleted_at IS NULL
   WHERE q.id = p_qcp_id
     AND (
       EXISTS (SELECT 1 FROM public.org_members om
                WHERE om.org_id  = q.organization_id
                  AND om.user_id = public.nx_job_buyer_principal(j.id))
       OR EXISTS (SELECT 1 FROM public.organizations o
                   WHERE o.id = q.organization_id
                     AND o.owner_id = public.nx_job_buyer_principal(j.id))
       OR EXISTS (SELECT 1 FROM public.org_departments d
                   WHERE d.id = j.department_id
                     AND d.org_id = q.organization_id)
     );
$fn$;

ALTER FUNCTION public.nx_qcp_scope_jobs(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_scope_jobs(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_qcp_scope_jobs(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.nx_qcp_scope_jobs(uuid, uuid) IS
  'INTERNAL. The jobs whose execution a QCP revision governs, inferred from the shared template spine (jobs.scope_template_id = qcp_stage_templates.template_id) and constrained to the plan organisation via the buyer principal or the job department. There is no jobs.project_id in this schema, so this is the only available linkage and it is labelled as inferred everywhere it surfaces. Performs no authorization and is granted to service_role only; the gated readers call it as owner. Returns no pricing column.';

-- ── 2) The effective revision ───────────────────────────────────────────────
--  Exactly one approved revision exists per plan (contract §2 partial unique).
--  INTERNAL for the same reason as above: nx_qcp_visible consults it before it
--  can decide anything, so it cannot gate on nx_qcp_visible.
CREATE OR REPLACE FUNCTION public.nx_qcp_effective_revision(p_qcp_id uuid)
RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT r.id FROM public.qcp_revisions r
   WHERE r.qcp_id = p_qcp_id AND r.status = 'approved'
   ORDER BY r.revision_no DESC
   LIMIT 1;
$fn$;

ALTER FUNCTION public.nx_qcp_effective_revision(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_effective_revision(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_qcp_effective_revision(uuid) TO service_role;

COMMENT ON FUNCTION public.nx_qcp_effective_revision(uuid) IS
  'INTERNAL. The single approved (effective) revision of a QCP, or NULL when the plan has never been approved. service_role only; the gated readers call it as owner.';

-- ── 3) Who may read this plan, and as what (contract §4) ────────────────────
--  Returns the caller's audience or NULL. NULL is a refusal: every reader in
--  this file fails closed on it.
CREATE OR REPLACE FUNCTION public.nx_qcp_visible(p_qcp_id uuid, p_uid uuid DEFAULT auth.uid())
RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_q   RECORD;
  v_rev uuid;
BEGIN
  IF p_uid IS NULL OR p_qcp_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT q.organization_id, q.supplier_id INTO v_q
    FROM public.quality_control_plans q WHERE q.id = p_qcp_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF public.nx_is_admin(p_uid) THEN
    RETURN 'admin';
  END IF;

  -- Enterprise / client org / agency, org-scoped. Owner counts even without an
  -- org_members row, which is how organizations.owner_id already behaves.
  IF EXISTS (SELECT 1 FROM public.org_members om
              WHERE om.org_id = v_q.organization_id AND om.user_id = p_uid)
     OR EXISTS (SELECT 1 FROM public.organizations o
                 WHERE o.id = v_q.organization_id AND o.owner_id = p_uid) THEN
    RETURN 'org';
  END IF;

  -- The inspected party. Never another supplier's plan.
  IF v_q.supplier_id IS NOT NULL AND v_q.supplier_id = p_uid THEN
    RETURN 'supplier';
  END IF;

  -- An inspector reaches ONLY the effective approved revision, and only while
  -- engaged on a job the plan governs.
  v_rev := public.nx_qcp_effective_revision(p_qcp_id);
  IF v_rev IS NOT NULL AND EXISTS (
       SELECT 1
         FROM public.nx_qcp_scope_jobs(p_qcp_id, v_rev) sj
         JOIN public.jobs j ON j.id = sj.job_id
        WHERE j.contractor_id IS NOT DISTINCT FROM p_uid
           OR public.nx_is_active_job_team_member(j.id, p_uid)) THEN
    RETURN 'inspector';
  END IF;

  RETURN NULL;   -- fail closed
END $fn$;

ALTER FUNCTION public.nx_qcp_visible(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_visible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_visible(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_visible(uuid, uuid) IS
  'The frozen QCP authorization matrix as one answer: admin | org | supplier | inspector | NULL. NULL means refused and every QCP reader fails closed on it. An inspector qualifies only against the effective approved revision of a plan governing a job they are engaged on; a supplier only where supplier_id is themselves. Discloses nothing but the caller''s own audience.';

-- ── 4) Which plan governs a job (the inferred bridge, in one place) ─────────
CREATE OR REPLACE FUNCTION public.nx_qcp_for_job(p_job_id uuid)
RETURNS TABLE (qcp_id uuid, revision_id uuid, candidate_count int, audience text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  RETURN QUERY
  WITH cand AS (
    -- Narrowed by the shared template spine FIRST so the organisation rule is
    -- evaluated over a handful of plans, not every approved revision on the
    -- platform. The organisation rule itself is NOT restated here: it lives in
    -- nx_qcp_scope_jobs and is asserted through it.
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
  -- candidate_count counts only the plans this caller may read: the existence
  -- of somebody else's plan is not this caller's business, and "ambiguous" is
  -- only actionable when the reader can see both.
  SELECT v.c_qcp, v.c_rev,
         (SELECT count(*)::int FROM vis w WHERE w.c_aud IS NOT NULL),
         v.c_aud
    FROM vis v
   WHERE v.c_aud IS NOT NULL
   ORDER BY v.c_at DESC NULLS LAST
   LIMIT 1;
END $fn$;

ALTER FUNCTION public.nx_qcp_for_job(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_for_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_for_job(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_for_job(uuid) IS
  'The quality control plan governing a job, INFERRED from the shared scope-template spine because this schema has no jobs.project_id. Returns at most one row — the most recently approved candidate the caller may read — plus candidate_count so an ambiguous match can be declined rather than guessed. No row means the job is governed by no plan the caller may see. Returns no pricing column.';

-- ── 5) Stage status with DERIVED progress (contract §2) ─────────────────────
--  One row per stage of the effective (or explicitly named) revision. There is
--  no progress column anywhere; every number below is computed here from
--  itp_point_results through qcp_stage_templates → itp_points.
CREATE OR REPLACE FUNCTION public.nx_qcp_stage_progress(
  p_qcp_id      uuid,
  p_revision_id uuid DEFAULT NULL
) RETURNS TABLE (
  stage_id           uuid,
  sequence_no        int,
  stage_name         text,
  responsible_party  text,
  template_count     int,
  template_names     text[],
  plan_point_count   int,
  job_count          int,
  instance_count     int,
  recorded           int,
  not_recorded       int,
  passed             int,
  failed             int,
  pending            int,
  waived             int,
  not_applicable     int,
  accepted           int,
  ever_failed        int,
  hold_total         int,
  hold_outstanding   int,
  witness_total      int,
  witness_outstanding int,
  review_total       int,
  blocking_now       int,
  signoff_required   int,
  signed_off         int,
  ncr_count          int,
  ncr_open           int,
  percent_complete   numeric,
  first_recorded_at  timestamptz,
  last_recorded_at   timestamptz
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_aud text;
  v_eff uuid;
  v_rev uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  v_aud := public.nx_qcp_visible(p_qcp_id, v_uid);
  IF v_aud IS NULL THEN
    RAISE EXCEPTION 'not authorized for this quality control plan' USING errcode = '42501';
  END IF;
  -- The inspected party is bound by requirements and documents, not entitled to
  -- the other parties' execution detail (contract §4).
  IF v_aud = 'supplier' THEN
    RAISE EXCEPTION 'not authorized for this quality control plan' USING errcode = '42501';
  END IF;

  v_eff := public.nx_qcp_effective_revision(p_qcp_id);
  v_rev := COALESCE(p_revision_id, v_eff);
  IF v_rev IS NULL THEN
    RETURN;   -- no approved revision and none named: nothing to report
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qcp_revisions r
                  WHERE r.id = v_rev AND r.qcp_id = p_qcp_id) THEN
    RAISE EXCEPTION 'revision does not belong to this plan' USING errcode = 'P0002';
  END IF;
  -- An inspector sees the effective approved revision and no other.
  IF v_aud = 'inspector' AND v_rev IS DISTINCT FROM v_eff THEN
    RAISE EXCEPTION 'not authorized for this revision' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH stg AS (
    SELECT s.id AS s_id, s.sequence_no AS s_seq, s.name AS s_name,
           s.responsible_party AS s_resp
      FROM public.qcp_stages s
     WHERE s.revision_id = v_rev
  ), tpl AS (
    SELECT st.stage_id AS t_stage, st.template_id AS t_tpl
      FROM public.qcp_stage_templates st
      JOIN stg ON stg.s_id = st.stage_id
  ), tname AS (
    -- Only id and name are read from the scope-template table. Never a star,
    -- never any other column: that table carries a commercial figure and this
    -- is the one join in the file that touches it by anything but key.
    SELECT t.t_stage AS n_stage,
           array_agg(DISTINCT ist.name) AS n_names,
           (count(DISTINCT ist.id))::int AS n_count
      FROM tpl t
      JOIN public.inspection_scope_templates ist ON ist.id = t.t_tpl
     GROUP BY t.t_stage
  ), pts AS (
    SELECT t.t_stage AS p_stage, t.t_tpl AS p_tpl, p.id AS p_point,
           p.point_type AS p_type, p.blocks_progress AS p_blocks,
           p.requires_signoff AS p_signoff
      FROM tpl t
      JOIN public.itp_points p ON p.template_id = t.t_tpl AND p.is_active
  ), sj AS (
    SELECT DISTINCT z.job_id AS j_id, z.template_id AS j_tpl
      FROM public.nx_qcp_scope_jobs(p_qcp_id, v_rev) z
      JOIN public.jobs j ON j.id = z.job_id
     WHERE v_aud <> 'inspector'
        OR j.contractor_id IS NOT DISTINCT FROM v_uid
        OR public.nx_is_active_job_team_member(j.id, v_uid)
  ), inst AS (
    -- THE UNIT OF PROGRESS: one (job, point) checkpoint instance.
    SELECT pts.p_stage AS i_stage, pts.p_point AS i_point, pts.p_type AS i_type,
           pts.p_blocks AS i_blocks, pts.p_signoff AS i_signoff, sj.j_id AS i_job
      FROM pts JOIN sj ON sj.j_tpl = pts.p_tpl
  ), keys AS (
    -- SEMI-JOIN KEY SET, deliberately DISTINCT. Two stages of one revision may
    -- link the SAME template, which puts the same (job, point) into inst twice.
    -- Joining the result rows against inst directly would then double every
    -- count. The stage-level totals below still count each stage's own
    -- instances; only the per-result aggregates use this de-duplicated set.
    SELECT DISTINCT i.i_job, i.i_point FROM inst i
  ), latest AS (
    -- The state of an instance is the LAST thing recorded for it, whichever
    -- visit it happened on. Same rule as nx_report_itp_log.
    SELECT DISTINCT ON (r.job_id, r.point_id)
           r.job_id AS l_job, r.point_id AS l_point, r.result AS l_result,
           r.released_at AS l_released, r.signed_off_at AS l_signed,
           r.witnessed_by AS l_witness
      FROM public.itp_point_results r
     WHERE (r.job_id, r.point_id) IN (SELECT k.i_job, k.i_point FROM keys k)
     ORDER BY r.job_id, r.point_id, r.recorded_at DESC NULLS LAST, r.created_at DESC
  ), agg AS (
    SELECT r.job_id AS a_job, r.point_id AS a_point,
           (count(*))::int AS a_records,
           bool_or(r.result = 'failed') AS a_everfailed,
           min(r.recorded_at) AS a_first,
           max(r.recorded_at) AS a_last,
           (count(*) FILTER (WHERE r.flash_report_id IS NOT NULL))::int AS a_ncrs,
           -- The frozen blocking rule from nx_job_itp, across every visit.
           bool_or(r.result IN ('passed','waived','not_applicable')
                   OR r.released_at IS NOT NULL) AS a_cleared
      FROM public.itp_point_results r
     WHERE (r.job_id, r.point_id) IN (SELECT k.i_job, k.i_point FROM keys k)
     GROUP BY r.job_id, r.point_id
  ), ncr AS (
    SELECT r.job_id AS n_job, r.point_id AS n_point,
           (count(*) FILTER (WHERE f.status IN
              ('open','acknowledged','in_remediation','disputed')))::int AS n_open
      FROM public.itp_point_results r
      JOIN public.flash_reports f ON f.id = r.flash_report_id
     WHERE (r.job_id, r.point_id) IN (SELECT k.i_job, k.i_point FROM keys k)
     GROUP BY r.job_id, r.point_id
  ), rows_ AS (
    SELECT i.i_stage, i.i_type, i.i_blocks, i.i_signoff,
           COALESCE(la.l_result, 'pending') AS r_result,
           la.l_released, la.l_signed, la.l_witness,
           COALESCE(ag.a_records, 0)    AS r_records,
           COALESCE(ag.a_everfailed, false) AS r_everfailed,
           ag.a_first, ag.a_last,
           COALESCE(ag.a_ncrs, 0)       AS r_ncrs,
           COALESCE(nc.n_open, 0)       AS r_ncropen,
           (i.i_blocks AND NOT COALESCE(ag.a_cleared, false)) AS r_blocking
      FROM inst i
      LEFT JOIN latest la ON la.l_job = i.i_job AND la.l_point = i.i_point
      LEFT JOIN agg    ag ON ag.a_job = i.i_job AND ag.a_point = i.i_point
      LEFT JOIN ncr    nc ON nc.n_job = i.i_job AND nc.n_point = i.i_point
  )
  SELECT stg.s_id, stg.s_seq, stg.s_name, stg.s_resp,
         COALESCE(tn.n_count, 0),
         COALESCE(tn.n_names, ARRAY[]::text[]),
         (SELECT count(DISTINCT p.p_point)::int FROM pts p WHERE p.p_stage = stg.s_id),
         (SELECT count(DISTINCT i.i_job)::int   FROM inst i WHERE i.i_stage = stg.s_id),
         (SELECT count(*)::int                  FROM inst i WHERE i.i_stage = stg.s_id),
         COALESCE(x.recorded, 0),      COALESCE(x.not_recorded, 0),
         COALESCE(x.passed, 0),        COALESCE(x.failed, 0),
         COALESCE(x.pending, 0),       COALESCE(x.waived, 0),
         COALESCE(x.not_applicable, 0),COALESCE(x.accepted, 0),
         COALESCE(x.ever_failed, 0),
         COALESCE(x.hold_total, 0),    COALESCE(x.hold_outstanding, 0),
         COALESCE(x.witness_total, 0), COALESCE(x.witness_outstanding, 0),
         COALESCE(x.review_total, 0),  COALESCE(x.blocking_now, 0),
         COALESCE(x.signoff_required, 0), COALESCE(x.signed_off, 0),
         COALESCE(x.ncr_count, 0),     COALESCE(x.ncr_open, 0),
         CASE WHEN COALESCE(x.total, 0) > 0
              THEN round((100.0 * COALESCE(x.accepted, 0)) / x.total, 1)
         END,
         x.first_at, x.last_at
    FROM stg
    LEFT JOIN tname tn ON tn.n_stage = stg.s_id
    LEFT JOIN LATERAL (
      SELECT (count(*))::int AS total,
             (count(*) FILTER (WHERE rr.r_records > 0))::int AS recorded,
             (count(*) FILTER (WHERE rr.r_records = 0))::int AS not_recorded,
             (count(*) FILTER (WHERE rr.r_result = 'passed'))::int AS passed,
             (count(*) FILTER (WHERE rr.r_result = 'failed'))::int AS failed,
             (count(*) FILTER (WHERE rr.r_result = 'pending'))::int AS pending,
             (count(*) FILTER (WHERE rr.r_result = 'waived'))::int AS waived,
             (count(*) FILTER (WHERE rr.r_result = 'not_applicable'))::int AS not_applicable,
             (count(*) FILTER (WHERE rr.r_result IN ('passed','waived','not_applicable')))::int AS accepted,
             (count(*) FILTER (WHERE rr.r_everfailed))::int AS ever_failed,
             (count(*) FILTER (WHERE rr.i_type = 'hold'))::int AS hold_total,
             (count(*) FILTER (WHERE rr.i_type = 'hold' AND rr.r_blocking))::int AS hold_outstanding,
             (count(*) FILTER (WHERE rr.i_type = 'witness'))::int AS witness_total,
             (count(*) FILTER (WHERE rr.i_type = 'witness' AND rr.r_records = 0))::int AS witness_outstanding,
             (count(*) FILTER (WHERE rr.i_type = 'review'))::int AS review_total,
             (count(*) FILTER (WHERE rr.r_blocking))::int AS blocking_now,
             (count(*) FILTER (WHERE rr.i_signoff))::int AS signoff_required,
             (count(*) FILTER (WHERE rr.l_signed IS NOT NULL))::int AS signed_off,
             COALESCE(sum(rr.r_ncrs), 0)::int   AS ncr_count,
             COALESCE(sum(rr.r_ncropen), 0)::int AS ncr_open,
             min(rr.a_first) AS first_at,
             max(rr.a_last)  AS last_at
        FROM rows_ rr WHERE rr.i_stage = stg.s_id
    ) x ON true
   ORDER BY stg.s_seq;
END $fn$;

ALTER FUNCTION public.nx_qcp_stage_progress(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_stage_progress(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_stage_progress(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_stage_progress(uuid, uuid) IS
  'Stage-by-stage status of a QCP revision with progress DERIVED at read time from itp_point_results through qcp_stage_templates -> itp_points. No progress column exists and none is added. The unit is the (job, point) checkpoint instance; the state of an instance is the last result recorded across every visit, and the blocking rule is nx_job_itp''s unchanged. plan_point_count with instance_count = 0 means the plan is defined but no work is dispatched, and percent_complete is NULL rather than an invented denominator. Suppliers are refused; an inspector sees only the effective revision and only the jobs they are engaged on. Returns no identity and no pricing column.';

-- ── 6) One-row QCP summary ──────────────────────────────────────────────────
--  Aggregates nx_qcp_stage_progress rather than re-querying, so the plan and
--  the derivation keep exactly one implementation — the relationship
--  nx_report_itp_rollup has to nx_report_itp_log.
CREATE OR REPLACE FUNCTION public.nx_qcp_rollup(p_qcp_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_aud  text;
  v_eff  uuid;
  v_plan RECORD;
  v_rev  RECORD;
  v_docs jsonb;
  v_hist jsonb;
  v_prog jsonb;
  v_ncr  jsonb;
  v_supp jsonb;
  v_n    int;
  v_jobs int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  v_aud := public.nx_qcp_visible(p_qcp_id, v_uid);
  IF v_aud IS NULL THEN
    RAISE EXCEPTION 'not authorized for this quality control plan' USING errcode = '42501';
  END IF;

  SELECT q.id, q.title, q.organization_id, q.supplier_id, q.created_at
    INTO v_plan
    FROM public.quality_control_plans q WHERE q.id = p_qcp_id;

  v_eff := public.nx_qcp_effective_revision(p_qcp_id);

  -- FALLBACK DISCIPLINE. A plan with no approved revision governs nothing yet;
  -- reporting it as an empty plan would assert a regime that is not in force.
  IF v_eff IS NULL THEN
    SELECT (count(*))::int INTO v_n FROM public.qcp_revisions r WHERE r.qcp_id = p_qcp_id;
    RETURN jsonb_build_object(
      'has_qcp',           false,
      'qcp_id',            p_qcp_id,
      'title',             v_plan.title,
      'audience',          v_aud,
      'effective_revision', NULL,
      'revision_count',    v_n,
      'reason',            'no approved revision in force');
  END IF;

  SELECT r.revision_no, r.status, r.quality_scope, r.standards, r.procedures,
         r.approved_at, r.approved_by, r.supersedes_id, r.created_at
    INTO v_rev
    FROM public.qcp_revisions r WHERE r.id = v_eff;

  -- ── REQUIRED DOCUMENTS. Links to EXISTING documents; nothing is stored here.
  SELECT jsonb_build_object(
           'total',              (count(*))::int,
           'supplied',           (count(*) FILTER (WHERE d.document_id IS NOT NULL))::int,
           'outstanding',        (count(*) FILTER (WHERE d.document_id IS NULL))::int,
           'mandatory_total',    (count(*) FILTER (WHERE d.is_mandatory))::int,
           'mandatory_supplied', (count(*) FILTER (WHERE d.is_mandatory AND d.document_id IS NOT NULL))::int,
           'mandatory_outstanding',
                                 (count(*) FILTER (WHERE d.is_mandatory AND d.document_id IS NULL))::int,
           -- A linked document belonging to another organisation is a data
           -- integrity signal a quality reviewer needs, not a hidden anomaly.
           'linked_out_of_org',  (count(*) FILTER (
                                   WHERE doc.id IS NOT NULL
                                     AND doc.organization_id IS DISTINCT FROM v_plan.organization_id))::int,
           'complete',           (count(*) FILTER (WHERE d.is_mandatory AND d.document_id IS NULL)) = 0)
    INTO v_docs
    FROM public.qcp_required_documents d
    LEFT JOIN public.documents doc ON doc.id = d.document_id
   WHERE d.revision_id = v_eff;

  -- ── SUPPLIER: pseudonym only, in every direction. No name, ever.
  v_supp := CASE WHEN v_plan.supplier_id IS NULL THEN NULL
                 ELSE jsonb_build_object(
                        'handle',   public.nx_handle(v_plan.supplier_id),
                        'is_self',  (v_plan.supplier_id = v_uid))
            END;

  -- ── THE SUPPLIER VIEW STOPS HERE (contract §4): requirements, documents and
  --    revision status. No execution detail, no other party's findings.
  IF v_aud = 'supplier' THEN
    RETURN jsonb_build_object(
      'has_qcp',   true,
      'qcp_id',    p_qcp_id,
      'title',     v_plan.title,
      'audience',  'supplier',
      'restricted', true,
      'revision',  jsonb_build_object(
                     'revision_id',   v_eff,
                     'revision_no',   v_rev.revision_no,
                     'status',        v_rev.status,
                     'quality_scope', v_rev.quality_scope,
                     'standards',     COALESCE(to_jsonb(v_rev.standards), '[]'::jsonb),
                     'procedures',    v_rev.procedures,
                     'approved_at',   v_rev.approved_at),
      'stage_count', (SELECT count(*)::int FROM public.qcp_stages s WHERE s.revision_id = v_eff),
      'documents', v_docs,
      'supplier',  v_supp);
  END IF;

  -- ── HOW MANY JOBS THE PLAN ACTUALLY GOVERNS. Counted once at plan level, not
  --    as max() over the stages, because different stages may govern different
  --    jobs and the largest stage would understate the plan. The inspector
  --    narrowing is restated here so this number means the same thing to that
  --    audience as every other number in the payload.
  SELECT (count(DISTINCT z.job_id))::int INTO v_jobs
    FROM public.nx_qcp_scope_jobs(p_qcp_id, v_eff) z
    JOIN public.jobs j ON j.id = z.job_id
   WHERE v_aud <> 'inspector'
      OR j.contractor_id IS NOT DISTINCT FROM v_uid
      OR public.nx_is_active_job_team_member(j.id, v_uid);

  -- ── DERIVED PROGRESS AND NCRs, aggregated from the stage reader in ONE pass
  --    (one truth, and one scan of a reader that is not cheap).
  SELECT (count(*))::int,
         jsonb_build_object(
           'stage_count',       (count(*))::int,
           'template_links',    COALESCE(sum(t.template_count), 0)::int,
           'plan_point_count',  COALESCE(sum(t.plan_point_count), 0)::int,
           'job_count',         v_jobs,
           'instance_count',    COALESCE(sum(t.instance_count), 0)::int,
           'recorded',          COALESCE(sum(t.recorded), 0)::int,
           'not_recorded',      COALESCE(sum(t.not_recorded), 0)::int,
           'passed',            COALESCE(sum(t.passed), 0)::int,
           'failed',            COALESCE(sum(t.failed), 0)::int,
           'pending',           COALESCE(sum(t.pending), 0)::int,
           'waived',            COALESCE(sum(t.waived), 0)::int,
           'not_applicable',    COALESCE(sum(t.not_applicable), 0)::int,
           'accepted',          COALESCE(sum(t.accepted), 0)::int,
           'ever_failed',       COALESCE(sum(t.ever_failed), 0)::int,
           'hold_total',        COALESCE(sum(t.hold_total), 0)::int,
           'hold_outstanding',  COALESCE(sum(t.hold_outstanding), 0)::int,
           'witness_total',     COALESCE(sum(t.witness_total), 0)::int,
           'witness_outstanding', COALESCE(sum(t.witness_outstanding), 0)::int,
           'review_total',      COALESCE(sum(t.review_total), 0)::int,
           'blocking_now',      COALESCE(sum(t.blocking_now), 0)::int,
           'signoff_required',  COALESCE(sum(t.signoff_required), 0)::int,
           'signed_off',        COALESCE(sum(t.signed_off), 0)::int,
           'percent_complete',  CASE WHEN COALESCE(sum(t.instance_count), 0) > 0
                                     THEN round((100.0 * COALESCE(sum(t.accepted), 0))
                                                / sum(t.instance_count), 1) END,
           'stages_complete',   (count(*) FILTER (
                                   WHERE t.instance_count > 0
                                     AND t.accepted = t.instance_count))::int,
           'stages_blocked',    (count(*) FILTER (WHERE t.hold_outstanding > 0))::int,
           'first_recorded_at', min(t.first_recorded_at),
           'last_recorded_at',  max(t.last_recorded_at)),
         jsonb_build_object(
           'total',  COALESCE(sum(t.ncr_count), 0)::int,
           'open',   COALESCE(sum(t.ncr_open), 0)::int,
           'closed', GREATEST(COALESCE(sum(t.ncr_count), 0)
                              - COALESCE(sum(t.ncr_open), 0), 0)::int)
    INTO v_n, v_prog, v_ncr
    FROM public.nx_qcp_stage_progress(p_qcp_id, v_eff) t;

  -- ── APPEND-PRESERVED REVISION HISTORY. Admin and the plan's own organisation
  --    read the trail; an inspector sees the effective revision and no other.
  IF v_aud IN ('admin', 'org') THEN
    SELECT jsonb_build_object(
             'revision_count', (count(*))::int,
             'approved_count', (count(*) FILTER (WHERE r.status = 'approved'))::int,
             'superseded_count', (count(*) FILTER (WHERE r.status = 'superseded'))::int,
             'draft_count',    (count(*) FILTER (WHERE r.status = 'draft'))::int,
             'under_review_count', (count(*) FILTER (WHERE r.status = 'under_review'))::int,
             'first_created_at', min(r.created_at),
             'last_approved_at', max(r.approved_at))
      INTO v_hist
      FROM public.qcp_revisions r WHERE r.qcp_id = p_qcp_id;
  END IF;

  RETURN jsonb_build_object(
    'has_qcp',   true,
    'qcp_id',    p_qcp_id,
    'title',     v_plan.title,
    'audience',  v_aud,
    'created_at', v_plan.created_at,
    'revision',  jsonb_build_object(
                   'revision_id',       v_eff,
                   'revision_no',       v_rev.revision_no,
                   'status',            v_rev.status,
                   'quality_scope',     v_rev.quality_scope,
                   'standards',         COALESCE(to_jsonb(v_rev.standards), '[]'::jsonb),
                   'procedures',        v_rev.procedures,
                   'supersedes_id',     v_rev.supersedes_id,
                   'approved_at',       v_rev.approved_at,
                   -- The approver is a pseudonym here. The authoritative actor
                   -- record for an approval is the row Agent 1 writes.
                   'approved_by_handle',
                       CASE WHEN v_rev.approved_by IS NULL THEN NULL
                            ELSE public.nx_handle(v_rev.approved_by) END,
                   'created_at',        v_rev.created_at),
    'progress',  v_prog,
    'documents', v_docs,
    'ncr',       v_ncr,
    'supplier',  v_supp,
    'history',   v_hist,
    'outstanding', jsonb_build_object(
                     'hold_points',         COALESCE((v_prog->>'hold_outstanding')::int, 0),
                     'blocking_points',     COALESCE((v_prog->>'blocking_now')::int, 0),
                     'unrecorded_points',   COALESCE((v_prog->>'not_recorded')::int, 0),
                     'mandatory_documents', COALESCE((v_docs->>'mandatory_outstanding')::int, 0),
                     'open_ncrs',           COALESCE((v_ncr->>'open')::int, 0)),
    -- The single question a reviewer actually asks before signing.
    'is_satisfied',
        COALESCE((v_prog->>'blocking_now')::int, 0) = 0
    AND COALESCE((v_docs->>'mandatory_outstanding')::int, 0) = 0
    AND COALESCE((v_ncr->>'open')::int, 0) = 0
    AND COALESCE((v_prog->>'not_recorded')::int, 0) = 0
    AND COALESCE((v_prog->>'instance_count')::int, 0) > 0);
END $fn$;

ALTER FUNCTION public.nx_qcp_rollup(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_rollup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_rollup(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_rollup(uuid) IS
  'One-row summary of a quality control plan: effective revision and its approvals, derived progress, stage status, ITP completion, outstanding hold points, required-document completion, open NCR summary, supplier context and the revision history depth. Aggregates nx_qcp_stage_progress so the derivation keeps one implementation. has_qcp=false means no approved revision is in force and the surface must render NOTHING rather than an empty plan. Supplier output is masked to requirements, documents and revision status. Every actor is an nx_handle pseudonym; no name, no email, no pricing column.';

-- ── 7) Outstanding requirements, itemised ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_qcp_outstanding_requirements(p_qcp_id uuid)
RETURNS TABLE (
  kind         text,
  ref_id       uuid,
  label        text,
  detail       text,
  is_mandatory boolean,
  stage_name   text,
  sequence_no  int,
  since        timestamptz
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_aud text;
  v_eff uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  v_aud := public.nx_qcp_visible(p_qcp_id, v_uid);
  IF v_aud IS NULL THEN
    RAISE EXCEPTION 'not authorized for this quality control plan' USING errcode = '42501';
  END IF;

  v_eff := public.nx_qcp_effective_revision(p_qcp_id);
  IF v_eff IS NULL THEN
    -- The plan itself is the outstanding requirement.
    RETURN QUERY
      SELECT 'revision_not_approved'::text, p_qcp_id, 'No approved revision'::text,
             'The plan is not in force; no revision has been approved.'::text,
             true, NULL::text, NULL::int,
             (SELECT min(r.created_at) FROM public.qcp_revisions r WHERE r.qcp_id = p_qcp_id);
    RETURN;
  END IF;

  -- ── Required documents that are not yet supplied. Every audience, including
  --    the supplier, is entitled to this: it is what they are asked for.
  RETURN QUERY
    SELECT 'document_missing'::text, d.id, d.label,
           COALESCE(d.acceptance_criteria, 'No acceptance criteria stated'),
           d.is_mandatory, NULL::text, NULL::int, NULL::timestamptz
      FROM public.qcp_required_documents d
     WHERE d.revision_id = v_eff
       AND d.document_id IS NULL;

  IF v_aud = 'supplier' THEN
    RETURN;   -- contract §4: requirements and documents only
  END IF;

  -- ── Execution gaps, derived. ONE scan of the stage reader, which is not a
  --    cheap function. Stage-level on purpose: a governance surface states that
  --    a stage is short, never that a named person is behind.
  RETURN QUERY
  WITH sp AS (
    SELECT t.stage_id, t.stage_name, t.sequence_no, t.last_recorded_at,
           t.hold_outstanding, t.hold_total, t.not_recorded, t.instance_count,
           t.ncr_open, t.ncr_count
      FROM public.nx_qcp_stage_progress(p_qcp_id, v_eff) t
  )
    SELECT 'hold_outstanding'::text, sp.stage_id, sp.stage_name,
           format('%s hold point(s) still blocking of %s',
                  sp.hold_outstanding, sp.hold_total),
           true, sp.stage_name, sp.sequence_no, sp.last_recorded_at
      FROM sp WHERE sp.hold_outstanding > 0
  UNION ALL
    SELECT 'points_not_recorded'::text, sp.stage_id, sp.stage_name,
           format('%s of %s checkpoint instance(s) never recorded',
                  sp.not_recorded, sp.instance_count),
           false, sp.stage_name, sp.sequence_no, sp.last_recorded_at
      FROM sp WHERE sp.not_recorded > 0
  UNION ALL
    SELECT 'ncr_open'::text, sp.stage_id, sp.stage_name,
           format('%s open non-conformance(s) of %s raised',
                  sp.ncr_open, sp.ncr_count),
           true, sp.stage_name, sp.sequence_no, sp.last_recorded_at
      FROM sp WHERE sp.ncr_open > 0
  -- Mandatory first, then in plan order. Ordinals because a UNION has no names.
  ORDER BY 5 DESC, 7 NULLS FIRST, 1;
END $fn$;

ALTER FUNCTION public.nx_qcp_outstanding_requirements(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_outstanding_requirements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_outstanding_requirements(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_outstanding_requirements(uuid) IS
  'Everything a quality control plan still wants, itemised: unsupplied required documents, outstanding hold points, unrecorded checkpoint instances and open non-conformances, plus the plan itself when no revision has been approved. Execution rows are stage-level, never per person, and a supplier receives only the document and revision rows the contract entitles them to. Returns no identity and no pricing column.';

-- ── 8) The report-scoped reader: QCP context for ONE inspection report ──────
CREATE OR REPLACE FUNCTION public.nx_report_qcp_rollup(p_report_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_job  uuid;
  v_j    RECORD;
  v_is_buyer boolean;
  v_may_name boolean;
  -- Scalars, not a RECORD: nx_qcp_for_job legitimately returns no row and an
  -- unassigned record variable would raise instead of degrading.
  v_qcp  uuid;
  v_cand int;
  v_out  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.job_id INTO v_job
    FROM public.inspection_reports r WHERE r.id = p_report_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'report not found' USING errcode = 'P0002';
  END IF;

  SELECT j.client_id, j.agency_id, j.contractor_id INTO v_j
    FROM public.jobs j WHERE j.id = v_job;

  -- The report audience, identical to nx_report_itp_log's.
  IF NOT (
    public.nx_is_admin()
    OR public.nx_is_active_job_team_member(v_job, v_uid)
    OR v_uid IS NOT DISTINCT FROM v_j.contractor_id
    OR v_uid IS NOT DISTINCT FROM v_j.client_id
    OR v_uid IS NOT DISTINCT FROM v_j.agency_id
  ) THEN
    RAISE EXCEPTION 'not authorized for this report' USING errcode = '42501';
  END IF;

  v_is_buyer := (v_uid IS NOT DISTINCT FROM v_j.client_id)
             OR (v_uid IS NOT DISTINCT FROM v_j.agency_id);

  -- THE DISCLOSURE GATE, identical to nx_report_contributors and
  -- nx_report_itp_log. Nothing in this payload is a name — the flag exists so
  -- that any surface which later wants one must pass the same gate every other
  -- buyer surface passes, and so the policy is consulted rather than assumed.
  v_may_name :=
        public.nx_is_admin()
     OR public.nx_is_active_job_team_member(v_job, v_uid)
     OR v_uid IS NOT DISTINCT FROM v_j.contractor_id
     OR (v_is_buyer
         AND public.nx_job_effective_identity_mode(v_job) IN ('professional', 'full'));

  SELECT f.qcp_id, f.candidate_count INTO v_qcp, v_cand
    FROM public.nx_qcp_for_job(v_job) f LIMIT 1;

  -- FALLBACK DISCIPLINE: no governing plan the caller may read. Render NOTHING.
  IF v_qcp IS NULL THEN
    RETURN jsonb_build_object(
      'has_qcp',                 false,
      'job_id',                  v_job,
      'from_scope_template_link', false,
      'identity_disclosed',      v_may_name);
  END IF;

  v_out := public.nx_qcp_rollup(v_qcp);

  RETURN v_out || jsonb_build_object(
    'job_id',                   v_job,
    'report_id',                p_report_id,
    -- Labelled, always: this schema has no jobs.project_id, so the plan was
    -- matched through the shared scope-template spine, not a stored link.
    'from_scope_template_link', true,
    'candidate_count',          COALESCE(v_cand, 1),
    'ambiguous',                COALESCE(v_cand, 1) > 1,
    'identity_disclosed',       v_may_name);
END $fn$;

ALTER FUNCTION public.nx_report_qcp_rollup(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_qcp_rollup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_qcp_rollup(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_qcp_rollup(uuid) IS
  'The quality control plan governing ONE inspection report, with its effective revision, derived progress, outstanding hold points, document completion and open NCR summary. The plan is matched through the shared scope-template spine because this schema has no jobs.project_id; every payload says so via from_scope_template_link and reports candidate_count so an ambiguous match can be declined. has_qcp=false means the job is governed by no plan the caller may read and the surface must render NOTHING. Consults nx_job_effective_identity_mode and publishes identity_disclosed; returns no name and no pricing column.';

-- ── 9) The admin review queue gains the QCP summary ─────────────────────────
--  A third APPENDED jsonb column, for the same reason visit_rollup (390000) and
--  itp_rollup (400000) were appended: the queue is where a reviewer decides
--  whether a report is signable, and "a mandatory document is still missing and
--  one hold point is open" is exactly that decision. It rides inside the
--  existing RPC because fetching it per row would be one round trip per report.
--
--  Forward-only: neither 390000 nor 400000 is edited, and both of their columns
--  are preserved in place and in order so every existing reader keeps working.
DROP FUNCTION IF EXISTS public.nx_admin_report_review_queue(int, boolean);

CREATE FUNCTION public.nx_admin_report_review_queue(
  p_limit           int     DEFAULT 50,
  p_only_unreviewed boolean DEFAULT true
) RETURNS TABLE (
  report_id          uuid,
  job_id             uuid,
  job_title          text,
  inspector_id       uuid,
  inspector_name     text,
  status             text,
  submitted_at       timestamptz,
  technical_approved boolean,
  financial_approved boolean,
  is_published       boolean,
  is_client_approved boolean,
  pdf_url            text,
  visit_rollup       jsonb,
  itp_rollup         jsonb,
  -- APPENDED ↓
  qcp_rollup         jsonb
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.job_id, j.title, r.inspector_id, p.full_name,
         r.status, r.created_at,
         COALESCE(r.technical_approved, false),
         COALESCE(r.financial_approved, false),
         COALESCE(r.is_published, false),
         COALESCE(r.is_client_approved, false),
         r.pdf_url,
         public.nx_report_visit_rollup(r.id),
         public.nx_report_itp_rollup(r.id),
         public.nx_report_qcp_rollup(r.id)
    FROM public.inspection_reports r
    LEFT JOIN public.jobs     j ON j.id = r.job_id
    LEFT JOIN public.profiles p ON p.id = r.inspector_id
   WHERE r.deleted_at IS NULL
     AND (NOT p_only_unreviewed
          OR COALESCE(r.technical_approved, false) = false
          OR COALESCE(r.financial_approved, false) = false)
   ORDER BY r.created_at ASC
   LIMIT GREATEST(COALESCE(p_limit, 50), 1);
END $fn$;

ALTER FUNCTION public.nx_admin_report_review_queue(int, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_admin_report_review_queue(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_admin_report_review_queue(int, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_admin_report_review_queue(int, boolean) IS
  'Admin-only queue of inspection reports awaiting technical/financial review, oldest first, each carrying its visit programme rollup (20260801390000), its ITP rollup (20260801400000) and its QCP governance rollup (20260801410000) so a reviewer can see whether the work is finished, whether the inspection plan is satisfied and whether the governing quality plan is satisfied before signing off. Returns no pricing column of any kind.';

-- ── 10) Self-tests ──────────────────────────────────────────────────────────
--  NOTE FOR FUTURE EDITORS: pg_get_functiondef() includes the function's OWN
--  comments. Nothing written INSIDE a function body above may contain a literal
--  that the scans below search for, or the scan matches its own explanation and
--  the deploy fails for no reason. This has bitten this repository three times.
--  In particular the scope-template price column is named in the FILE header
--  and in this block, and NOWHERE inside a function body.
DO $test$
DECLARE
  dscope text := pg_get_functiondef('public.nx_qcp_scope_jobs(uuid,uuid)'::regprocedure);
  deff   text := pg_get_functiondef('public.nx_qcp_effective_revision(uuid)'::regprocedure);
  dvis   text := pg_get_functiondef('public.nx_qcp_visible(uuid,uuid)'::regprocedure);
  dfor   text := pg_get_functiondef('public.nx_qcp_for_job(uuid)'::regprocedure);
  dstage text := pg_get_functiondef('public.nx_qcp_stage_progress(uuid,uuid)'::regprocedure);
  droll  text := pg_get_functiondef('public.nx_qcp_rollup(uuid)'::regprocedure);
  dout   text := pg_get_functiondef('public.nx_qcp_outstanding_requirements(uuid)'::regprocedure);
  drep   text := pg_get_functiondef('public.nx_report_qcp_rollup(uuid)'::regprocedure);
  dq     text := pg_get_functiondef('public.nx_admin_report_review_queue(int,boolean)'::regprocedure);
  ditp   text := pg_get_functiondef('public.nx_job_itp(uuid,uuid)'::regprocedure);
  -- THE NEGATIVE PRICE GUARD, modelled on 20260801400000 §4 and EXTENDED with
  -- the scope-template price column this lane joins through.
  v_money constant text :=
    '\m(base_price_cents|payout|wallet|escrow|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents|platform_spread_cents|price_cents|release_payment|stripe|margin|spread)\M';
  v_all text[];
  v_one text;
  v_n int;
BEGIN
  v_all := ARRAY[dscope, deff, dvis, dfor, dstage, droll, dout, drep, dq];

  -- ══ THE FROZEN QCP CONTRACT MUST BE INTACT ════════════════════════════════
  IF to_regclass('public.quality_control_plans') IS NULL
     OR to_regclass('public.qcp_revisions')          IS NULL
     OR to_regclass('public.qcp_stages')             IS NULL
     OR to_regclass('public.qcp_stage_templates')    IS NULL
     OR to_regclass('public.qcp_required_documents') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP table is missing — the frozen schema was removed under this migration';
  END IF;
  -- Signatures are matched by NAME, not by argument list: this lane must not
  -- hard-fail on another lane's parameter choices, but the frozen RPC SURFACE
  -- (contract §3) must exist.
  FOREACH v_one IN ARRAY ARRAY['nx_qcp_create','nx_qcp_add_revision',
                               'nx_qcp_submit_revision','nx_qcp_approve_revision',
                               'nx_qcp_set_stage_templates','nx_project_qcp',
                               'nx_qcp_revision_history'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc pr
                     JOIN pg_namespace n ON n.oid = pr.pronamespace
                    WHERE n.nspname = 'public' AND pr.proname = v_one) THEN
      RAISE EXCEPTION 'SELFTEST FAILED: the frozen QCP RPC % is missing — contract §3 was not delivered', v_one;
    END IF;
  END LOOP;

  -- ══ MONEY: NO PRICE, NO PAYOUT, NO MARGIN, NO PAYMENT SIDE EFFECT ═════════
  --  The scope-template table carries a commercial figure and every function
  --  here joins it. This is the guard that keeps it out.
  FOREACH v_one IN ARRAY v_all LOOP
    IF v_one ~* v_money THEN
      RAISE EXCEPTION 'SELFTEST FAILED: a QCP reporting function names a money surface — the scope-template price column or a payout/margin field has reached reporting';
    END IF;
  END LOOP;
  -- A star-select on the scope-template table would drag the price column in
  -- even though the literal never appears. Forbidden outright.
  FOREACH v_one IN ARRAY v_all LOOP
    IF v_one ~* '(SELECT|,)\s*(\w+\.)?\*\s+FROM\s+(public\.)?inspection_scope_templates\M'
       OR v_one ~* 'to_jsonb\s*\(\s*\w*\s*inspection_scope_templates' THEN
      RAISE EXCEPTION 'SELFTEST FAILED: a QCP reporting function star-selects the scope-template table — the price column would be returned';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND (parameter_name ILIKE '%_cents%'
            OR parameter_name ILIKE '%price%'
            OR parameter_name ILIKE '%payout%'
            OR parameter_name ILIKE '%spread%'
            OR parameter_name ILIKE '%margin%')
       AND (specific_name LIKE 'nx_qcp%'
            OR specific_name LIKE 'nx_report_qcp%'
            OR specific_name LIKE 'nx_admin_report_review_queue%')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP reporting function exposes a money column';
  END IF;
  -- This migration creates NO view on purpose: a view is a PostgREST surface
  -- and the price column is one join away. Sweep for one anyway.
  IF EXISTS (
    SELECT 1 FROM pg_views
     WHERE schemaname = 'public'
       AND (viewname ILIKE '%qcp%' OR definition ILIKE '%qcp_stage_templates%')
       AND definition ILIKE '%base\_price\_cents%') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP view exposes the scope-template price column on the PostgREST surface';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_matviews
     WHERE schemaname = 'public'
       AND (matviewname ILIKE '%qcp%' OR definition ILIKE '%qcp_stage_templates%')
       AND definition ILIKE '%base\_price\_cents%') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP materialized view exposes the scope-template price column';
  END IF;

  -- ══ READ-ONLY, AND NO PAYMENT EFFECT ══════════════════════════════════════
  FOREACH v_one IN ARRAY v_all LOOP
    IF v_one ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.' THEN
      RAISE EXCEPTION 'SELFTEST FAILED: a QCP reporting reader writes — reporting reports, it does not act';
    END IF;
    IF v_one ~* '\mflash_report_create\M' THEN
      RAISE EXCEPTION 'SELFTEST FAILED: a QCP reporting reader raises an NCR — reporting reads the NCR link, it never writes one';
    END IF;
    -- The QCP readers must not even NAME a publish flag. The review queue is
    -- excluded because it has SELECTED both flags read-only since 20260801364000
    -- and preserving that column is a requirement of this migration, not a leak.
    IF v_one <> dq AND v_one ~* '\m(is_published|is_client_approved)\M' THEN
      RAISE EXCEPTION 'SELFTEST FAILED: a QCP reporting reader names a publish flag';
    END IF;
  END LOOP;
  FOREACH v_one IN ARRAY ARRAY['nx_qcp_scope_jobs(uuid,uuid)',
                               'nx_qcp_effective_revision(uuid)',
                               'nx_qcp_visible(uuid,uuid)',
                               'nx_qcp_for_job(uuid)',
                               'nx_qcp_stage_progress(uuid,uuid)',
                               'nx_qcp_rollup(uuid)',
                               'nx_qcp_outstanding_requirements(uuid)',
                               'nx_report_qcp_rollup(uuid)'] LOOP
    IF (SELECT provolatile FROM pg_proc WHERE oid = ('public.' || v_one)::regprocedure) <> 's' THEN
      RAISE EXCEPTION 'SELFTEST FAILED: % is not STABLE — it could acquire a side effect', v_one;
    END IF;
  END LOOP;
  -- The orphaned report state machine must stay unattached: it completes the
  -- job on approval, which fires settlement. Pinned by 390000 and 400000,
  -- re-pinned here because this migration replaces the same review queue.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc  f ON f.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND c.relname = 'inspection_reports'
       AND f.proname IN ('handle_inspection_report_state_machine',
                         'handle_report_status_change',
                         'handle_report_submission')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an orphaned report state machine is attached — report approval would auto-complete the job and fire settlement';
  END IF;

  -- ══ IDENTITY ══════════════════════════════════════════════════════════════
  --  20260801390000 fixed a real leak of exactly this kind. The rule here is
  --  absolute: no QCP reporting function returns a name at all.
  FOREACH v_one IN ARRAY v_all LOOP
    IF v_one ~* '\m(full_name|first_name|last_name|company_name|avatar_url)\M'
       AND v_one <> dq THEN
      RAISE EXCEPTION 'SELFTEST FAILED: a QCP reporting function returns an identity column — actors must be nx_handle pseudonyms or counts';
    END IF;
  END LOOP;
  IF droll ~* '\m(email|phone)\M' OR drep ~* '\m(email|phone)\M'
     OR dstage ~* '\m(email|phone)\M' OR dout ~* '\m(email|phone)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP reporting function returns contact PII';
  END IF;
  IF position('nx_job_effective_identity_mode' IN drep) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the report-scoped QCP reader does not consult the identity policy';
  END IF;
  IF position('nx_handle' IN droll) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the QCP rollup lost its pseudonymous actor rendering';
  END IF;
  IF to_regprocedure('public.nx_job_effective_identity_mode(uuid)') IS NULL
     OR to_regprocedure('public.nx_handle(uuid)') IS NULL
     OR to_regprocedure('public.nx_report_contributors(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the identity-aware path this migration reuses is gone';
  END IF;

  -- ══ AUTHORIZATION, FAIL CLOSED ════════════════════════════════════════════
  FOREACH v_one IN ARRAY ARRAY[dstage, droll, dout, drep] LOOP
    IF position('42501' IN v_one) = 0 THEN
      RAISE EXCEPTION 'SELFTEST FAILED: a QCP reader has no refusal path — it would answer an outsider';
    END IF;
  END LOOP;
  FOREACH v_one IN ARRAY ARRAY[dstage, droll, dout] LOOP
    IF position('nx_qcp_visible' IN v_one) = 0 THEN
      RAISE EXCEPTION 'SELFTEST FAILED: a QCP reader does not consult the audience matrix — that is a second authorization truth';
    END IF;
  END LOOP;
  -- The supplier mask, and the inspector's single-revision limit.
  IF position('supplier' IN droll) = 0 OR position('restricted' IN droll) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the QCP rollup lost its supplier mask — a supplier would read other parties'' execution detail';
  END IF;
  IF position('not authorized for this revision' IN dstage) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the stage reader lost the inspector single-revision limit';
  END IF;
  -- The internal derivations must not be reachable by an ordinary session.
  IF has_function_privilege('authenticated', 'public.nx_qcp_scope_jobs(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.nx_qcp_effective_revision(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ungated internal QCP derivation is executable by authenticated';
  END IF;

  -- ══ PROGRESS IS DERIVED, NOT STORED ═══════════════════════════════════════
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name IN ('quality_control_plans','qcp_revisions',
                                   'qcp_stages','qcp_stage_templates')
                AND column_name IN ('progress','progress_pct','percent_complete',
                                    'completion','completion_pct')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a stored progress column appeared on a QCP table — contract §2 forbids it';
  END IF;
  IF position('qcp_stage_templates' IN dstage) = 0
     OR position('itp_point_results' IN dstage) = 0
     OR position('itp_points' IN dstage) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the stage reader no longer derives progress along qcp_stage_templates -> itp_points -> itp_point_results';
  END IF;
  IF position('nx_qcp_stage_progress' IN droll) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the QCP rollup no longer aggregates the stage reader — the two could disagree';
  END IF;
  -- The blocking rule this file re-states must still match the frozen reader's.
  IF position('waived' IN ditp) = 0 OR position('not_applicable' IN ditp) = 0
     OR position('released_at' IN ditp) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_job_itp changed its blocking rule — the QCP stage reader now re-states a rule that no longer exists';
  END IF;

  -- ══ FALLBACK DISCIPLINE ═══════════════════════════════════════════════════
  IF position('has_qcp' IN droll) = 0 OR position('has_qcp' IN drep) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP rollup lost its no-plan marker — a job with no plan would render as an empty plan';
  END IF;
  IF position('from_scope_template_link' IN drep) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the report-scoped reader no longer labels the inferred linkage — a surface could present a guess as a stored fact';
  END IF;
  IF position('has_itp' IN pg_get_functiondef('public.nx_report_itp_rollup(uuid)'::regprocedure)) = 0
     OR position('from_fallback' IN pg_get_functiondef('public.nx_report_visit_rollup(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a sibling report rollup lost its no-data marker — the three no longer share the discipline';
  END IF;

  -- ══ NO REPORTS V2, NO ANALYTICS V2, NO QCP V2 ═════════════════════════════
  IF to_regclass('public.qcp_reports')        IS NOT NULL
     OR to_regclass('public.qcp_report_items') IS NOT NULL
     OR to_regclass('public.qcp_progress')     IS NOT NULL
     OR to_regclass('public.qcp_analytics')    IS NOT NULL
     OR to_regclass('public.inspection_reports_v2') IS NOT NULL
     OR to_regclass('public.ncr_reports')      IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a parallel report, progress or analytics table exists';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conname = 'unique_report_per_job_inspector';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspection_reports lost its one-row-per-(job,inspector) rule — report cardinality changed';
  END IF;

  -- ══ PRESERVATION ══════════════════════════════════════════════════════════
  IF to_regclass('public.report_templates') IS NULL
     OR to_regprocedure('public.get_template_for_job(uuid)') IS NULL
     OR to_regprocedure('public.lock_report_template(uuid)') IS NULL
     OR to_regprocedure('public.get_client_branding(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: report templating or branding was disturbed';
  END IF;
  IF to_regclass('public.pi_report_seals') IS NULL
     OR to_regprocedure('public.pi_seal_inspection_report(uuid)') IS NULL
     OR to_regprocedure('public.pi_countersign_inspection_report(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: report sealing / countersigning was disturbed';
  END IF;
  IF to_regprocedure('public.approve_inspection_report(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.nx_admin_review_inspection_report(uuid,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a report publish or review path was disturbed';
  END IF;
  IF to_regprocedure('public.nx_report_visit_rollup(uuid)') IS NULL
     OR to_regprocedure('public.nx_report_itp_rollup(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a sibling report rollup is gone — the queue would return a null column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.parameters
                  WHERE specific_schema = 'public'
                    AND parameter_name = 'visit_rollup'
                    AND specific_name LIKE 'nx_admin_report_review_queue%') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the review queue lost visit_rollup — 20260801390000 was regressed by this migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.parameters
                  WHERE specific_schema = 'public'
                    AND parameter_name = 'itp_rollup'
                    AND specific_name LIKE 'nx_admin_report_review_queue%') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the review queue lost itp_rollup — 20260801400000 was regressed by this migration';
  END IF;

  -- ══ EXPOSURE ══════════════════════════════════════════════════════════════
  FOREACH v_one IN ARRAY ARRAY['nx_qcp_visible(uuid,uuid)',
                               'nx_qcp_for_job(uuid)',
                               'nx_qcp_stage_progress(uuid,uuid)',
                               'nx_qcp_rollup(uuid)',
                               'nx_qcp_outstanding_requirements(uuid)',
                               'nx_report_qcp_rollup(uuid)',
                               'nx_admin_report_review_queue(int,boolean)'] LOOP
    IF has_function_privilege('anon', 'public.' || v_one, 'EXECUTE') THEN
      RAISE EXCEPTION 'SELFTEST FAILED: anon can reach %', v_one;
    END IF;
  END LOOP;
  IF position('admin only' IN dq) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the review queue is no longer admin-gated';
  END IF;
  -- Every definer here must pin its search_path.
  IF EXISTS (
    SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
     WHERE n.nspname = 'public'
       AND pr.prosecdef
       AND (pr.proname LIKE 'nx_qcp%' OR pr.proname = 'nx_report_qcp_rollup')
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(pr.proconfig, ARRAY[]::text[])) c
                        WHERE c LIKE 'search_path=%')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP definer function has no pinned search_path';
  END IF;

  -- ══ ADVISORY ══════════════════════════════════════════════════════════════
  --  Not a failure of THIS migration, so it warns rather than aborts.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'jobs'
                    AND column_name = 'project_id') THEN
    RAISE WARNING 'QCP REPORT LINKAGE: public.jobs has no project_id and no jobs<->projects bridge exists, so a report cannot reach its project-scoped QCP directly. nx_qcp_for_job infers the plan from the shared scope-template spine and every payload is labelled from_scope_template_link with a candidate_count. If two plans in one organisation link the same scope template the match is ambiguous and the surface must decline it. A stored linkage belongs to the schema lane, not to reporting.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
              WHERE n.nspname = 'public' AND pr.proname = 'nx_project_qcp')
     AND NOT EXISTS (
       SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
        WHERE n.nspname = 'public' AND pr.proname = 'nx_project_qcp'
          AND pg_get_functiondef(pr.oid) ILIKE '%itp\_point\_results%') THEN
    RAISE WARNING 'QCP PROGRESS DRIFT: nx_project_qcp does not read itp_point_results, so the schema lane''s progress and this lane''s derived progress may not agree. Contract §2 names one derivation path; both readers must use it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname = 'public' AND tablename = 'quality_control_plans'
                    AND rowsecurity) THEN
    RAISE WARNING 'QCP RLS: quality_control_plans has row level security disabled. These readers are SECURITY DEFINER and gate themselves, but direct PostgREST table access would be ungoverned. Owned by the schema lane.';
  END IF;

  RAISE NOTICE 'QCP reporting ready: stage progress derived through qcp_stage_templates -> itp_points -> itp_point_results, rollup rides inside the review queue beside visit_rollup and itp_rollup, audience matrix enforced, no name, no price, read-only.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
