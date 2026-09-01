-- ════════════════════════════════════════════════════════════════════════════
--  Command Console: admin role correction + admin→user message
--
--  Both are ADDITIVE, SECURITY DEFINER RPCs. Nothing existing is altered:
--  no table, column, policy, enum or RPC is modified or dropped, so the
--  released iOS (build 14) and Android (versionCode 24) binaries keep working
--  unchanged and no new mobile build is required.
--
--  Roles are the canonical set already enforced by the profiles.role CHECK:
--    inspector, client, agency, enterprise, supplier, senior, admin, super_admin
--  No new role name is invented.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · admin_change_user_role ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_change_user_role(
  p_user_id  uuid,
  p_new_role text,
  p_reason   text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_old_role   text;
  v_email      text;
  -- Roles an ordinary admin may move a user between. Elevated roles are
  -- deliberately excluded so this endpoint can never become a privilege-
  -- escalation path.
  c_operational constant text[] := ARRAY['client','inspector','agency','enterprise','supplier','senior'];
  c_elevated    constant text[] := ARRAY['admin','super_admin'];
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  SELECT role, email INTO v_old_role, v_email FROM public.profiles WHERE id = p_user_id;

  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  -- Must be a role the profiles CHECK already accepts.
  IF NOT (p_new_role = ANY (c_operational || c_elevated)) THEN
    RAISE EXCEPTION 'invalid role: %', p_new_role;
  END IF;

  IF p_new_role = v_old_role THEN
    RAISE EXCEPTION 'user already has role %', p_new_role;
  END IF;

  -- An admin may not change their own role (self-escalation / self-lockout).
  IF p_user_id = v_actor THEN
    RAISE EXCEPTION 'you cannot change your own role';
  END IF;

  -- PRIVILEGE PROTECTION. Note nx_is_admin() is true for BOTH admin and
  -- super_admin, and is_super_admin() is a misnomer (it also returns true for
  -- 'support'), so neither is sufficient here: the guard reads the actor's own
  -- role directly. Granting or removing an elevated role is super_admin-only.
  IF (p_new_role = ANY (c_elevated) OR v_old_role = ANY (c_elevated))
     AND COALESCE(v_actor_role, '') <> 'super_admin' THEN
    RAISE EXCEPTION 'only a super_admin may grant or change an administrative role';
  END IF;

  -- Identity, jobs, documents and history are all keyed on profiles.id, which
  -- is untouched: this is a single column update, never a delete-and-recreate.
  UPDATE public.profiles
     SET role = p_new_role, updated_at = NOW()
   WHERE id = p_user_id;

  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, delta, metadata
  ) VALUES (
    'admin_user.role_changed',
    CASE WHEN p_new_role = ANY (c_elevated) OR v_old_role = ANY (c_elevated)
         THEN 'critical' ELSE 'warning' END,
    v_actor, v_actor_role, 'Command Console',
    'profiles', p_user_id,
    format('Role changed from %s to %s', v_old_role, p_new_role),
    jsonb_build_object('role', jsonb_build_object('from', v_old_role, 'to', p_new_role)),
    jsonb_build_object('reason', p_reason, 'target_email', v_email)
  );

  -- Best-effort, exactly as admin_verify_user does: never let notification
  -- delivery fail the mutation.
  BEGIN
    PERFORM public.notify_safe(
      p_user_id, 'system', 'Your account type was updated',
      format('An administrator changed your account type to %s.%s',
             p_new_role, CASE WHEN p_reason IS NULL OR p_reason = '' THEN ''
                              ELSE ' ' || p_reason END),
      NULL, NULL);
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

REVOKE ALL ON FUNCTION public.admin_change_user_role(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_change_user_role(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.admin_change_user_role(uuid, text, text) IS
  'Command Console role correction. Admin-only; elevated roles (admin/super_admin) require the caller to BE super_admin. Same user id preserved; writes audit_events admin_user.role_changed and notifies the user.';

-- ── 2 · admin_send_user_message ─────────────────────────────────────────────
--  Writes into public.helpdesk_messages — the EXISTING admin<->user channel.
--  The released mobile apps already read it and subscribe to realtime INSERTs
--  filtered on user_id (app/support-chat.tsx, "Help & Support"), so the message
--  appears live in the shipped binaries with no app update.
--
--  This is user<->support only. It creates no client<->inspector path: those
--  live in conversations.kind = 'job_client_inspector' and are untouched.
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
  v_msg_id     uuid;
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

  -- One thread per user is implicit: helpdesk_messages is keyed by user_id, so
  -- this appends to the existing support thread rather than creating a new one.
  INSERT INTO public.helpdesk_messages (user_id, sender_id, content, is_read)
  VALUES (p_user_id, v_actor, btrim(p_content), false)
  RETURNING id INTO v_msg_id;

  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, metadata
  ) VALUES (
    'admin_user.message_sent', 'info', v_actor, v_actor_role, 'Command Console',
    'helpdesk_messages', v_msg_id,
    'Administrator sent a direct message to the user',
    jsonb_build_object('target_user', p_user_id, 'length', length(btrim(p_content)))
  );

  BEGIN
    PERFORM public.notify_safe(
      p_user_id, 'system', 'Message from NEXPEC support',
      left(btrim(p_content), 140), '/support-chat', NULL);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN v_msg_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_send_user_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_user_message(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_send_user_message(uuid, text) IS
  'Command Console admin->user message. Appends to the existing helpdesk_messages support thread the released apps already read; admin-only, audited, notifies the recipient. Creates no client<->inspector channel.';
