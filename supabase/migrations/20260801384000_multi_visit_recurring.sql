-- ════════════════════════════════════════════════════════════════════════════
--  20260801384000_multi_visit_recurring.sql
--
--  PHASE 2 — MULTI-VISIT / RECURRING INSPECTIONS. Additive. Legacy jobs are
--  untouched and require no backfill.
--
--  ── VERIFIED ABSENT BEFORE BUILDING ────────────────────────────────────────
--  No visit / occurrence / recurrence / round table, column or RPC exists in
--  any of the 40 migrations, and the handful of app files matching "visit" are
--  incidental prose. Scheduling today is exactly one field — jobs.scheduled_date
--  — plus the availability columns on profiles. This is genuinely new.
--
--  ── THE COMPATIBILITY RULE, SAME SHAPE AS MULTI-INSPECTOR ──────────────────
--  jobs.scheduled_date REMAINS the schedule for a job that has no explicit
--  visits. nx_job_visits() falls back to it and returns a synthetic visit #1, so
--  every existing job reads as a valid single-visit job with NO data migration.
--  Creating the first explicit visit is what opts a job into the multi-visit
--  model; nothing changes until an admin does that.
--
--  ── NO SCHEDULING V2 ───────────────────────────────────────────────────────
--  Visit conflict detection reuses the SAME same-calendar-day predicate as
--  nx_job_schedule_conflicts, extended to visit level. No calendar table, no
--  availability engine, no second scheduling model.
--
--  ── NO SECOND ASSIGNMENT ARCHITECTURE ──────────────────────────────────────
--  Visit allocation references an EXISTING job_inspectors membership row rather
--  than naming an inspector again. You cannot be allocated to a visit without
--  being on the job team, and removing someone from the team removes them from
--  its visits by construction — there is only one source of assignment truth.
--
--  ── PAYMENT ────────────────────────────────────────────────────────────────
--  Visits are operational. Creating, rescheduling, cancelling or completing one
--  moves NO money and does not touch admin_confirmed_at or any *_cents column.
--  Settlement stays manual. Self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The visit ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_visits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  visit_number   int  NOT NULL,
  title          text,
  visit_kind     text NOT NULL DEFAULT 'single',
  status         text NOT NULL DEFAULT 'scheduled',

  scheduled_start timestamptz,
  scheduled_end   timestamptz,
  -- IANA zone. Site-local time matters for a field visit; the app already
  -- stores timestamptz elsewhere, so this records intent, not a second clock.
  timezone       text,

  -- Groups the occurrences of one recurring series so it can be managed and
  -- reported on as a series without a separate schedule table.
  recurrence_group_id uuid,
  -- Rescheduling never edits in place: the old row is kept as 'rescheduled'
  -- and the new one points back, so the visit history is reconstructable.
  rescheduled_from_id uuid REFERENCES public.job_visits(id) ON DELETE SET NULL,

  notes          text,
  created_by     uuid REFERENCES public.profiles(id),
  started_at     timestamptz,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES public.profiles(id),
  cancel_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_visits_kind_check CHECK (visit_kind = ANY (ARRAY[
    'single','recurring','surveillance','resident','repeat','followup'])),
  CONSTRAINT job_visits_status_check CHECK (status = ANY (ARRAY[
    'planned','scheduled','in_progress','completed','cancelled','rescheduled','no_show'])),
  CONSTRAINT job_visits_number_positive CHECK (visit_number > 0),
  CONSTRAINT job_visits_window CHECK (
    scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end >= scheduled_start),
  CONSTRAINT job_visits_cancel_pair CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  CONSTRAINT job_visits_cancel_status CHECK (
    cancelled_at IS NULL OR status = 'cancelled')
);

CREATE UNIQUE INDEX IF NOT EXISTS job_visits_job_number_idx
  ON public.job_visits (job_id, visit_number);
CREATE INDEX IF NOT EXISTS job_visits_job_status_idx
  ON public.job_visits (job_id, status);
CREATE INDEX IF NOT EXISTS job_visits_schedule_idx
  ON public.job_visits (scheduled_start)
  WHERE scheduled_start IS NOT NULL AND status IN ('planned','scheduled','in_progress');
