-- ════════════════════════════════════════════════════════════════════════════
--  20260801198000_create_send_message_rpc.sql   (Mobile Parity Epic — Phase 1, P0)
--
--  THE missing keystone. `send_message` was called by the mobile chat hook
--  (`src/core/chat/hooks/useChat.ts` → rpc('send_message', …)) but NEVER existed
--  as a DB function → the call errored and the hook fell back to a raw
--  `messages` insert keyed by `room_id`/`job_id` with NO `conversation_id`.
--  After the silo hardening (192000 dropped the allow-all read, 194000 dropped
--  the permissive `insert_chat_msgs`), every remaining messages policy keys off
--  `conversation_id` → those fallback inserts are DENIED for non-admins. So all
--  mobile sends are broken the moment 192000/194000 are live (admins bypass via
--  nx_is_admin(), which is why it hides in testing).
--
--  This creates the canonical send path:
--    • SECURITY DEFINER → bypasses RLS, so it authorizes explicitly (mirrors
--      msg_insert_party ∪ msg_team_insert: admin | conversation owner | non-viewer
--      teammate). DEFINER also lets the AFTER-INSERT trigger
--      `_conversation_on_new_message` run its conversations UPDATE for non-owner
--      teammates without tripping conversations RLS.
--    • Inserts with sender_id = auth.uid() (never trusts the client).
--    • Does NOT touch conversation metadata — the existing BEFORE trigger
--      (`_messages_fill_sender_role`) + AFTER trigger (last_message_at / preview /
--      unread counters) already handle it once conversation_id is set.
--  Idempotent (CREATE OR REPLACE). Additive.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id  uuid,
  p_content          text DEFAULT NULL,
  p_attachment_url   text DEFAULT NULL,
  p_attachment_type  text DEFAULT NULL,
  p_attachment_name  text DEFAULT NULL
) RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id required';
  END IF;
  IF btrim(COALESCE(p_content, '')) = '' AND p_attachment_url IS NULL THEN
    RAISE EXCEPTION 'empty message (need content or attachment)';
  END IF;

  -- SECURITY DEFINER bypasses RLS → authorize here. Poster must be: the platform
  -- admin, the conversation OWNER on an open thread, or a non-viewer TEAMMATE
  -- (buyer-side team chat). Same union the messages INSERT policies enforce.
  IF NOT (
        public.nx_is_admin()
     OR EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.id = p_conversation_id
                   AND c.user_id = v_uid
                   AND c.status = 'open')
     OR public.nx_can_team_manage_conversation(p_conversation_id)
  ) THEN
    RAISE EXCEPTION 'not authorised to post to this conversation' USING errcode = '42501';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, content,
                               attachment_url, attachment_type, attachment_name)
  VALUES (p_conversation_id, v_uid, btrim(COALESCE(p_content, '')),
          p_attachment_url, p_attachment_type, p_attachment_name)
  RETURNING * INTO v_row;

  RETURN v_row;
END
$fn$;

REVOKE ALL    ON FUNCTION public.send_message(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.send_message(uuid, text, text, text, text) IS
  'Canonical message send. SECURITY DEFINER + explicit poster check (admin | conversation owner | non-viewer teammate); inserts sender_id=auth.uid(); triggers maintain conversation metadata. Replaces raw client inserts the hardened messages RLS denies.';

-- ── Structural self-test (behavioural deny-matrix → tests/rls_messages_silo_test.sql)
DO $test$
BEGIN
  IF to_regprocedure('public.send_message(uuid, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: send_message missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = to_regprocedure('public.send_message(uuid, text, text, text, text)')) THEN
    RAISE EXCEPTION 'SELFTEST: send_message must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.send_message(uuid, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon must NOT execute send_message';
  END IF;
  RAISE NOTICE 'send_message OK (SECURITY DEFINER; anon revoked).';
END
$test$;

COMMIT;
