-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801368000_rollback.sql
--
--  Reverses 20260801368000 (dispute / integrity schema repair). LOCAL only.
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801368000_rollback.sql
--
--  ⚠ READ THIS BEFORE RUNNING IT.
--  20260801368000 is a BUG FIX for two live 42703 errors. Rolling it back
--  RESTORES BOTH DEFECTS: Predictive Integrity goes back to failing with
--  "column d.job_id does not exist", and filing a dispute from mobile fails
--  again. This script exists for completeness of the rollback set, not because
--  reverting is advisable.
--
--  It deliberately does NOT restore the broken function bodies. Re-installing
--  code that is known to raise 42703 on every call would be vandalism dressed
--  as a rollback. Instead it narrows the widened CHECK back to its original
--  vocabulary — the only schema change the migration made — and leaves the
--  repaired functions in place.
--
--  The narrowing is guarded: if any row already uses one of the added
--  categories, it ABORTS rather than silently deleting or rewriting that row.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.job_disputes
   WHERE reason_category IN ('scope', 'quality', 'payment');
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: % job_disputes row(s) use a category added by 20260801368000 '
      '(scope/quality/payment). Narrowing the CHECK would invalidate real user data. '
      'Re-categorise those rows first if you genuinely intend to revert.', v_n;
  END IF;
END
$guard$;

ALTER TABLE public.job_disputes
  DROP CONSTRAINT IF EXISTS job_disputes_reason_category_check;

ALTER TABLE public.job_disputes
  ADD CONSTRAINT job_disputes_reason_category_check
  CHECK (reason_category = ANY (ARRAY[
    'inspection_quality','no_show','incomplete_work','pricing',
    'communication','safety','other'
  ]));

DO $verify$
BEGIN
  IF to_regclass('public.disputes') IS NULL OR to_regclass('public.job_disputes') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a dispute table is missing';
  END IF;
  IF to_regprocedure('public.file_dispute(uuid,text,text)') IS NULL
     OR to_regprocedure('public.inspector_integrity_analytics(integer)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a repaired function is missing';
  END IF;
  RAISE NOTICE 'rollback complete: CHECK narrowed. The 42703 REPAIRS WERE INTENTIONALLY KEPT.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
