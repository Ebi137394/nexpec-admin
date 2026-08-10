-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801378000_rollback.sql
--
--  Reverses 20260801378000 (team evidence + report contribution). LOCAL only.
--
--  Drops only what the migration added: the two additional capture policies,
--  the two inspection_items policies, the contributor function, the team-member
--  helper, and the inspection_items.inspector_id column.
--
--  ⚠ Dropping inspector_id LOSES per-member attribution on existing items. The
--  items themselves are NOT deleted — they revert to the pre-migration meaning
--  of "recorded by the report's inspector", which is exactly what they meant
--  before. The guard below aborts if any row carries real attribution, so that
--  information cannot be discarded silently.
--
--  The pre-existing contractor policies and the RESTRICTIVE active-contract
--  policy from 20260801288000 are NOT touched by either direction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='inspection_items'
                AND column_name='inspector_id') THEN
    SELECT count(*) INTO v_n FROM public.inspection_items WHERE inspector_id IS NOT NULL;
    IF v_n > 0 AND coalesce(current_setting('nexpec.force_drop_attribution', true),'') <> '1' THEN
      RAISE EXCEPTION
        'ROLLBACK ABORTED: % inspection item(s) carry per-inspector attribution. '
        'Dropping the column discards who recorded them. Set '
        'nexpec.force_drop_attribution=1 if that is genuinely intended.', v_n;
    END IF;
  END IF;
END
$guard$;

DROP POLICY IF EXISTS captures_insert_team_member  ON public.inspection_captures;
DROP POLICY IF EXISTS captures_read_team_member    ON public.inspection_captures;
DROP POLICY IF EXISTS inspection_items_team_read   ON public.inspection_items;
DROP POLICY IF EXISTS inspection_items_team_write  ON public.inspection_items;

DROP FUNCTION IF EXISTS public.nx_report_contributors(uuid);

DROP INDEX IF EXISTS public.inspection_items_inspector_idx;
ALTER TABLE public.inspection_items DROP COLUMN IF EXISTS inspector_id;

-- Dropped last: the capture policies above referenced it.
DROP FUNCTION IF EXISTS public.nx_is_active_job_team_member(uuid, uuid);

DO $verify$
BEGIN
  -- what the migration widened must still be present in its original form
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='inspection_captures'
                  AND policyname='captures_insert_inspector_self') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the original contractor capture policy is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='inspection_captures'
                  AND policyname='captures_update_requires_active_inspector') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the RESTRICTIVE active-contract policy is missing';
  END IF;
  IF to_regclass('public.inspection_items') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: inspection_items is missing';
  END IF;
  RAISE NOTICE 'rollback complete: team widening removed; contractor rules and 288000 intact.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
