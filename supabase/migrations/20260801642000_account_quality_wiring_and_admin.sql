-- ════════════════════════════════════════════════════════════════════════════
--  Wire account quality into every operational surface, and give Admin the
--  controls to correct it.
--
--  nx_is_test_account() is already the single predicate that /status,
--  /pending, /today, /users, the onboarding sender and the new-user alert all
--  consult. Rather than edit six function bodies — and risk them drifting —
--  the PREDICATE itself now also honours a confirmed known_test_or_fake
--  classification. Every call site inherits it at once.
--
--  It becomes STABLE (it reads a table now) instead of IMMUTABLE. Verified
--  before changing: no index, view, RLS policy or CHECK constraint depends on
--  it, so the volatility change is safe.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.nx_is_test_account(p_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE(p_email, '') ~* '(@test[.]com$|@example[.]com$|@acme[.]com$|@nexpec[.]test$|@synthetic[.]invalid$|^e2e[.]|^apple_tester@)'
      OR EXISTS (
        SELECT 1 FROM public.account_quality q
          JOIN public.profiles p ON p.id = q.user_id
         WHERE lower(p.email) = lower(btrim(COALESCE(p_email,'')))
           AND q.state = 'known_test_or_fake');
$$;
REVOKE ALL ON FUNCTION public.nx_is_test_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_test_account(text) TO authenticated, service_role;

-- ── Admin: the account-quality queue ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_account_quality(p_state text DEFAULT NULL,
                                                             p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(t ORDER BY t.state DESC, t.classified_at DESC), '[]'::jsonb) INTO v_out
    FROM (
      SELECT p.id, p.email, p.role, p.full_name,
             COALESCE(q.state,'normal')            AS state,
             COALESCE(q.reasons,'{}')              AS reasons,
             COALESCE(q.email_suppressed,false)    AS email_suppressed,
             q.suppress_reason, q.is_manual, q.notes,
             COALESCE(q.classified_at, p.created_at) AS classified_at,
             (SELECT max(n.email_last_attempt_at) FROM public.notifications n
               WHERE n.recipient_id = p.id)        AS last_email_attempt,
             (SELECT n.email_send_error FROM public.notifications n
               WHERE n.recipient_id = p.id AND n.email_send_error IS NOT NULL
               ORDER BY n.email_last_attempt_at DESC LIMIT 1) AS last_email_error,
             EXISTS (SELECT 1 FROM public.profile_completion_reminders r
                      WHERE r.user_id = p.id AND r.onboarding_sent_at IS NOT NULL) AS onboarded
        FROM public.profiles p
        LEFT JOIN public.account_quality q ON q.user_id = p.id
       WHERE (p_state IS NULL OR COALESCE(q.state,'normal') = p_state)
       ORDER BY COALESCE(q.state,'normal') DESC, COALESCE(q.classified_at, p.created_at) DESC
       LIMIT GREATEST(COALESCE(p_limit,50),1)) t;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_account_quality(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_account_quality(text,integer) TO authenticated, service_role;

-- ── Admin: correct a classification. Audited, never destructive. ──────────
CREATE OR REPLACE FUNCTION public.admin_set_account_quality(p_user_id uuid,
                                                            p_state text,
                                                            p_suppress_email boolean DEFAULT NULL,
                                                            p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_before RECORD; v_sup boolean;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('normal','suspicious','known_test_or_fake') THEN
    RAISE EXCEPTION 'invalid state %', p_state;
  END IF;
  -- This function deliberately cannot delete an account. Reclassifying is
  -- reversible; deletion is not, and is not part of this capability.
  SELECT * INTO v_before FROM public.account_quality WHERE user_id = p_user_id;
  v_sup := COALESCE(p_suppress_email,
                    CASE WHEN p_state = 'known_test_or_fake' THEN true
                         WHEN p_state = 'normal' THEN false
                         ELSE COALESCE(v_before.email_suppressed,false) END);

  INSERT INTO public.account_quality (user_id, state, reasons, email_suppressed,
                                      suppress_reason, classified_by, is_manual, notes)
  VALUES (p_user_id, p_state, ARRAY['admin_manual_classification'], v_sup,
          CASE WHEN v_sup THEN COALESCE(p_note,'set by admin') END,
          auth.uid(), true, p_note)
  ON CONFLICT (user_id) DO UPDATE
    SET state = EXCLUDED.state,
        reasons = EXCLUDED.reasons,
        email_suppressed = EXCLUDED.email_suppressed,
        suppress_reason = EXCLUDED.suppress_reason,
        classified_by = EXCLUDED.classified_by,
        is_manual = true,
        notes = COALESCE(EXCLUDED.notes, public.account_quality.notes),
        classified_at = NOW();

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                   subject_table, subject_id, summary, metadata)
  VALUES ('account_quality.changed', 'warning', auth.uid(), 'Admin Console',
          'profiles', p_user_id,
          'Account quality set to ' || p_state,
          jsonb_build_object('from', COALESCE(v_before.state,'normal'),
                             'to', p_state,
                             'email_suppressed', v_sup,
                             'was_manual', COALESCE(v_before.is_manual,false),
                             'note', p_note));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_account_quality(uuid,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_quality(uuid,text,boolean,text) TO authenticated, service_role;

-- Bot-scoped read for Telegram, authorised through the paired allowlist row.
CREATE OR REPLACE FUNCTION public.tg_account_quality(p_chat_id bigint, p_state text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.tg_bot_actor(p_chat_id, false);
  SELECT public.admin_list_account_quality(p_state, 10) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.tg_account_quality(bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_account_quality(bigint,text) TO service_role;
