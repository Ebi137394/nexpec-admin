-- ════════════════════════════════════════════════════════════════════════════
--  20260801404000_itp_coherence_history_ncr.sql
--
--  The three remaining concrete defects from the post-integration Phase 3
--  review. Smallest canonical forward-only fixes; no ITP redesign, no new
--  subsystem, no schema replacement.
--
--  ── DEFECT A (MEDIUM): visit_id COHERENCE — CONFIRMED REAL ─────────────────
--  nx_itp_record_result (398000:353) never checks that the visit belongs to the
--  job, and no trigger or CHECK exists on itp_point_results. The FK to
--  job_visits proves EXISTENCE only. inspection_captures got exactly this guard
--  in 20260801388000 (tg_guard_capture_visit); ITP results were never given it.
--
--  Blast radius, as traced: inbound only — every reader filters r.job_id, so no
--  data leaks OUT to the other job. The damage is on the target job. The
--  partial unique indexes are (point_id, job_id, visit_id) and (point_id,
--  job_id) WHERE visit_id IS NULL, so a foreign visit_id defeats "one live
--  result per point per visit" and admits unlimited extra rows for one point.
--  nx_report_itp_log's DISTINCT ON … recorded_at DESC then makes an off-visit
--  row the report's stated result while every visit screen still shows the old
--  one — the register and the report disagree about what was found.
--
--  FIX: a BEFORE trigger, structural so it binds service_role and any future
--  writer, not just the RPC. NULL visit_id keeps its legacy job-level meaning
--  and is not touched. No forwarding past a rescheduled visit is added here:
--  unlike evidence, an ITP result is not destroyed by a reschedule (proven in
--  itpReplay), so there is nothing to rescue and inventing movement would
--  change where a recorded finding is filed.
--
--  ── DEFECT B (HIGH): RESULT HISTORY WAS REWRITTEN IN PLACE ─────────────────
--  398000:361 UPDATEs the existing row: re-recording 'passed' over 'failed'
--  erases that a failure was ever found, silently reassigns inspector_id to
--  whoever recorded last, and writes no audit row. On an ITP register — the
--  document that says a hold point was satisfied — a finding that can vanish
--  without trace is a data-integrity defect, not a UX one.
--
--  FIX: append to public.job_events on every recording, BEFORE the row is
--  overwritten, capturing the prior result and prior inspector. job_events is
--  the shipped audit spine; this adds no history table and does not convert the
--  result row to supersession (which would change the reader contract and every
--  unique index). The current-state row stays exactly as the readers expect;
--  the immutable trail now lives where every other job history lives.
--
--  ── DEFECT C (MEDIUM): THE NCR LINK-BACK COULD NEVER PERSIST ───────────────
--  400000:626-633 already detected and WARNED about this: itp_point_results
--  carries a SELECT policy and an INSERT policy and no third one, so the
--  SECURITY INVOKER NCR bridge's write-back of flash_report_id matches no row
--  under RLS for a non-admin caller. The link never persists, so the bridge's
--  idempotency guard never trips and ONE failed point can raise UNLIMITED
--  flash reports. 400000 correctly declined to patch another migration's table.
--
--  FIX: the narrowest possible UPDATE policy. Same audience as recording, and
--  the USING/WITH CHECK pair permits linking an NCR and nothing else — result,
--  attribution, release and sign-off columns must all be unchanged. So this
--  cannot become a back door to the release bypass 402000 just closed.
--
--  ── NOT CHANGED ────────────────────────────────────────────────────────────
--  No RPC signature, no reader, no index, no grant. 402000's lockdown stands:
--  authenticated still has no INSERT. nx_itp_release_hold untouched. No money
--  column is read or written and nothing here can trigger a settlement.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── DEFECT A: a result's visit must belong to the result's job ──────────────
CREATE OR REPLACE FUNCTION public.tg_guard_itp_result_visit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $t$
DECLARE
  v_visit_job uuid;
