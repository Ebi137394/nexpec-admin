-- ════════════════════════════════════════════════════════════════════════════
--  20260801430000_report_review_history.sql
--
--  LANE B — REPORT REVIEW HISTORY / FIRST-PASS APPROVAL
--  Frozen contract: docs/launch-hardening-p1-contract.md §"Lane B".
--
--  ── THE GAP, RESTATED FROM EVIDENCE ────────────────────────────────────────
--  Two report entities exist in this schema and the contract's Lane B paragraph
--  describes a merge of both. Recorded here because the next reader will hit it:
--
--    public.reports              baseline:24252. status CHECK is exactly
--                                In_Progress|Submitted|Approved|Rejected|
--                                Revision_Requested — the vocabulary the
--                                contract quotes. It has NO technical_approved
--                                / financial_approved columns. Legacy
--                                report/project model (so named at 148000:11);
--                                one writer left in the tree,
--                                app/submit-report.tsx, INSERT only.
--
--    public.inspection_reports   baseline:23075. status is free text defaulting
--                                to 'pending'; the live values written are
--                                'pending' → 'approved' | 'revision_requested'
--                                (162000:64). THIS is the table that carries
--                                technical_approved{,_at,_by} /
--                                financial_approved{,_at,_by} (baseline:
--                                23087-23093), the one the review queue reads
--                                (364000), and the one the apps use (68 refs).
--
--  So the contract's "reports.status … technical_approved … exist" sentence
--  describes no single table. The FINDING is nevertheless correct for BOTH:
--  neither table has any status/review history anywhere in the migration tree,
--  and every non-approval transition overwrites status in place. First-pass
--  approval rate and revision cycle count are not computable today.
--
--  This migration therefore covers BOTH report entities through ONE table with
--  an exclusive-arc foreign key. Covering only `reports` would leave the metric
--  dead on arrival (nothing has ever transitioned that table's status);
--  covering only `inspection_reports` would ignore the table the contract
--  literally names. One table, two arcs, one canonical transition vocabulary.
--
--  ── WHAT IS PRESERVED UNCHANGED ────────────────────────────────────────────
--  technical_approved{,_at,_by} and financial_approved{,_at,_by} keep STATUS-
--  ONLY semantics and are neither read as authority nor written by anything
--  here. nx_admin_review_inspection_report (364000) and
--  approve_inspection_report (162000) are untouched. No status value is added,
--  removed or renamed on either table. No Reports v2.
--
--  ── APPEND-ONLY, AND NO BACKFILL ───────────────────────────────────────────
--  A history row is never UPDATEd and never DELETEd on its own; it may only
--  disappear together with the report it describes (FK cascade). Nothing is
--  fabricated for pre-existing reports: because an AFTER INSERT trigger writes
--  a genesis row for every report created from now on, "zero history rows" is a
--  PROOF of pre-migration origin, not an ambiguity. Such reports classify as
--  'legacy_history_unavailable' and stay perfectly valid.
--
--  ── PAYMENT FREEZE ─────────────────────────────────────────────────────────
--  Nothing here writes or reads wallets, transactions, payout_status,
--  payout_paid_at or admin_confirmed_at. Report approval moves no money; payout
--  stays manual. Nothing here selects, joins or returns client_price_cents,
--  inspector_payout_cents, platform_spread_cents or base_price_cents. Both are
--  asserted by the self-test at the foot of this file.
--
--  ── THE 402000 LESSON ──────────────────────────────────────────────────────
--  This database's ALTER DEFAULT PRIVILEGES (baseline:40931-40932) GRANTs ALL
--  ON TABLES to anon AND authenticated for every future table. A new table is
--  therefore world-writable the instant it is created unless the grant is
--  explicitly revoked. It is revoked below, and the self-test fails the deploy
--  if it ever comes back.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
--  1) The canonical transition vocabulary
--
--  The two report tables speak different dialects (Title_Case vs lowercase,
--  'Submitted' vs 'pending'). One derived classification lets a single query
--  answer the pilot metric across both. The verbatim status text is kept
--  alongside it in from_status/to_status, so normalising loses nothing and an
--  unrecognised value degrades to 'other' instead of being dropped.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_report_review_transition(p_status text)
RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = public, pg_temp
AS $fn$
  SELECT CASE lower(btrim(replace(coalesce(p_status, ''), ' ', '_')))
           WHEN 'in_progress'         THEN 'in_progress'
           WHEN 'draft'               THEN 'in_progress'
           WHEN 'submitted'           THEN 'submitted'
           WHEN 'pending'             THEN 'submitted'
           WHEN 'under_review'        THEN 'submitted'
           WHEN 'in_review'           THEN 'submitted'
           WHEN 'approved'            THEN 'approved'
           WHEN 'rejected'            THEN 'rejected'
           WHEN 'revision_requested'  THEN 'revision_requested'
           WHEN 'revisions_requested' THEN 'revision_requested'
           ELSE 'other'
         END
