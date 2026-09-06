-- ════════════════════════════════════════════════════════════════════════════
--  Email as the SECOND onboarding channel. The in-app Help & Support thread
--  stays canonical; email mirrors it from the same derived state.
--
--  WHY NO EMAIL WAS EVER SENT — three independent blockers, all confirmed on
--  Production before writing this:
--    1. notify_safe() never sets email_required, so all 21 onboarding
--       notifications sat at email_required = false and nothing entered the
--       outbox. emails_ever_sent was 0.
--    2. The dispatcher reads EMAIL_FROM, which was NOT SET, so it fell back to
--       its hardcoded 'NEXPEC <notifications@nexpec.com>' — the WRONG domain.
--       Only nexpecapp.com is verified in Resend, so that sender could only
--       ever be rejected.
--    3. FROM_EMAIL / RESEND_FROM_EMAIL were 'onboarding@resend.dev', Resend's
--       shared sandbox sender, which cannot deliver to arbitrary recipients.
--  (2) and (3) are fixed in edge-function secrets; (1) is fixed here.
--
--  There is NO second state machine: the email is enqueued by the same
--  function that writes the Help & Support message, from the same
--  nx_role_missing_fields() answer, guarded by the same ledger.
-- ════════════════════════════════════════════════════════════════════════════

