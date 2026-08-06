-- ════════════════════════════════════════════════════════════════════════════
--  20260801316000_nx_notify_lockdown.sql
--
--  FINAL item of the SECURITY DEFINER sweep (308000 → 314000 → this).
--
--  public.nx_notify(p_recipient, p_title, p_body, p_kind, p_link, p_job_id) is
--  SECURITY DEFINER, writes public.notifications, bumps
--  profiles.unread_notifications_count, and performs NO authorization. While it
--  was granted to `authenticated`, any logged-in user could send any other user
--  a notification with attacker-chosen title and body — an unsolicited-message
--  and phishing primitive, reachable straight off PostgREST:
--      POST /rest/v1/rpc/nx_notify {"p_recipient":"<anyone>","p_title":"…"}
--
--  308000 removed `anon`. `authenticated` had to stay at that point because
--  src/utils/notificationUtils.ts::createNotification() called it.
--
--  ── WHY IT CAN NOW BE REMOVED OUTRIGHT ──────────────────────────────────────
--  That wrapper turned out to be DEAD CODE — a legacy compatibility shim with
--  zero call sites anywhere in the mobile app, the web app or the Edge
--  Functions, and it was the ONLY application-code caller of nx_notify. It has
--  been deleted in the same change set.
--
--  So EXECUTE is revoked from anon AND authenticated with no loss of function:
--  every legitimate notification in the product is emitted by database triggers
--  (tg_notify_jobs, tg_notify_applications, …) and by other SECURITY DEFINER
--  functions (schedule_meeting, admin_forward_application_to_client, …). Those
--  run as their OWNER (postgres), and EXECUTE privilege is checked against the
--  effective user — so internal composition is completely unaffected.
--  service_role keeps EXECUTE for Edge Functions.
--
--  The function body is NOT modified. This is a privilege change only.
--
--  If a browser-initiated notification is ever needed again, the correct shape
--  is a domain-specific RPC that DERIVES the recipient from the engagement
--  (job/RFQ/org membership) — never a generic "notify this uuid".
--
--  Idempotent; self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.nx_notify(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- Belt and braces: notify_safe is the sibling primitive (308000 already revoked
-- it); re-assert here so the two can never drift apart.
REVOKE ALL ON FUNCTION public.notify_safe(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

DO $test$
DECLARE
  v_fail text := '';
  v_sig  text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.nx_notify(uuid,text,text,text,text,uuid)',
    'public.notify_safe(uuid,text,text,text,text,uuid)'
  ] LOOP
    BEGIN
      IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
        v_fail := v_fail || v_sig || ' executable by anon; ';
      END IF;
      IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
        v_fail := v_fail || v_sig || ' executable by authenticated; ';
      END IF;
      IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
        v_fail := v_fail || v_sig || ' lost service_role; ';
      END IF;
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skipped (signature not present): %', v_sig;
    END;
  END LOOP;

  -- The trigger path MUST still exist, or approvals would emit no notification
  -- at all — the opposite failure mode.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'jobs' AND c.relnamespace = 'public'::regnamespace
       AND t.tgname = 'trg_notify_jobs' AND t.tgenabled <> 'D'
  ) THEN
    v_fail := v_fail || 'trg_notify_jobs missing/disabled — legitimate notifications would stop; ';
  END IF;

  IF v_fail <> '' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: %', v_fail;
  END IF;
  RAISE NOTICE 'nx_notify/notify_safe are internal-only; trigger-based notifications intact.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