$fn$;

ALTER FUNCTION public.nx_report_review_transition(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_review_transition(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_review_transition(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_review_transition(text) IS
  'Maps a raw report status from either report table (public.reports Title_Case, public.inspection_reports lowercase) onto the canonical review vocabulary in_progress|submitted|approved|rejected|revision_requested|other. Unknown values classify as ''other'' and are never dropped — the verbatim text is preserved in report_review_history.to_status.';

-- ════════════════════════════════════════════════════════════════════════════
--  2) The history table — one row per observed status transition, forever
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.report_review_history (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exclusive arc. Existing report ids are REUSED; no surrogate report identity
  -- is introduced and no report row is copied.
  inspection_report_id  uuid REFERENCES public.inspection_reports(id) ON DELETE CASCADE,
  legacy_report_id      uuid REFERENCES public.reports(id)            ON DELETE CASCADE,
  report_kind           text NOT NULL,

  -- 1-based, per report. Ordering that does not depend on clock resolution.
  seq                   integer NOT NULL,

  -- Verbatim, exactly as the table spelled it. NULL on the genesis row, and
  -- NULL-able generally because status is nullable on both tables.
  from_status           text,
  to_status             text,

  -- Derived at write time by nx_report_review_transition(to_status).
  transition            text NOT NULL,

  -- WHO. Never a function parameter anywhere — always auth.uid() observed at
  -- the moment of the transition, so it cannot be forged by a caller.
  actor_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role            text,
  actor_is_report_author boolean NOT NULL DEFAULT false,

  occurred_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_review_history_arc CHECK (
    num_nonnulls(inspection_report_id, legacy_report_id) = 1),

  CONSTRAINT report_review_history_kind_matches_arc CHECK (
    (report_kind = 'inspection_report' AND inspection_report_id IS NOT NULL)
    OR (report_kind = 'legacy_report'  AND legacy_report_id     IS NOT NULL)),

  CONSTRAINT report_review_history_kind_check CHECK (
    report_kind = ANY (ARRAY['inspection_report', 'legacy_report'])),

  CONSTRAINT report_review_history_transition_check CHECK (
    transition = ANY (ARRAY[
      'in_progress', 'submitted', 'approved', 'rejected',
      'revision_requested', 'other'])),

  CONSTRAINT report_review_history_seq_positive CHECK (seq >= 1)
);

ALTER TABLE public.report_review_history OWNER TO postgres;

-- Per-report ordering is unique. This is also the concurrency guard: two racing
-- transitions on the same report cannot both claim the same seq — one fails
-- loudly rather than producing a silently ambiguous timeline.
CREATE UNIQUE INDEX IF NOT EXISTS report_review_history_inspection_seq_idx
  ON public.report_review_history (inspection_report_id, seq)
  WHERE inspection_report_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS report_review_history_legacy_seq_idx
  ON public.report_review_history (legacy_report_id, seq)
  WHERE legacy_report_id IS NOT NULL;

-- Drives the first-pass / revision-cycle aggregates.
CREATE INDEX IF NOT EXISTS report_review_history_transition_idx
  ON public.report_review_history (transition, occurred_at);

CREATE INDEX IF NOT EXISTS report_review_history_actor_idx
  ON public.report_review_history (actor_id)
  WHERE actor_id IS NOT NULL;

COMMENT ON TABLE public.report_review_history IS
  'Append-only review history for BOTH report entities: public.inspection_reports (the live one) and public.reports (legacy). One row per observed status transition, written only by trg_report_review_history / trg_legacy_report_review_history. Never UPDATEd; DELETEable only by FK cascade when the parent report itself is deleted. Absence of rows for a report is PROOF that the report predates 20260801430000 (every report created since gets a genesis row on INSERT) — such reports are classified legacy_history_unavailable and are NOT backfilled. Carries no money column and no pricing join.';

COMMENT ON COLUMN public.report_review_history.seq IS
  '1-based sequence within one report. The genesis row (seq=1) records the status the report was created with; from_status is NULL there.';

COMMENT ON COLUMN public.report_review_history.actor_id IS
  'auth.uid() observed at the instant of the transition. NEVER an RPC parameter, so no caller can attribute a decision to somebody else. NULL means the transition was made by a path with no end-user identity (service_role / migration / cron), which is itself the honest answer.';

COMMENT ON COLUMN public.report_review_history.actor_is_report_author IS
  'True when the actor is the report''s own inspector. Kept so a reader can tell self-authored transitions (submit, revise) from third-party review decisions without re-joining. An approval transition can never carry true here — nx_guard_report_no_self_approval refuses it before it happens.';

COMMENT ON COLUMN public.report_review_history.transition IS
  'Canonical classification of to_status via nx_report_review_transition(). The raw text stays in to_status; this exists so one query spans both tables'' status dialects.';

-- ════════════════════════════════════════════════════════════════════════════
--  3) APPEND-ONLY ENFORCEMENT
--
--  UPDATE is refused unconditionally. DELETE is refused while the report the
--  row describes still exists — which permits the FK cascade (during a cascade
--  the parent row is already gone within the same command) and refuses
--  selective pruning of a live report's evidence. Evidence cannot be edited,
--  and cannot be thinned out from under a report that still exists.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_report_review_history_append_only()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'report_review_history is append-only: row % cannot be modified', OLD.id
      USING errcode = '42501';
  END IF;

  -- TG_OP = 'DELETE'. Permitted only as part of the parent report's own
  -- deletion, i.e. when the parent is already gone.
  IF OLD.inspection_report_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.inspection_reports r
                  WHERE r.id = OLD.inspection_report_id) THEN
    RAISE EXCEPTION
      'report_review_history is append-only: row % cannot be deleted while inspection report % exists',
      OLD.id, OLD.inspection_report_id
      USING errcode = '42501';
  END IF;

  IF OLD.legacy_report_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.reports r
                  WHERE r.id = OLD.legacy_report_id) THEN
    RAISE EXCEPTION
      'report_review_history is append-only: row % cannot be deleted while report % exists',
      OLD.id, OLD.legacy_report_id
      USING errcode = '42501';
  END IF;

  RETURN OLD;
