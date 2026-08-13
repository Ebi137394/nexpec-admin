-- ════════════════════════════════════════════════════════════════════════════
--  20260801386000_visit_schedule_conflicts.sql
--
--  PHASE 2B — visit-level scheduling conflicts. Same predicate family as the
--  job-level check, one shared implementation, advisory only.
--
--  ── WHY A SHARED CORE, NOT A SECOND COPY ───────────────────────────────────
--  nx_job_schedule_conflicts (20260801382000) already answers "is this inspector
--  busy on this calendar day?" against job_inspectors + jobs.scheduled_date. The
--  visit model adds a second place work can be scheduled — job_visits — so the
--  question is the same but the sources are now two.
--
--  Duplicating the predicate is how preview and outcome drift apart. So the
--  counting logic lives in ONE private core, nx_schedule_conflicts_core(day,
--  inspector, exclude_job, exclude_visit), and BOTH the preview RPC and the
--  assignment RPC call it. The invariant PREVIEW COUNT = ASSIGNMENT COUNT is
--  then structural rather than something tests have to keep re-checking.
--
--  nx_job_schedule_conflicts is NOT modified — job-level behaviour is unchanged
--  and its own suite still holds.
--
--  ── WHAT COUNTS AS A CONFLICT ──────────────────────────────────────────────
--  Same calendar day, from either source:
--    • another job scheduled that day where the inspector holds an ACTIVE
--      job_inspectors membership (the pre-existing rule), and
--    • another VISIT scheduled that day the inspector is allocated to.
--  Excluded, deliberately:
--    • the current visit and its own job
--    • cancelled and rescheduled/superseded visits — a superseded row is not
--      real workload, and counting it would invent conflicts after every
--      reschedule
--    • removed and replaced memberships — stale allocations must not
--      manufacture phantom clashes
--
--  ── ADVISORY ───────────────────────────────────────────────────────────────
--  Nothing here blocks. nx_visit_assign_inspector still assigns and simply
--  reports the count: "N conflicts — you can still assign them." A field lead
--  covering two sites in a day is a legitimate operational decision.
--
--  ── PRIVACY ────────────────────────────────────────────────────────────────
--  Counts and dates only. No other job's title, client, site or pricing. An
--  admin resolving a clash does not need another client's job details.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The single source of conflict truth ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_schedule_conflicts_core(
  p_day            date,
  p_inspector_id   uuid,
  p_exclude_job_id uuid DEFAULT NULL,
  p_exclude_visit_id uuid DEFAULT NULL
) RETURNS TABLE (conflict_count int, conflict_dates date[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  WITH job_level AS (
    -- The pre-existing rule: an active membership on another job scheduled
    -- that day. Kept identical so job-level answers do not change.
    SELECT j.scheduled_date::date AS d
      FROM public.job_inspectors ji
      JOIN public.jobs j ON j.id = ji.job_id
     WHERE ji.inspector_id = p_inspector_id
       AND ji.status IN ('assigned', 'active')
       AND j.scheduled_date IS NOT NULL
       AND j.scheduled_date::date = p_day
       AND (p_exclude_job_id IS NULL OR j.id <> p_exclude_job_id)
  ), visit_level AS (
    -- New: an allocation to another visit scheduled that day.
    SELECT v.scheduled_start::date AS d
      FROM public.job_visit_assignments a
      JOIN public.job_visits    v  ON v.id = a.visit_id
      JOIN public.job_inspectors ji ON ji.id = a.job_inspector_id
     WHERE ji.inspector_id = p_inspector_id
       AND ji.status IN ('assigned', 'active')
       AND v.scheduled_start IS NOT NULL
       AND v.scheduled_start::date = p_day
       -- superseded and abandoned work is not workload
       AND v.status NOT IN ('cancelled', 'rescheduled')
       AND (p_exclude_visit_id IS NULL OR v.id <> p_exclude_visit_id)
       AND (p_exclude_job_id  IS NULL OR v.job_id <> p_exclude_job_id)
  -- `both` is a RESERVED WORD in Postgres (trim(both ...)), so an unquoted
  -- CTE of that name is a syntax error: `syntax error at or near "both"`
  -- (SQLSTATE 42601). It aborted this migration and every one after it on a
  -- clean database. Renamed rather than quoted — a quoted "both" would work
  -- but leaves the same trap for the next reader.
  ), all_days AS (
    SELECT d FROM job_level
    UNION ALL
    SELECT d FROM visit_level
  )
  SELECT count(*)::int,
         COALESCE(array_agg(DISTINCT d), '{}'::date[])
    FROM all_days;
$fn$;

ALTER FUNCTION public.nx_schedule_conflicts_core(date, uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_schedule_conflicts_core(date, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_schedule_conflicts_core(date, uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.nx_schedule_conflicts_core(date, uuid, uuid, uuid) IS
  'THE single conflict predicate, shared by the visit preview and the visit assignment RPC so the two can never disagree. Counts same-day workload from BOTH jobs.scheduled_date (active memberships) and job_visits (active allocations), excluding cancelled/rescheduled visits and inactive memberships. Private: granted to nobody but service_role.';

-- ── 2) Admin preview ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_visit_schedule_conflicts(
  p_visit_id uuid, p_inspector_id uuid
) RETURNS TABLE (
  conflict_count     int,
  conflict_dates     date[],
  visit_scheduled_at timestamptz,
  visit_has_date     boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_visit RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT v.id, v.job_id, v.scheduled_start
    INTO v_visit FROM public.job_visits v WHERE v.id = p_visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit not found' USING errcode = 'P0002';
  END IF;

  visit_scheduled_at := v_visit.scheduled_start;
  visit_has_date     := (v_visit.scheduled_start IS NOT NULL);

  IF v_visit.scheduled_start IS NULL THEN
    -- An unscheduled visit cannot clash. Reporting a bare 0 would imply we
    -- checked a date and found it free.
    conflict_count := 0;
    conflict_dates := '{}';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT c.conflict_count, c.conflict_dates
    INTO conflict_count, conflict_dates
    FROM public.nx_schedule_conflicts_core(
           v_visit.scheduled_start::date, p_inspector_id,
           v_visit.job_id, p_visit_id) c;

  RETURN NEXT;
END $fn$;

ALTER FUNCTION public.nx_visit_schedule_conflicts(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_visit_schedule_conflicts(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_visit_schedule_conflicts(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_visit_schedule_conflicts(uuid, uuid) IS
  'Admin-only, read-only, ADVISORY preview of same-day clashes for allocating an inspector to a visit. Delegates to nx_schedule_conflicts_core, the same predicate nx_visit_assign_inspector uses, so preview and outcome cannot drift. Counts and dates only — never another job''s title, client or pricing. Blocks nothing.';

-- ── 3) Assignment reports the SAME count ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_visit_assign_inspector(
  p_visit_id uuid, p_inspector_id uuid, p_is_lead boolean DEFAULT false
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin     uuid := auth.uid();
  v_visit     RECORD;
  v_member    uuid;
  v_id        uuid;
  v_conflicts int := 0;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT v.id, v.job_id, v.scheduled_start
    INTO v_visit FROM public.job_visits v WHERE v.id = p_visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit not found' USING errcode = 'P0002';
  END IF;

  -- Single source of assignment truth: they must already be on the job team.
  SELECT ji.id INTO v_member FROM public.job_inspectors ji
   WHERE ji.job_id = v_visit.job_id AND ji.inspector_id = p_inspector_id
     AND ji.status IN ('assigned','active');
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'inspector is not an active member of this job team — add them to the team first'
      USING errcode = '42501';
  END IF;

  -- Measured BEFORE inserting, and with this visit excluded, so the number
  -- matches what the preview showed for the same state.
  IF v_visit.scheduled_start IS NOT NULL THEN
    SELECT c.conflict_count INTO v_conflicts
      FROM public.nx_schedule_conflicts_core(
             v_visit.scheduled_start::date, p_inspector_id,
             v_visit.job_id, p_visit_id) c;
  END IF;

  IF p_is_lead THEN
    UPDATE public.job_visit_assignments SET is_lead = false WHERE visit_id = p_visit_id;
  END IF;

  INSERT INTO public.job_visit_assignments (visit_id, job_inspector_id, is_lead, assigned_by)
  VALUES (p_visit_id, v_member, COALESCE(p_is_lead, false), v_admin)
  ON CONFLICT (visit_id, job_inspector_id)
    DO UPDATE SET is_lead = EXCLUDED.is_lead
  RETURNING id INTO v_id;

  -- ADVISORY: the assignment stands. The count is information, not a veto.
  RETURN jsonb_build_object('ok', true, 'assignment_id', v_id,
                            'schedule_conflicts', v_conflicts);
END $fn$;

ALTER FUNCTION public.nx_visit_assign_inspector(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_visit_assign_inspector(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_visit_assign_inspector(uuid, uuid, boolean) TO authenticated, service_role;

-- ── 4) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dcore text := pg_get_functiondef('public.nx_schedule_conflicts_core(date,uuid,uuid,uuid)'::regprocedure);
  dprev text := pg_get_functiondef('public.nx_visit_schedule_conflicts(uuid,uuid)'::regprocedure);
  dasg  text := pg_get_functiondef('public.nx_visit_assign_inspector(uuid,uuid,boolean)'::regprocedure);
BEGIN
  -- ONE predicate: both callers must delegate to the core.
  IF position('nx_schedule_conflicts_core' IN dprev) = 0
     OR position('nx_schedule_conflicts_core' IN dasg) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: preview and assignment do not share the conflict predicate — they will drift';
  END IF;

  -- The core must exclude superseded and abandoned work.
  IF position('''cancelled'', ''rescheduled''' IN dcore) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the core counts cancelled/rescheduled visits as workload';
  END IF;
  IF position('''assigned'', ''active''' IN dcore) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the core counts inactive memberships';
  END IF;

  -- Job-level behaviour must be untouched.
  IF to_regprocedure('public.nx_job_schedule_conflicts(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_job_schedule_conflicts was removed';
  END IF;

  -- The core is private.
  IF has_function_privilege('authenticated','public.nx_schedule_conflicts_core(date,uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.nx_schedule_conflicts_core(date,uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the conflict core is reachable by end users';
  END IF;

  -- ADVISORY: assignment must not refuse on conflict.
  IF dasg ~* 'RAISE EXCEPTION[^;]*conflict' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: assignment blocks on conflict — dispatch semantics allow a knowing double-book';
  END IF;

  -- PRIVACY + PAYMENT.
  IF dcore ~* '\m(title|client_id|client_price_cents|inspector_payout_cents|platform_spread_cents)\M'
     OR dprev ~* '\m(client_price_cents|inspector_payout_cents|platform_spread_cents)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the conflict path exposes another job''s identity or pricing';
  END IF;
  IF dasg ~* '\m(payout|wallet|transactions|admin_confirmed_at)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: visit assignment names a money surface';
  END IF;

  RAISE NOTICE 'visit conflicts ready: one shared predicate, advisory, private core.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
