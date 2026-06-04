-- ════════════════════════════════════════════════════════════════════════════
--  20260801122700_sla_sentinel_report_reminders.sql
--
--  SLA SENTINEL — automated overdue-report reminders with an escalation ladder.
--
--  When a job's inspection window has passed (jobs.scheduled_date < now) and no
--  report has been SEALED yet (no pi_report_seals row for the job), the Sentinel
--  chases the inspector — escalating over time and looping in operations:
--
--      Stage 1  (overdue ≥ 0h)   → inspector: "report due"
--      Stage 2  (overdue ≥ 24h)  → inspector + admins
--      Stage 3  (overdue ≥ 72h)  → inspector + admins, flagged "at-risk"
--
--  A ledger (report_reminders, unique per job+stage) makes every stage fire
--  exactly once. A 6-hourly pg_cron job runs the pure-SQL sweep (no external
--  call needed — it only reads jobs, writes the ledger, and calls nx_notify).
--  Reuses: jobs.scheduled_date / contractor_id, pi_report_seals (the seal IS the
--  "submitted" signal), nx_notify / nx_notify_admins. $0, all existing infra.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Escalation ledger ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_reminders (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id  uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  stage   smallint NOT NULL CHECK (stage BETWEEN 1 AND 3),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, stage)
);
CREATE INDEX IF NOT EXISTS report_reminders_job_idx ON public.report_reminders (job_id);

-- speed the sweep: only candidate jobs
CREATE INDEX IF NOT EXISTS jobs_overdue_candidate_idx
  ON public.jobs (scheduled_date)
  WHERE status IN ('assigned', 'in_progress') AND contractor_id IS NOT NULL;

ALTER TABLE public.report_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_reminders_read ON public.report_reminders;
CREATE POLICY report_reminders_read ON public.report_reminders FOR SELECT USING (
  public.nx_is_admin()
  OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = report_reminders.job_id AND j.contractor_id = auth.uid())
);
GRANT SELECT ON public.report_reminders TO authenticated;

-- ── 2) The sweep — escalate overdue reports (pure DB, idempotent) ────────────
CREATE OR REPLACE FUNCTION public.sweep_overdue_reports()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j           RECORD;
  v_overdue_h numeric;
  v_target    smallint;
  v_link      text;
  v_title     text;
  v_count     int := 0;
BEGIN
  FOR j IN
    SELECT jb.id, jb.title, jb.contractor_id, jb.scheduled_date
      FROM public.jobs jb
     WHERE jb.status IN ('assigned', 'in_progress')
       AND jb.contractor_id IS NOT NULL
       AND jb.scheduled_date IS NOT NULL
       AND jb.scheduled_date < now()
       AND NOT EXISTS (SELECT 1 FROM public.pi_report_seals s WHERE s.job_id = jb.id)
  LOOP
    v_overdue_h := EXTRACT(EPOCH FROM (now() - j.scheduled_date)) / 3600.0;
    v_target := CASE WHEN v_overdue_h >= 72 THEN 3 WHEN v_overdue_h >= 24 THEN 2 ELSE 1 END;

    -- already chased at this stage? skip (the ledger is the idempotency key)
    IF EXISTS (SELECT 1 FROM public.report_reminders r WHERE r.job_id = j.id AND r.stage = v_target) THEN
      CONTINUE;
    END IF;

    v_link  := '/jobs/' || j.id::text;
    v_title := coalesce(nullif(j.title, ''), 'an inspection');

    -- notifications never abort the sweep
    BEGIN
      IF v_target = 1 THEN
        PERFORM public.nx_notify(j.contractor_id, 'Report due',
          'Your inspection report for "' || v_title || '" is past its scheduled date. Please submit it.',
          'report_overdue', v_link, j.id);
      ELSIF v_target = 2 THEN
        PERFORM public.nx_notify(j.contractor_id, 'Report still outstanding',
          'Your report for "' || v_title || '" is more than 24h overdue. Please submit it as soon as possible.',
          'report_overdue', v_link, j.id);
        PERFORM public.nx_notify_admins('Report overdue 24h+',
          'Inspector report for "' || v_title || '" is more than 24h late.',
          'report_overdue_admin', v_link, j.id);
      ELSE
        PERFORM public.nx_notify(j.contractor_id, 'Final reminder — report overdue',
          'Your report for "' || v_title || '" is more than 72h overdue and has been escalated to NEXPEC operations.',
          'report_at_risk', v_link, j.id);
        PERFORM public.nx_notify_admins('At-risk report (72h+)',
          'Inspector has not submitted the report for "' || v_title || '". Please intervene.',
          'report_at_risk', v_link, j.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    INSERT INTO public.report_reminders (job_id, stage) VALUES (j.id, v_target)
      ON CONFLICT (job_id, stage) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.sweep_overdue_reports() FROM public;
GRANT EXECUTE ON FUNCTION public.sweep_overdue_reports() TO service_role;

-- ── 3) Admin read — "At-risk reports" KPI feed ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_overdue_reports()
RETURNS TABLE(job_id uuid, title text, inspector_id uuid, scheduled_date timestamptz, hours_overdue numeric, max_stage smallint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'not authorized' USING errcode = '42501'; END IF;
  RETURN QUERY
    SELECT jb.id, jb.title, jb.contractor_id, jb.scheduled_date,
           round((EXTRACT(EPOCH FROM (now() - jb.scheduled_date)) / 3600.0)::numeric, 1),
           (SELECT max(r.stage) FROM public.report_reminders r WHERE r.job_id = jb.id)
      FROM public.jobs jb
     WHERE jb.status IN ('assigned', 'in_progress')
       AND jb.contractor_id IS NOT NULL
       AND jb.scheduled_date IS NOT NULL
       AND jb.scheduled_date < now()
       AND NOT EXISTS (SELECT 1 FROM public.pi_report_seals s WHERE s.job_id = jb.id)
     ORDER BY jb.scheduled_date ASC;
END $$;

REVOKE ALL ON FUNCTION public.get_overdue_reports() FROM public;
GRANT EXECUTE ON FUNCTION public.get_overdue_reports() TO authenticated;

-- ── 4) Schedule the 6-hourly sweep (pg_cron, idempotent — mirrors FX scheduler)
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'nexpec-report-reminder-sweep';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule('nexpec-report-reminder-sweep', '0 */6 * * *', $cron$SELECT public.sweep_overdue_reports();$cron$);
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron not available here — schedule nexpec-report-reminder-sweep manually (every 6h: SELECT public.sweep_overdue_reports();).';
END $$;

-- ── 5) SELF-TEST (existence only — no side effects; the cron drives real sweeps)
DO $$
BEGIN
  IF to_regprocedure('public.sweep_overdue_reports()') IS NULL THEN RAISE EXCEPTION 'SELFTEST sweep missing'; END IF;
  IF to_regprocedure('public.get_overdue_reports()') IS NULL THEN RAISE EXCEPTION 'SELFTEST read missing'; END IF;
  IF to_regprocedure('public.nx_notify(uuid,text,text,text,text,uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST nx_notify missing'; END IF;
  RAISE NOTICE 'SLA Sentinel installed: ledger + escalating sweep + admin read + 6-hourly cron. First sweep runs on the next cron tick.';
END $$;

COMMIT;