BEGIN
  -- NULL is the legacy job-level meaning and stays untouched.
  IF NEW.visit_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT v.job_id INTO v_visit_job FROM public.job_visits v WHERE v.id = NEW.visit_id;
  IF v_visit_job IS NULL THEN
    RAISE EXCEPTION 'visit % does not exist', NEW.visit_id USING errcode = '23503';
  END IF;

  IF v_visit_job IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION
      'visit % belongs to job %, not job % — an ITP result cannot be filed against another job''s visit',
      NEW.visit_id, v_visit_job, NEW.job_id
      USING errcode = '23514';
  END IF;

  RETURN NEW;
END $t$;
ALTER FUNCTION public.tg_guard_itp_result_visit() OWNER TO postgres;

--  Two triggers, matching the shape 388000 settled on: a WHEN clause on a
--  combined INSERT OR UPDATE trigger cannot reference OLD, and an UPDATE that
--  leaves visit_id alone must not be re-validated (that would retro-block edits
--  to historical results whose visit later changed hands).
DROP TRIGGER IF EXISTS trg_guard_itp_result_visit_ins ON public.itp_point_results;
CREATE TRIGGER trg_guard_itp_result_visit_ins
  BEFORE INSERT ON public.itp_point_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_itp_result_visit();

DROP TRIGGER IF EXISTS trg_guard_itp_result_visit_upd ON public.itp_point_results;
CREATE TRIGGER trg_guard_itp_result_visit_upd
  BEFORE UPDATE OF visit_id ON public.itp_point_results
  FOR EACH ROW
  WHEN (NEW.visit_id IS DISTINCT FROM OLD.visit_id)
  EXECUTE FUNCTION public.tg_guard_itp_result_visit();

COMMENT ON TRIGGER trg_guard_itp_result_visit_ins ON public.itp_point_results IS
  'An ITP result may only name a visit belonging to its own job. The FK to job_visits proves existence only; without this, a foreign visit_id defeats the (point,job,visit) partial unique index and lets nx_report_itp_log state a different result than the visit register shows. Mirrors tg_guard_capture_visit (20260801388000) for evidence.';

-- ── DEFECT B, prerequisite: job_events.event_type is a CLOSED allow-list ────
--  job_events_event_type_check (baseline:23495) permits exactly nine values and
--  no later migration has widened it. Writing 'itp_result_amended' would raise
--  23514 on every amendment — the same defect class as conversations_kind_shape,
--  which has bitten this repository twice. Widened here, additively: the nine
--  existing values are preserved verbatim and one is appended.
ALTER TABLE public.job_events DROP CONSTRAINT IF EXISTS job_events_event_type_check;
ALTER TABLE public.job_events ADD CONSTRAINT job_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'created', 'status_change', 'contractor_assigned', 'contractor_unassigned',
    'soft_deleted', 'restored', 'application_created', 'application_status_change',
    'fraud_alert',
    -- ★ 404000
    'itp_result_amended'
  ]));

-- ── DEFECT B: the prior finding is preserved before it is overwritten ───────
CREATE OR REPLACE FUNCTION public.tg_itp_result_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $t$
BEGIN
  -- Only a real change is worth a history row. A no-op re-delivery of the same
  -- answer by the same inspector is idempotent and must stay silent, or a
  -- flaky connection would fill the timeline with noise.
  IF NEW.result       IS NOT DISTINCT FROM OLD.result
     AND NEW.inspector_id IS NOT DISTINCT FROM OLD.inspector_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.job_events (job_id, actor_id, event_type, metadata)
  VALUES (
    OLD.job_id,
    auth.uid(),
    'itp_result_amended',
    jsonb_build_object(
      'result_id',            OLD.id,
      'point_id',             OLD.point_id,
      'visit_id',             OLD.visit_id,
      'previous_result',      OLD.result,
      'new_result',           NEW.result,
      'previous_inspector_id', OLD.inspector_id,
      'new_inspector_id',      NEW.inspector_id,
      'previously_recorded_at', OLD.recorded_at
    )
  );
  RETURN NEW;
END $t$;
ALTER FUNCTION public.tg_itp_result_history() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_itp_result_history ON public.itp_point_results;
CREATE TRIGGER trg_itp_result_history
  BEFORE UPDATE ON public.itp_point_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_itp_result_history();

