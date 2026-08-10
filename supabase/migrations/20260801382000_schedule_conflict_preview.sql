-- ════════════════════════════════════════════════════════════════════════════
--  20260801382000_schedule_conflict_preview.sql
--
--  MULTI-INSPECTOR, part 4 (Phase 1F) — scheduling conflict, made visible.
--
--  ── THE GAP ────────────────────────────────────────────────────────────────
--  nx_job_add_inspector already computes schedule_conflicts, but only AFTER the
--  member is added. An admin cannot see a clash while deciding. This adds the
--  read-only preview that the same decision needs BEFORE the click.
--
--  ── NO SCHEDULING V2 ───────────────────────────────────────────────────────
--  It reuses exactly the existing signal — jobs.scheduled_date compared on the
--  calendar day, against ACTIVE job_inspectors memberships. Same predicate as
--  the add path, so the preview and the outcome can never disagree. No new
--  calendar, no availability table, no second scheduling model.
--
--  ── ADVISORY, NOT A GATE ───────────────────────────────────────────────────
--  This function reports. It blocks nothing, and nx_job_add_inspector still
--  does not refuse a conflicted assignment. Existing NEXPEC dispatch semantics
--  let an admin knowingly double-book — a lead may legitimately cover two jobs
--  on one day — so the product decision stays with the human.
--
--  ── PRIVACY ────────────────────────────────────────────────────────────────
--  Returns COUNTS and DATES only. It deliberately does NOT return the other
--  jobs' titles, clients, sites or any pricing: an admin deciding this
--  assignment does not need another client's job details to see a clash, and a
--  conflict preview is a poor place to widen data exposure.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_job_schedule_conflicts(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS TABLE (
  conflict_count     int,
  conflict_dates     date[],
  job_scheduled_date date,
  job_has_date       boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_when date;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT j.scheduled_date::date INTO v_when
    FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  job_scheduled_date := v_when;
  job_has_date       := (v_when IS NOT NULL);

  IF v_when IS NULL THEN
    -- Nothing to clash with. An undated job cannot conflict, and saying
    -- "0 conflicts" without this flag would imply we checked and found none.
    conflict_count := 0;
    conflict_dates := '{}';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)::int,
         COALESCE(array_agg(DISTINCT j2.scheduled_date::date), '{}')
    INTO conflict_count, conflict_dates
    FROM public.job_inspectors ji
    JOIN public.jobs j2 ON j2.id = ji.job_id
   WHERE ji.inspector_id = p_inspector_id
     -- Removed and replaced memberships are NOT conflicts. Only 'assigned'
     -- and 'active' count, matching nx_job_add_inspector exactly.
     AND ji.status IN ('assigned', 'active')
     AND j2.id <> p_job_id
     AND j2.scheduled_date IS NOT NULL
     AND j2.scheduled_date::date = v_when;

  RETURN NEXT;
END $fn$;

ALTER FUNCTION public.nx_job_schedule_conflicts(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_schedule_conflicts(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_schedule_conflicts(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_schedule_conflicts(uuid, uuid) IS
  'Admin-only, read-only preview of same-day scheduling clashes for a candidate, using the SAME predicate as nx_job_add_inspector so preview and outcome cannot disagree. Advisory: blocks nothing. Returns counts and dates only — never another job''s title, client or pricing.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $test$
DECLARE
  d text := pg_get_functiondef('public.nx_job_schedule_conflicts(uuid,uuid)'::regprocedure);
BEGIN
  IF position('admin only' IN d) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the conflict preview is not admin-gated';
  END IF;

  -- Must count only ACTIVE memberships, exactly like the add path.
  IF position('''assigned'', ''active''' IN d) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the preview does not restrict to active memberships — removed members would be counted as conflicts';
  END IF;

  -- Must not leak other jobs' commercial or descriptive detail.
  IF d ~* '\m(client_price_cents|inspector_payout_cents|platform_spread_cents|budget_cents)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the conflict preview names a money surface';
  END IF;
  IF d ~* '\mj2\.title\M' OR d ~* '\mj2\.client_id\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the preview exposes another job''s title or client';
  END IF;

  -- Advisory only: it must not raise on a conflict.
  IF d ~* 'RAISE EXCEPTION[^;]*conflict' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the preview blocks on conflict — dispatch semantics allow a knowing double-book';
  END IF;

  RAISE NOTICE 'schedule conflict preview ready: advisory, admin-only, active memberships only.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
