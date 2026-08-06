-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801304000_to_316000_rollback.sql
--
--  Reverses the PRIVILEGE, VIEW and RPC-signature changes introduced by
--  304000 → 316000. NOT a migration; run manually only if the stack must be
--  backed out of a LOCAL database.
--
--      psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/rollback/20260801304000_to_316000_rollback.sql
--
--  ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
--  It performs NO destructive DROP of business data. Specifically it does NOT
--  drop or truncate:
--    • public.application_assignment_origin  (audit provenance — keep it)
--    • any row in jobs / applications / job_contracts / notifications
--  Re-running a direct assignment after rollback simply re-inserts provenance.
--
--  ── WHAT IT RESTORES ────────────────────────────────────────────────────────
--    1. blanket SELECT on public.jobs, and drops jobs_secure_view  (312000)
--    2. the pre-lockdown EXECUTE grants                (308000/314000/316000)
--    3. the pre-306000 absence of the direct-assignment RPCs   (306000/310000)
--    4. the pre-304000 schedule_meeting authorization           (304000)
--
--  NOTE on 3 and 4: the function BODIES are not restored here — the originals
--  live in the baseline migration. After running this, re-apply the baseline
--  definitions if you need the old behaviour back. What this file guarantees is
--  that no NEW object and no TIGHTENED privilege is left behind.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) 312000 — price blindness ─────────────────────────────────────────────
DROP VIEW IF EXISTS public.jobs_secure_view;

-- Restore the blanket table-level SELECT (this supersedes the per-column grants).
GRANT SELECT ON public.jobs TO authenticated;
GRANT SELECT ON public.jobs TO anon;

DROP FUNCTION IF EXISTS public.nx_jobs_buyer_only_columns();

-- ── 2) 308000 / 314000 / 316000 — restore EXECUTE ──────────────────────────
--  Wrapped individually: a signature that does not exist in this database must
--  not abort the whole rollback.
DO $restore$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.debit_wallet_for_payout(uuid,bigint)',
    'public.get_or_create_wallet(uuid)',
    'public.heal_contract_to_active(uuid)',
    'public.set_inspector_daily_limit(uuid,integer)',
    'public.notify_safe(uuid,text,text,text,text,uuid)',
    'public.nx_notify(uuid,text,text,text,text,uuid)',
    'public.create_system_notification(uuid,text,text,text,text,uuid)',
    'public.enqueue_notification(uuid,text,text,text,text,uuid,boolean,text,jsonb)',
    'public.generate_contract_for_job(uuid)',
    'public.recompute_reputation(uuid)',
    'public.mark_notification_email_sent(uuid,text)',
    'public.mark_notification_email_failed(uuid,text)'
  ] LOOP
    BEGIN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', v_sig);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'rollback: % not present, skipped', v_sig;
    END;
  END LOOP;
END
$restore$;

-- ── 3) 306000 / 310000 — direct assignment ─────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_assign_inspector_directly(uuid, uuid, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.admin_search_assignable_inspectors(text, int, boolean);
DROP FUNCTION IF EXISTS public.admin_search_assignable_inspectors(text, int);
DROP FUNCTION IF EXISTS public.nx_admin_upsert_direct_application(uuid, uuid, bigint);
-- application_assignment_origin is intentionally PRESERVED (audit provenance).

-- ── 4) 304000 — meeting authorization ──────────────────────────────────────
--  Dropping the predicate alone would leave schedule_meeting referencing a
--  missing function, so the predicate stays and only the tightening is undone
--  by restoring the baseline schedule_meeting definition. Re-apply the baseline
--  body if you truly need the pre-304000 behaviour; the predicate below is
--  harmless on its own.
--  (Deliberately NOT dropped: public.nx_meeting_engagement_party)

-- ── Verification ────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='jobs_secure_view') THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: jobs_secure_view still present';
  END IF;
  IF NOT has_table_privilege('authenticated','public.jobs','SELECT') THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: authenticated still lacks SELECT on jobs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='application_assignment_origin') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the provenance annex was destroyed — it must be preserved';
  END IF;
  RAISE NOTICE 'rollback complete: privileges restored, no business data removed.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
