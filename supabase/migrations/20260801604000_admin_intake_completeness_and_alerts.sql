-- ════════════════════════════════════════════════════════════════════════════
--  Admin intake: client-profile completeness, one-shot nudge, new-user alerts
--
--  STRICTLY ADDITIVE. New helper functions, one small ledger table and two
--  triggers. No existing table, column, view, policy, RPC or status value is
--  altered, so the published iOS/Android binaries are unaffected and no new
--  build is required.
--
--  ★ THE CRITICAL SAFETY PROPERTY ★
--  Both triggers are AFTER triggers whose entire body is wrapped in
--  EXCEPTION WHEN OTHERS THEN NULL. A published app must never see a new error
--  it cannot interpret, so nothing here can fail signup or job creation: if any
--  part of the nudge or the admin alert breaks, the INSERT still commits.
--
--  Completeness is defined from columns that ALREADY exist on public.profiles
--  (full_name, company_name, phone, location). No new required field is
--  invented, no NOT NULL is added, and no CHECK is tightened — an incomplete
--  client can still submit exactly as they do today; the job simply carries a
--  visible warning for the admin, using the existing moderation_status flow.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Completeness helper ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_profile_missing_fields(p_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
           ARRAY(
             SELECT f FROM (
               SELECT 'full_name'    AS f WHERE COALESCE(btrim(p.full_name), '')    = ''
               UNION ALL
               SELECT 'company_name'    WHERE COALESCE(btrim(p.company_name), '') = ''
               UNION ALL
               SELECT 'phone'           WHERE COALESCE(btrim(p.phone), '')        = ''
               UNION ALL
               SELECT 'location'        WHERE COALESCE(btrim(p.location), '')     = ''
             ) q
           ), '{}'::text[])
    FROM public.profiles p
   WHERE p.id = p_user_id;
$$;

COMMENT ON FUNCTION public.nx_profile_missing_fields(uuid) IS
  'Returns the required contact/organisation fields still blank on a profile, from columns that already exist. Advisory only — nothing enforces it.';

GRANT EXECUTE ON FUNCTION public.nx_profile_missing_fields(uuid) TO authenticated;

-- ── 2 · Reminder ledger (idempotency) ──────────────────────────────────────
--  One row per user. Without this the nudge would re-fire on every job insert.
CREATE TABLE IF NOT EXISTS public.profile_completion_reminders (
  user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_sent_at  timestamptz NOT NULL DEFAULT NOW(),
  last_sent_at   timestamptz NOT NULL DEFAULT NOW(),
  send_count     integer     NOT NULL DEFAULT 1,
  missing_fields text[]      NOT NULL DEFAULT '{}',
  last_job_id    uuid
);

ALTER TABLE public.profile_completion_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pcr_admin_all ON public.profile_completion_reminders;
CREATE POLICY pcr_admin_all ON public.profile_completion_reminders
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS pcr_read_own ON public.profile_completion_reminders;
CREATE POLICY pcr_read_own ON public.profile_completion_reminders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.profile_completion_reminders FROM anon;

COMMENT ON TABLE public.profile_completion_reminders IS
  'Idempotency ledger for the automatic profile-completion nudge: one row per user so the reminder is sent once, not on every submission.';