END $fn$;

ALTER FUNCTION public.nx_report_review_history_append_only() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_report_review_history_append_only ON public.report_review_history;
CREATE TRIGGER trg_report_review_history_append_only
  BEFORE UPDATE OR DELETE ON public.report_review_history
  FOR EACH ROW EXECUTE FUNCTION public.nx_report_review_history_append_only();

COMMENT ON TRIGGER trg_report_review_history_append_only ON public.report_review_history IS
  'Append-only enforcement at the row level, so it binds the table owner and service_role too — not only the roles that RLS constrains. UPDATE always fails; DELETE fails unless the parent report has already been removed in the same command (FK cascade).';

-- ════════════════════════════════════════════════════════════════════════════
--  4) THE WRITER — one trigger function, two tables
--
--  SECURITY DEFINER so the append succeeds regardless of the writer's RLS and
--  regardless of the (deliberately absent) INSERT grant. The actor is read from
--  auth.uid(); it is never supplied by a caller.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_report_review_history_capture()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor   uuid := auth.uid();
  v_role    text;
  v_kind    text;
  v_insp_id uuid;
  v_leg_id  uuid;
  v_author  uuid;
  v_from    text;
  v_seq     integer;
BEGIN
  IF TG_TABLE_NAME = 'inspection_reports' THEN
    v_kind    := 'inspection_report';
    v_insp_id := NEW.id;
    v_leg_id  := NULL;
  ELSE
    v_kind    := 'legacy_report';
    v_insp_id := NULL;
    v_leg_id  := NEW.id;
  END IF;

  v_author := NEW.inspector_id;
  v_from   := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;

  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = v_actor;

  IF v_insp_id IS NOT NULL THEN
    SELECT COALESCE(max(h.seq), 0) + 1 INTO v_seq
      FROM public.report_review_history h
     WHERE h.inspection_report_id = v_insp_id;
  ELSE
    SELECT COALESCE(max(h.seq), 0) + 1 INTO v_seq
      FROM public.report_review_history h
     WHERE h.legacy_report_id = v_leg_id;
  END IF;

  INSERT INTO public.report_review_history (
    inspection_report_id, legacy_report_id, report_kind, seq,
    from_status, to_status, transition,
    actor_id, actor_role, actor_is_report_author, occurred_at)
  VALUES (
    v_insp_id, v_leg_id, v_kind, v_seq,
    v_from, NEW.status, public.nx_report_review_transition(NEW.status),
    v_actor, v_role,
    (v_actor IS NOT NULL AND v_actor IS NOT DISTINCT FROM v_author),
    now());

  RETURN NULL;  -- AFTER trigger; the return value is ignored