-- Where a user of each role actually completes their profile. Verified live
-- against Production: these return 307 -> /sign-in?next=... for a signed-out
-- visitor, so an email link parks them on sign-in and the OAuth callback
-- carries them straight back here afterwards.
CREATE OR REPLACE FUNCTION public.nx_profile_path(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(COALESCE(p_role,''))
    WHEN 'inspector' THEN '/inspector/profile'
    WHEN 'senior'    THEN '/inspector/profile'
    WHEN 'supplier'  THEN '/suppliers/profile'
    ELSE '/client/profile'          -- client, agency, enterprise
  END;
$$;
REVOKE ALL ON FUNCTION public.nx_profile_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_profile_path(text) TO authenticated, service_role;

-- A hard bounce must never be retried: repeated sends to a dead address are
-- what get a sending domain suppressed.
CREATE OR REPLACE FUNCTION public.nx_email_suppressed(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.recipient_id = p_user_id
       AND n.email_send_error IS NOT NULL
       AND (n.email_send_error ~* '(bounce|invalid|does not exist|not found|suppress|blocked|complaint|unsubscrib)'
            OR COALESCE(n.email_attempts,0) >= 5))
  OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user_id AND COALESCE(btrim(p.email),'') <> ''
       AND p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
$$;
REVOKE ALL ON FUNCTION public.nx_email_suppressed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_email_suppressed(uuid) TO authenticated, service_role;

-- ── Onboarding now writes the thread message AND queues the email ─────────
CREATE OR REPLACE FUNCTION public.nx_send_role_onboarding(p_user_id uuid,
                                                          p_force boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  p           public.profiles%ROWTYPE;
  v_missing   text[];
  v_labels    text[];
  v_pretty    text;
  v_conv      uuid;
  v_body      text;
  v_prev      RECORD;
  v_supersede boolean := false;
  v_msg       uuid;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p.role IS NULL OR p.role IN ('admin','super_admin') THEN RETURN false; END IF;
  IF public.nx_is_test_account(p.email) THEN RETURN false; END IF;

  SELECT onboarding_sent_at, onboarding_role INTO v_prev
    FROM public.profile_completion_reminders WHERE user_id = p_user_id;

  IF NOT p_force AND v_prev.onboarding_sent_at IS NOT NULL THEN
    IF COALESCE(v_prev.onboarding_role,'') = p.role THEN RETURN false; END IF;
    IF v_prev.onboarding_sent_at > NOW() - interval '15 minutes' THEN
      v_supersede := true;
    END IF;
  END IF;

  v_missing := public.nx_role_missing_fields(p_user_id);
  SELECT array_agg(public.nx_field_label(f) ORDER BY ord)
    INTO v_labels FROM unnest(v_missing) WITH ORDINALITY AS u(f, ord);
  v_pretty := array_to_string(v_labels, ', ');

  v_body :=
    'Welcome to NEXPEC. You registered as '
      || CASE WHEN left(public.nx_role_label(p.role),1) IN ('A','E','I','O','U')
              THEN 'an ' ELSE 'a ' END
      || public.nx_role_label(p.role)
      || ', ' || public.nx_role_blurb(p.role) || '.' || E'\n\n'
    || 'Please confirm that this account type is correct.' || E'\n\n'
    || CASE WHEN COALESCE(v_pretty,'') = ''
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

  IF v_supersede THEN
    SELECT m.id INTO v_msg FROM public.messages m
     WHERE m.conversation_id = v_conv AND m.sender_id IS NULL AND m.deleted_at IS NULL
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
        role_confirmed_at  = NULL,
        role_dispute_at    = NULL;

  -- In-app notification AND the email, in one canonical enqueue. Email is
  -- requested only when the address is usable and not suppressed; a bad
  -- address downgrades this to in-app only rather than failing the signup.
  -- When the role settles (profiles.role DEFAULTS to 'client', and the shipped
  -- app writes the real role a moment later), the thread message is rewritten
  -- above. The QUEUED EMAIL must be rewritten with it — otherwise the message
  -- says Inspector while the email still says Client. Rewrite in place while it
  -- is still undelivered; only enqueue fresh when there is nothing to correct.
  IF v_supersede THEN
    UPDATE public.notifications
       SET email_template_data = jsonb_build_object(
             'name',          COALESCE(NULLIF(btrim(p.full_name),''), split_part(COALESCE(p.email,'there'),'@',1)),
             'role_label',    public.nx_role_label(p.role),
             'role_blurb',    public.nx_role_blurb(p.role),
             'missing_labels', COALESCE(to_jsonb(v_labels), '[]'::jsonb),
             'profile_path',  public.nx_profile_path(p.role),
             'template_version','onboarding.v1'),
           body = CASE WHEN COALESCE(v_pretty,'') = '' THEN 'Please confirm your account type.'
                       ELSE 'Please confirm your account type and add: ' || v_pretty || '.' END,
           email_required = NOT public.nx_email_suppressed(p_user_id)
     WHERE recipient_id = p_user_id
       AND email_template_kind = 'user.onboarding'
       AND email_dispatched_at IS NULL;
    IF FOUND THEN
      RETURN true;   -- corrected in place; no second notification, no second email
    END IF;
  END IF;

  BEGIN
    PERFORM public.enqueue_notification(
      p_user_id, 'system', 'Welcome to NEXPEC',
      CASE WHEN COALESCE(v_pretty,'') = '' THEN 'Please confirm your account type.'
           ELSE 'Please confirm your account type and add: ' || v_pretty || '.' END,
      '/inbox/' || v_conv::text, NULL,
      NOT public.nx_email_suppressed(p_user_id),          -- p_email_required
      'user.onboarding',                                   -- p_template_kind
      jsonb_build_object(
        'name',          COALESCE(NULLIF(btrim(p.full_name),''), split_part(COALESCE(p.email,'there'),'@',1)),
        'role_label',    public.nx_role_label(p.role),
        'role_blurb',    public.nx_role_blurb(p.role),
        'missing_labels', COALESCE(to_jsonb(v_labels), '[]'::jsonb),
        'profile_path',  public.nx_profile_path(p.role),
        'template_version', 'onboarding.v1'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                     subject_table, subject_id, summary, metadata)
    VALUES ('user.onboarding_sent', 'info', p_user_id, 'NEXPEC Onboarding',
            'profiles', p_user_id,
            'Role onboarding sent to ' || public.nx_role_label(p.role),
            jsonb_build_object('role', p.role, 'missing_fields', v_missing,
                               'conversation_id', v_conv,
                               'email_requested', NOT public.nx_email_suppressed(p_user_id),
                               'template_version', 'onboarding.v1'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.nx_send_role_onboarding(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_send_role_onboarding(uuid, boolean) TO service_role;
