-- ════════════════════════════════════════════════════════════════════════════
--  20260801390000_visit_aware_reporting.sql
--
--  PHASE 2G — MULTI-VISIT ↔ REPORTING INTEGRATION. Additive.
--
--  This migration integrates visits into the reporting system that ALREADY
--  EXISTS. It builds no Reports v2, adds no report table, no second template
--  model, no parallel publish path and no new report status.
--
--  ── WHAT THE INVENTORY ACTUALLY FOUND (evidence, not assumption) ───────────
--  inspection_reports (baseline 23076-23100) is ONE row per (job, inspector),
--  enforced by unique_report_per_job_inspector. It carries notes,
--  final_report_doc (text JSON), pdf_url, the two admin review flags, and the
--  two client publish flags. It has NO visit column and NO revision column, and
--  this migration deliberately adds neither:
--
--   • A per-VISIT report ROW is impossible without changing report cardinality,
--     and approve_inspection_report (20260801162000) publishes by job_id — one
--     client approval already publishes every report row on the job. Splitting
--     reports per visit would multiply that blast radius. The visit dimension
--     therefore lives WHERE IT ALREADY IS: inspection_items.visit_id and
--     inspection_captures.visit_id (20260801384000). One report, a per-visit
--     log inside it. That is exactly what daily / resident / surveillance
--     reporting needs, and it needs no cardinality change to get it.
--
--   • "Report revisioning" is a phantom. handle_inspection_report_state_machine
--     (baseline 11725) and handle_report_status_change both write
--     revision_count / revision_history / revision_notes / submitted_at /
--     approved_at — NONE of which exist on inspection_reports — and NEITHER IS
--     ATTACHED: the only trigger on the table is tg_enqueue_document_analysis
--     (baseline 27550). The live revision trail is the audit trail
--     (audit_events 'job.client_requested_revision' + job_events
--     'status_change') plus status='revision_requested'. Nothing here changes
--     that, and a self-test below pins the fact that the orphaned state machine
--     stays unattached — it contains `UPDATE jobs SET status='completed'`,
--     which its own comment says fires escrow release. Attaching it would
--     create an automatic payment side effect from report approval.
--
--  ── THE TWO REAL GAPS THIS CLOSES ──────────────────────────────────────────
--  1. IDENTITY LEAK IN CONTRIBUTOR ATTRIBUTION. nx_report_contributors
--     (20260801378000) authorises the job's CLIENT and AGENCY and then returns
--     p.full_name unconditionally. jobs.identity_mode — the authoritative
--     disclosure policy (…284000/…328000), 'protected' by default on every
--     legacy job — is never consulted. Every other buyer-facing surface gates
--     on it (client_job_contracts_view, clientReports.ts, clientJobReport.ts).
--     This one did not, so wiring it to any buyer report surface would have
--     printed the real names of the whole crew. Fixed here: the buyer gets
--     nx_handle() unless nx_job_effective_identity_mode permits a name.
--
--  2. NO VISIT CONTEXT ON ANY REPORT SURFACE. Admin reviews a consolidated
--     report with no idea whether the programme is finished; the buyer approves
--     it with no idea what it covers. Two report-scoped readers below answer
--     that, and BOTH DELEGATE THE VISIT LIST AND THE AUTHORIZATION TO
--     nx_job_visits(), so the legacy single-visit fallback and the
--     live/superseded rule have exactly one implementation and cannot drift.
--
--  ── NOT DUPLICATED ─────────────────────────────────────────────────────────
--  nx_visit_evidence_summary (20260801388000) answers the JOB-scoped question
--  "what evidence exists per visit". nx_report_visit_log below answers the
--  REPORT-scoped question "what did THIS report record per visit". Captures are
--  deliberately left to the former; this one counts only inspection_items bound
--  to p_report_id, so there is no second evidence counter.
--
--  ── PRESERVED, AND SELF-TESTED BELOW ───────────────────────────────────────
--  report_templates (schema_json / header_template / footer_template /
--  template_spec / spec_sha256 / is_locked), get_template_for_job,
--  lock_report_template, set_default_template, get_client_branding,
--  approve_inspection_report, pi_report_seals + pi_seal_inspection_report +
--  pi_countersign_inspection_report. Every one of them is untouched.
--
--  ── PRICE PRIVACY ──────────────────────────────────────────────────────────
--  No function here selects, joins or returns a *_cents column, a wallet, a
--  transaction or a payout. Buyer price, inspector payout and platform margin
--  have nowhere to land. Self-tested.
--
--  ── PAYMENT ────────────────────────────────────────────────────────────────
--  Nothing here writes admin_confirmed_at, is_published or is_client_approved.
--  Report review and publishing keep their existing owners and move no money.
--  Self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Contributor attribution — identity-gated, and visit-aware ────────────
--  The output columns of 20260801378000 are preserved IN ORDER; three are
--  APPENDED. PostgREST returns RPC rows as name-keyed objects, so an existing
--  reader that asks for item_count keeps getting item_count.
--
--  A signature change needs DROP + CREATE; CREATE OR REPLACE cannot widen a
--  RETURNS TABLE. Forward-only: 20260801378000 is not edited.
DROP FUNCTION IF EXISTS public.nx_report_contributors(uuid);

