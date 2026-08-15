-- ════════════════════════════════════════════════════════════════════════════
--  20260801520000_cron_kickoff_no_hardcoded_prod_url_or_secret.sql
--
--  P1 — two SECURITY DEFINER cron functions hardcode the PRODUCTION project URL
--  and a plaintext shared secret that is committed to this repository.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  public.cron_kickoff_email_dispatch() and public.cron_kickoff_fx_refresh(),
--  both defined in 00000000000000_remote_baseline.sql and never replaced since,
--  each open with:
--
--      v_base_url    text := 'https://sxqpjxhslzzcdrdctatm.supabase.co';
--      v_cron_secret text := 'nexpec-super-secret-cron-key-2026';
--
--  That is the Production project ref and a literal bearer token, in tracked
--  source. Two distinct failures follow.
--
--  1. CROSS-ENVIRONMENT CALL. The URL is absolute and environment-independent,
--     so these functions call PRODUCTION no matter which database they run in.
--     Scheduled on Staging, cron_kickoff_email_dispatch() POSTs to PRODUCTION's
--     /functions/v1/dispatch-notification-emails and drains the PRODUCTION
--     notification queue — real mail, sent to real people, triggered by a
--     staging database. cron_kickoff_fx_refresh() likewise writes its
--     fx_refresh_runs row locally and then kicks PRODUCTION's refresh.
--
--  2. COMMITTED CREDENTIAL. Both target functions are declared
--     `verify_jwt = false` in supabase/config.toml because they authenticate by
--     shared secret instead:
--
--         const callerAuthorised = bearer === serviceRoleKey ||
--                                  (cronSecret && bearer === cronSecret);
--
--     so CRON_SECRET *is* the entire authentication for two unauthenticated
--     public endpoints. If the deployed CRON_SECRET equals the literal above,
--     anyone with read access to this repository can drain the notification
--     queue and trigger FX refreshes on Production at will. If it does NOT
--     equal it, then the kickoffs have been getting 401 and email dispatch has
--     silently never run. There is no third possibility: the hardcoding is a
--     defect under either value.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Resolve both values at call time, per environment, and FAIL CLOSED.
--
--    • Base URL  ← public._app_config_get('functions_base_url'), falling back
--      to current_setting('app.settings.supabase_url', true), which
--      trigger_certification_check already uses.
--    • Secret    ← vault.decrypted_secrets WHERE name = 'cron_secret'.
--
--  WHY THE SECRET IS NOT IN _app_config. public._app_config_get is SECURITY
--  DEFINER with EXECUTE granted to anon and authenticated. Putting the cron
--  secret there would let any anonymous caller read it with a single RPC —
--  strictly worse than the defect being fixed. vault.decrypted_secrets is
--  SELECT-able only by postgres and service_role, and these functions are
--  SECURITY DEFINER owned by postgres, so they can read it while no caller can.
--
--  FAIL CLOSED IS THE POINT. When either value is unconfigured the function
--  RAISEs a WARNING and returns without calling anything. It deliberately does
--  NOT fall back to a default host — a fallback host is exactly how a staging
--  database ends up calling Production, which is the bug. An unconfigured
--  environment does nothing, loudly.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • The queue predicate, the batch semantics, the fx_refresh_runs bookkeeping
--     and the request_id write-back are all byte-for-byte as before.
--   • Timeouts stay 60000 / 30000 ms respectively.
--   • The EXCEPTION WHEN OTHERS ... RAISE NOTICE tail is preserved, so a cron
--     tick still cannot abort on a transport error.
--   • No grant, RLS policy, funding rule or money path is touched.
--
--  ── OWNER ACTION REQUIRED, AND NOT PERFORMABLE FROM HERE ───────────────────
--  The literal 'nexpec-super-secret-cron-key-2026' is in this repository's git
--  history and cannot be unpublished. Removing it from HEAD does not revoke it.
--  The deployed CRON_SECRET must be ROTATED on each environment, and the new
--  value stored in that environment's vault as 'cron_secret'. Rotating the
--  Production value requires Production credentials, which this change set is
--  not authorised to touch.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Notification email dispatch kickoff ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.cron_kickoff_email_dispatch() RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_base_url    text;
  v_cron_secret text;
  v_pending     int;
