-- ════════════════════════════════════════════════════════════════════════════
--  20260608120000_fx_cron_scheduler.sql
--
--  Live FX-rate refresh cron — production scheduler.
--
--  This migration wires up the daily FX-rate refresh job by:
--
--    1) Ensuring pg_cron + pg_net are enabled (Supabase ships them but
--       they need to be explicitly created in the `extensions` schema).
--
--    2) Adding `cron_upsert_fx_rate(...)` — a SERVICE-ROLE-callable
--       sibling of the existing `upsert_fx_rate(...)` that does NOT
--       require an authenticated user. The Edge Function `refresh-fx-rates`
--       calls this with its service-role key after fetching live rates
--       from OpenExchangeRates.
--
--    3) Scheduling two pg_cron jobs:
--         • daily 06:05 UTC  → invoke `refresh-fx-rates` Edge Function
--         • every 5 minutes  → invoke `dispatch-notification-emails`
--                              Edge Function (drains the email queue)
--
--  CONFIGURATION REQUIRED (one-time, by the Platform Owner):
--    The cron jobs read the project URL and the cron secret from
--    runtime settings. Run these once per environment:
--
--      ALTER DATABASE postgres SET app.settings.supabase_url
--        = 'https://YOUR-PROJECT-REF.supabase.co';
--      ALTER DATABASE postgres SET app.settings.cron_secret
--        = 'a-long-random-shared-secret';
--
--    Then redeploy `refresh-fx-rates` and `dispatch-notification-emails`
--    with the same value in the CRON_SECRET env var so the function can
--    authenticate the call.
--
--  HOW THE LIVE FX REFRESH WORKS END-TO-END:
--    pg_cron (06:05 UTC) → pg_net.http_post → /functions/v1/refresh-fx-rates
--      → fetch OpenExchangeRates latest/?app_id=...&base=USD
--      → for each supported currency: POST /rpc/cron_upsert_fx_rate
--      → INSERT/UPDATE fx_rates rows for `today` with source='openexchangerates'
--    All running budget rollups pick the new rates up at read time —
--    no further code changes needed downstream.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Enable required extensions. pg_cron must live in its own schema.
-- ─────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────────────
-- 2) cron_upsert_fx_rate — service-role-callable rate writer.
--
--    The existing `upsert_fx_rate(...)` requires auth.uid() AND
--    super_admin role — perfect for a human in the SQL editor, useless
--    for a cron-triggered Edge Function running with the service role
--    (which has no auth.uid()).
--
--    This sibling skips the auth check (it's locked down via REVOKE
--    instead — only the service role can call it), validates inputs
--    just as strictly, and tags rows with `source` so manual entries
--    stay distinguishable from cron entries.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cron_upsert_fx_rate(
  p_base_currency   text,
  p_quote_currency  text,
  p_rate            numeric,
  p_effective_date  date DEFAULT current_date,
  p_source          text DEFAULT 'openexchangerates'
) RETURNS public.fx_rates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_base  public.currency_code;
  v_quote public.currency_code;
  v_row   public.fx_rates;
BEGIN
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'rate must be positive, got %', p_rate
      USING ERRCODE = '22023';
  END IF;

  -- Defensive enum casting.
  BEGIN
    v_base  := upper(p_base_currency)::public.currency_code;
    v_quote := upper(p_quote_currency)::public.currency_code;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'unsupported currency pair: % → %', p_base_currency, p_quote_currency
      USING ERRCODE = '22023';
  END;

  -- Self-pair is always identity, and the table CHECK enforces this.
  IF v_base = v_quote AND p_rate <> 1 THEN
    RAISE EXCEPTION 'self-pair rate must be 1.0, got %', p_rate
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.fx_rates (
    base_currency,
    quote_currency,
    rate,
    effective_date,
    source
  )
  VALUES (
    v_base,
    v_quote,
    p_rate,
    COALESCE(p_effective_date, current_date),
    COALESCE(p_source, 'openexchangerates')
  )
  ON CONFLICT (base_currency, quote_currency, effective_date) DO UPDATE
    SET rate   = EXCLUDED.rate,
        source = EXCLUDED.source
  RETURNING * INTO v_row;

  RETURN v_row;
END
$fn$;

-- Lock it down — only the service role can call. This is critical:
-- if any authenticated user could call this, they could rewrite rates
-- and silently inflate every budget rollup in their tenant.
REVOKE ALL ON FUNCTION public.cron_upsert_fx_rate(text, text, numeric, date, text)
  FROM PUBLIC, authenticated, anon;

COMMENT ON FUNCTION public.cron_upsert_fx_rate(text, text, numeric, date, text) IS
  'Service-role-only FX rate writer used by the refresh-fx-rates Edge Function. Called via PostgREST /rpc/ with the service-role key. Authenticated users must use upsert_fx_rate(...) instead.';