END $fn$;

ALTER FUNCTION public.nx_report_review_history_capture() OWNER TO postgres;

COMMENT ON FUNCTION public.nx_report_review_history_capture() IS
  'Appends one report_review_history row per report INSERT and per real status change, for public.inspection_reports and public.reports alike. Writes nothing back to the report, so both status vocabularies, the technical/financial review columns and every existing reader are untouched. Records no money column.';

-- The genesis row on INSERT is what makes "no history" mean "predates this
-- migration" rather than "history was lost". Nothing is backfilled.
DROP TRIGGER IF EXISTS trg_report_review_history_ins ON public.inspection_reports;
CREATE TRIGGER trg_report_review_history_ins
  AFTER INSERT ON public.inspection_reports
  FOR EACH ROW EXECUTE FUNCTION public.nx_report_review_history_capture();

DROP TRIGGER IF EXISTS trg_report_review_history_upd ON public.inspection_reports;
CREATE TRIGGER trg_report_review_history_upd
  AFTER UPDATE OF status ON public.inspection_reports
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.nx_report_review_history_capture();

DROP TRIGGER IF EXISTS trg_legacy_report_review_history_ins ON public.reports;
CREATE TRIGGER trg_legacy_report_review_history_ins
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.nx_report_review_history_capture();

DROP TRIGGER IF EXISTS trg_legacy_report_review_history_upd ON public.reports;
CREATE TRIGGER trg_legacy_report_review_history_upd
  AFTER UPDATE OF status ON public.reports
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.nx_report_review_history_capture();

COMMENT ON TRIGGER trg_report_review_history_upd ON public.inspection_reports IS
  'Preserves the superseded status before it is overwritten in place. Before this, approve_inspection_report''s pending -> revision_requested -> pending -> approved cycle left only the final value, so nobody could tell a first-pass approval from a report that had been returned three times.';

-- ════════════════════════════════════════════════════════════════════════════
--  5) NO SELF-APPROVAL — the forgery surface this lane must close
--
--  public.inspection_reports carries GRANT ALL to authenticated
--  (baseline:40372) plus the permissive policy "Inspectors can update reports"
--  USING (auth.uid() = inspector_id) (baseline:29517). An inspector can
--  therefore UPDATE their own report row directly through PostgREST today, and
--  would be able to write status='approved' — minting an approval, and with
--  this migration in place an approval HISTORY ROW, for their own work.
--
--  Recording that faithfully is not enough: the lane's constraint is that the
--  inspector cannot self-approve at all. The transition is refused, not merely
--  attributed. The same guard covers the boolean approval flags, because
--  flipping is_client_approved or technical_approved on your own report is the
--  same forgery by another column.
--
--  DELIBERATELY NARROW:
--    * only fires when the writer IS the report's own inspector;
--    * only refuses transitions INTO approval — an inspector may still submit,
--      revise and resubmit their own report exactly as before;
--    * a caller with no end-user identity (service_role, migration, cron;
--      auth.uid() IS NULL) is not affected, because there is no self to be;
--    * approve_inspection_report (client/agency) and
--      nx_admin_review_inspection_report (admin) both run with auth.uid() set
--      to a NON-author, so the live review paths are unaffected.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_guard_report_no_self_approval()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- LEAD REVIEW (95a1cbc follow-up): this compared v_actor against
  -- NEW.inspector_id. Authorship must be read from OLD — comparing against NEW
  -- lets a writer disclaim authorship in the SAME statement (set inspector_id
  -- to someone else AND grant an approval flag) and fall straight through this
  -- guard. That is not exploitable today: the policy "Inspectors can update
  -- reports" (baseline:29517) is FOR UPDATE USING (auth.uid() = inspector_id)
  -- with NO WITH CHECK, so Postgres applies USING to the new row as well and
  -- the reassignment is refused by RLS first. But this guard's correctness must
  -- not depend on the absence of a WITH CHECK clause in a different file —
  -- adding one, or any future admin/service write path, would silently reopen
  -- it. OLD is the row whose author actually did the work.
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM OLD.inspector_id THEN
    RETURN NEW;
  END IF;

  IF public.nx_report_review_transition(NEW.status) = 'approved'
     AND public.nx_report_review_transition(OLD.status) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION
      'inspector % may not approve their own report % — review authority is explicit and belongs to the buyer or an admin',
      v_actor, NEW.id
      USING errcode = '42501';
  END IF;

  IF (COALESCE(NEW.is_client_approved, false) AND NOT COALESCE(OLD.is_client_approved, false))
     OR (COALESCE(NEW.is_published,       false) AND NOT COALESCE(OLD.is_published,       false))
     OR (COALESCE(NEW.technical_approved, false) AND NOT COALESCE(OLD.technical_approved, false))
     OR (COALESCE(NEW.financial_approved, false) AND NOT COALESCE(OLD.financial_approved, false)) THEN
    RAISE EXCEPTION
      'inspector % may not grant an approval flag on their own report %',
      v_actor, NEW.id
      USING errcode = '42501';
  END IF;

  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_guard_report_no_self_approval() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_report_no_self_approval ON public.inspection_reports;
