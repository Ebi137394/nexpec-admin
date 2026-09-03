-- ════════════════════════════════════════════════════════════════════════════
--  Least privilege for the Telegram/admin function surface
--
--  FOUND BY THE ADVERSARIAL PASS ON MY OWN WORK. PostgreSQL grants EXECUTE on
--  every new function to PUBLIC, so `anon` — an unauthenticated caller holding
--  only the publishable key — could invoke SECURITY DEFINER helpers added in
--  migrations 604000-614000. cron_kickoff_email_dispatch() was already locked
--  down correctly; the newer functions simply did not repeat that REVOKE.
--
--  Worst case closed here:
--    · notify_inspectors_about_existing_job(uuid) — SECURITY DEFINER with NO
--      authorization check of its own. Any caller could fan out "New job
--      available" notifications to every eligible inspector, for any job id.
--    · cron_kickoff_telegram_dispatch(), tg_send_daily_brief() — unauthenticated
--      callers could drive the dispatcher and manufacture admin notifications.
--    · tg_consume_action_token() — an unauthenticated caller could burn an
--      admin's pending confirmation token.
--
--  Triggers are unaffected: PostgreSQL does not check EXECUTE on a trigger
--  function when the trigger fires, so revoking from PUBLIC cannot stop
--  notification routing, signup, job creation or approval. Verified before
--  writing this: `severity` is a plain column (not GENERATED), and no view,
--  index expression or CHECK constraint references any function touched here.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Internal only: cron, triggers and helpers with no client caller ────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.cron_kickoff_telegram_dispatch()',
    'public.tg_send_daily_brief()',
    'public.tg_route_notification()',
    'public.tg_notify_admins_new_user()',
    'public.tg_job_profile_completion_nudge()',
    'public.notify_inspectors_on_job_approved()',
    'public.tg_should_route_to_telegram(text)',
    'public.nx_notification_severity(text, text)',
    'public.nx_inspector_can_discover_job(uuid, uuid)',
    'public.nx_send_profile_completion_nudge(uuid, uuid, text, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- ── 2 · Edge-function surface: service role only ───────────────────────────
REVOKE ALL ON FUNCTION public.tg_consume_action_token(text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_consume_action_token(text, bigint) TO service_role;

REVOKE ALL ON FUNCTION public.tg_consume_bootstrap(text, bigint, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_consume_bootstrap(text, bigint, bigint, text) TO service_role;

-- ── 3 · Real client callers keep `authenticated`, lose `anon` ──────────────
--  nx_profile_missing_fields is called directly by the web admin console
--  (lib/data/jobsModeration.ts) and indirectly by five SECURITY DEFINER
--  helpers. Only the anon grant is removed. Its body is deliberately NOT
--  changed: it participates in the signup trigger path, and the owner's
--  standing constraint is that signup must not break. The residual exposure —
--  an authenticated user could learn WHICH profile fields another user has
--  left blank, never their values — is reported rather than silently traded
--  against that risk.
REVOKE ALL ON FUNCTION public.nx_profile_missing_fields(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_profile_missing_fields(uuid) TO authenticated, service_role;

-- notify_inspectors_about_existing_job IS called by clients: the admin
-- diagnostics screen on web and in the released mobile app. It therefore keeps
-- `authenticated` and instead gains the authorization check it never had.
-- A NULL auth.uid() (service role, internal maintenance) is still allowed;
-- anon cannot reach it at all after the REVOKE below.
CREATE OR REPLACE FUNCTION public.notify_inspectors_about_existing_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r       RECORD;
  v_title text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'notify_inspectors_about_existing_job is an admin action'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(title, ''), 'New inspection') INTO v_title
    FROM public.jobs WHERE id = p_job_id;

  FOR r IN
    SELECT p.id
      FROM public.profiles p
     WHERE p.role IN ('inspector', 'senior')
       -- Was: every inspector, unconditionally. Now the same rule the feed uses.
       AND public.nx_inspector_can_discover_job(p_job_id, p.id)
  LOOP
    BEGIN
      PERFORM public.notify_safe(
        r.id, 'assignment', 'New job available', v_title,
        -- link_href is retained for the web console. The released mobile app
        -- deliberately ignores it and routes by job_id (app/notifications.tsx),
        -- so this value cannot change mobile behaviour either way.
        '/admin/jobs/' || p_job_id::text, p_job_id);
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- already notified about this job; the index did its job
    END;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.notify_inspectors_about_existing_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_inspectors_about_existing_job(uuid)
  TO authenticated, service_role;

-- ── 4 · Read models stay admin-reachable, never anonymous ──────────────────
REVOKE ALL ON FUNCTION public.tg_admin_status()    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_admin_status()    TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_attention_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_attention_queue() TO authenticated, service_role;