-- ─────────────────────────────────────────────────────────────────────
-- 3) Bookkeeping table — every cron tick records its outcome so we
--    can debug "why didn't rates refresh today?" without grepping
--    Edge Function logs.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fx_refresh_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL    DEFAULT now(),
  completed_at  timestamptz,
  source        text        NOT NULL    DEFAULT 'openexchangerates',
  rates_upserted int        NOT NULL    DEFAULT 0,
  succeeded     boolean,
  error_message text,
  http_status   int,
  cron_jobid    bigint,
  request_id    bigint
);

CREATE INDEX IF NOT EXISTS fx_refresh_runs_recent_idx
  ON public.fx_refresh_runs (started_at DESC);

ALTER TABLE public.fx_refresh_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_refresh_runs_select_admin ON public.fx_refresh_runs;
CREATE POLICY fx_refresh_runs_select_admin
  ON public.fx_refresh_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Service-role-callable upsert for the Edge Function to write its result.
CREATE OR REPLACE FUNCTION public.record_fx_refresh_result(
  p_run_id        uuid,
  p_succeeded     boolean,
  p_rates_upserted int,
  p_error_message text,
  p_http_status   int
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.fx_refresh_runs
     SET completed_at  = now(),
         succeeded     = COALESCE(p_succeeded, false),
         rates_upserted = COALESCE(p_rates_upserted, 0),
         error_message  = p_error_message,
         http_status    = p_http_status
   WHERE id = p_run_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.record_fx_refresh_result(uuid, boolean, int, text, int)
  FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Fire-and-forget kickoff helpers (run inside pg_cron). They emit
--    a fx_refresh_runs row + dispatch the Edge Function via pg_net.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cron_kickoff_fx_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_base_url    text := current_setting('app.settings.supabase_url',  true);
  v_cron_secret text := current_setting('app.settings.cron_secret',    true);
  v_run_id      uuid := gen_random_uuid();
  v_request_id  bigint;
BEGIN
  -- Defensive: if the platform owner hasn't set the runtime settings
  -- yet, log a notice and bail rather than crash the cron schedule.
  IF v_base_url IS NULL OR v_base_url = '' THEN
    RAISE NOTICE 'cron_kickoff_fx_refresh: app.settings.supabase_url is not set; aborting.';
    RETURN;
  END IF;

  INSERT INTO public.fx_refresh_runs (id, source, cron_jobid)
       VALUES (v_run_id, 'openexchangerates', NULLIF(current_setting('cron.job_id', true), '')::bigint);

  SELECT net.http_post(
    url     := v_base_url || '/functions/v1/refresh-fx-rates',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || COALESCE(v_cron_secret, '')
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

REVOKE ALL ON FUNCTION public.cron_kickoff_fx_refresh() FROM PUBLIC, authenticated, anon;

CREATE OR REPLACE FUNCTION public.cron_kickoff_email_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_base_url    text := current_setting('app.settings.supabase_url',  true);
  v_cron_secret text := current_setting('app.settings.cron_secret',    true);
  v_pending     int;
BEGIN
  IF v_base_url IS NULL OR v_base_url = '' THEN
    RAISE NOTICE 'cron_kickoff_email_dispatch: app.settings.supabase_url is not set; aborting.';
    RETURN;
  END IF;

  -- Cheap short-circuit — skip the HTTP call entirely when there's
  -- nothing in the queue. We poll every 5 minutes so this saves the
  -- 99% of ticks where nothing happened.
  SELECT count(*) INTO v_pending
    FROM public.notifications
   WHERE email_required = true
     AND email_dispatched_at IS NULL
     AND email_attempts < 5;

  IF v_pending = 0 THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_base_url || '/functions/v1/dispatch-notification-emails',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || COALESCE(v_cron_secret, '')
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

REVOKE ALL ON FUNCTION public.cron_kickoff_email_dispatch() FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Schedule the two cron jobs. cron.schedule returns a bigint job
--    id; we unschedule the old one first so the migration stays
--    re-applicable.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  -- Daily FX refresh — 06:05 UTC (so OpenExchangeRates' 00:00 UTC
  -- update has settled and we don't slam them at the top of the hour).
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'nexpec-fx-refresh-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'nexpec-fx-refresh-daily',
    '5 6 * * *',
    $cron$ SELECT public.cron_kickoff_fx_refresh(); $cron$
  );

  -- Email queue drain — every 5 minutes.
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'nexpec-email-dispatch-5min';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'nexpec-email-dispatch-5min',
    '*/5 * * * *',
    $cron$ SELECT public.cron_kickoff_email_dispatch(); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron schedule setup: %', SQLERRM;
END $$;

COMMIT;