CREATE TRIGGER trg_report_no_self_approval
  BEFORE UPDATE ON public.inspection_reports
  FOR EACH ROW EXECUTE FUNCTION public.nx_guard_report_no_self_approval();

COMMENT ON TRIGGER trg_report_no_self_approval ON public.inspection_reports IS
  'Refuses any transition into approval authored by the report''s own inspector, so a first-pass-approval statistic cannot be manufactured by the party it measures. Installed as a trigger, not a policy, so it binds PostgREST, RPCs and service_role-owned SECURITY DEFINER paths identically. It does not read or write any money column and it never touches payout state.';

COMMENT ON FUNCTION public.nx_guard_report_no_self_approval() IS
  'BEFORE UPDATE guard on inspection_reports: the report author cannot approve, publish or technically/financially clear their own report. Submit / revise / resubmit by the author remain permitted. MOVES NO MONEY.';

-- ════════════════════════════════════════════════════════════════════════════
--  6) RLS + GRANTS
--
--  Read audience mirrors the parent report exactly — history is never visible
--  to somebody who cannot see the report it describes. There is NO INSERT,
--  UPDATE or DELETE policy and no such grant: writes arrive only through the
--  SECURITY DEFINER trigger above. A policy that authorises a row while pinning
--  no column is a forgery surface (the 402000 lesson), so no write policy is
--  written at all.
--
--  RLS is ENABLEd but deliberately NOT FORCEd: the trigger function runs as the
--  table owner, and forcing RLS on the owner would make the append fail against
--  a table that intentionally has no INSERT policy.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.report_review_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.report_review_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.report_review_history TO authenticated;

DROP POLICY IF EXISTS report_review_history_read ON public.report_review_history;
CREATE POLICY report_review_history_read ON public.report_review_history
  FOR SELECT TO authenticated
  USING (
    -- inspection_reports arc: author, buyer/agency on the job, active team
    -- member, or admin — the same audience as the report itself.
    (inspection_report_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.inspection_reports r
       WHERE r.id = report_review_history.inspection_report_id
         AND (
           r.inspector_id = auth.uid()
           OR public.nx_is_admin()
           OR EXISTS (SELECT 1 FROM public.jobs j
                       WHERE j.id = r.job_id
                         AND (j.client_id = auth.uid() OR j.agency_id = auth.uid()))
           OR public.nx_is_active_job_team_member(r.job_id, auth.uid())
         )))
    OR
    -- legacy reports arc: mirrors reports_select_party_admin (244000:127),
    -- including its finding that reports.project_id resolves through
    -- work_orders, not public.projects.
    (legacy_report_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.reports lr
       WHERE lr.id = report_review_history.legacy_report_id
         AND (
           lr.inspector_id = auth.uid()
           OR public.nx_is_admin()
           OR EXISTS (SELECT 1 FROM public.work_orders w
                       WHERE w.id = lr.project_id AND w.client_id = auth.uid())
         )))
  );

COMMENT ON POLICY report_review_history_read ON public.report_review_history IS
  'Read-only, and only for a principal who can already see the parent report. There is deliberately no write policy of any kind: the sole writer is the SECURITY DEFINER trigger nx_report_review_history_capture, so no client can author, backdate or re-attribute a review event.';

