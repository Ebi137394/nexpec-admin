-- ════════════════════════════════════════════════════════════════════════════
--  Telegram: one-tap owner pairing + daily brief + aging alerts
--
--  PAIRING DESIGN. A plain "/start unlocks enrolment" window is a race: whoever
--  messages the bot first during it gets paired. Instead the owner opens a
--  deep link, https://t.me/<bot>?start=<token>, so Telegram delivers
--  "/start <token>" and the webhook pairs ONLY if that exact single-use,
--  short-lived token matches. A stranger sending plain /start matches nothing
--  and is refused, so there is never an open enrolment path — even while
--  bootstrap is armed.
--
--  Additive only. No existing table, policy, RPC or mobile contract changes.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.telegram_bootstrap (
  token        text        PRIMARY KEY,
  profile_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  expires_at   timestamptz NOT NULL DEFAULT (NOW() + interval '60 minutes'),
  consumed_at  timestamptz,
  consumed_by_chat bigint
);

ALTER TABLE public.telegram_bootstrap ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tg_bootstrap_admin_only ON public.telegram_bootstrap;
CREATE POLICY tg_bootstrap_admin_only ON public.telegram_bootstrap
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON public.telegram_bootstrap FROM anon;

COMMENT ON TABLE public.telegram_bootstrap IS
  'Single-use, expiring pairing tokens delivered via a t.me deep link. Consuming one enrols exactly one Telegram chat as an admin and immediately closes the window.';

-- Atomic pairing: consume the token and create the allowlist row in one
-- statement, so two taps of the same link cannot enrol two chats.
CREATE OR REPLACE FUNCTION public.tg_consume_bootstrap(
  p_token    text,
  p_chat_id  bigint,
  p_user_id  bigint,
  p_username text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile uuid;
BEGIN
  UPDATE public.telegram_bootstrap b
     SET consumed_at = NOW(), consumed_by_chat = p_chat_id
   WHERE b.token = p_token
     AND b.consumed_at IS NULL
     AND b.expires_at > NOW()
  RETURNING b.profile_id INTO v_profile;

  IF v_profile IS NULL THEN
    RETURN false;                       -- unknown, expired or already used
  END IF;

  INSERT INTO public.telegram_admin_chats
    (chat_id, telegram_user_id, telegram_username, profile_id, is_active, can_act, notes)
  VALUES (p_chat_id, p_user_id, p_username, v_profile, true, true,
          'Paired via one-tap bootstrap deep link')
  ON CONFLICT (chat_id) DO UPDATE
    SET telegram_user_id = EXCLUDED.telegram_user_id,
        telegram_username = EXCLUDED.telegram_username,
        profile_id = EXCLUDED.profile_id,
        is_active = true, can_act = true;

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                   subject_table, subject_id, summary, metadata)
  VALUES ('telegram.admin_paired', 'critical', v_profile,
          'Telegram Admin Control Center', 'telegram_admin_chats', v_profile,
          'Telegram admin chat paired via one-tap bootstrap',
          jsonb_build_object('source','telegram_admin_control_center',
                             'telegram_chat_id', p_chat_id,
                             'telegram_user_id', p_user_id,
                             'bootstrap_single_use', true));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.tg_consume_bootstrap(text, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_consume_bootstrap(text, bigint, bigint, text) TO service_role;

-- ── Daily brief + aging attention queue ───────────────────────────────────
--  Returns counts and the aging items that genuinely need a decision, so
--  /pending and the brief share one definition and cannot disagree.
CREATE OR REPLACE FUNCTION public.tg_attention_queue()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'generated_at', NOW(),
    'moderation_aging', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT id, left(title, 60) AS title,
               EXTRACT(epoch FROM (NOW() - created_at))/3600 AS hours_waiting
          FROM public.jobs
         WHERE moderation_status = 'pending_review' AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 5) x),
    'zero_applicants', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT j.id, left(j.title, 60) AS title,
               EXTRACT(epoch FROM (NOW() - j.created_at))/86400 AS days_open
          FROM public.jobs j
         WHERE j.status = 'open' AND j.moderation_status = 'approved' AND j.deleted_at IS NULL
           AND j.created_at < NOW() - interval '48 hours'
           AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id)
         ORDER BY j.created_at ASC LIMIT 5) x),
    'support_waiting', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT c.id, left(COALESCE(c.last_message_preview, ''), 60) AS preview,
               EXTRACT(epoch FROM (NOW() - c.last_message_at))/3600 AS hours_waiting
          FROM public.conversations c
         WHERE c.kind = 'help_support' AND COALESCE(c.unread_for_admin, 0) > 0
         ORDER BY c.last_message_at ASC LIMIT 5) x),
    'incomplete_profiles', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT p.id, COALESCE(p.full_name, 'Unnamed') AS name, p.role,
               public.nx_profile_missing_fields(p.id) AS missing
          FROM public.profiles p
         WHERE COALESCE(array_length(public.nx_profile_missing_fields(p.id), 1), 0) > 0
           AND p.role NOT IN ('admin','super_admin')
           AND COALESCE(p.email,'') !~* '(@nexpec\.test$|@synthetic\.invalid$|^e2e\.)'
         ORDER BY p.created_at DESC LIMIT 5) x)
  );
