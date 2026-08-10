-- ════════════════════════════════════════════════════════════════════════════
--  20260801396000_visit_evidence_survives_reschedule.sql
--
--  Found by the SECOND (post-integration) Phase 2 security review. This defect
--  did not exist in either half on its own — it was created by integrating 2F
--  (capture.tsx now stamps visit_id) with 388000's status guard and the
--  pre-existing offline FATAL classification. No pre-integration review could
--  have seen it.
--
--  ── DEFECT 1 (HIGH): RESCHEDULING A VISIT DESTROYED OFFLINE EVIDENCE ───────
--  Chain, verified end to end:
--    app/(inspector)/compliance/job/[id]/capture.tsx  stamps visit_id
--    20260801388000 tg_guard_capture_visit            RAISE 23514 when the
--                                                     visit is rescheduled
--    packages/shared-core/src/offline/syncErrors.ts   23514 ∈ FATAL_CODES
--    src/core/offline/sync.ts → markFatal             terminal, never retried
--
--  So: an inspector captures a day of evidence offline against visit V; an
--  admin reschedules V while they are still in the field; the outbox drains and
--  every single row is rejected and marked fatal. The evidence is gone. Before
--  2F those same captures carried visit_id NULL and always landed.
--
--  It is also an evidence-suppression vector: rescheduling a visit is an
--  ordinary admin action that silently destroyed an inspector's un-drained
--  field work.
--
--  ── THE FIX: FOLLOW THE SUPERSESSION CHAIN, NEVER DESTROY EVIDENCE ─────────
--  A rescheduled visit is not a void visit — it has a live successor, reachable
--  through job_visits.rescheduled_from_id. Evidence arriving late for the
--  superseded row belongs to that successor. The guard now REWRITES
--  NEW.visit_id forward instead of raising, walking the chain (bounded) in case
--  a visit was rescheduled more than once.
--
--  CANCELLED is treated differently and deliberately: there is no successor to
--  forward to, and destroying proof of work that was actually performed is
--  worse than attributing it to a visit that was later cancelled. The visit's
--  own status already records the cancellation, so nothing is misrepresented.
--  Evidence is admissible record; it does not become false because the schedule
--  changed after the fact. So the write is ACCEPTED.
--
--  What the guard still refuses, unchanged: a visit that does not exist, and a
--  visit belonging to a DIFFERENT job (the cross-job injection this file's
--  predecessor was written to stop). Actor authorization is unchanged too — a
--  removed inspector still cannot record new work.
--
--  ── DEFECT 3 (LOW): nx_can_record_visit_work WAS A MEMBERSHIP ORACLE ───────
--  SECURITY DEFINER, granted to authenticated, accepting an arbitrary p_uid
--  with no caller==target check — so any authenticated user holding a visit id
--  and a user id could probe team membership. nx_job_active_visit_for already
--  had this check; this function was simply missing it.
--
--  ── DEFECT 4 (LOW): nx_visit_job_id WAS A GRANTED, UNAUTHORIZED, DEAD PATH ─
--  Zero callers, no authorization, EXECUTE granted to authenticated. Revoked
--  rather than dropped: 388000's triggers reference it internally as an owner-
--  privileged helper, and dropping it would require rewriting them.
--
--  ── NOT CHANGED ────────────────────────────────────────────────────────────
--  No table, no policy, no RPC signature. The cross-job guard, the actor check,
--  hash canonicalisation and every money-free property are preserved. Payment
--  remains manual; nothing here touches a money column.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Where does a superseded visit's work actually belong? ───────────────────
CREATE OR REPLACE FUNCTION public.nx_visit_live_successor(p_visit_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cur    uuid := p_visit_id;
  v_status text;
  v_next   uuid;
  v_hops   int := 0;
BEGIN
  IF p_visit_id IS NULL THEN RETURN NULL; END IF;

  LOOP
    SELECT status INTO v_status FROM public.job_visits WHERE id = v_cur;
    IF v_status IS NULL THEN RETURN NULL; END IF;      -- vanished
    IF v_status <> 'rescheduled' THEN RETURN v_cur; END IF;  -- live enough

    -- The successor is the row that points BACK at this one.
    SELECT id INTO v_next FROM public.job_visits WHERE rescheduled_from_id = v_cur;
    IF v_next IS NULL THEN
      -- Superseded with no successor: nothing to forward to. The caller keeps
      -- the original id rather than losing the attribution entirely.
      RETURN v_cur;
    END IF;

    v_cur  := v_next;
    v_hops := v_hops + 1;
    IF v_hops > 50 THEN
      -- Defensive: a cycle here would hang an INSERT. Fail to the original.
      RETURN p_visit_id;
    END IF;
  END LOOP;
END;
$$;
ALTER FUNCTION public.nx_visit_live_successor(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_visit_live_successor(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.nx_visit_live_successor(uuid) IS
  'Walks job_visits.rescheduled_from_id forward from a superseded visit to the live visit that replaced it. Owner-privileged helper for the evidence guards only — not granted to authenticated. Returns the input unchanged when the visit is already live or has no successor.';

-- ── DEFECT 1: the capture guard forwards instead of destroying ──────────────
CREATE OR REPLACE FUNCTION public.tg_guard_capture_visit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $t$
DECLARE
  v_visit_job uuid;
  v_status    text;
  v_uid       uuid := auth.uid();
  v_target    uuid;
BEGIN
  SELECT v.job_id, v.status INTO v_visit_job, v_status
    FROM public.job_visits v WHERE v.id = NEW.visit_id;

  IF v_visit_job IS NULL THEN
    RAISE EXCEPTION 'visit % does not exist', NEW.visit_id USING errcode = '23503';
  END IF;

  -- UNCHANGED: job + visit must be ONE coherent unit. This is the cross-job
  -- injection guard and it still fails closed.
  IF v_visit_job IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION
      'visit % belongs to job %, not job % — evidence cannot cross jobs',
      NEW.visit_id, v_visit_job, NEW.job_id USING errcode = '23514';
  END IF;

  -- ★ 396000. Previously this raised 23514 for 'rescheduled', which the offline
  --   layer classifies as FATAL — permanently discarding field evidence that
  --   was captured before the reschedule. Forward it to the live successor
  --   instead. The successor is on the same job by construction, so the
  --   coherence guarantee above is not weakened.
  IF v_status = 'rescheduled' THEN
    v_target := public.nx_visit_live_successor(NEW.visit_id);
    IF v_target IS NOT NULL AND v_target IS DISTINCT FROM NEW.visit_id THEN
      NEW.visit_id := v_target;
      SELECT v.status INTO v_status FROM public.job_visits v WHERE v.id = v_target;
    END IF;
  END IF;
  --   'cancelled' is accepted deliberately: there is no successor to forward
  --   to, and destroying proof of work that was performed is worse than
  --   recording it against a visit later cancelled. The visit's own status
  --   already tells that story.

  -- UNCHANGED: actor rules for authenticated sessions. A removed inspector
  -- still cannot record new work. auth.uid() is NULL for service_role and for
  -- migrations, which must keep working.
  IF v_uid IS NOT NULL AND NOT public.nx_can_record_visit_work(NEW.visit_id, v_uid) THEN
    RAISE EXCEPTION
      'not authorised to record work on visit %', NEW.visit_id USING errcode = '42501';
  END IF;

  RETURN NEW;
END $t$;
ALTER FUNCTION public.tg_guard_capture_visit() OWNER TO postgres;

-- ── nx_can_record_visit_work must accept the forwarded target ───────────────
--  It previously refused any 'cancelled' visit outright, which would now
--  contradict the guard above. Cancelled is permitted; rescheduled is not,
--  because the guard has already forwarded past it.
--  DEFECT 3: p_uid may no longer be an arbitrary probe.
CREATE OR REPLACE FUNCTION public.nx_can_record_visit_work(
  p_visit_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- ★ 396000 DEFECT 3. SECURITY DEFINER + granted to authenticated + arbitrary
  --   p_uid made this a team-membership oracle: any authenticated user holding
  --   a visit id and a user id could probe. nx_job_active_visit_for already
  --   carried this check; this function was missing it. auth.uid() IS NULL for
  --   service_role and migrations, which must keep working.
  IF auth.uid() IS NOT NULL
     AND p_uid IS DISTINCT FROM auth.uid()
     AND NOT public.nx_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'may not test another user''s visit authority'
      USING errcode = '42501';
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.job_visits v
      JOIN public.jobs j ON j.id = v.job_id
     WHERE v.id = p_visit_id
       AND v.status <> 'rescheduled'
       AND (public.nx_is_admin(p_uid)
            OR j.contractor_id = p_uid
            OR public.nx_is_active_job_team_member(v.job_id, p_uid)));
END;
$fn$;
ALTER FUNCTION public.nx_can_record_visit_work(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_record_visit_work(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_can_record_visit_work(uuid, uuid) TO authenticated, service_role;

-- ── DEFECT 4: the dead helper stops being reachable by authenticated ────────
REVOKE EXECUTE ON FUNCTION public.nx_visit_job_id(uuid) FROM authenticated;

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_src text;
BEGIN
  v_src := regexp_replace(
             pg_get_functiondef('public.tg_guard_capture_visit()'::regprocedure),
             '--[^\n]*', '', 'g');

  IF strpos(v_src, 'nx_visit_live_successor') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the capture guard does not forward superseded evidence — offline captures would still be destroyed by a reschedule';
  END IF;
  IF strpos(v_src, 'evidence cannot cross jobs') = 0 THEN
    RAISE EXCEPTION 'REGRESSION: the cross-job injection guard was lost while fixing the reschedule defect';
  END IF;
  IF strpos(v_src, 'nx_can_record_visit_work') = 0 THEN
    RAISE EXCEPTION 'REGRESSION: the actor authorization check was lost — a removed inspector could record new work';
  END IF;

  -- Defect 3: the oracle check must be present.
  IF strpos(regexp_replace(
              pg_get_functiondef('public.nx_can_record_visit_work(uuid,uuid)'::regprocedure),
              '--[^\n]*', '', 'g'),
            'may not test another user') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: nx_can_record_visit_work is still a membership oracle';
  END IF;

  -- Defect 4: authenticated must no longer hold EXECUTE.
  IF has_function_privilege('authenticated', 'public.nx_visit_job_id(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: the dead nx_visit_job_id helper is still granted to authenticated';
  END IF;

  -- The successor walker must never be reachable directly.
  IF has_function_privilege('authenticated', 'public.nx_visit_live_successor(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: nx_visit_live_successor must not be granted to authenticated';
  END IF;

  -- Nothing this migration must have disturbed.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_guard_capture_visit_ins' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'REGRESSION: the capture visit guard trigger is missing';
  END IF;
  IF to_regprocedure('public.nx_job_reschedule_visit(uuid,timestamptz,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'ORDERING: 394000 must apply before 396000';
  END IF;
END
$verify$;

COMMIT;