-- ════════════════════════════════════════════════════════════════════════════
--  7) THE DERIVED METRICS — what the pilot actually asked for
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_report_review_stats(p_report_id uuid)
RETURNS TABLE (
  report_id             uuid,
  history_available     boolean,
  review_state          text,
  first_pass_approved   boolean,
  submission_count      integer,
  returned_count        integer,
  rejected_count        integer,
  approval_attempts     integer,
  review_cycles         integer,
  first_decision_at     timestamptz,
  first_decision_by     uuid,
  last_transition_at    timestamptz
)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ok boolean;
BEGIN
  -- Explicit authorisation. Mirrors the read policy; no money column is read
  -- to establish it.
  SELECT EXISTS (
    SELECT 1 FROM public.inspection_reports r
     WHERE r.id = p_report_id
       AND (
         r.inspector_id = auth.uid()
         OR public.nx_is_admin()
         OR EXISTS (SELECT 1 FROM public.jobs j
                     WHERE j.id = r.job_id
                       AND (j.client_id = auth.uid() OR j.agency_id = auth.uid()))
         OR public.nx_is_active_job_team_member(r.job_id, auth.uid())
       ))
  INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'not authorised to read review history for report %', p_report_id
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH h AS (
    SELECT x.seq, x.transition, x.occurred_at, x.actor_id
      FROM public.report_review_history x
     WHERE x.inspection_report_id = p_report_id
  ),
  agg AS (
    SELECT
      count(*)                                                          AS n_rows,
      count(*) FILTER (WHERE transition = 'submitted')                  AS n_sub,
      count(*) FILTER (WHERE transition = 'revision_requested')         AS n_ret,
      count(*) FILTER (WHERE transition = 'rejected')                   AS n_rej,
      count(*) FILTER (WHERE transition = 'approved')                   AS n_app,
      min(seq) FILTER (WHERE transition = 'approved')                   AS first_app_seq,
      min(seq) FILTER (WHERE transition IN
                        ('approved', 'rejected', 'revision_requested')) AS first_dec_seq,
      max(occurred_at)                                                  AS last_at
      FROM h
  )
  SELECT
    p_report_id,
    (agg.n_rows > 0),
    CASE
      WHEN agg.n_rows = 0                       THEN 'legacy_history_unavailable'
      WHEN agg.n_app = 0 AND agg.n_rej > 0      THEN 'rejected'
      WHEN agg.n_app = 0                        THEN 'pending_decision'
      WHEN agg.n_ret = 0 AND agg.n_rej = 0      THEN 'first_pass_approved'
      WHEN agg.first_app_seq < COALESCE(
             (SELECT min(seq) FROM h
               WHERE transition IN ('revision_requested', 'rejected')),
             agg.first_app_seq + 1)             THEN 'first_pass_approved'
      ELSE 'approved_after_revision'
    END,
    CASE
      WHEN agg.n_rows = 0 THEN NULL              -- legacy: unknowable, not false
      WHEN agg.n_app = 0  THEN NULL              -- not decided yet
      ELSE NOT EXISTS (SELECT 1 FROM h
                        WHERE h.transition IN ('revision_requested', 'rejected')
                          AND h.seq < agg.first_app_seq)
    END,
    agg.n_sub::int, agg.n_ret::int, agg.n_rej::int, agg.n_app::int,
    CASE WHEN agg.n_rows = 0 THEN NULL
         ELSE (agg.n_ret + agg.n_rej + 1)::int END,
    (SELECT occurred_at FROM h WHERE h.seq = agg.first_dec_seq),
    (SELECT actor_id    FROM h WHERE h.seq = agg.first_dec_seq),
    agg.last_at
  FROM agg;
END $fn$;

