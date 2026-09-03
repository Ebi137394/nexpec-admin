-- ════════════════════════════════════════════════════════════════════════════
--  Telegram Admin Control Center — schema, routing, allowlist, action tokens
--
--  ARCHITECTURE DECISION. NEXPEC already has a notification OUTBOX: public.
--  notifications carries email_required / email_dispatched_at / email_attempts /
--  email_last_attempt_at / email_send_error, a pg_cron job calls
--  cron_kickoff_email_dispatch(), and that reads its base URL from _app_config
--  and its secret from vault, then net.http_post()s an edge function. Telegram
--  is therefore modelled as a SECOND DELIVERY CHANNEL ON THE SAME ROWS, not as
--  a second notification system: same notifications table, same nx_notify_admins
--  producers, same audit_events, same cron+edge-function transport.
--
--  Consequences that matter:
--    * §8 one event pipeline — a Telegram alert IS the Command Console
--      notification row; nothing can drift between channels.
--    * §13 failure safety — delivery is asynchronous and out-of-band. Nothing
--      in signup, job creation, approval, applications, reports or support
--      messaging can block or fail because Telegram is down; the worst case is
--      an undispatched row that retries.
--    * §14 least invasive — no new transport, scheduler or secret mechanism.
--
--  Additive only: new columns (all nullable/defaulted), new tables, new
--  functions. No existing table, policy, RPC signature or mobile contract
--  changes, so the published binaries are unaffected.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Telegram delivery outbox, mirroring the proven email columns ───────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS telegram_required      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_attempts      integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS telegram_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_send_error    text,
  ADD COLUMN IF NOT EXISTS telegram_message_id    bigint,
  ADD COLUMN IF NOT EXISTS severity               text;

COMMENT ON COLUMN public.notifications.telegram_required IS
  'Delivery flag for the Telegram channel, mirroring email_required. Set by nx_notification_severity()/routing, drained by the telegram-dispatch edge function.';

-- Partial index: the dispatcher only ever scans undelivered, under-attempted rows.
CREATE INDEX IF NOT EXISTS notifications_telegram_pending_idx
  ON public.notifications (created_at)
  WHERE telegram_required = true AND telegram_dispatched_at IS NULL AND telegram_attempts < 5;

