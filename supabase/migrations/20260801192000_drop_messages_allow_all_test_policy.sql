-- ════════════════════════════════════════════════════════════════════════════
--  20260801192000_drop_messages_allow_all_test_policy.sql   (CRITICAL silo fix)
--
--  Removes a leftover policy from the baseline:
--      CREATE POLICY "Allow all access to messages for testing"
--        ON public.messages USING (true);
--
--  It is PERMISSIVE with no FOR clause and USING(true) → it grants EVERY role
--  full access to ALL chat messages, silently nullifying the client↔admin and
--  inspector↔admin silos (and making the team-chat RLS moot). Surfaced by the
--  rls_team_workspace pgTAP suite (an unrelated user could read the inspector
--  thread).
--
--  The legitimate, scoped message policies REMAIN and continue to govern access:
--    • msg_select_via_conv            (admin OR conversation owner)
--    • view_chat_msgs                 (job client_id / contractor_id)
--    • "Admins can read ALL messages" (admin)
--    • msg_team_select / msg_team_insert (org team — buyer silo only)
--    • msg_insert_party / insert_chat_msgs (sender = self)
--    • hide_soft_deleted (RESTRICTIVE)
--
--  Idempotent. SECURITY HARDENING (removes access, grants none).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DROP POLICY IF EXISTS "Allow all access to messages for testing" ON public.messages;

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='messages'
      AND policyname='Allow all access to messages for testing'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: allow-all messages policy still present';
  END IF;
  -- RLS still on + the real silo policy still present (we removed a leak, not the guard)
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.messages'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: RLS disabled on public.messages';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='messages' AND policyname='msg_select_via_conv'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: msg_select_via_conv (silo policy) missing';
  END IF;
  RAISE NOTICE 'messages allow-all test policy dropped; chat silos now enforced.';
END $test$;

COMMIT;