ALTER FUNCTION public.nx_report_review_stats(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_review_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_review_stats(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_review_stats(uuid) IS
  'Per-report review metrics derived from report_review_history: first-pass approval, review cycles, returns for correction, approval attempts, and first-decision reviewer + timestamp. A report with no history predates 20260801430000 and returns review_state=legacy_history_unavailable with first_pass_approved NULL — never false, because "unknown" is not "failed". Returns no pricing or payout column.';

CREATE OR REPLACE FUNCTION public.nx_admin_report_first_pass_rate(
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL
)
RETURNS TABLE (
  reports_total            integer,
  reports_with_history     integer,
  reports_legacy_unknown   integer,
  reports_decided          integer,
  first_pass_approved      integer,
  approved_after_revision  integer,
  rejected                 integer,
  first_pass_rate          numeric,
  mean_review_cycles       numeric
)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT r.id
      FROM public.inspection_reports r
     WHERE r.deleted_at IS NULL
       AND (p_since IS NULL OR r.created_at >= p_since)
       AND (p_until IS NULL OR r.created_at <  p_until)
  ),
  per_report AS (
    SELECT s.id,
           count(h.*)                                                  AS n_rows,
           count(h.*) FILTER (WHERE h.transition = 'revision_requested') AS n_ret,
           count(h.*) FILTER (WHERE h.transition = 'rejected')           AS n_rej,
           count(h.*) FILTER (WHERE h.transition = 'approved')           AS n_app,
           min(h.seq) FILTER (WHERE h.transition = 'approved')           AS first_app_seq,
           min(h.seq) FILTER (WHERE h.transition IN
                               ('revision_requested', 'rejected'))       AS first_bad_seq
      FROM scoped s
      LEFT JOIN public.report_review_history h ON h.inspection_report_id = s.id
     GROUP BY s.id
  ),
  classed AS (
    SELECT id,
           (n_rows > 0) AS has_history,
           CASE
             WHEN n_rows = 0                  THEN 'legacy_history_unavailable'
             WHEN n_app = 0 AND n_rej > 0     THEN 'rejected'
             WHEN n_app = 0                   THEN 'pending_decision'
             WHEN first_bad_seq IS NULL
               OR first_app_seq < first_bad_seq THEN 'first_pass_approved'
             ELSE 'approved_after_revision'
           END AS state,
           CASE WHEN n_rows = 0 THEN NULL ELSE (n_ret + n_rej + 1) END AS cycles
      FROM per_report
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE has_history)::int,
    count(*) FILTER (WHERE NOT has_history)::int,
    count(*) FILTER (WHERE state IN
      ('first_pass_approved', 'approved_after_revision', 'rejected'))::int,
    count(*) FILTER (WHERE state = 'first_pass_approved')::int,
    count(*) FILTER (WHERE state = 'approved_after_revision')::int,
    count(*) FILTER (WHERE state = 'rejected')::int,
    -- Denominator is DECIDED reports only. Legacy and undecided reports are
    -- excluded rather than counted as failures, and the excluded count is
    -- returned alongside so the rate is never quoted without its caveat.
    CASE WHEN count(*) FILTER (WHERE state IN
           ('first_pass_approved', 'approved_after_revision', 'rejected')) = 0
         THEN NULL
         ELSE round(
           count(*) FILTER (WHERE state = 'first_pass_approved')::numeric
           / count(*) FILTER (WHERE state IN
               ('first_pass_approved', 'approved_after_revision', 'rejected'))::numeric,
           4)
    END,
    round(avg(cycles) FILTER (WHERE has_history), 3)
  FROM classed;
END $fn$;

ALTER FUNCTION public.nx_admin_report_first_pass_rate(timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_admin_report_first_pass_rate(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_admin_report_first_pass_rate(timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_admin_report_first_pass_rate(timestamptz, timestamptz) IS
  'Admin-only pilot metric: first-pass approval rate and mean review cycles over inspection reports created in a window. Reports predating 20260801430000 carry no history and are reported separately as reports_legacy_unknown — they are excluded from the denominator, never counted as failures. Returns no pricing, payout or spread column of any kind.';

-- ════════════════════════════════════════════════════════════════════════════
--  8) SELF-TESTS — the invariants this lane is accountable for
-- ════════════════════════════════════════════════════════════════════════════

DO $selftest$
DECLARE
  v_def_capture text := pg_get_functiondef('public.nx_report_review_history_capture()'::regprocedure);
  v_def_guard   text := pg_get_functiondef('public.nx_guard_report_no_self_approval()'::regprocedure);
  v_def_stats   text := pg_get_functiondef('public.nx_report_review_stats(uuid)'::regprocedure);
  v_def_rate    text := pg_get_functiondef('public.nx_admin_report_first_pass_rate(timestamptz,timestamptz)'::regprocedure);
  v_all         text;
  v_bad         int;
BEGIN
  v_all := v_def_capture || v_def_guard || v_def_stats || v_def_rate;

  -- ── I1. RLS is on ────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname = 'report_review_history'
                   AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: RLS is not enabled on report_review_history';
  END IF;

  -- ── I2. No write grant to anon or authenticated. The database's
  --        ALTER DEFAULT PRIVILEGES hands out ALL on every new table, so this
  --        is the assertion that the revoke actually happened.
  FOR v_bad IN
    SELECT 1 FROM (VALUES ('anon'), ('authenticated')) AS r(rolename)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
    WHERE has_table_privilege(r.rolename, 'public.report_review_history', p.priv)
  LOOP
    RAISE EXCEPTION 'SELFTEST FAILED: anon or authenticated holds a write privilege on report_review_history — the 402000 forgery surface is open';
  END LOOP;

  IF has_table_privilege('anon', 'public.report_review_history', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can read report_review_history';
  END IF;

  -- ── I3. There is no write POLICY either — writes are trigger-only ────────
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public'
                AND tablename  = 'report_review_history'
                AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a write policy exists on report_review_history — history must be trigger-written only';
  END IF;

  -- ── I4. Append-only enforcement is installed ─────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_report_review_history_append_only'
                    AND tgrelid = 'public.report_review_history'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: append-only enforcement is missing — history rows could be edited or pruned';
  END IF;

  -- ── I5. Both report entities are captured ────────────────────────────────
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.inspection_reports'::regclass
         AND NOT tgisinternal
         AND tgname IN ('trg_report_review_history_ins', 'trg_report_review_history_upd')) <> 2 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspection_reports status history is not captured';
  END IF;

  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.reports'::regclass
         AND NOT tgisinternal
         AND tgname IN ('trg_legacy_report_review_history_ins', 'trg_legacy_report_review_history_upd')) <> 2 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: legacy reports status history is not captured';
  END IF;

  -- ── I6. Self-approval is refused, not merely recorded ────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_report_no_self_approval'
                    AND tgrelid = 'public.inspection_reports'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the no-self-approval guard is not installed';
  END IF;

  -- ── I7. PAYMENT FREEZE. Nothing in this lane may name a money surface ────
  IF v_all ~* '\m(wallets?|transactions|payout_status|payout_paid_at|payout_marked_by|admin_confirmed_at|escrow|release_payment|stripe|settle_client_payment)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a report-review-history function names a money surface — report approval must have no payment side effect';
  END IF;

  -- ── I8. NO COMMERCIAL-DATA LEAKAGE ───────────────────────────────────────
  IF v_all ~* '\m(client_price_cents|inspector_payout_cents|platform_spread_cents|base_price_cents|price_cents)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a report-review-history function names a commercial column';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name   = 'report_review_history'
                AND column_name ~* '(price|payout|spread|cents|amount|fee)') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: report_review_history carries a money-shaped column';
  END IF;

  -- ── I9. Every SECURITY DEFINER function here pins search_path ────────────
  SELECT count(*) INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND p.proname IN ('nx_report_review_history_capture',
                       'nx_report_review_history_append_only',
                       'nx_guard_report_no_self_approval',
                       'nx_report_review_stats',
                       'nx_admin_report_first_pass_rate')
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
                      WHERE cfg LIKE 'search_path=%');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % SECURITY DEFINER function(s) in this lane do not pin search_path', v_bad;
  END IF;

  -- ── I10. NO BACKFILL. Not one row may have been fabricated for a report
  --         that existed before this migration ran.
  IF (SELECT count(*) FROM public.report_review_history) <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: report_review_history is not empty at install time — historical rows must never be fabricated';
  END IF;

  -- ── I11. The pre-existing approval attribution is untouched ──────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'inspection_reports'
                    AND column_name = 'technical_approved_by')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'inspection_reports'
                    AND column_name = 'financial_approved_by') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the status-only technical/financial attribution columns were disturbed';
  END IF;

  IF to_regprocedure('public.approve_inspection_report(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.nx_admin_review_inspection_report(uuid,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an existing report review path is missing — this lane must extend, never replace';
  END IF;

  -- ── I12. No Reports v2. The history hangs off the EXISTING report ids. ───
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.report_review_history'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.inspection_reports'::regclass)
   OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.report_review_history'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.reports'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: report_review_history does not reuse the existing report ids';
  END IF;

  RAISE NOTICE 'report review history active: append-only, trigger-written, RLS on, no write grant, no money surface, nothing backfilled. First-pass approval is now derivable via nx_report_review_stats / nx_admin_report_first_pass_rate.';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
