-- ════════════════════════════════════════════════════════════════════════════
--  20260801122500_turnkey_concurrency_hardening.sql
--
--  RACE FIX — one inspection job per RFQ, enforced by the database.
--
--  _spawn_inspection_for_award() and award_quote() both read the RFQ row WITHOUT
--  a lock and gate on `spawned_job_id IS NULL`. Two concurrent awards on the same
--  RFQ (e.g. two admins brokering at once) can both pass the gate and spawn TWO
--  source/FAT jobs — a duplicate dispatch. Rather than rewrite the trigger, we
--  make the invariant impossible to violate at the storage layer: a UNIQUE
--  partial index on jobs.source_rfq_id. If a race occurs, the loser's INSERT
--  fails and that award transaction rolls back cleanly — exactly one job remains.
--
--  The old non-unique lookup index is replaced (a unique index also serves the
--  award_quote `WHERE source_rfq_id = …` lookup).
--
--  NOTE: if this CREATE fails with a uniqueness violation, the live DB already
--  has >1 job for some RFQ (from a prior race) — dedupe those rows first, then
--  re-run. On a fresh feature there are none.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP INDEX IF EXISTS public.jobs_source_rfq_idx;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_inspection_per_rfq
  ON public.jobs (source_rfq_id)
  WHERE source_rfq_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='jobs_one_inspection_per_rfq') THEN
    RAISE EXCEPTION 'SELFTEST jobs_one_inspection_per_rfq missing'; END IF;
  RAISE NOTICE 'Turnkey hardened: at most one source/FAT inspection job per RFQ (double-spawn race closed).';
END $$;

COMMIT;