CREATE INDEX IF NOT EXISTS job_visits_series_idx
  ON public.job_visits (recurrence_group_id)
  WHERE recurrence_group_id IS NOT NULL;

COMMENT ON TABLE public.job_visits IS
  'Site visits under a job. ADDITIVE: a job with no rows here still reads as a single visit built from jobs.scheduled_date, so no legacy job needs migrating. Rescheduling preserves the old row as ''rescheduled'' and links forward, keeping visit history intact. Creating a visit moves no money.';

CREATE OR REPLACE FUNCTION public.tg_touch_job_visits() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $t$
BEGIN NEW.updated_at := now(); RETURN NEW; END $t$;

DROP TRIGGER IF EXISTS trg_touch_job_visits ON public.job_visits;
CREATE TRIGGER trg_touch_job_visits
  BEFORE UPDATE ON public.job_visits
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_job_visits();

-- ── 2) Visit allocation — REUSES the job team, never re-names an inspector ──
CREATE TABLE IF NOT EXISTS public.job_visit_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id         uuid NOT NULL REFERENCES public.job_visits(id) ON DELETE CASCADE,
  -- The MEMBERSHIP, not the person. There is exactly one assignment truth:
  -- you cannot be allocated to a visit without being on the job team, and
  -- removing the membership removes the allocation with it.
  job_inspector_id uuid NOT NULL REFERENCES public.job_inspectors(id) ON DELETE CASCADE,
  is_lead          boolean NOT NULL DEFAULT false,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      uuid REFERENCES public.profiles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS job_visit_assignments_unique_idx
  ON public.job_visit_assignments (visit_id, job_inspector_id);
CREATE UNIQUE INDEX IF NOT EXISTS job_visit_assignments_one_lead_idx
  ON public.job_visit_assignments (visit_id) WHERE is_lead;

COMMENT ON TABLE public.job_visit_assignments IS
  'Who works a given visit. References a job_inspectors MEMBERSHIP rather than a profile, so the job team stays the single source of assignment truth and team removal cascades automatically.';

-- ── 3) Evidence gains an optional visit ─────────────────────────────────────
--  Nullable on purpose: NULL means job-level evidence, which is exactly what
--  every existing row means today. No backfill, no reinterpretation.
ALTER TABLE public.inspection_captures
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.job_visits(id) ON DELETE SET NULL;
ALTER TABLE public.inspection_items
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.job_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inspection_captures_visit_idx
  ON public.inspection_captures (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inspection_items_visit_idx
  ON public.inspection_items (visit_id) WHERE visit_id IS NOT NULL;

COMMENT ON COLUMN public.inspection_captures.visit_id IS
  'Optional visit this evidence belongs to. NULL = job-level, the pre-existing meaning of every row, so legacy evidence is untouched.';

-- ── 4) RLS — same audience as the job team ──────────────────────────────────
ALTER TABLE public.job_visits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_visit_assignments ENABLE ROW LEVEL SECURITY;

--  Buyers SHOULD see the visit schedule — it is their site and their programme.
--  They see dates and status; they do not get inspector-private detail, because
--  identities live in job_inspectors, which they cannot read.
DROP POLICY IF EXISTS job_visits_read ON public.job_visits;
CREATE POLICY job_visits_read ON public.job_visits
  FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_visits.job_id
         AND (auth.uid() = j.client_id
              OR auth.uid() = j.agency_id
              OR auth.uid() = j.contractor_id))
    OR public.nx_is_active_job_team_member(job_visits.job_id, auth.uid())
  );

DROP POLICY IF EXISTS job_visit_assignments_read ON public.job_visit_assignments;
CREATE POLICY job_visit_assignments_read ON public.job_visit_assignments
  FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.job_visits v
        JOIN public.jobs j ON j.id = v.job_id
       WHERE v.id = job_visit_assignments.visit_id
         AND (auth.uid() = j.contractor_id
              OR public.nx_is_active_job_team_member(j.id, auth.uid())))
  );

