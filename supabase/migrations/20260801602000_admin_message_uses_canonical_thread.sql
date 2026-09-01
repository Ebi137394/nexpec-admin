-- ════════════════════════════════════════════════════════════════════════════
--  FIX: admin → user messages must land in the canonical Help & Support thread
--
--  ROOT CAUSE. admin_send_user_message() (20260801600000) inserted into
--  public.helpdesk_messages. The Command Console inbox at /admin/messages does
--  not read that table at all — it reads public.conversations via
--  fetchAdminConversations() (apps/web/src/lib/data/conversations.ts:98) and the
--  thread body via public.messages (same file, :271). Two unrelated stores, so
--  a message written by the RPC could never appear in the inbox.
--
--  Production carries BOTH: conversations(kind='help_support') + messages
--  (9 threads / 19 messages, read by the admin inbox AND the released mobile
--  unified inbox) and helpdesk_messages (10 rows, read only by the mobile
--  Help & Support screen — no admin surface reads it).
--
--  The conversations model is therefore the canonical admin<->user thread: it
--  is the one BOTH sides already read, its rows are literally titled
--  'Help & Support', and ensure_help_support_conversation() already builds it
--  for end users. This function is repointed at it.
--
--  BACKWARD COMPATIBLE. Function body only — no table, column, policy, trigger
--  or RPC signature changes; helpdesk_messages is left exactly as it is so the
--  released binaries keep working. No mobile build or resubmission.
--
--  POLICY PRESERVED. Posting reuses public.send_message(), which is the single
--  place conversation authorization lives. That function explicitly refuses
--  admins on job_client_inspector, job_supplier_inspector and buyer_supplier
--  rooms ("admins do not post into client-inspector direct rooms"), and only
--  its legacy admin-mediated ELSE branch — which covers help_support — accepts
--  nx_is_admin(). Reusing it means this endpoint cannot widen the
--  client<->inspector boundary even by accident.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_send_user_message(
  p_user_id uuid,
  p_content text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_conv_id    uuid;
  v_msg        public.messages;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'message cannot be empty';
  END IF;
  IF length(p_content) > 4000 THEN
    RAISE EXCEPTION 'message too long (max 4000 characters)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;

  -- Find-or-create the target user's canonical Help & Support thread. Mirrors
  -- ensure_help_support_conversation() exactly, except that function keys off
  -- auth.uid() — which for an admin caller would create the ADMIN's own thread,
  -- not the recipient's. One row per (user_id, kind), so repeat sends from User
  -- Detail reuse this thread instead of creating duplicates.
  SELECT id INTO v_conv_id
    FROM public.conversations
   WHERE user_id = p_user_id AND kind = 'help_support'
   LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (kind, user_id, title)
    VALUES ('help_support', p_user_id, 'Help & Support')
    RETURNING id INTO v_conv_id;
  END IF;

  -- Canonical poster: sender is auth.uid() (the admin), and every per-kind
  -- authorization rule stays in one place.
  v_msg := public.send_message(v_conv_id, btrim(p_content), NULL, NULL, NULL);

  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, metadata
  ) VALUES (
    'admin_user.message_sent', 'info', v_actor, v_actor_role, 'Command Console',
    'messages', v_msg.id,
    'Administrator sent a direct message to the user',
    jsonb_build_object(
      'target_user', p_user_id,
      'conversation_id', v_conv_id,
      'length', length(btrim(p_content))
    )
  );

  BEGIN
    PERFORM public.notify_safe(
      p_user_id, 'system', 'Message from NEXPEC support',
      left(btrim(p_content), 140), '/inbox/' || v_conv_id::text, NULL);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN v_msg.id;
END $$;

REVOKE ALL ON FUNCTION public.admin_send_user_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_user_message(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_send_user_message(uuid, text) IS
  'Command Console admin->user message. Posts into the recipient''s canonical conversations(kind=help_support) thread via send_message(), so it appears in /admin/messages and in the released mobile inbox, and user replies land in the same thread. Admin-only, audited, notifies the recipient.';
