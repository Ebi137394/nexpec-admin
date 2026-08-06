-- ════════════════════════════════════════════════════════════════════════════
--  20260801314000_revoke_remaining_unguarded_definer_rpcs.sql
--
--  Completes the sweep begun in 308000. Selection criteria, applied
--  mechanically across every migration: SECURITY DEFINER, non-trigger, GRANTed
--  to anon and/or authenticated, takes a caller-supplied uuid, WRITES to a
--  money / notification / contract / job / application / permission table, and
--  contains NO auth.uid(), nx_is_admin() or equivalent authorization check.
--
--  Seven functions matched. All are internal plumbing invoked from other
--  SECURITY DEFINER functions or from Edge Functions — none needs to be
--  callable straight off the public API.
--
--    create_system_notification  arbitrary recipient + attacker-controlled body
--    enqueue_notification        same, plus it can force an EMAIL send
--    generate_contract_for_job   manufactures a contract for ANY job id
--    recompute_reputation        rewrites any user's reputation
--    mark_notification_email_sent / _failed   flips delivery state on ANY
--                                notification id (used by the email Edge
--                                Function, which runs as service_role)
--    nx_notify                   arbitrary recipient + arbitrary title/body
--
--  ── APPROACH: privilege only, logic untouched ───────────────────────────────
--  No function body is modified. Internal composition is unaffected: these are
--  called as `PERFORM public.fn(...)` from other SECURITY DEFINER functions,
--  which execute as their OWNER (postgres), and EXECUTE privilege is checked
--  against the effective user. service_role keeps EXECUTE throughout, so the
--  notification Edge Function keeps working.
--
--  ── TIER B — nx_notify ──────────────────────────────────────────────────────
--  src/utils/notificationUtils.ts calls nx_notify directly from the client, so
--  removing `authenticated` would break a live path. anon is revoked here.
--  nx_notify therefore REMAINS an unsolicited-notification primitive for any
--  logged-in user, and is reported as a KNOWN REMAINING ISSUE rather than
--  silently marked fixed: closing it needs a recipient-relationship rule plus a
--  rewrite of that call site, which is a behaviour change, not a grant change.
--
--  Idempotent; self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── TIER A — zero live app callers: revoke from both public roles ──────────
REVOKE ALL ON FUNCTION public.create_system_notification(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, uuid, boolean, text, jsonb)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.generate_contract_for_job(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.recompute_reputation(uuid)
  FROM PUBLIC, anon, authenticated;

-- Email delivery state. The email sender runs as service_role, which is
-- unaffected; the browser has no reason to flip a notification's delivery flag.
REVOKE ALL ON FUNCTION public.mark_notification_email_sent(uuid, text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mark_notification_email_failed(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── TIER B — live caller exists: anon only ─────────────────────────────────
REVOKE ALL ON FUNCTION public.nx_notify(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon;

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_sig  text;
  v_fail text := '';
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.create_system_notification(uuid,text,text,text,text,uuid)',
    'public.enqueue_notification(uuid,text,text,text,text,uuid,boolean,text,jsonb)',
    'public.generate_contract_for_job(uuid)',
    'public.recompute_reputation(uuid)',
    'public.mark_notification_email_sent(uuid,text)',
    'public.mark_notification_email_failed(uuid,text)'
  ] LOOP
    BEGIN
      IF has_function_privilege('anon', v_sig, 'EXECUTE')
         OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
        v_fail := v_fail || v_sig || ' still executable; ';
      END IF;
      IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
        v_fail := v_fail || v_sig || ' lost service_role; ';
      END IF;
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skipped (signature not present here): %', v_sig;
    END;
  END LOOP;

  BEGIN
    IF has_function_privilege('anon','public.nx_notify(uuid,text,text,text,text,uuid)','EXECUTE') THEN
      v_fail := v_fail || 'nx_notify still executable by anon; ';
    END IF;
    IF NOT has_function_privilege('authenticated','public.nx_notify(uuid,text,text,text,text,uuid)','EXECUTE') THEN
      v_fail := v_fail || 'nx_notify lost authenticated — notificationUtils.ts would break; ';
    END IF;
  EXCEPTION WHEN undefined_function THEN NULL;
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: %', v_fail;
  END IF;
  RAISE NOTICE 'remaining unguarded SECURITY DEFINER RPCs are off the public API; service_role and internal callers unaffected.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
