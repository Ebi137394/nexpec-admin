-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801388000_rollback.sql
--
--  Reverses 20260801388000 (visit-scoped evidence). LOCAL only.
--
--  Drops the four evidence guards, the two authorisation helpers, the active-
--  visit resolver and the visit-aware evidence reader.
--
--  EFFECT: inspection_captures.visit_id and inspection_items.visit_id REMAIN
--  (they belong to 20260801384000) and every row keeps the value it holds. What
--  is lost is the enforcement: nothing then prevents a capture from being
--  stamped with another job's visit, and the field wizard's
--  nx_job_active_visit_for call degrades to a caught error, which leaves
--  visit_id NULL — the pre-existing job-level behaviour. Nothing breaks.
--
--  NO DATA IS MODIFIED. No visit attribution is erased, no seal is touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TRIGGER IF EXISTS trg_guard_capture_visit_ins ON public.inspection_captures;
DROP TRIGGER IF EXISTS trg_guard_capture_visit_upd ON public.inspection_captures;
DROP TRIGGER IF EXISTS trg_guard_item_visit_ins    ON public.inspection_items;
DROP TRIGGER IF EXISTS trg_guard_item_visit_upd    ON public.inspection_items;

DROP FUNCTION IF EXISTS public.tg_guard_capture_visit();
DROP FUNCTION IF EXISTS public.tg_guard_item_visit();
DROP FUNCTION IF EXISTS public.nx_visit_evidence_summary(uuid);
DROP FUNCTION IF EXISTS public.nx_job_active_visit_for(uuid, uuid);

-- Dropped last: the guards above referenced them.
DROP FUNCTION IF EXISTS public.nx_can_record_visit_work(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_visit_job_id(uuid);

DROP INDEX IF EXISTS public.inspection_captures_job_visit_idx;

DO $verify$
BEGIN
  -- The columns are 384000's and must survive the rollback untouched.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_captures'
                    AND column_name='visit_id') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: inspection_captures.visit_id was removed — that column belongs to 20260801384000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_items'
                    AND column_name='visit_id') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: inspection_items.visit_id was removed — that column belongs to 20260801384000';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE NOT t.tgisinternal
                AND t.tgname IN ('trg_guard_capture_visit_ins','trg_guard_capture_visit_upd',
                                 'trg_guard_item_visit_ins','trg_guard_item_visit_upd')) THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: a visit evidence guard is still installed';
  END IF;
  IF to_regprocedure('public.nx_job_active_visit_for(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the active-visit resolver is still present';
  END IF;

  -- What earlier phases own must be intact.
  IF to_regprocedure('public.nx_job_visits(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the canonical visit reader was disturbed';
  END IF;
  IF to_regprocedure('public.nx_is_active_job_team_member(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the job-team predicate was disturbed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='inspection_captures'
                  AND policyname='captures_insert_team_member') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the team capture policy from 20260801378000 is missing';
  END IF;

  RAISE NOTICE 'rollback complete: visit evidence guards removed; visit_id columns, attribution and seals untouched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