-- ── 2 · Severity taxonomy + routing policy (§1, §9) ────────────────────────
--  Deliberately small and derived from event kinds that ALREADY exist, so no
--  producer has to be rewritten to classify itself.
CREATE OR REPLACE FUNCTION public.nx_notification_severity(p_kind text, p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- Critical: security / money / system integrity.
    WHEN p_kind IN ('security', 'system_alert', 'payment_exception') THEN 'critical'
    WHEN p_title ILIKE '%failed%' OR p_title ILIKE '%error%' OR p_title ILIKE '%anomaly%' THEN 'critical'
    -- Action required: a human must decide something.
    WHEN p_kind IN ('moderation', 'job_moderated', 'verification', 'dispute') THEN 'action_required'
    WHEN p_title ILIKE '%review required%' OR p_title ILIKE '%awaiting%'
      OR p_title ILIKE '%needs%' OR p_title ILIKE '%requested%' THEN 'action_required'
    -- Operational: worth knowing promptly, no decision pending.
    WHEN p_kind IN ('assignment', 'application', 'report', 'message') THEN 'operational'
    WHEN p_title ILIKE '%registered%' OR p_title ILIKE '%submitted%' THEN 'operational'
    ELSE 'informational'
  END;
$$;

COMMENT ON FUNCTION public.nx_notification_severity(text, text) IS
  'Maps an existing notification kind/title onto the Critical / Action Required / Operational / Informational taxonomy. Pure, so it can be used in generated contexts and indexes.';

--  Routing: Informational stays in the Command Console only, so Telegram does
--  not become noise (§1 "do not flood"). Critical and Action Required always go
--  to Telegram; Operational does too, because for a marketplace operator these
--  are the events worth reacting to within minutes.
CREATE OR REPLACE FUNCTION public.tg_should_route_to_telegram(p_severity text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_severity IN ('critical', 'action_required', 'operational');
$$;

-- ── 3 · Mark admin-bound notifications for Telegram delivery ───────────────
--  A trigger rather than editing every producer: nx_notify / nx_notify_admins /
--  notify_safe all funnel into this table, so one place classifies and routes.
CREATE OR REPLACE FUNCTION public.tg_route_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_sev      text;
  v_is_admin boolean;
BEGIN
  BEGIN
    v_sev := public.nx_notification_severity(NEW.kind, COALESCE(NEW.title, ''));
    NEW.severity := v_sev;

    -- Telegram is an ADMIN console: only notifications addressed to an
    -- admin/super_admin are ever routed there. A client's or inspector's
    -- personal notification is never mirrored to the owner's Telegram.
    SELECT (p.role IN ('admin', 'super_admin')) INTO v_is_admin
      FROM public.profiles p WHERE p.id = NEW.recipient_id;

    IF COALESCE(v_is_admin, false) AND public.tg_should_route_to_telegram(v_sev) THEN
      NEW.telegram_required := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- classification must never block a notification insert
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tg_route_notification ON public.notifications;
CREATE TRIGGER trg_tg_route_notification
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_route_notification();

-- ── 4 · Owner allowlist — deny by default (§6) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_admin_chats (
  chat_id          bigint      PRIMARY KEY,           -- stable Telegram chat id
  telegram_user_id bigint      NOT NULL,              -- stable Telegram user id
  telegram_username text,                             -- display only; NEVER used for authz
  profile_id       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active        boolean     NOT NULL DEFAULT true,
  can_act          boolean     NOT NULL DEFAULT false, -- read-only until explicitly granted
  added_at         timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at     timestamptz,
  notes            text
);

ALTER TABLE public.telegram_admin_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tg_chats_admin_only ON public.telegram_admin_chats;
CREATE POLICY tg_chats_admin_only ON public.telegram_admin_chats
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON public.telegram_admin_chats FROM anon;

COMMENT ON TABLE public.telegram_admin_chats IS
  'Allowlist of Telegram identities permitted to use the Admin Control Center. Authorisation is by numeric chat_id/telegram_user_id only — username and display name are untrusted. can_act gates mutations separately from read access.';

-- ── 5 · Short-lived, single-use action tokens (§4, §5, §7) ─────────────────
--  Sensitive actions are never executed from a raw callback payload: the
--  callback carries an opaque token that must exist, be unexpired, be unused,
--  and belong to the same chat. This gives confirmation, replay protection and
--  idempotency in one structure.
CREATE TABLE IF NOT EXISTS public.telegram_action_tokens (
  token        text        PRIMARY KEY,
  chat_id      bigint      NOT NULL REFERENCES public.telegram_admin_chats(chat_id) ON DELETE CASCADE,
  action       text        NOT NULL,
  subject_id   uuid,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  expires_at   timestamptz NOT NULL DEFAULT (NOW() + interval '10 minutes'),
  consumed_at  timestamptz,
  result       text
);

ALTER TABLE public.telegram_action_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tg_tokens_admin_only ON public.telegram_action_tokens;
CREATE POLICY tg_tokens_admin_only ON public.telegram_action_tokens
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON public.telegram_action_tokens FROM anon;

CREATE INDEX IF NOT EXISTS telegram_action_tokens_expiry_idx
  ON public.telegram_action_tokens (expires_at) WHERE consumed_at IS NULL;

-- Atomic single-use consumption: the UPDATE ... WHERE consumed_at IS NULL makes
-- a double-tapped Telegram button execute at most once, even concurrently.
CREATE OR REPLACE FUNCTION public.tg_consume_action_token(p_token text, p_chat_id bigint)
RETURNS TABLE (action text, subject_id uuid, payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.telegram_action_tokens t
     SET consumed_at = NOW()
   WHERE t.token = p_token
     AND t.chat_id = p_chat_id
     AND t.consumed_at IS NULL
     AND t.expires_at > NOW()
  RETURNING t.action, t.subject_id, t.payload;
END $$;

-- ── 6 · Operational read model for the bot (§3) ────────────────────────────
--  One round trip for /status and the daily brief. SECURITY DEFINER because the
--  edge function calls it with the service role; it returns COUNTS ONLY — no
--  buyer pricing, no payout, no personal data — so it cannot leak commercial
--  detail into a chat transcript.
CREATE OR REPLACE FUNCTION public.tg_admin_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'generated_at',        NOW(),
    'jobs_awaiting_moderation',
      (SELECT count(*) FROM public.jobs
        WHERE moderation_status = 'pending_review' AND deleted_at IS NULL),
    'jobs_open',
      (SELECT count(*) FROM public.jobs
        WHERE status = 'open' AND moderation_status = 'approved' AND deleted_at IS NULL),
    'jobs_zero_applicants_48h',
      (SELECT count(*) FROM public.jobs j
        WHERE j.status = 'open' AND j.moderation_status = 'approved' AND j.deleted_at IS NULL
          AND j.created_at < NOW() - interval '48 hours'
          AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id)),
    'applications_24h',
      (SELECT count(*) FROM public.applications WHERE created_at > NOW() - interval '24 hours'),
    'users_24h',
      (SELECT count(*) FROM public.profiles WHERE created_at > NOW() - interval '24 hours'
        AND COALESCE(email,'') !~* '(@nexpec\.test$|@synthetic\.invalid$|^e2e\.)'),
    'incomplete_profiles',
      (SELECT count(*) FROM public.profiles p
        WHERE COALESCE(array_length(public.nx_profile_missing_fields(p.id), 1), 0) > 0
          AND p.role NOT IN ('admin','super_admin')
          AND COALESCE(p.email,'') !~* '(@nexpec\.test$|@synthetic\.invalid$|^e2e\.)'),
    'support_unread',
      (SELECT count(*) FROM public.conversations
        WHERE kind = 'help_support' AND COALESCE(unread_for_admin, 0) > 0),
    'reports_awaiting_review',
      (SELECT count(*) FROM public.inspection_reports WHERE COALESCE(is_published, false) = false),
    'critical_alerts_24h',
      (SELECT count(*) FROM public.notifications
        WHERE severity = 'critical' AND created_at > NOW() - interval '24 hours'),
    'telegram_delivery_failures_24h',
      (SELECT count(*) FROM public.notifications
        WHERE telegram_send_error IS NOT NULL AND telegram_last_attempt_at > NOW() - interval '24 hours')
  );
$$;

REVOKE ALL ON FUNCTION public.tg_admin_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_admin_status() TO authenticated, service_role;

-- ── 7 · Cron kickoff, mirroring cron_kickoff_email_dispatch() exactly ──────
CREATE OR REPLACE FUNCTION public.cron_kickoff_telegram_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_base_url    text;
  v_cron_secret text;
  v_pending     int;
BEGIN
  SELECT count(*) INTO v_pending FROM public.notifications
   WHERE telegram_required = true AND telegram_dispatched_at IS NULL AND telegram_attempts < 5;
  IF v_pending = 0 THEN RETURN; END IF;

  v_base_url := COALESCE(
    NULLIF(public._app_config_get('functions_base_url'), ''),
    NULLIF(public._app_config_get('notify_edge_fn_url'), ''),
    NULLIF(current_setting('app.settings.supabase_url', true), ''));

  SELECT NULLIF(decrypted_secret, '') INTO v_cron_secret
    FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;

  -- Fail-safe, same as the email kickoff: unconfigured means REFUSE, never
  -- send unauthenticated.
  IF v_base_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE WARNING 'cron_kickoff_telegram_dispatch: unconfigured (base_url=%, cron_secret=%) — refusing to dispatch % pending.',
      (v_base_url IS NOT NULL), (v_cron_secret IS NOT NULL), v_pending;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_base_url || '/functions/v1/telegram-dispatch',
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer ' || v_cron_secret),
    body    := jsonb_build_object('triggered_by','pg_cron','triggered_at',NOW(),
                                  'pending_estimate',v_pending),
    timeout_milliseconds := 60000);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron_kickoff_telegram_dispatch: %', SQLERRM;
END $$;

COMMENT ON FUNCTION public.cron_kickoff_telegram_dispatch() IS
  'pg_cron entry point for Telegram delivery. Deliberately identical in shape to cron_kickoff_email_dispatch: same config lookup, same vault secret, same fail-safe refusal when unconfigured, same swallow-all exception handler so a scheduler hiccup can never surface into product transactions.';