BEGIN
  SELECT count(*) INTO v_pending
    FROM public.notifications
   WHERE email_required = true
     AND email_dispatched_at IS NULL
     AND email_attempts < 5;

  IF v_pending = 0 THEN
    RETURN;
  END IF;

  -- Per-environment configuration. No hardcoded host, no hardcoded secret.
  v_base_url := COALESCE(
    NULLIF(public._app_config_get('functions_base_url'), ''),
    NULLIF(current_setting('app.settings.supabase_url', true), '')
  );
  SELECT NULLIF(decrypted_secret, '') INTO v_cron_secret
    FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

  -- Fail closed. Calling a default host from an unconfigured database is the
  -- exact failure this migration exists to remove.
  IF v_base_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE WARNING 'cron_kickoff_email_dispatch: unconfigured (base_url=%, cron_secret=%) — refusing to dispatch %  pending notification(s).',
      (v_base_url IS NOT NULL), (v_cron_secret IS NOT NULL), v_pending;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_base_url || '/functions/v1/dispatch-notification-emails',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_cron_secret
               ),
    body    := jsonb_build_object(
                 'triggered_by', 'pg_cron',
                 'triggered_at', now(),
                 'pending_estimate', v_pending
               ),
    timeout_milliseconds := 60000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron_kickoff_email_dispatch: %', SQLERRM;
END
$fn$;

ALTER FUNCTION public.cron_kickoff_email_dispatch() OWNER TO postgres;

COMMENT ON FUNCTION public.cron_kickoff_email_dispatch() IS
  'pg_cron kickoff for the notification email drain. Base URL from _app_config.functions_base_url (or app.settings.supabase_url); bearer from vault secret "cron_secret". Fails closed when either is unset — it must never fall back to a default host, because an absolute default is how a staging database ends up mailing Production users.';

-- ── 2) FX rate refresh kickoff ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cron_kickoff_fx_refresh() RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_base_url    text;
  v_cron_secret text;
  v_run_id      uuid := gen_random_uuid();
  v_request_id  bigint;
BEGIN
  v_base_url := COALESCE(
    NULLIF(public._app_config_get('functions_base_url'), ''),
    NULLIF(current_setting('app.settings.supabase_url', true), '')
  );
  SELECT NULLIF(decrypted_secret, '') INTO v_cron_secret
    FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

  -- Checked BEFORE the bookkeeping row is written, so an unconfigured
  -- environment does not accumulate fx_refresh_runs rows for calls that were
  -- never made.
  IF v_base_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE WARNING 'cron_kickoff_fx_refresh: unconfigured (base_url=%, cron_secret=%) — refusing to call.',
      (v_base_url IS NOT NULL), (v_cron_secret IS NOT NULL);
    RETURN;
  END IF;

  INSERT INTO public.fx_refresh_runs (id, source, cron_jobid)
       VALUES (v_run_id, 'openexchangerates', NULLIF(current_setting('cron.job_id', true), '')::bigint);

  SELECT net.http_post(
    url     := v_base_url || '/functions/v1/refresh-fx-rates',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_cron_secret
               ),
    body    := jsonb_build_object(
                 'run_id', v_run_id,
                 'triggered_by', 'pg_cron',
                 'triggered_at', now()
               ),
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  UPDATE public.fx_refresh_runs
     SET request_id = v_request_id
   WHERE id = v_run_id;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron_kickoff_fx_refresh: %', SQLERRM;
END
$fn$;

ALTER FUNCTION public.cron_kickoff_fx_refresh() OWNER TO postgres;

COMMENT ON FUNCTION public.cron_kickoff_fx_refresh() IS
  'pg_cron kickoff for the FX rate refresh. Same per-environment resolution and fail-closed rule as cron_kickoff_email_dispatch. The fx_refresh_runs bookkeeping row is written only once configuration has resolved, so an unconfigured environment records no phantom runs.';

-- ── 3) Self-test — the migration fails the deploy if the literals survive ────
--  Asserted against pg_get_functiondef of the LIVE functions, not against this
--  file's text, so a later migration re-introducing either literal is caught by
--  the pgTAP suite added alongside this change.
DO $$
DECLARE
  v_bad int;
  v_names text;
BEGIN
  SELECT count(*), string_agg(p.proname, ', ')
    INTO v_bad, v_names
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) ~ 'sxqpjxhslzzcdrdctatm|nexpec-super-secret-cron-key-2026';

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'CRON_HARDCODE_REMAINS: % function(s) still embed the Production ref or the leaked cron secret: %',
      v_bad, v_names;
  END IF;

  RAISE NOTICE 'ok: no public function embeds the Production project ref or the leaked cron secret.';
END $$;

COMMIT;
