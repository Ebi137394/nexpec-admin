-- ════════════════════════════════════════════════════════════════════════════
--  Automatic, role-aware post-registration onboarding.
--
--  WHAT ALREADY EXISTED and is reused rather than rebuilt:
--    · the canonical Help & Support thread (conversations.kind='help_support',
--      one per user, enforced by uniq_conversations_help_support_per_user) —
--      the released apps already read it, so onboarding lands where the user
--      can reply from the shipped build;
--    · profile_completion_reminders — a real ledger with first_sent_at,
--      last_sent_at, send_count and missing_fields. Extended, not replaced;
--    · nx_send_profile_completion_nudge — the job-triggered client nudge;
--    · notify_safe / nx_notify_admins / audit_events.
--
--  WHAT WAS MISSING: anything at REGISTRATION time (the only nudge was
--  triggered by submitting a job), any role-awareness (one generic four-field
--  rule for everyone), and any notion of the user confirming their role.
--
--  COMPLETENESS RULES ARE EVIDENCE-BASED. Measured on real (non-QA) accounts
--  before writing: NOT ONE has company, phone, location, city, country or
--  contact_person filled; only full_name is populated (7/13 clients, 9/11
--  inspectors). experience_years is non-null for all 11 inspectors, so it is a
--  default rather than a signal, and ndt_methods / certifications are empty for
--  every inspector. Requiring those would mark every inspector permanently
--  incomplete and make the reminder worthless — so certifications stay
--  job-gated (CCI and per-job credential rules remain authoritative) and the
--  inspector "professional" requirement is satisfied by ANY ONE of several
--  fields the app can actually write.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Role-aware core completeness ──────────────────────────────────────
--  Additive: nx_profile_missing_fields is left exactly as it is, because the
--  web console and the released app already depend on its four-field answer.
CREATE OR REPLACE FUNCTION public.nx_role_missing_fields(p_user_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  p        public.profiles%ROWTYPE;
  v_out    text[] := '{}';
  v_named  boolean;
  v_placed boolean;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN '{}'; END IF;

  -- A person's name may live in full_name or in the org contact field.
  v_named := COALESCE(btrim(p.full_name), '') <> ''
          OR COALESCE(btrim(p.contact_person_name), '') <> ''
          OR COALESCE(btrim(p.first_name), '') <> '';

  -- Any one of these answers "where are you", so we never ask twice for it.
  v_placed := COALESCE(btrim(p.location), '') <> ''
           OR COALESCE(btrim(p.location_city), '') <> ''
           OR COALESCE(btrim(p.country_of_residence), '') <> '';

  IF NOT v_named  THEN v_out := array_append(v_out, 'full_name'); END IF;
  IF COALESCE(btrim(p.phone), '') = '' THEN v_out := array_append(v_out, 'phone'); END IF;
  IF NOT v_placed THEN v_out := array_append(v_out, 'location'); END IF;

  IF p.role IN ('client', 'agency', 'enterprise', 'supplier') THEN
    -- An organisation account without an organisation name cannot be processed.
    IF COALESCE(btrim(p.company_name), '') = '' THEN
      v_out := array_append(v_out, 'company_name');
    END IF;

  ELSIF p.role IN ('inspector', 'senior') THEN
    -- Deliberately NOT company_name: independent inspectors have none.
    -- Deliberately NOT certifications: those are gated per job by the existing
    -- CCI / credential rules, which stay authoritative. One professional
    -- signal is enough, and ANY of these satisfies it.
    IF  COALESCE(array_length(p.specialty_slugs, 1), 0) = 0
    AND COALESCE(array_length(p.ndt_methods, 1), 0) = 0
    AND COALESCE(array_length(p.custom_specialties, 1), 0) = 0
    AND COALESCE(btrim(p.specialties), '') = ''
    AND COALESCE(btrim(p.professional_title), '') = '' THEN
      v_out := array_append(v_out, 'specialties');
    END IF;
  END IF;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.nx_role_missing_fields(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_role_missing_fields(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_role_missing_fields(uuid) IS
  'Role-aware core profile completeness. Clients/agencies/enterprises/suppliers must have an organisation name; inspectors need one professional signal instead, and never certifications (those remain gated per job by the CCI and credential rules).';

-- ── 2 · Owner-facing wording ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_role_blurb(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(COALESCE(p_role,''))
    WHEN 'client'     THEN 'meaning you intend to request or manage professional industrial inspection services'
    WHEN 'inspector'  THEN 'meaning you intend to provide professional industrial inspection services'
    WHEN 'senior'     THEN 'meaning you intend to provide and review professional industrial inspection work'
    WHEN 'agency'     THEN 'meaning your organisation coordinates inspection work on behalf of clients or inspectors'
    WHEN 'enterprise' THEN 'meaning your organisation manages industrial inspection programmes at scale'
    WHEN 'supplier'   THEN 'meaning you supply equipment, materials or services to inspection projects'
    ELSE 'meaning you intend to use NEXPEC for professional industrial inspection work'
  END;
$$;
REVOKE ALL ON FUNCTION public.nx_role_blurb(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_role_blurb(text) TO authenticated, service_role;

-- ── 3 · Onboarding state, on the ledger that already exists ───────────────
--  Additive columns only. No parallel state machine, no second inbox: the
--  message itself lives in the canonical Help & Support thread, and this table
--  records only what cannot be derived (was it sent, was the role confirmed or
--  disputed). Everything else — incomplete/complete, verification_status —
--  is already derivable from profiles.
ALTER TABLE public.profile_completion_reminders
  ADD COLUMN IF NOT EXISTS onboarding_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_role    text,
  ADD COLUMN IF NOT EXISTS role_confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS role_dispute_at    timestamptz;

COMMENT ON COLUMN public.profile_completion_reminders.onboarding_role IS
  'Role the onboarding message was written for. A later admin role change sends exactly one new onboarding message for the new role, and never repeats for the same one.';

-- ── 3b · Canonical thread, resolvable without a session ───────────────────
--  ensure_help_support_conversation() takes no argument: it derives the user
--  from auth.uid(), which is NULL inside a signup trigger and under the
--  service role. This is the same find-or-create the existing job-triggered
--  nudge already uses, just named once instead of inlined twice. It still
--  returns the ONE canonical thread the released apps read.
CREATE OR REPLACE FUNCTION public.nx_help_support_thread(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_conv uuid;
BEGIN
  SELECT id INTO v_conv FROM public.conversations
   WHERE user_id = p_user_id AND kind = 'help_support' LIMIT 1;
  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (kind, user_id, title)
    VALUES ('help_support', p_user_id, 'Help & Support')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conv;
    IF v_conv IS NULL THEN     -- lost a race; the other writer's row is canonical
      SELECT id INTO v_conv FROM public.conversations
       WHERE user_id = p_user_id AND kind = 'help_support' LIMIT 1;
    END IF;
  END IF;
  RETURN v_conv;
END $$;
REVOKE ALL ON FUNCTION public.nx_help_support_thread(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_help_support_thread(uuid) TO service_role;

-- ── 4 · The onboarding message ────────────────────────────────────────────
--  Writes into the user's EXISTING canonical Help & Support thread, as a
--  system message (sender_id NULL) exactly like the job-triggered nudge the
--  released apps already render. No new inbox, no new message table, and the
--  user can reply from the shipped build.
CREATE OR REPLACE FUNCTION public.nx_send_role_onboarding(p_user_id uuid,
                                                          p_force boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  p         public.profiles%ROWTYPE;
  v_missing text[];
  v_pretty  text;
  v_conv    uuid;
  v_body    text;
  v_prev    RECORD;
  v_supersede boolean := false;
  v_msg     uuid;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Never onboard staff, synthetic identities, or a role we have no copy for.
  IF p.role IS NULL OR p.role IN ('admin','super_admin') THEN RETURN false; END IF;
  IF public.nx_is_test_account(p.email) THEN RETURN false; END IF;

  SELECT onboarding_sent_at, onboarding_role INTO v_prev
    FROM public.profile_completion_reminders WHERE user_id = p_user_id;

  IF NOT p_force AND v_prev.onboarding_sent_at IS NOT NULL THEN
    -- Already onboarded for this exact role: stay silent. This is what makes
    -- login, refresh, profile fetch and app reopen produce nothing.
    IF COALESCE(v_prev.onboarding_role,'') = p.role THEN RETURN false; END IF;
    -- Role changed moments after the first message: this is signup still
    -- settling. profiles.role defaults to 'client', and the shipped app
    -- creates the row and THEN writes the chosen role, so an inspector is
    -- briefly a client. Staying silent here would leave that inspector holding
    -- a Client welcome, so instead the original message is REWRITTEN in place
    -- for the correct role — the user still ends up with exactly one
    -- onboarding message, and it is the right one.
    IF v_prev.onboarding_sent_at > NOW() - interval '15 minutes' THEN
      v_supersede := true;
    END IF;
  END IF;

  v_missing := public.nx_role_missing_fields(p_user_id);
  SELECT string_agg(public.nx_field_label(f), ', ') INTO v_pretty
    FROM unnest(v_missing) AS f;

  -- "a Client" but "an Inspector" / "an Agency" / "an Enterprise".
  v_body :=
    'Welcome to NEXPEC. You registered as '
      || CASE WHEN left(public.nx_role_label(p.role),1) IN ('A','E','I','O','U')
              THEN 'an ' ELSE 'a ' END
      || public.nx_role_label(p.role)
      || ', ' || public.nx_role_blurb(p.role) || '.' || E'\n\n'
    || 'Please confirm that this account type is correct.' || E'\n\n'
    || CASE WHEN v_pretty IS NULL
            THEN 'Your profile looks complete — thank you.'
            ELSE 'Missing information: ' || v_pretty || '.' || E'\n'
              || 'Please complete your profile. NEXPEC needs this before it can '
              || 'fully review and process your activity.'
       END
    || CASE WHEN p.role IN ('inspector','senior')
            THEN E'\n\n' || 'Relevant qualifications and certifications may be required '
              || 'before you can access or apply for certain inspection work.'
            ELSE '' END
    || E'\n\n'
    || 'If you selected the wrong account type, reply here and our team will correct it for you.';

  v_conv := public.nx_help_support_thread(p_user_id);
  IF v_conv IS NULL THEN RETURN false; END IF;

  -- Supersede only while the welcome is still the last thing in the thread. If
  -- the user has already replied to it, rewriting history under them would be
  -- dishonest, so a fresh message is sent instead.
  IF v_supersede THEN
    SELECT m.id INTO v_msg
      FROM public.messages m
     WHERE m.conversation_id = v_conv AND m.sender_id IS NULL
       AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT 1;

    IF v_msg IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.messages m2
          WHERE m2.conversation_id = v_conv AND m2.sender_id IS NOT NULL
            AND m2.created_at > (SELECT created_at FROM public.messages WHERE id = v_msg)) THEN
      UPDATE public.messages SET content = v_body WHERE id = v_msg;
    ELSE
      INSERT INTO public.messages (conversation_id, sender_id, content)
      VALUES (v_conv, NULL, v_body);
    END IF;
  ELSE
    INSERT INTO public.messages (conversation_id, sender_id, content)
    VALUES (v_conv, NULL, v_body);
  END IF;

  INSERT INTO public.profile_completion_reminders AS r
    (user_id, missing_fields, onboarding_sent_at, onboarding_role)
  VALUES (p_user_id, v_missing, NOW(), p.role)
  ON CONFLICT (user_id) DO UPDATE
    SET onboarding_sent_at = NOW(),
        onboarding_role    = EXCLUDED.onboarding_role,
        missing_fields     = EXCLUDED.missing_fields,
        role_confirmed_at  = NULL,      -- a new role must be confirmed again
        role_dispute_at    = NULL;

  BEGIN
    PERFORM public.notify_safe(
      p_user_id, 'system', 'Welcome to NEXPEC',
      CASE WHEN v_pretty IS NULL THEN 'Please confirm your account type.'
           ELSE 'Please confirm your account type and add: ' || v_pretty || '.' END,
      '/inbox/' || v_conv::text, NULL);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                     subject_table, subject_id, summary, metadata)
    VALUES ('user.onboarding_sent', 'info', NULL, 'NEXPEC Onboarding',
            'profiles', p_user_id,
            'Role onboarding sent to ' || public.nx_role_label(p.role),
            jsonb_build_object('role', p.role, 'missing_fields', v_missing,
                               'conversation_id', v_conv));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.nx_send_role_onboarding(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_send_role_onboarding(uuid, boolean) TO service_role;

-- ── 5 · Fire it at registration ───────────────────────────────────────────
--  INSERT covers a signup that already carries its role; UPDATE OF role covers
--  the shipped app's two-step create-then-set-role. Idempotency inside the
--  function means the pair can only ever produce one message.
--
--  The whole body is wrapped so that registration can NEVER fail because a
--  welcome message could not be delivered.
CREATE OR REPLACE FUNCTION public.tg_profile_role_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
      RETURN NULL;
    END IF;
    PERFORM public.nx_send_role_onboarding(NEW.id, false);
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- signup must never fail because onboarding could not be delivered
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_profile_role_onboarding ON public.profiles;
CREATE TRIGGER trg_profile_role_onboarding
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_role_onboarding();

REVOKE ALL ON FUNCTION public.tg_profile_role_onboarding() FROM PUBLIC, anon, authenticated;

-- ── 6 · "I picked the wrong account type" → admin attention, never escalation
--  The user replies in the SAME canonical thread from the released app. This
--  only ever raises a flag and notifies admins; it cannot change a role. The
--  admin then uses the existing secure Change Role capability, so there is no
--  path by which a user promotes themselves to any privileged role.
CREATE OR REPLACE FUNCTION public.tg_detect_role_dispute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c        public.conversations%ROWTYPE;
  p        public.profiles%ROWTYPE;
  v_flagged timestamptz;
BEGIN
  BEGIN
    SELECT * INTO c FROM public.conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND OR c.kind <> 'help_support' THEN RETURN NULL; END IF;

    -- Only the thread's own user, never an admin reply, and never a system row.
    IF NEW.sender_id IS NULL OR NEW.sender_id IS DISTINCT FROM c.user_id THEN
      RETURN NULL;
    END IF;

    -- Deliberately narrow. A false positive costs an admin a wasted look; a
    -- loose pattern would flag ordinary support chatter as a role dispute.
    IF NEW.content !~* '(wrong (account|role|account type)|wrong type of account|selected the wrong|chose the wrong|signed up as the wrong|should (be|have been) (a|an) (client|inspector|agency|enterprise|supplier)|change my (role|account type)|not (a|an) (client|inspector) account)' THEN
      RETURN NULL;
    END IF;

    SELECT role_dispute_at INTO v_flagged
      FROM public.profile_completion_reminders WHERE user_id = c.user_id;
    IF v_flagged IS NOT NULL THEN RETURN NULL; END IF;   -- already raised once

    SELECT * INTO p FROM public.profiles WHERE id = c.user_id;

    INSERT INTO public.profile_completion_reminders AS r (user_id, role_dispute_at)
    VALUES (c.user_id, NOW())
    ON CONFLICT (user_id) DO UPDATE SET role_dispute_at = NOW();

    PERFORM public.nx_notify_admins(
      'Account type may be wrong',
      COALESCE(NULLIF(btrim(p.full_name),''), COALESCE(p.email,'A user'))
        || ' is registered as ' || public.nx_role_label(p.role)
        || ' and says the account type is wrong. Review and correct it from the user page.',
      'verification',
      '/admin/users/' || c.user_id::text,
      NULL);

    INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                     subject_table, subject_id, summary, metadata)
    VALUES ('user.role_dispute_raised', 'warning', c.user_id, 'NEXPEC Onboarding',
            'profiles', c.user_id,
            'User reports wrong account type (currently ' || COALESCE(p.role,'?') || ')',
            jsonb_build_object('current_role', p.role, 'conversation_id', c.id,
                               'self_escalation_possible', false));
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- a support reply must never fail because flagging failed
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_detect_role_dispute ON public.messages;
CREATE TRIGGER trg_detect_role_dispute
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_detect_role_dispute();

REVOKE ALL ON FUNCTION public.tg_detect_role_dispute() FROM PUBLIC, anon, authenticated;

-- ── 7 · Onboarding state, derived not duplicated ──────────────────────────
CREATE OR REPLACE FUNCTION public.nx_onboarding_state(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'role',                p.role,
    'role_label',          public.nx_role_label(p.role),
    'onboarding_sent',     (r.onboarding_sent_at IS NOT NULL),
    'onboarding_sent_at',  r.onboarding_sent_at,
    'role_confirmed',      (r.role_confirmed_at IS NOT NULL),
    'role_disputed',       (r.role_dispute_at IS NOT NULL),
    'missing_fields',      public.nx_role_missing_fields(p.id),
    'missing_labels',      (SELECT string_agg(public.nx_field_label(f), ', ')
                              FROM unnest(public.nx_role_missing_fields(p.id)) f),
    'profile_complete',    (COALESCE(array_length(public.nx_role_missing_fields(p.id),1),0) = 0),
    'verification_status', COALESCE(p.verification_status,'none'),
    'verified',            COALESCE(p.is_verified,false),
    'reminders_sent',      COALESCE(r.send_count,0),
    'last_reminder_at',    r.last_sent_at)
    FROM public.profiles p
    LEFT JOIN public.profile_completion_reminders r ON r.user_id = p.id
   WHERE p.id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.nx_onboarding_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_onboarding_state(uuid) TO authenticated, service_role;

-- ── 8 · Bounded reminder policy ───────────────────────────────────────────
--  Onboarding is once. A reminder is only ever sent to someone who is STILL
--  incomplete, at most twice more, at least 7 days apart. A completed profile
--  is never reminded again, which is enforced by the emptiness check rather
--  than by remembering to stop.
CREATE OR REPLACE FUNCTION public.nx_onboarding_reminder_sweep(p_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  u RECORD; n int := 0; v_conv uuid; v_pretty text;
BEGIN
  FOR u IN
    SELECT p.id, p.role, r.send_count
      FROM public.profiles p
      JOIN public.profile_completion_reminders r ON r.user_id = p.id
     WHERE r.onboarding_sent_at IS NOT NULL
       AND p.role NOT IN ('admin','super_admin')
       AND NOT public.nx_is_test_account(p.email)
       AND COALESCE(array_length(public.nx_role_missing_fields(p.id),1),0) > 0
       AND COALESCE(r.send_count,0) < 3
       AND COALESCE(r.last_sent_at, r.onboarding_sent_at) < NOW() - interval '7 days'
     ORDER BY r.onboarding_sent_at
     LIMIT GREATEST(COALESCE(p_limit,50),1)
  LOOP
    BEGIN
      SELECT string_agg(public.nx_field_label(f), ', ') INTO v_pretty
        FROM unnest(public.nx_role_missing_fields(u.id)) f;
      v_conv := public.nx_help_support_thread(u.id);
      CONTINUE WHEN v_conv IS NULL;

      INSERT INTO public.messages (conversation_id, sender_id, content)
      VALUES (v_conv, NULL,
        'A quick reminder from NEXPEC: your profile is still missing ' || v_pretty || '. '
        || 'Completing it lets us fully process your activity. Reply here if you need help.');

      UPDATE public.profile_completion_reminders
         SET last_sent_at = NOW(), send_count = COALESCE(send_count,0) + 1,
             missing_fields = public.nx_role_missing_fields(u.id)
       WHERE user_id = u.id;
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN CONTINUE; END;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.nx_onboarding_reminder_sweep(integer) FROM PUBLIC, anon, authenticated;
