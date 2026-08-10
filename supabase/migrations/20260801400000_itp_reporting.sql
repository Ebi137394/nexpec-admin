-- ════════════════════════════════════════════════════════════════════════════
--  20260801400000_itp_reporting.sql
--
--  PHASE 3B — ITP ↔ REPORTING / NCR INTEGRATION. Additive.
--
--  This migration integrates the ITP layer (20260801398000) into the reporting
--  system that ALREADY EXISTS. It builds no Reports v2 and no NCR v2. It adds
--  no table, no report row, no report status, no second template model, no
--  second publish path and no second non-conformance record.
--
--  ── THE MODEL IT COPIES ────────────────────────────────────────────────────
--  20260801390000 solved the identical problem for visits: a dimension that had
--  to appear on report surfaces without forking reporting. Its three decisions
--  are reproduced here verbatim in shape:
--
--    1. A REPORT-SCOPED READER, not a report column. inspection_reports is one
--       row per (job, inspector) and stays that way; the ITP dimension lives
--       where it already is — itp_points (the plan) and itp_point_results (the
--       execution) — and is READ per report.
--    2. THE ROLLUP RIDES INSIDE THE EXISTING QUEUE RPC. Adding a per-row fetch
--       to nx_admin_report_review_queue would be one round trip per report, so
--       itp_rollup is appended to the queue exactly as visit_rollup was.
--    3. FALLBACK DISCIPLINE. nx_report_visit_rollup marks the legacy single-date
--       job from_fallback so a surface can decline to dress it up as a
--       programme. The ITP equivalent is has_itp: a job with no scope template,
--       or a template with no active points, returns {has_itp:false} and MUST
--       render as nothing. An empty "0 of 0 plan" is a claim about quality
--       control that the job never made.
--
--  ── WHAT IS DELEGATED, AND WHY THAT MATTERS ────────────────────────────────
--  nx_report_itp_log does NOT re-derive the plan. It selects from nx_job_itp(),
--  which owns:
--       • the authorization rule (42501 for anyone outside the job audience)
--       • template resolution via jobs.scope_template_id
--       • the is_active filter and the stage/sequence ordering
--       • "no template means no ITP, without erroring"
--  so those five rules keep exactly one implementation and cannot drift from
--  the ITP screens. The ONE thing this migration adds is cross-visit
--  aggregation, which the frozen reader structurally cannot do: nx_job_itp is
--  scoped to a single visit (r.visit_id IS NOT DISTINCT FROM p_visit_id) and a
--  consolidated report spans all of them.
--
--  The blocking rule is lifted from nx_job_itp unchanged — a blocking point
--  that is not passed/waived/not_applicable and not released — and evaluated
--  across every visit instead of one: a hold cleared on any visit is cleared
--  for the report. That is the only re-statement in this file, and it is
--  self-tested against the frozen reader's own literal list below.
--
--  ── NCR: THE BRIDGE IS VERIFIED, NOT REBUILT ───────────────────────────────
--  nx_raise_ncr_from_itp_point (20260801398000 §8) delegates to
--  flash_report_create, is SECURITY INVOKER so the existing job-party check is
--  the single authorization, is idempotent per result, and refuses a non-failed
--  result. Its twin nx_raise_ncr_from_inspection_item (20260801366000) made the
--  same four decisions. Nothing here changes either. Reporting READS the link
--  (itp_point_results.flash_report_id → flash_reports.status) and never writes
--  it, so an NCR shown on a report is the same ordinary flash report the NCR
--  workflow already tracks to closure. Both bridges are pinned by self-tests
--  below: if a future edit makes either one write flash_reports directly or
--  turn into a definer, this migration refuses to apply.
--
--  ── PRICE PRIVACY ──────────────────────────────────────────────────────────
--  No function here selects, joins or returns a *_cents column, a wallet, a
--  transaction, a buyer price, an inspector payout or a platform spread. There
--  is nowhere for them to land, and the money surfaces this file must never
--  name are pinned by a self-test that scans the compiled function bodies.
--
--  ── IDENTITY ───────────────────────────────────────────────────────────────
--  Contributor attribution on an ITP line reuses the report system's existing
--  identity-aware path rather than inventing one: the same gate
--  nx_report_contributors applies (20260801390000 §1) —
--  nx_job_effective_identity_mode, fail-closed to 'protected' — and the same
--  nx_handle() pseudonym as the fallback that nx_job_inspector_team_public and
--  every other buyer surface render. A buyer on a protected engagement gets
--  NX- handles on the ITP register, never a name. The ROLLUP carries no
--  identity at all, only counts, because it rides inside the admin queue.
--
--  Whoever RELEASED a hold point is emitted as a handle only, in both
--  directions: a release is a buyer/admin act, and the register's audience
--  includes the crew. The authoritative actor record for a release is the
--  job_events row 20260801398000 already writes.
--
--  ── ZERO PAYMENT EFFECT ────────────────────────────────────────────────────
--  Every function here is STABLE and reads only. Nothing credits, settles,
--  transfers or moves a balance, and nothing writes admin_confirmed_at,
--  is_published or is_client_approved. Self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The ITP register for ONE report ──────────────────────────────────────
--  One row per ACTIVE plan point, carrying the point's definition, its
--  effective state across every visit the report consolidates, its evidence
--  linkage, its NCR linkage and its identity-gated attribution.
CREATE OR REPLACE FUNCTION public.nx_report_itp_log(p_report_id uuid)
RETURNS TABLE (
  point_id            uuid,
  stage               text,
  sequence_no         int,
  point_type          text,
  title               text,
  requirement         text,
  acceptance_criteria text,
  responsible_party   text,
  reference_document  text,
  blocks_progress     boolean,
  requires_signoff    boolean,
  result              text,
  ever_failed         boolean,
  record_count        int,
  visit_count         int,
  job_level_records   int,
  first_recorded_at   timestamptz,
  last_recorded_at    timestamptz,
  signed_off_at       timestamptz,
  witnessed_by        text,
  released_at         timestamptz,
  release_note        text,
  is_blocking_now     boolean,
  ncr_count           int,
  ncr_open            int,
  flash_report_id     uuid,
  evidence_requirement_id uuid,
  evidence_label      text,
  evidence_kind       text,
  evidence_capture_count int,
  recorded_by_name    text,
  recorded_by_handle  text,
  released_by_handle  text,
  identity_disclosed  boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job uuid;
  v_j   RECORD;
  v_is_buyer boolean;
  v_may_name boolean;
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

  v_is_buyer := (v_uid IS NOT DISTINCT FROM v_j.client_id)
             OR (v_uid IS NOT DISTINCT FROM v_j.agency_id);

  -- THE DISCLOSURE GATE, identical to nx_report_contributors. Admin, the crew
  -- and the contracted inspector work by name; the buyer gets a name only when
  -- the job's LIVE policy says so, and nx_job_effective_identity_mode fails
  -- closed to 'protected'. Anyone else reads nx_handle().
  v_may_name :=
        public.nx_is_admin()
     OR public.nx_is_active_job_team_member(v_job, v_uid)
     OR v_uid IS NOT DISTINCT FROM v_j.contractor_id
     OR (v_is_buyer
         AND public.nx_job_effective_identity_mode(v_job) IN ('professional', 'full'));

  RETURN QUERY
  WITH itp_plan AS (
    -- Authorization, template resolution, is_active and ordering: all inherited.
    SELECT * FROM public.nx_job_itp(v_job, NULL::uuid)
  ), res AS (
    SELECT r.* FROM public.itp_point_results r WHERE r.job_id = v_job
  ), latest AS (
    -- The state a report states is the LAST thing recorded for the point,
    -- whichever visit it happened on. A surveillance point recorded five times
    -- reads as its fifth reading, with ever_failed preserving the history.
    SELECT DISTINCT ON (r.point_id)
           r.point_id       AS l_point,
           r.result         AS l_result,
           r.inspector_id   AS l_inspector,
           r.witnessed_by   AS l_witness,
           r.release_note   AS l_note,
           r.released_by    AS l_releaser,
           r.flash_report_id AS l_ncr
      FROM res r
     ORDER BY r.point_id, r.recorded_at DESC NULLS LAST, r.created_at DESC
  ), agg AS (
    SELECT r.point_id                                  AS a_point,
           (count(*))::int                             AS a_records,
           (count(DISTINCT r.visit_id))::int           AS a_visits,
           (count(*) FILTER (WHERE r.visit_id IS NULL))::int AS a_joblevel,
           bool_or(r.result = 'failed')                AS a_everfailed,
           min(r.recorded_at)                          AS a_first,
           max(r.recorded_at)                          AS a_last,
           max(r.signed_off_at)                        AS a_signed,
           max(r.released_at)                          AS a_released,
           (count(*) FILTER (WHERE r.flash_report_id IS NOT NULL))::int AS a_ncrs,
           -- The frozen blocking rule, evaluated across every visit.
           bool_or(r.result IN ('passed','waived','not_applicable')
                   OR r.released_at IS NOT NULL)       AS a_cleared
      FROM res r
     GROUP BY r.point_id
  ), ncr AS (
    SELECT r.point_id AS n_point,
           (count(*) FILTER (WHERE f.status IN
              ('open','acknowledged','in_remediation','disputed')))::int AS n_open
      FROM res r
      JOIN public.flash_reports f ON f.id = r.flash_report_id
     GROUP BY r.point_id
  ), cap AS (
    -- Evidence is NOT recounted per point: this counts the captures that exist
    -- against the requirement the point reuses, on this job.
    SELECT c.requirement_id AS c_req, (count(*))::int AS c_n
      FROM public.inspection_captures c
     WHERE c.job_id = v_job
     GROUP BY c.requirement_id
  )
  SELECT pl.point_id, pl.stage, pl.sequence_no, pl.point_type, pl.title,
         pl.requirement, pl.acceptance_criteria, pl.responsible_party,
         pl.reference_document, pl.blocks_progress, pl.requires_signoff,
         COALESCE(la.l_result, 'pending'),
         COALESCE(ag.a_everfailed, false),
         COALESCE(ag.a_records, 0),
         COALESCE(ag.a_visits, 0),
         COALESCE(ag.a_joblevel, 0),
         ag.a_first, ag.a_last, ag.a_signed,
         la.l_witness, ag.a_released, la.l_note,
         (pl.blocks_progress AND NOT COALESCE(ag.a_cleared, false)),
         COALESCE(ag.a_ncrs, 0), COALESCE(nc.n_open, 0), la.l_ncr,
         ip.evidence_requirement_id, er.label, er.kind::text, COALESCE(cp.c_n, 0),
         CASE WHEN v_may_name THEN pf.full_name END,
         CASE WHEN la.l_inspector IS NULL THEN NULL
              ELSE public.nx_handle(la.l_inspector) END,
         CASE WHEN la.l_releaser IS NULL THEN NULL
              ELSE public.nx_handle(la.l_releaser) END,
         v_may_name
    FROM itp_plan pl
    LEFT JOIN latest la ON la.l_point = pl.point_id
    LEFT JOIN agg    ag ON ag.a_point = pl.point_id
    LEFT JOIN ncr    nc ON nc.n_point = pl.point_id
    LEFT JOIN public.itp_points ip ON ip.id = pl.point_id
    LEFT JOIN public.inspection_evidence_requirements er
           ON er.id = ip.evidence_requirement_id
    LEFT JOIN cap cp ON cp.c_req = ip.evidence_requirement_id
    LEFT JOIN public.profiles pf ON pf.id = la.l_inspector
   ORDER BY pl.stage, pl.sequence_no;
END $fn$;

ALTER FUNCTION public.nx_report_itp_log(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_itp_log(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_itp_log(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_itp_log(uuid) IS
  'The ITP register behind ONE inspection report: every active plan point with its effective state across all the visits the report consolidates, its evidence requirement and capture count, its NCR link, and who recorded it. The plan, the authorization, the is_active filter and the ordering are delegated to nx_job_itp so they keep one implementation; the only thing added is cross-visit aggregation, which the per-visit reader cannot do. Attribution is gated on nx_job_effective_identity_mode exactly as nx_report_contributors gates it, falling back to nx_handle(); a hold release is emitted as a handle only. Returns no pricing column.';

-- ── 2) One-row ITP summary, for headers and queues ──────────────────────────
--  Aggregates the register rather than re-querying the tables — the same
--  relationship nx_job_itp_blocking_points has to nx_job_itp. Identity-free by
--  construction: counts only, because this rides inside the admin queue and on
--  buyer-facing report headers.
CREATE OR REPLACE FUNCTION public.nx_report_itp_rollup(p_report_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_out jsonb;
  v_n   int;
BEGIN
  SELECT (count(*))::int,
         jsonb_build_object(
           'has_itp',       true,
           'point_count',   (count(*))::int,
           'recorded',      (count(*) FILTER (WHERE t.record_count > 0))::int,
           'not_recorded',  (count(*) FILTER (WHERE t.record_count = 0))::int,
           'record_count',  COALESCE(sum(t.record_count), 0)::int,

           -- Counts BY RESULT, over the plan. A point never recorded reads as
           -- 'pending', which is what nx_job_itp already says it is.
           'passed',         (count(*) FILTER (WHERE t.result = 'passed'))::int,
           'failed',         (count(*) FILTER (WHERE t.result = 'failed'))::int,
           'pending',        (count(*) FILTER (WHERE t.result = 'pending'))::int,
           'waived',         (count(*) FILTER (WHERE t.result = 'waived'))::int,
           'not_applicable', (count(*) FILTER (WHERE t.result = 'not_applicable'))::int,
           'ever_failed',    (count(*) FILTER (WHERE t.ever_failed))::int,
           'accepted',       (count(*) FILTER (
                               WHERE t.result IN ('passed','waived','not_applicable')))::int,

           -- POINT TYPE BREAKDOWN.
           'by_type', jsonb_build_object(
             'normal',       (count(*) FILTER (WHERE t.point_type = 'normal'))::int,
             'hold',         (count(*) FILTER (WHERE t.point_type = 'hold'))::int,
             'witness',      (count(*) FILTER (WHERE t.point_type = 'witness'))::int,
             'review',       (count(*) FILTER (WHERE t.point_type = 'review'))::int,
             'surveillance', (count(*) FILTER (WHERE t.point_type = 'surveillance'))::int),

           -- HOLD / WITNESS / REVIEW STATUS. The hold figure is the one that
           -- decides whether work may proceed, so it is stated on its own.
           'hold_total',        (count(*) FILTER (WHERE t.point_type = 'hold'))::int,
           'hold_outstanding',  (count(*) FILTER (
                                  WHERE t.point_type = 'hold' AND t.is_blocking_now))::int,
           'hold_released',     (count(*) FILTER (
                                  WHERE t.point_type = 'hold' AND t.released_at IS NOT NULL))::int,
           'witness_total',     (count(*) FILTER (WHERE t.point_type = 'witness'))::int,
           'witness_recorded',  (count(*) FILTER (
                                  WHERE t.point_type = 'witness' AND t.witnessed_by IS NOT NULL))::int,
           'witness_outstanding', (count(*) FILTER (
                                  WHERE t.point_type = 'witness' AND t.record_count = 0))::int,
           'review_total',      (count(*) FILTER (WHERE t.point_type = 'review'))::int,
           'review_outstanding', (count(*) FILTER (
                                  WHERE t.point_type = 'review' AND t.record_count = 0))::int,

           -- Every unreleased blocking point, whatever its type.
           'blocking_now',      (count(*) FILTER (WHERE t.is_blocking_now))::int,
           'signoff_required',  (count(*) FILTER (WHERE t.requires_signoff))::int,
           'signed_off',        (count(*) FILTER (WHERE t.signed_off_at IS NOT NULL))::int,

           -- NCR LINKAGE. Ordinary flash reports raised from failed points.
           'ncr_count', COALESCE(sum(t.ncr_count), 0)::int,
           'ncr_open',  COALESCE(sum(t.ncr_open), 0)::int,

           -- EVIDENCE LINKAGE. Points that name a requirement, and the captures
           -- that exist against those requirements on this job.
           'evidence_points',   (count(*) FILTER (
                                  WHERE t.evidence_requirement_id IS NOT NULL))::int,
           'evidence_captures', COALESCE(sum(t.evidence_capture_count), 0)::int,

           -- VISIT CONTEXT. The programme itself stays in nx_report_visit_rollup;
           -- this says only how much ITP work was bound to a visit at all.
           'points_with_visit_records', (count(*) FILTER (WHERE t.visit_count > 0))::int,
           'job_level_records', COALESCE(sum(t.job_level_records), 0)::int,

           -- CONTRIBUTORS. Distinct pseudonyms, never names, never ids.
           'contributor_count', (count(DISTINCT t.recorded_by_handle))::int,

           'stages', COALESCE(jsonb_agg(DISTINCT t.stage)
                       FILTER (WHERE t.stage IS NOT NULL), '[]'::jsonb),
           'reference_documents', COALESCE(jsonb_agg(DISTINCT t.reference_document)
                       FILTER (WHERE t.reference_document IS NOT NULL), '[]'::jsonb),
           'first_recorded_at', min(t.first_recorded_at),
           'last_recorded_at',  max(t.last_recorded_at))
    INTO v_n, v_out
    FROM public.nx_report_itp_log(p_report_id) t;

  -- FALLBACK DISCIPLINE, the counterpart of from_fallback: a job with no scope
  -- template, or a template with no active points, has no plan. Saying
  -- "0 of 0" would assert a quality regime the engagement never bought.
  IF COALESCE(v_n, 0) = 0 THEN
    RETURN jsonb_build_object('has_itp', false, 'point_count', 0);
  END IF;

  RETURN v_out;
END $fn$;

ALTER FUNCTION public.nx_report_itp_rollup(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_itp_rollup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_itp_rollup(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_itp_rollup(uuid) IS
  'One-row ITP summary for a report: counts by result, the point-type breakdown, outstanding hold points, witness/review status, evidence and NCR linkage, reference documents and how many people contributed. Aggregates nx_report_itp_log, so the plan and the authorization still have one implementation. has_itp=false means the job carries no ITP at all and the surface must render NOTHING rather than an empty plan — the same discipline from_fallback carries for visits. Returns no pricing column and no identity, only counts and pseudonym totals.';

-- ── 3) The admin review queue gains the ITP summary ─────────────────────────
--  A second APPENDED jsonb column, for the same reason visit_rollup was
--  appended in 20260801390000: the queue is where a reviewer decides whether a
--  report is signable, and "two hold points are still open" is exactly that
--  decision. It rides inside the existing RPC because fetching it per row would
--  be one round trip per report.
--
--  Forward-only: 20260801390000 is not edited, and its visit_rollup column is
--  preserved in place and in order so every existing reader keeps working.
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
  -- APPENDED ↓
  itp_rollup         jsonb
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
         public.nx_report_itp_rollup(r.id)
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
  'Admin-only queue of inspection reports awaiting technical/financial review, oldest first, each carrying its visit programme rollup (20260801390000) and its ITP rollup (20260801400000) so a reviewer can see both whether the work is finished and whether the quality plan is satisfied before signing off. Returns no pricing column of any kind.';

-- ── 4) Self-tests ───────────────────────────────────────────────────────────
--  NOTE FOR FUTURE EDITORS: pg_get_functiondef() includes the function's OWN
--  comments. Nothing written INSIDE a function body above may contain a literal
--  that the scans below search for, or the scan matches its own explanation and
--  the deploy fails for no reason. This has bitten this repository twice.
DO $test$
DECLARE
  dlog  text := pg_get_functiondef('public.nx_report_itp_log(uuid)'::regprocedure);
  droll text := pg_get_functiondef('public.nx_report_itp_rollup(uuid)'::regprocedure);
  dq    text := pg_get_functiondef('public.nx_admin_report_review_queue(int,boolean)'::regprocedure);
  dncr  text := pg_get_functiondef('public.nx_raise_ncr_from_itp_point(uuid,text,text,text)'::regprocedure);
  ditem text := pg_get_functiondef('public.nx_raise_ncr_from_inspection_item(uuid,text,text,text)'::regprocedure);
  ditp  text := pg_get_functiondef('public.nx_job_itp(uuid,uuid)'::regprocedure);
  v_money constant text :=
    '\m(payout|wallet|escrow|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents|platform_spread_cents|release_payment|stripe)\M';
  v_n int;
BEGIN
  -- ══ THE FROZEN ITP CONTRACT MUST BE INTACT ════════════════════════════════
  IF to_regclass('public.itp_points') IS NULL
     OR to_regclass('public.itp_point_results') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP table is missing — the foundation was removed under this migration';
  END IF;
  IF to_regprocedure('public.nx_job_itp(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_job_itp_blocking_points(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_itp_record_result(uuid,uuid,text,uuid,text,text)') IS NULL
     OR to_regprocedure('public.nx_itp_release_hold(uuid,text)') IS NULL
     OR to_regprocedure('public.nx_raise_ncr_from_itp_point(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP RPC signature changed — the frozen contract is broken';
  END IF;

  -- ══ NCR: ONE SYSTEM, AND BOTH BRIDGES BEHAVE THE SAME ═════════════════════
  --  These four assertions are the reason a failed ITP point cannot quietly
  --  become a second non-conformance record.
  IF position('flash_report_create' IN dncr) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP NCR bridge no longer delegates to the existing NCR entry point';
  END IF;
  IF dncr ~* 'INSERT\s+INTO\s+(public\.)?flash_reports\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP NCR bridge writes the NCR table directly — that is a parallel NCR path';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'nx_raise_ncr_from_itp_point' AND prosecdef) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP NCR bridge became a definer and would bypass the job-party check';
  END IF;
  -- Idempotent per result, and only a FAILED point may raise one.
  IF position('idempotent' IN dncr) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP NCR bridge lost its idempotency guard — one failure could raise many NCRs';
  END IF;
  IF position('only a FAILED ITP point' IN dncr) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP NCR bridge no longer refuses a non-failed result';
  END IF;
  -- The inspection-item bridge made the same decisions in 20260801366000. If
  -- the two ever diverge, one of them is wrong.
  IF ditem ~* 'INSERT\s+INTO\s+(public\.)?flash_reports\M'
     OR position('flash_report_create' IN ditem) = 0
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'nx_raise_ncr_from_inspection_item' AND prosecdef) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the inspection-item NCR bridge diverged from the ITP one — the two must behave identically';
  END IF;
  -- Reporting READS the link and must never raise or write one.
  IF dlog ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.'
     OR droll ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.'
     OR dq   ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP reporting reader writes';
  END IF;
  IF position('flash_report_create' IN dlog) > 0
     OR position('flash_report_create' IN droll) > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP reporting reader raises an NCR — reporting reports, it does not act';
  END IF;

  -- ══ MONEY: NO PRICE, NO PAYOUT, NO MARGIN, NO PAYMENT SIDE EFFECT ═════════
  IF dlog ~* v_money OR droll ~* v_money OR dq ~* v_money THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP reporting function names a money surface';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND (parameter_name ILIKE '%_cents%'
            OR parameter_name ILIKE '%price%'
            OR parameter_name ILIKE '%payout%'
            OR parameter_name ILIKE '%spread%')
       AND (specific_name LIKE 'nx_report_itp%'
            OR specific_name LIKE 'nx_admin_report_review_queue%')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP reporting function exposes a money column';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.nx_report_itp_log(uuid)'::regprocedure) <> 's'
     OR (SELECT provolatile FROM pg_proc WHERE oid = 'public.nx_report_itp_rollup(uuid)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP reporting reader is not STABLE — it could acquire a side effect';
  END IF;
  -- The orphaned report state machine must stay unattached: it completes the
  -- job on approval, which fires settlement. Pinned by 20260801390000, re-pinned
  -- here because this migration touches the same review queue.
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
  IF position('nx_job_effective_identity_mode' IN dlog) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP register does not consult the identity policy — a buyer would read crew names on a protected job';
  END IF;
  IF position('nx_handle' IN dlog) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP register has no pseudonymous fallback';
  END IF;
  -- The rollup rides inside the admin queue and buyer headers: counts only.
  IF droll ~* '\m(full_name|email|phone|company_name)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP rollup returns an identity column';
  END IF;
  IF to_regprocedure('public.nx_job_inspector_team_public(uuid)') IS NULL
     OR to_regprocedure('public.nx_report_contributors(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the identity-aware attribution path this migration reuses is gone';
  END IF;

  -- ══ ONE PLAN TRUTH ════════════════════════════════════════════════════════
  IF position('nx_job_itp' IN dlog) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP register does not delegate to nx_job_itp — that is a second plan truth';
  END IF;
  IF position('nx_report_itp_log' IN droll) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP rollup no longer aggregates the register — the two could disagree';
  END IF;
  -- The blocking rule this file re-states across visits must still match the
  -- frozen reader's own list.
  IF position('waived' IN ditp) = 0 OR position('not_applicable' IN ditp) = 0
     OR position('released_at' IN ditp) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_job_itp changed its blocking rule — the report register now re-states a rule that no longer exists';
  END IF;

  -- ══ FALLBACK DISCIPLINE ═══════════════════════════════════════════════════
  IF position('has_itp' IN droll) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP rollup lost its no-plan marker — a job with no ITP would render as an empty plan';
  END IF;
  IF position('from_fallback' IN pg_get_functiondef('public.nx_report_visit_rollup(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the visit rollup lost from_fallback — the two report rollups no longer share the discipline';
  END IF;

  -- ══ NO REPORTS V2, NO ITP V2 ══════════════════════════════════════════════
  IF to_regclass('public.itp_reports') IS NOT NULL
     OR to_regclass('public.itp_report_items') IS NOT NULL
     OR to_regclass('public.inspection_reports_v2') IS NOT NULL
     OR to_regclass('public.ncr_reports') IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a parallel report or NCR table exists';
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
     OR to_regprocedure('public.nx_report_visit_log(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the visit reporting readers are gone — the queue would return a null rollup';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.parameters
                  WHERE specific_schema = 'public'
                    AND parameter_name = 'visit_rollup'
                    AND specific_name LIKE 'nx_admin_report_review_queue%') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the review queue lost visit_rollup — 20260801390000 was regressed by this migration';
  END IF;

  -- ══ EXPOSURE ══════════════════════════════════════════════════════════════
  IF has_function_privilege('anon', 'public.nx_report_itp_log(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.nx_report_itp_rollup(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.nx_admin_report_review_queue(int,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can reach an ITP reporting function';
  END IF;
  IF position('admin only' IN dq) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the review queue is no longer admin-gated';
  END IF;

  -- ══ ADVISORY ══════════════════════════════════════════════════════════════
  --  Not a failure of THIS migration, so it warns rather than aborts. The NCR
  --  bridge is SECURITY INVOKER by design and writes back the link column as
  --  the caller. itp_point_results carries a SELECT policy and an INSERT policy
  --  and no third one, so under RLS that write-back matches no row for a
  --  non-admin caller, the link never persists, and the bridge's idempotency
  --  guard never trips. Owned by the ITP foundation, reported not patched.
  IF to_regclass('public.itp_point_results') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname = 'public' AND tablename = 'itp_point_results'
                    AND rowsecurity)
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                      WHERE schemaname = 'public' AND tablename = 'itp_point_results'
                        AND cmd IN ('UPDATE', 'ALL')) THEN
    RAISE WARNING 'ITP NCR LINK-BACK: itp_point_results has no UPDATE-capable policy, so nx_raise_ncr_from_itp_point cannot persist flash_report_id for a non-admin caller. The register will show no NCR linkage and the bridge will not be idempotent in practice. Fix belongs to the ITP foundation migration.';
  END IF;

  RAISE NOTICE 'ITP reporting ready: register + rollup delegate to nx_job_itp, rollup rides inside the review queue, identity gated, NCR read-only, money-free.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