CREATE FUNCTION public.nx_report_contributors(p_report_id uuid)
RETURNS TABLE (
  inspector_id  uuid,
  full_name     text,
  team_role     text,
  is_lead       boolean,
  is_contracted boolean,
  item_count    int,
  capture_count int,
  -- APPENDED ↓
  handle        text,
  visit_count   int,
  identity_disclosed boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job uuid;
  v_rep RECORD;
  v_j   RECORD;
  v_is_buyer boolean;
  v_may_name boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.job_id, r.inspector_id INTO v_rep
    FROM public.inspection_reports r WHERE r.id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found' USING errcode = 'P0002';
  END IF;
  v_job := v_rep.job_id;

  SELECT j.client_id, j.agency_id, j.contractor_id INTO v_j
    FROM public.jobs j WHERE j.id = v_job;

  v_is_buyer := (v_uid IS NOT DISTINCT FROM v_j.client_id)
             OR (v_uid IS NOT DISTINCT FROM v_j.agency_id);

  -- Audience: unchanged from 20260801378000.
  IF NOT (
    public.nx_is_admin()
    OR public.nx_is_active_job_team_member(v_job, v_uid)
    OR v_is_buyer
    OR v_uid IS NOT DISTINCT FROM v_j.contractor_id
  ) THEN
    RAISE EXCEPTION 'not authorized for this report' USING errcode = '42501';
  END IF;

  -- ── THE DISCLOSURE GATE ───────────────────────────────────────────────────
  --  Admin, the crew itself and the contracted inspector work by name. The
  --  BUYER sees a name only when the job's live identity policy says so;
  --  nx_job_effective_identity_mode fails closed to 'protected', which is the
  --  default on every legacy job. Anyone else gets nx_handle() — the same
  --  pseudonym the rest of the buyer surface already renders.
  v_may_name :=
        public.nx_is_admin()
     OR public.nx_is_active_job_team_member(v_job, v_uid)
     OR v_uid IS NOT DISTINCT FROM v_j.contractor_id
     OR (v_is_buyer
         AND public.nx_job_effective_identity_mode(v_job) IN ('professional', 'full'));

  RETURN QUERY
  WITH item_rows AS (
    -- NULL inspector_id means the report's own inspector (legacy semantics).
    SELECT COALESCE(i.inspector_id, v_rep.inspector_id) AS iid, i.visit_id AS vid
      FROM public.inspection_items i
     WHERE i.report_id = p_report_id
  ), capture_rows AS (
    SELECT c.inspector_id AS iid, c.visit_id AS vid
      FROM public.inspection_captures c
     WHERE c.job_id = v_job AND c.inspector_id IS NOT NULL
  ), item_counts AS (
    SELECT iid, count(*)::int AS n FROM item_rows GROUP BY 1
  ), capture_counts AS (
    SELECT iid, count(*)::int AS n FROM capture_rows GROUP BY 1
  ), visit_counts AS (
    -- How many VISITS each person actually worked, derived from the same
    -- evidence rows. Job-level (visit_id NULL) work is not a visit and is
    -- excluded rather than counted as one.
    SELECT iid, count(DISTINCT vid)::int AS n
      FROM (SELECT iid, vid FROM item_rows    WHERE vid IS NOT NULL
            UNION ALL
            SELECT iid, vid FROM capture_rows WHERE vid IS NOT NULL) z
     GROUP BY 1
  ), everyone AS (
    SELECT iid FROM item_counts
    UNION
    SELECT iid FROM capture_counts
    UNION
    SELECT v_rep.inspector_id
  )
  SELECT e.iid,
         CASE WHEN v_may_name THEN p.full_name END,
         ji.role,
         COALESCE(ji.is_lead, false),
         (e.iid IS NOT DISTINCT FROM v_j.contractor_id),
         COALESCE(ic.n, 0),
         COALESCE(cc.n, 0),
         public.nx_handle(e.iid),
         COALESCE(vc.n, 0),
         v_may_name
    FROM everyone e
    LEFT JOIN public.profiles p ON p.id = e.iid
    LEFT JOIN public.job_inspectors ji
           ON ji.job_id = v_job AND ji.inspector_id = e.iid
          AND ji.status IN ('assigned','active')
    LEFT JOIN item_counts    ic ON ic.iid = e.iid
    LEFT JOIN capture_counts cc ON cc.iid = e.iid
    LEFT JOIN visit_counts   vc ON vc.iid = e.iid
   WHERE e.iid IS NOT NULL
   ORDER BY COALESCE(ji.is_lead, false) DESC,
            COALESCE(ic.n,0) + COALESCE(cc.n,0) DESC;
END $fn$;

ALTER FUNCTION public.nx_report_contributors(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_contributors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_contributors(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_contributors(uuid) IS
  'Who contributed to a report, DERIVED from inspection_items and inspection_captures rather than a contributions table, now with the visits each person worked. full_name is gated on nx_job_effective_identity_mode for the BUYER (fail-closed to ''protected''); everyone outside the disclosure policy gets nx_handle() instead. NULL item.inspector_id still counts towards the report''s own inspector, preserving legacy meaning. Returns no pricing column.';

-- ── 2) Report-scoped visit rollup — one row, for headers and queues ─────────
CREATE OR REPLACE FUNCTION public.nx_report_visit_rollup(p_report_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job uuid;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.job_id INTO v_job
    FROM public.inspection_reports r WHERE r.id = p_report_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'report not found' USING errcode = 'P0002';
  END IF;

  -- Authorization is nx_job_visits'. It raises 42501 for anyone outside the
  -- job's audience, so the rule is stated once and cannot drift from the
  -- visits page. The legacy single-visit fallback arrives with it, free.
  SELECT jsonb_build_object(
           'visit_count',   count(*)::int,
           'completed',     (count(*) FILTER (WHERE v.status = 'completed'))::int,
           'cancelled',     (count(*) FILTER (WHERE v.status = 'cancelled'))::int,
           'no_show',       (count(*) FILTER (WHERE v.status = 'no_show'))::int,
           'in_progress',   (count(*) FILTER (WHERE v.status = 'in_progress'))::int,
           'outstanding',   (count(*) FILTER (
                              WHERE v.status IN ('planned','scheduled','in_progress')))::int,
           'undated',       (count(*) FILTER (WHERE v.scheduled_start IS NULL))::int,
           'first_start',   min(v.scheduled_start),
           'last_start',    max(v.scheduled_start),
           'next_at',       (min(v.scheduled_start) FILTER (
                              WHERE v.status IN ('planned','scheduled','in_progress')
                                AND v.scheduled_start >= now())),
           'first_started_at',   min(jv.started_at),
           'last_completed_at',  max(jv.completed_at),
           'kinds',         COALESCE(jsonb_agg(DISTINCT v.visit_kind), '[]'::jsonb),
           'is_recurring',  COALESCE(bool_or(v.recurrence_group_id IS NOT NULL), false),
           -- false, not true, on an empty list: zero live visits (every one
           -- superseded) is a different statement from "this is a legacy job".
           'from_fallback', COALESCE(bool_or(v.from_fallback), false))
    INTO v_out
    FROM public.nx_job_visits(v_job) v
    -- Execution timestamps are not part of the canonical reader's contract;
    -- they are read for the rows it already returned, never re-selected with a
    -- second live/superseded rule of their own.
    LEFT JOIN public.job_visits jv ON jv.id = v.visit_id;

  RETURN COALESCE(v_out, jsonb_build_object('visit_count', 0, 'from_fallback', false));
END $fn$;

ALTER FUNCTION public.nx_report_visit_rollup(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_visit_rollup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_visit_rollup(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_visit_rollup(uuid) IS
  'One-row programme summary for a report: how many visits it covers, how many are done, the window they span. Delegates the visit list AND the authorization to nx_job_visits, so the legacy scheduled_date fallback and the superseded-row rule have a single implementation. from_fallback=true means the job has no explicit visits and this is the classic single-visit job. Returns no pricing column and no identity.';

-- ── 3) Report-scoped per-visit log — the daily / surveillance record ────────
CREATE OR REPLACE FUNCTION public.nx_report_visit_log(p_report_id uuid)
RETURNS TABLE (
  visit_id            uuid,
  visit_number        int,
  title               text,
  visit_kind          text,
  status              text,
  scheduled_start     timestamptz,
  scheduled_end       timestamptz,
  timezone            text,
  recurrence_group_id uuid,
  started_at          timestamptz,
  completed_at        timestamptz,
  notes               text,
  cancel_reason       text,
  report_item_count   int,
  report_contributor_count int,
  from_fallback       boolean,
  is_job_level        boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_rep RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.job_id, r.inspector_id INTO v_rep
    FROM public.inspection_reports r WHERE r.id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found' USING errcode = 'P0002';
  END IF;

  RETURN QUERY
  WITH vis AS (
    -- Authorization + fallback + superseded-row rule, all inherited.
    SELECT * FROM public.nx_job_visits(v_rep.job_id)
  ), it AS (
    SELECT COALESCE(i.inspector_id, v_rep.inspector_id) AS iid, i.visit_id AS vid
      FROM public.inspection_items i
     WHERE i.report_id = p_report_id
  )
  SELECT v.visit_id, v.visit_number, v.title, v.visit_kind, v.status,
         v.scheduled_start, v.scheduled_end, v.timezone, v.recurrence_group_id,
         jv.started_at, jv.completed_at, jv.notes, jv.cancel_reason,
         -- On a legacy job the single synthetic visit IS the whole job, so
         -- every item on the report belongs to it. That is the pre-existing
         -- meaning of visit_id NULL, not a reinterpretation.
         CASE WHEN v.from_fallback
              THEN (SELECT count(*)::int FROM it)
              ELSE (SELECT count(*)::int FROM it WHERE it.vid = v.visit_id) END,
         CASE WHEN v.from_fallback
              THEN (SELECT count(DISTINCT it.iid)::int FROM it WHERE it.iid IS NOT NULL)
              ELSE (SELECT count(DISTINCT it.iid)::int FROM it
                     WHERE it.vid = v.visit_id AND it.iid IS NOT NULL) END,
         v.from_fallback,
         false
    FROM vis v
    LEFT JOIN public.job_visits jv ON jv.id = v.visit_id

  UNION ALL

  -- Job-level bucket. Emitted ONLY when the job has explicit visits and some of
  -- this report's items are not bound to one, so unattached work is never
  -- silently dropped from a consolidated report — and never invented on a
  -- legacy job, where it would be a duplicate of the fallback row above.
  SELECT NULL::uuid, NULL::int, 'Not linked to a visit'::text, NULL::text, NULL::text,
         NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::uuid,
         NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::text,
         (SELECT count(*)::int FROM it WHERE it.vid IS NULL),
         (SELECT count(DISTINCT it.iid)::int FROM it
           WHERE it.vid IS NULL AND it.iid IS NOT NULL),
         false, true
   WHERE EXISTS (SELECT 1 FROM vis WHERE NOT vis.from_fallback)
     AND EXISTS (SELECT 1 FROM it WHERE it.vid IS NULL)

  ORDER BY 17, 2;
END $fn$;

ALTER FUNCTION public.nx_report_visit_log(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_visit_log(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_visit_log(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_visit_log(uuid) IS
  'Per-visit execution record for ONE report — dates, status, execution timestamps, the visit note, and how much of THIS report was recorded on each visit. The daily / resident / surveillance log lives here, inside the single report, rather than in per-visit report rows. Job-scoped evidence counts stay in nx_visit_evidence_summary; this counts only inspection_items bound to p_report_id, so there is no second evidence counter. Visit list and authorization delegate to nx_job_visits. Returns no pricing column and no identity.';

-- ── 4) The admin review queue gains programme context ───────────────────────
--  ONE appended column, deliberately jsonb: the queue is the only place a
--  reviewer decides whether a consolidated report is even reviewable yet
--  ("3 of 5 visits done"), and a jsonb rollup lets that answer grow without
--  another signature change.
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
  -- APPENDED ↓
  visit_rollup       jsonb
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
         public.nx_report_visit_rollup(r.id)
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
  'Admin-only queue of inspection reports awaiting technical/financial review, oldest first, each carrying its visit programme rollup so a reviewer can see whether the work the report consolidates is actually finished. Returns no pricing column of any kind.';

-- ── 5) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dcon  text := pg_get_functiondef('public.nx_report_contributors(uuid)'::regprocedure);
  droll text := pg_get_functiondef('public.nx_report_visit_rollup(uuid)'::regprocedure);
  dlog  text := pg_get_functiondef('public.nx_report_visit_log(uuid)'::regprocedure);
  dq    text := pg_get_functiondef('public.nx_admin_report_review_queue(int,boolean)'::regprocedure);
  v_money constant text :=
    '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents|platform_spread_cents|release_payment|stripe)\M';
BEGIN
  -- ── PRICE PRIVACY: no money surface may be named anywhere here ────────────
  IF dcon ~* v_money OR droll ~* v_money OR dlog ~* v_money OR dq ~* v_money THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a visit-reporting function names a money surface';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND parameter_name ILIKE '%_cents%'
       AND specific_name LIKE 'nx_report_visit%') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a visit-reporting function exposes a *_cents column';
  END IF;

  -- ── IDENTITY: the contributor gate must consult the live policy ───────────
  IF position('nx_job_effective_identity_mode' IN dcon) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_report_contributors does not consult the identity policy — a buyer would see crew names on a protected job';
  END IF;
  IF position('nx_handle' IN dcon) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_report_contributors has no pseudonymous fallback';
  END IF;
  -- The two visit readers must stay identity-free; they describe work.
  IF droll ~* '\m(full_name|email|phone|company_name)\M'
     OR dlog ~* '\m(full_name|email|phone|company_name)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a visit reader returns an identity column';
  END IF;

  -- ── ONE VISIT TRUTH: both readers must delegate, not re-derive ────────────
  IF position('nx_job_visits' IN droll) = 0 OR position('nx_job_visits' IN dlog) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a report visit reader does not delegate to nx_job_visits — that is a second visit truth';
  END IF;
  IF position('from_fallback' IN pg_get_functiondef('public.nx_job_visits(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_job_visits lost its single-visit fallback';
  END IF;

  -- ── READ-ONLY: reporting integration writes nothing ───────────────────────
  IF droll ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.'
     OR dlog ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.'
     OR dcon ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.'
     OR dq   ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a report reader writes';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.nx_report_visit_log(uuid)'::regprocedure) <> 's'
     OR (SELECT provolatile FROM pg_proc WHERE oid = 'public.nx_report_visit_rollup(uuid)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a report visit reader is not STABLE';
  END IF;

  -- ── NO AUTOMATIC PAYMENT FROM APPROVAL / PUBLISHING ───────────────────────
  --  handle_inspection_report_state_machine (baseline) does
  --  `UPDATE jobs SET status='completed'` on approval, which its own comment
  --  says fires escrow release. It has never been attached. Pin that.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc  f ON f.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND c.relname = 'inspection_reports'
       AND f.proname IN ('handle_inspection_report_state_machine',
                         'handle_report_status_change',
                         'handle_report_submission')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an orphaned report state machine has been attached to inspection_reports — report approval would auto-complete the job and fire settlement';
  END IF;

  -- ── PRESERVATION: every listed reporting capability must still exist ──────
  IF to_regclass('public.report_templates') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: report_templates is gone — template customization lost';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='report_templates'
                    AND column_name IN ('template_spec','spec_sha256','is_locked',
                                        'header_template','footer_template','version')
                  HAVING count(*) = 6) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a report_templates spec / branding / locking column is missing';
  END IF;
  IF to_regprocedure('public.get_template_for_job(uuid)') IS NULL
     OR to_regprocedure('public.lock_report_template(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: template resolution or template locking is gone';
  END IF;
  IF to_regprocedure('public.get_client_branding(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: get_client_branding is gone — report branding lost';
  END IF;
  IF to_regclass('public.pi_report_seals') IS NULL
     OR to_regprocedure('public.pi_seal_inspection_report(uuid)') IS NULL
     OR to_regprocedure('public.pi_countersign_inspection_report(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: report hashing / countersigning is gone';
  END IF;
  IF to_regprocedure('public.approve_inspection_report(uuid,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the client publish path is gone';
  END IF;
  IF to_regprocedure('public.nx_admin_review_inspection_report(uuid,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin report review is gone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_reports'
                    AND column_name IN ('technical_approved','financial_approved',
                                        'is_published','is_client_approved',
                                        'pdf_url','final_report_doc')
                  HAVING count(*) = 6) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an inspection_reports review / publish / document column is missing';
  END IF;

  -- ── EXPOSURE ──────────────────────────────────────────────────────────────
  IF has_function_privilege('anon','public.nx_report_contributors(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.nx_report_visit_rollup(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.nx_report_visit_log(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.nx_admin_report_review_queue(int,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can reach a report function';
  END IF;
  IF position('admin only' IN dq) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the review queue is no longer admin-gated';
  END IF;

  RAISE NOTICE 'visit-aware reporting ready: contributor identity gated, per-visit report log delegating to nx_job_visits, templates/branding/sealing/publishing untouched, money-free.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