COMMENT ON TRIGGER trg_itp_result_history ON public.itp_point_results IS
  'Appends the superseded finding to job_events before nx_itp_record_result overwrites it in place. Without this, re-recording passed over failed erased that a failure was ever found and silently reassigned inspector_id, with no trace anywhere. The current-state row is deliberately left as-is so no reader or unique index changes; the immutable trail lives on the shipped audit spine.';

-- ── DEFECT C: the NCR link, and ONLY the NCR link, may be written back ──────
DROP POLICY IF EXISTS itp_results_link_ncr ON public.itp_point_results;
CREATE POLICY itp_results_link_ncr ON public.itp_point_results
  FOR UPDATE TO authenticated
  USING (
    public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = itp_point_results.job_id AND j.contractor_id = auth.uid())
    OR public.nx_is_active_job_team_member(itp_point_results.job_id, auth.uid())
  )
  WITH CHECK (
    public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = itp_point_results.job_id AND j.contractor_id = auth.uid())
    OR public.nx_is_active_job_team_member(itp_point_results.job_id, auth.uid())
  );
-- ── Narrow the grant before widening it ─────────────────────────────────────
--  The COMMENT below asserts "authenticated holds UPDATE on flash_report_id
--  alone". That was FALSE, and this migration's own self-test proved it on the
--  first clean-database run: authenticated held
--  DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on this table.
--
--  398000:206 granted only SELECT, INSERT. The rest arrived from the baseline
--  ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO authenticated
--  (baseline:40921-40934) — every table created in public since is born with
--  the full set. 20260801442000 turned that default off for `anon` only, and
--  deliberately left `authenticated` intact so concurrent lanes' new objects
--  kept working; that is why this survived.
--
--  A table-level UPDATE makes the column grant below meaningless: result,
--  inspector_id, released_at/by and signed_off_by were all writable, which is
--  exactly the Hold bypass 20260801402000 closed. TRUNCATE is worse — RLS does
--  not mediate it at all, so any authenticated session could erase the ITP
--  evidence set outright, the same class of hole 20260801430000 had to install
--  a statement trigger to survive.
--
--  Revoke the whole set, then re-grant precisely what this migration needs.
--  SELECT is preserved: without it the ITP register goes blank (asserted in
--  20260801402000's self-test).
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.itp_point_results FROM authenticated;

GRANT UPDATE (flash_report_id) ON TABLE public.itp_point_results TO authenticated;

COMMENT ON POLICY itp_results_link_ncr ON public.itp_point_results IS
  'Lets the SECURITY INVOKER NCR bridge persist flash_report_id, which it previously could not: with only SELECT and INSERT policies present its write-back matched no row under RLS, so the link never stuck and the idempotency guard never tripped — one failed point could raise unlimited flash reports (warned about at 20260801400000:633). Scope is enforced by the COLUMN grant, not by this policy: authenticated holds UPDATE on flash_report_id alone, so result, inspector_id, released_* and signed_off_* remain unreachable and 20260801402000''s Hold lockdown is intact.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_guard_itp_result_visit_ins' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: the ITP visit-coherence guard is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_itp_result_history' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: ITP result history is still overwritten without a trace';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='itp_point_results'
                    AND cmd IN ('UPDATE','ALL')) THEN
    RAISE EXCEPTION 'SELFTEST: the NCR link-back still cannot persist';
  END IF;

  -- ★ 402000 MUST STILL HOLD. The UPDATE path added here must not have
  --   reopened the Hold bypass it closed.
  IF has_table_privilege('authenticated', 'public.itp_point_results', 'INSERT') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated regained INSERT — the Hold bypass is open again';
  END IF;
  IF has_column_privilege('authenticated', 'public.itp_point_results', 'released_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.itp_point_results', 'released_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.itp_point_results', 'signed_off_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.itp_point_results', 'result', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.itp_point_results', 'inspector_id', 'UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: the NCR link-back grant is too wide — a Hold could be released or a result rewritten through UPDATE';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.itp_point_results', 'flash_report_id', 'UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: the NCR link column is still not writable — the bridge stays broken';
  END IF;

  IF to_regprocedure('public.nx_itp_release_hold(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: nx_itp_release_hold was disturbed';
  END IF;
END
$verify$;

COMMIT;
