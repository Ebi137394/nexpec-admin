-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801384000_rollback.sql
--
--  Reverses 20260801384000 (multi-visit / recurring). LOCAL only.
--
--  Purely additive migration → clean revert. Drops the six new RPCs, the two
--  new tables, and the two nullable visit_id columns.
--
--  ⚠ Dropping job_visits DESTROYS VISIT HISTORY — schedules, reschedule chains,
--  cancellations and per-visit crew allocation. Jobs themselves are untouched:
--  jobs.scheduled_date was never modified, so every job reverts to the
--  single-visit behaviour it had before. Evidence is NOT deleted — the
--  inspection_captures / inspection_items rows survive and simply return to
--  meaning "job-level", which is what they meant before this migration.
--
--  The guard aborts if any visit exists, so history cannot be discarded by
--  accident. Override deliberately with nexpec.force_drop_visits = 1.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE v_n int;
BEGIN
  IF to_regclass('public.job_visits') IS NULL THEN
    RAISE NOTICE 'job_visits already absent; nothing to guard.';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM public.job_visits;
  IF v_n > 0 AND coalesce(current_setting('nexpec.force_drop_visits', true), '') <> '1' THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: job_visits holds % visit(s), including reschedule and '
      'cancellation history. Dropping the table destroys them. Set '
      'nexpec.force_drop_visits=1 if that is genuinely intended.', v_n;
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.nx_visit_assign_inspector(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.nx_job_cancel_visit(uuid, text);
DROP FUNCTION IF EXISTS public.nx_job_reschedule_visit(uuid, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.nx_job_create_recurring_visits(uuid, timestamptz, int, int, text, text, text);
DROP FUNCTION IF EXISTS public.nx_job_add_visit(uuid, timestamptz, timestamptz, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.nx_job_visits(uuid);

DROP INDEX IF EXISTS public.inspection_captures_visit_idx;
DROP INDEX IF EXISTS public.inspection_items_visit_idx;
ALTER TABLE public.inspection_captures DROP COLUMN IF EXISTS visit_id;
ALTER TABLE public.inspection_items    DROP COLUMN IF EXISTS visit_id;

DROP TRIGGER  IF EXISTS trg_touch_job_visits ON public.job_visits;
DROP TABLE    IF EXISTS public.job_visit_assignments;
DROP TABLE    IF EXISTS public.job_visits;
DROP FUNCTION IF EXISTS public.tg_touch_job_visits();

DO $verify$
BEGIN
  IF to_regclass('public.job_visits') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: job_visits still present';
  END IF;
  -- Everything the migration deliberately did NOT touch must survive.
  IF to_regclass('public.job_inspectors') IS NULL
     OR to_regclass('public.inspection_captures') IS NULL
     OR to_regclass('public.inspection_items') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a pre-existing table is missing';
  END IF;
  RAISE NOTICE 'rollback complete: visits removed; jobs, team and evidence untouched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
