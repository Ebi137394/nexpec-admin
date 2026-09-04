-- ════════════════════════════════════════════════════════════════════════════
--  Make the Telegram action audit ATOMIC with the action it describes.
--
--  THE GAP. Every other property of the identity-adoption mechanism held under
--  test, but the audit trail did not hold the word "always". The
--  telegram.admin_action row was written by the edge function in a SEPARATE
--  statement AFTER the mutation had already committed. If the function crashed,
--  timed out, or that insert failed in between, the mutation still stood while
--  its audit did not — and what survived was worse than nothing:
--     · admin_request_job_edits writes its own audit row, but that row carries
--       only the adopted NEXPEC admin uuid. Nothing in it says Telegram did it.
--     · admin_request_profile_completion writes no audit row at all, so the
--       action could leave no trace whatsoever.
--
--  The fix keeps the mechanism exactly as it is and moves the record into the
--  same transaction as the mutation, so a Telegram-initiated state change and
--  its audit row now commit or roll back together. It is no longer possible to
--  mutate through this path without recording both identities.
--
--  The Telegram user id is read from the allowlist row rather than taken from
--  the caller, so the audited Telegram identity is the paired one by
--  construction and cannot be spoofed by a parameter.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_audit_action(p_chat_id bigint,
                                                  p_actor   uuid,
                                                  p_action  text,
                                                  p_subject_table text,
                                                  p_subject uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tg_user bigint;
BEGIN
  -- Authoritative: the paired Telegram user, not one supplied by the caller.
  SELECT c.telegram_user_id INTO v_tg_user
    FROM public.telegram_admin_chats c WHERE c.chat_id = p_chat_id;

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_label,
                                   subject_table, subject_id, summary, metadata)
  VALUES ('telegram.admin_action', 'warning', p_actor,
          'Telegram Admin Control Center (chat ' || p_chat_id::text || ')',
          p_subject_table, p_subject,
          'Telegram action ' || p_action,
          jsonb_build_object('source', 'telegram_admin_control_center',
                             'action', p_action,
                             'telegram_chat_id', p_chat_id,
                             'telegram_user_id', v_tg_user,
                             'nexpec_admin_id', p_actor,
                             'atomic_with_mutation', true));
END $$;

REVOKE ALL ON FUNCTION public.tg_audit_action(bigint, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_audit_action(bigint, uuid, text, text, uuid) TO service_role;

-- ── The two mutations now audit themselves, in-transaction ────────────────
CREATE OR REPLACE FUNCTION public.tg_do_request_profile_completion(p_chat_id bigint,
                                                                   p_user_id uuid,
                                                                   p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.tg_bot_actor(p_chat_id, true);   -- mutation: can_act required
  PERFORM public.admin_request_profile_completion(p_user_id, p_note);
  PERFORM public.tg_audit_action(p_chat_id, v_actor,
                                 'request_profile_completion', 'profiles', p_user_id);
  RETURN true;
END $$;

--  admin_request_job_edits refuses an empty reason on purpose, so the client is
--  always told what to change. The bot therefore always supplies one.
CREATE OR REPLACE FUNCTION public.tg_do_request_job_edits(p_chat_id bigint,
                                                          p_job_id uuid,
                                                          p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.tg_bot_actor(p_chat_id, true);   -- mutation: can_act required
  PERFORM public.admin_request_job_edits(
    p_job_id,
    COALESCE(NULLIF(btrim(p_note), ''),
             'Please review and complete the job details so it can be approved.'));
  PERFORM public.tg_audit_action(p_chat_id, v_actor,
                                 'request_job_edits', 'jobs', p_job_id);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.tg_do_request_profile_completion(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_do_request_job_edits(bigint, uuid, text)          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_do_request_profile_completion(bigint, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_do_request_job_edits(bigint, uuid, text)          TO service_role;