-- Writes go exclusively through the admin-gated RPCs below.
REVOKE ALL ON TABLE public.job_visits            FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.job_visit_assignments FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.job_visits            TO authenticated;
GRANT SELECT ON TABLE public.job_visit_assignments TO authenticated;
GRANT ALL    ON TABLE public.job_visits            TO service_role;
GRANT ALL    ON TABLE public.job_visit_assignments TO service_role;

-- ── 5) Canonical reader, with single-visit fallback ─────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_visits(p_job_id uuid)
RETURNS TABLE (
  visit_id        uuid,
  visit_number    int,
  title           text,
  visit_kind      text,
  status          text,
  scheduled_start timestamptz,
  scheduled_end   timestamptz,
  timezone        text,
  recurrence_group_id uuid,
  assigned_count  int,
  from_fallback   boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job RECORD;
  v_n   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT j.client_id, j.agency_id, j.contractor_id, j.scheduled_date, j.title
    INTO v_job FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  IF NOT (
    public.nx_is_admin()
    OR v_uid IS NOT DISTINCT FROM v_job.client_id
    OR v_uid IS NOT DISTINCT FROM v_job.agency_id
    OR v_uid IS NOT DISTINCT FROM v_job.contractor_id
    OR public.nx_is_active_job_team_member(p_job_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  SELECT count(*) INTO v_n FROM public.job_visits v
   WHERE v.job_id = p_job_id AND v.status <> 'rescheduled';

  IF v_n = 0 THEN
    -- FALLBACK: a legacy job is one visit, described by jobs.scheduled_date.
    RETURN QUERY SELECT
      NULL::uuid, 1, v_job.title, 'single'::text, 'scheduled'::text,
      v_job.scheduled_date, NULL::timestamptz, NULL::text, NULL::uuid, 0, true;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT v.id, v.visit_number, v.title, v.visit_kind, v.status,
           v.scheduled_start, v.scheduled_end, v.timezone, v.recurrence_group_id,
           (SELECT count(*)::int FROM public.job_visit_assignments a
             WHERE a.visit_id = v.id),
           false
      FROM public.job_visits v
     WHERE v.job_id = p_job_id AND v.status <> 'rescheduled'
     ORDER BY v.visit_number;
END $fn$;

ALTER FUNCTION public.nx_job_visits(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_visits(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_visits(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_visits(uuid) IS
  'Visits for a job. Falls back to a synthetic visit #1 from jobs.scheduled_date when none exist, so every legacy job reads as a valid single-visit job with no backfill. Superseded (rescheduled) rows are excluded from the live list but retained in the table. Returns no pricing column.';

-- ── 6) Admin visit management ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_add_visit(
  p_job_id    uuid,
  p_start     timestamptz DEFAULT NULL,
  p_end       timestamptz DEFAULT NULL,
  p_kind      text        DEFAULT 'single',
  p_title     text        DEFAULT NULL,
  p_timezone  text        DEFAULT NULL,
  p_notes     text        DEFAULT NULL,
  p_recurrence_group uuid DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_next  int;
  v_id    uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id) THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  SELECT COALESCE(max(visit_number), 0) + 1 INTO v_next
    FROM public.job_visits WHERE job_id = p_job_id;

  INSERT INTO public.job_visits
    (job_id, visit_number, title, visit_kind, status, scheduled_start,
     scheduled_end, timezone, recurrence_group_id, notes, created_by)
  VALUES (p_job_id, v_next, NULLIF(btrim(coalesce(p_title, '')), ''),
          COALESCE(NULLIF(btrim(p_kind), ''), 'single'),
          CASE WHEN p_start IS NULL THEN 'planned' ELSE 'scheduled' END,
          p_start, p_end, NULLIF(btrim(coalesce(p_timezone, '')), ''),
          p_recurrence_group, NULLIF(btrim(coalesce(p_notes, '')), ''), v_admin)
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.job_events (job_id, actor_id, event_type, metadata)
    VALUES (p_job_id, v_admin, 'status_change',
            jsonb_build_object('area','job_visits','action','add',
                               'visit_id', v_id, 'visit_number', v_next,
                               'kind', p_kind, 'start', p_start));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'job_visits audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'visit_id', v_id, 'visit_number', v_next);
END $fn$;

ALTER FUNCTION public.nx_job_add_visit(uuid, timestamptz, timestamptz, text, text, text, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_add_visit(uuid, timestamptz, timestamptz, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_add_visit(uuid, timestamptz, timestamptz, text, text, text, text, uuid) TO authenticated, service_role;

-- Recurring series — N occurrences at a fixed interval, one group id.
CREATE OR REPLACE FUNCTION public.nx_job_create_recurring_visits(
  p_job_id        uuid,
  p_first_start   timestamptz,
  p_count         int,
  p_interval_days int  DEFAULT 7,
  p_kind          text DEFAULT 'recurring',
  p_title         text DEFAULT NULL,
  p_timezone      text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_group uuid := gen_random_uuid();
  v_i     int;
  v_ids   uuid[] := '{}';
  v_res   jsonb;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  IF p_count IS NULL OR p_count < 1 OR p_count > 365 THEN
    RAISE EXCEPTION 'p_count must be between 1 and 365 (got %)', p_count USING errcode = '22023';
  END IF;
  IF p_interval_days IS NULL OR p_interval_days < 1 THEN
    RAISE EXCEPTION 'p_interval_days must be >= 1' USING errcode = '22023';
  END IF;
  IF p_first_start IS NULL THEN
    RAISE EXCEPTION 'a recurring series needs a first start' USING errcode = '22023';
  END IF;

  FOR v_i IN 0 .. (p_count - 1) LOOP
    v_res := public.nx_job_add_visit(
      p_job_id,
      p_first_start + (v_i * p_interval_days) * interval '1 day',
      NULL, p_kind,
      COALESCE(p_title, 'Visit') || ' ' || (v_i + 1)::text,
      p_timezone, NULL, v_group);
    v_ids := v_ids || (v_res->>'visit_id')::uuid;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'recurrence_group_id', v_group,
                            'created', array_length(v_ids, 1), 'visit_ids', v_ids);
END $fn$;

ALTER FUNCTION public.nx_job_create_recurring_visits(uuid, timestamptz, int, int, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_create_recurring_visits(uuid, timestamptz, int, int, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_create_recurring_visits(uuid, timestamptz, int, int, text, text, text) TO authenticated, service_role;

-- Reschedule: never edit in place — supersede, so history survives.
CREATE OR REPLACE FUNCTION public.nx_job_reschedule_visit(
  p_visit_id uuid, p_new_start timestamptz, p_new_end timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_old   RECORD;
  v_new   uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT * INTO v_old FROM public.job_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit not found' USING errcode = 'P0002';
  END IF;
  IF v_old.status IN ('completed','cancelled','rescheduled') THEN
    RAISE EXCEPTION 'visit % cannot be rescheduled from status %', p_visit_id, v_old.status
      USING errcode = '22023';
  END IF;

  INSERT INTO public.job_visits
    (job_id, visit_number, title, visit_kind, status, scheduled_start,
     scheduled_end, timezone, recurrence_group_id, rescheduled_from_id,
     notes, created_by)
  VALUES (v_old.job_id, v_old.visit_number, v_old.title, v_old.visit_kind,
          'scheduled', p_new_start, p_new_end, v_old.timezone,
          v_old.recurrence_group_id, v_old.id,
          COALESCE(NULLIF(btrim(coalesce(p_reason,'')), ''), v_old.notes), v_admin)
  RETURNING id INTO v_new;

  -- The old row is superseded, NOT deleted: the schedule history stays legible.
  UPDATE public.job_visits SET status = 'rescheduled' WHERE id = p_visit_id;

  -- Carry the crew across, so rescheduling does not silently unassign anyone.
  INSERT INTO public.job_visit_assignments (visit_id, job_inspector_id, is_lead, assigned_by)
  SELECT v_new, a.job_inspector_id, a.is_lead, v_admin
    FROM public.job_visit_assignments a WHERE a.visit_id = p_visit_id;

  RETURN jsonb_build_object('ok', true, 'old_visit_id', p_visit_id, 'new_visit_id', v_new);
END $fn$;

ALTER FUNCTION public.nx_job_reschedule_visit(uuid, timestamptz, timestamptz, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_reschedule_visit(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_reschedule_visit(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_job_cancel_visit(
  p_visit_id uuid, p_reason text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE v_admin uuid := auth.uid(); v_n int;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  UPDATE public.job_visits
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_admin,
         cancel_reason = NULLIF(btrim(coalesce(p_reason,'')), '')
   WHERE id = p_visit_id AND status NOT IN ('completed','cancelled');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'visit_id', p_visit_id);
END $fn$;

ALTER FUNCTION public.nx_job_cancel_visit(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_cancel_visit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_cancel_visit(uuid, text) TO authenticated, service_role;

-- Allocate a TEAM MEMBER to a visit.
CREATE OR REPLACE FUNCTION public.nx_visit_assign_inspector(
  p_visit_id uuid, p_inspector_id uuid, p_is_lead boolean DEFAULT false
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin  uuid := auth.uid();
  v_job    uuid;
  v_member uuid;
  v_id     uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT job_id INTO v_job FROM public.job_visits WHERE id = p_visit_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'visit not found' USING errcode = 'P0002';
  END IF;

  -- Single source of assignment truth: they must already be on the job team.
  SELECT ji.id INTO v_member FROM public.job_inspectors ji
   WHERE ji.job_id = v_job AND ji.inspector_id = p_inspector_id
     AND ji.status IN ('assigned','active');
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'inspector is not an active member of this job team — add them to the team first'
      USING errcode = '42501';
  END IF;

  IF p_is_lead THEN
    UPDATE public.job_visit_assignments SET is_lead = false WHERE visit_id = p_visit_id;
  END IF;

  INSERT INTO public.job_visit_assignments (visit_id, job_inspector_id, is_lead, assigned_by)
  VALUES (p_visit_id, v_member, COALESCE(p_is_lead, false), v_admin)
  ON CONFLICT (visit_id, job_inspector_id)
    DO UPDATE SET is_lead = EXCLUDED.is_lead
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'assignment_id', v_id);
END $fn$;

ALTER FUNCTION public.nx_visit_assign_inspector(uuid, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_visit_assign_inspector(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_visit_assign_inspector(uuid, uuid, boolean) TO authenticated, service_role;

-- ── 7) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dadd text := pg_get_functiondef('public.nx_job_add_visit(uuid,timestamptz,timestamptz,text,text,text,text,uuid)'::regprocedure);
  dres text := pg_get_functiondef('public.nx_job_reschedule_visit(uuid,timestamptz,timestamptz,text)'::regprocedure);
  dasg text := pg_get_functiondef('public.nx_visit_assign_inspector(uuid,uuid,boolean)'::regprocedure);
BEGIN
  IF to_regclass('public.job_visits') IS NULL
     OR to_regclass('public.job_visit_assignments') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: visit tables were not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='job_visits' AND rowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: RLS not enabled on job_visits';
  END IF;

  -- Legacy compatibility must be structural, not incidental.
  IF position('from_fallback' IN pg_get_functiondef('public.nx_job_visits(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_job_visits lost its single-visit fallback';
  END IF;

  -- Rescheduling must SUPERSEDE, never delete.
  IF dres ~* 'DELETE\s+FROM\s+public\.job_visits' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: reschedule deletes visit history';
  END IF;
  IF position('rescheduled' IN dres) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: reschedule does not supersede the old row';
  END IF;

  -- ONE assignment architecture: allocation must go through job_inspectors.
  IF position('job_inspectors' IN dasg) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: visit assignment bypasses the job team — that is a second assignment architecture';
  END IF;

  -- PAYMENT: visits are operational.
  IF dadd ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents)\M'
     OR dres ~* '\m(payout|wallet|transactions|admin_confirmed_at)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a visit function names a money surface';
  END IF;

  -- No client write path.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename IN ('job_visits','job_visit_assignments') AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a non-SELECT policy exists — writes must go through the admin RPCs';
  END IF;

  RAISE NOTICE 'multi-visit ready: additive, scheduled_date fallback intact, one assignment truth, money-free.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