$$;

REVOKE ALL ON FUNCTION public.tg_attention_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_attention_queue() TO authenticated, service_role;

-- Daily brief producer. Writes ONE admin notification, which the existing
-- routing trigger flags for Telegram — reusing the same outbox rather than a
-- second scheduled sender. Dedupe: at most one brief per admin per day.
CREATE OR REPLACE FUNCTION public.tg_send_daily_brief()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  s     jsonb;
  r     RECORD;
  n     int := 0;
  v_body text;
BEGIN
  s := public.tg_admin_status();
  v_body :=
      'Awaiting moderation: ' || (s->>'jobs_awaiting_moderation') ||
    E'\nOpen jobs: '          || (s->>'jobs_open') ||
    E'\nNo applicants 48h+: ' || (s->>'jobs_zero_applicants_48h') ||
    E'\nApplications 24h: '   || (s->>'applications_24h') ||
    E'\nNew users 24h: '      || (s->>'users_24h') ||
    E'\nIncomplete profiles: '|| (s->>'incomplete_profiles') ||
    E'\nSupport awaiting: '   || (s->>'support_unread') ||
    E'\nReports to review: '  || (s->>'reports_awaiting_review') ||
    E'\nCritical alerts 24h: '|| (s->>'critical_alerts_24h');

  FOR r IN SELECT id FROM public.profiles WHERE role IN ('admin','super_admin') LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications
       WHERE recipient_id = r.id AND kind = 'daily_brief'
         AND created_at > date_trunc('day', NOW()));
    PERFORM public.notify_safe(r.id, 'daily_brief', 'NEXPEC Daily Brief', v_body, '/admin', NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_send_daily_brief: %', SQLERRM;
  RETURN 0;
END $$;

-- The brief is 'action_required' so routing sends it to Telegram.
CREATE OR REPLACE FUNCTION public.nx_notification_severity(p_kind text, p_title text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_kind IN ('security', 'system_alert', 'payment_exception') THEN 'critical'
    WHEN p_title ILIKE '%failed%' OR p_title ILIKE '%error%' OR p_title ILIKE '%anomaly%' THEN 'critical'
    WHEN p_kind = 'daily_brief' THEN 'action_required'
    WHEN p_kind IN ('moderation', 'job_moderated', 'verification', 'dispute') THEN 'action_required'
    WHEN p_title ILIKE '%review required%' OR p_title ILIKE '%awaiting%'
      OR p_title ILIKE '%needs%' OR p_title ILIKE '%requested%' THEN 'action_required'
    WHEN p_kind IN ('assignment', 'application', 'report', 'message') THEN 'operational'
    WHEN p_title ILIKE '%registered%' OR p_title ILIKE '%submitted%' THEN 'operational'
    ELSE 'informational'
  END;
$$;
