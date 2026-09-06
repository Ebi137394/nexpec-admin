-- ════════════════════════════════════════════════════════════════════════════
--  Reminders gain the email channel, on the SAME bounded ledger.
--
--  Policy is unchanged and shared with the in-app reminder: at most 3 sends
--  total, at least 7 days apart, only while still incomplete, and it stops the
--  moment the profile is complete — enforced by the emptiness check rather
--  than by remembering to stop. Email never gets its own counter, so the two
--  channels cannot drift into sending different numbers of reminders.
--
--  A hard-bounced or invalid address is skipped outright: repeatedly mailing a
--  dead address is what gets a sending domain suppressed.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.nx_onboarding_reminder_sweep(p_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  u RECORD; n int := 0; v_conv uuid; v_pretty text; v_labels text[];
BEGIN
  FOR u IN
    SELECT p.id, p.role, p.email, p.full_name, r.send_count
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
      SELECT array_agg(public.nx_field_label(f) ORDER BY ord)
        INTO v_labels FROM unnest(public.nx_role_missing_fields(u.id)) WITH ORDINALITY AS t(f,ord);
      v_pretty := array_to_string(v_labels, ', ');

      v_conv := public.nx_help_support_thread(u.id);
      CONTINUE WHEN v_conv IS NULL;

      INSERT INTO public.messages (conversation_id, sender_id, content)
      VALUES (v_conv, NULL,
        'A quick reminder from NEXPEC: your profile is still missing ' || v_pretty || '. '
        || 'Completing it lets us fully process your activity. Reply here if you need help.');

      -- Same enqueue for in-app + email; email only when the address is usable.
      BEGIN
        PERFORM public.enqueue_notification(
          u.id, 'system', 'Complete your NEXPEC profile',
          'Your profile is still missing: ' || v_pretty || '.',
          '/inbox/' || v_conv::text, NULL,
          NOT public.nx_email_suppressed(u.id),
          'user.onboarding',
          jsonb_build_object(
            'name', COALESCE(NULLIF(btrim(u.full_name),''), split_part(COALESCE(u.email,'there'),'@',1)),
            'role_label', public.nx_role_label(u.role),
            'role_blurb', public.nx_role_blurb(u.role),
            'missing_labels', COALESCE(to_jsonb(v_labels),'[]'::jsonb),
            'profile_path', public.nx_profile_path(u.role),
            'template_version','onboarding.v2'));
      EXCEPTION WHEN OTHERS THEN NULL; END;

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

-- A hard bounce we have already suppressed is RESOLVED, not outstanding, so it
-- must not sit in the owner's urgent tier forever. Genuine provider failures
-- (where the address is still deliverable) remain urgent.
CREATE OR REPLACE FUNCTION public.tg_delivery_failure_actionable(p_recipient uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT NOT public.nx_email_suppressed(p_recipient);
$$;
REVOKE ALL ON FUNCTION public.tg_delivery_failure_actionable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_delivery_failure_actionable(uuid) TO authenticated, service_role;