-- ── 3 · The nudge itself, reusable by the trigger and by admins ────────────
--  Posts into the recipient's canonical conversations(kind='help_support')
--  thread — the same thread /admin/messages shows and the released mobile
--  inbox reads — and raises a notification. sender_id is left NULL because the
--  message is system-generated; the mobile client computes
--  `mine = !!myId && senderId === myId`, so a NULL sender renders safely as a
--  normal incoming message.
CREATE OR REPLACE FUNCTION public.nx_send_profile_completion_nudge(
  p_user_id uuid,
  p_job_id  uuid DEFAULT NULL,
  p_note    text DEFAULT NULL,
  p_force   boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_missing  text[];
  v_conv_id  uuid;
  v_already  boolean;
  v_pretty   text;
  v_body     text;
BEGIN
  v_missing := public.nx_profile_missing_fields(p_user_id);
  IF v_missing IS NULL OR array_length(v_missing, 1) IS NULL THEN
    RETURN false;                       -- profile is complete; nothing to ask for
  END IF;

  SELECT true INTO v_already
    FROM public.profile_completion_reminders WHERE user_id = p_user_id;

  IF COALESCE(v_already, false) AND NOT p_force THEN
    RETURN false;                       -- already asked once: stay quiet
  END IF;

  -- Human-readable field list for the message body.
  SELECT string_agg(
           CASE f WHEN 'company_name' THEN 'company'
                  WHEN 'full_name'    THEN 'full name'
                  ELSE replace(f, '_', ' ') END, ', ' ORDER BY f)
    INTO v_pretty
    FROM unnest(v_missing) AS f;

  v_body := 'Thank you for submitting your inspection request. Before NEXPEC can review and publish the job, '
         || 'please complete your client profile, including your ' || COALESCE(v_pretty, 'contact details') || '. '
         || 'Once the required information is complete, our team can continue reviewing your request. '
         || 'If you need assistance, reply here and our team will help you.'
         || CASE WHEN COALESCE(btrim(p_note), '') = '' THEN '' ELSE E'\n\n' || btrim(p_note) END;

  -- Canonical Help & Support thread (find-or-create), same as the admin path.
  SELECT id INTO v_conv_id
    FROM public.conversations WHERE user_id = p_user_id AND kind = 'help_support' LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (kind, user_id, title)
    VALUES ('help_support', p_user_id, 'Help & Support')
    RETURNING id INTO v_conv_id;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_conv_id, NULL, v_body);

  INSERT INTO public.profile_completion_reminders AS r (user_id, missing_fields, last_job_id)
  VALUES (p_user_id, v_missing, p_job_id)
  ON CONFLICT (user_id) DO UPDATE
    SET last_sent_at   = NOW(),
        send_count     = r.send_count + 1,
        missing_fields = EXCLUDED.missing_fields,
        last_job_id    = COALESCE(EXCLUDED.last_job_id, r.last_job_id);

  BEGIN
    PERFORM public.notify_safe(
      p_user_id, 'system', 'Complete your profile to continue',
      'We need your ' || COALESCE(v_pretty, 'contact details') || ' before your request can be reviewed.',
      '/inbox/' || v_conv_id::text, p_job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                   subject_table, subject_id, summary, metadata)
  VALUES ('client.profile_completion_requested', 'info', auth.uid(), 'NEXPEC',
          'profiles', p_user_id,
          'Profile completion requested: ' || COALESCE(v_pretty, ''),
          jsonb_build_object('missing_fields', v_missing, 'job_id', p_job_id, 'forced', p_force));

  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.nx_send_profile_completion_nudge(uuid, uuid, text, boolean) TO authenticated;

-- ── 4 · Admin-invoked version for the Incomplete Profiles view ─────────────
CREATE OR REPLACE FUNCTION public.admin_request_profile_completion(
  p_user_id uuid,
  p_note    text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  -- p_force: an admin asking again is deliberate, so it bypasses the one-shot
  -- rule the automatic trigger obeys.
  RETURN public.nx_send_profile_completion_nudge(p_user_id, NULL, p_note, true);
END $$;

REVOKE ALL ON FUNCTION public.admin_request_profile_completion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_request_profile_completion(uuid, text) TO authenticated;

-- ── 5 · Trigger: nudge on job submission (never blocks the insert) ─────────
CREATE OR REPLACE FUNCTION public.tg_job_profile_completion_nudge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  BEGIN
    IF NEW.client_id IS NOT NULL THEN
      PERFORM public.nx_send_profile_completion_nudge(NEW.client_id, NEW.id, NULL, false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- job creation must never fail because of a courtesy message
  END;
  RETURN NULL;  -- AFTER trigger
END $$;

DROP TRIGGER IF EXISTS trg_job_profile_completion_nudge ON public.jobs;
CREATE TRIGGER trg_job_profile_completion_nudge
  AFTER INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_profile_completion_nudge();

-- ── 6 · Trigger: alert admins when a real user registers ───────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_admins_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_missing text[];
  v_label   text;
BEGIN
  BEGIN
    -- Skip synthetic identities. These suffixes are the ones the QA seeds and
    -- E2E fixtures already use, so real signups are never filtered out.
    IF COALESCE(NEW.email, '') ~* '(@nexpec\.test$|@synthetic\.invalid$|^e2e\.)' THEN
      RETURN NULL;
    END IF;
    -- Administrative accounts are created deliberately; no alert needed.
    IF COALESCE(NEW.role, '') IN ('admin', 'super_admin') THEN
      RETURN NULL;
    END IF;

    v_missing := public.nx_profile_missing_fields(NEW.id);
    v_label   := COALESCE(NULLIF(btrim(NEW.full_name), ''), 'Unnamed');

    PERFORM public.nx_notify_admins(
      'New ' || COALESCE(NEW.role, 'user') || ' registered',
      v_label || ' — ' || COALESCE(NEW.email, 'no email')
        || CASE WHEN array_length(v_missing, 1) IS NULL THEN ' · profile complete'
                ELSE ' · missing: ' || array_to_string(v_missing, ', ') END,
      'system',
      '/admin/users/' || NEW.id::text,
      NULL);
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- signup must never fail because an alert could not be delivered
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_notify_admins_new_user ON public.profiles;
CREATE TRIGGER trg_notify_admins_new_user
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_admins_new_user();
