-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801352000_brokered_engagement_no_silent_reassign
--
--  ⚠ THIS RE-OPENS A REACHABLE DATA-CORRUPTION PATH. Without the guard,
--  _brokered_create_engagement (via admin_assign_inspector, the
--  algorithmic_match wrapper, or the client_selection wrapper) can again leave
--  agreement = OLD inspector while jobs.contractor_id and
--  inspector_engagement_meta point at a NEW one. release_inspector_payout pays
--  the agreement's counterparty, so that split also splits money from access.
--
--  nx_is_current_job_inspector (350000) still FAILS CLOSED on such a state, so
--  chat and media stay safe; the corruption becomes silent rather than
--  exploitable. Roll back only if the guard is blocking a legitimate operation
--  that has no supersession path yet.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TRIGGER  IF EXISTS trg_engagement_meta_reject_reassign ON public.inspector_engagement_meta;
DROP FUNCTION IF EXISTS public.tg_engagement_meta_reject_reassign();
DROP FUNCTION IF EXISTS public.nx_brokered_engagement_conflict(uuid, uuid);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname = 'trg_engagement_meta_reject_reassign' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the re-assignment guard survived';
  END IF;
  -- Not this rollback's to remove.
  IF to_regprocedure('public.nx_is_current_job_inspector(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: it removed the engagement-aware helper';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_job_contracts_reject_brokered_job' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: it removed the brokered job_contracts guard';
  END IF;
  RAISE WARNING '352000 rolled back — post-execution brokered re-assignment can silently split-brain again.';
END
$verify$;

COMMIT;
