-- ════════════════════════════════════════════════════════════════════════════
--  20260801194000_fix_message_insert_silo_and_notify_enum.sql
--
--  Two fixes surfaced by the rls_team_workspace pgTAP suite:
--
--  1. WRITE-SILO HOLE: baseline policy "insert_chat_msgs" is
--        FOR INSERT WITH CHECK (auth.uid() = sender_id)
--     i.e. ANY user can post to ANY conversation as long as sender_id = self —
--     no party/role check. It's the write-side twin of the allow-all read policy
--     (dropped in 192000). It let a teammate post into the inspector thread and a
--     viewer post into the buyer thread. The correct, scoped INSERT policies
--     remain and cover all legitimate posting:
--        • msg_insert_party  (sender=self AND (admin OR own OPEN conversation))
--        • msg_team_insert   (org team, non-viewer, buyer thread, open)
--     → DROP the loose policy.
--
--  2. NOTIFY ENUM BUG: tg_notify_messages compared conversation_kind (an enum)
--     with LIKE ('job_%inspector%') → "operator does not exist: conversation_kind
--     ~~ unknown" (swallowed by the trigger's EXCEPTION guard, so inspector-thread
--     notifications silently failed). Replace with an enum-safe equality.
--
--  Idempotent. Security hardening + bugfix.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Drop the loose INSERT policy ───────────────────────────────────────────
DROP POLICY IF EXISTS "insert_chat_msgs" ON public.messages;

-- ── 2. Enum-safe notify trigger (same team-aware logic as 190000) ─────────────
CREATE OR REPLACE FUNCTION public.tg_notify_messages() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_conv     RECORD;
  v_preview  text;
  v_owner    uuid;
  v_has_team boolean := false;
  v_is_admin boolean;
  v_title    text;
  r          RECORD;
BEGIN
  SELECT id, user_id, kind, title, job_id INTO v_conv
    FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_preview := COALESCE(
    NULLIF(LEFT(NEW.content, 140), ''),
    CASE WHEN NEW.attachment_url IS NOT NULL THEN '📎 Attachment' ELSE 'New message' END
  );
  v_is_admin := public.nx_is_admin(NEW.sender_id);

  IF v_conv.kind = 'job_client_admin'::public.conversation_kind AND v_conv.job_id IS NOT NULL THEN
    SELECT COALESCE(j.agency_id, j.client_id) INTO v_owner
      FROM public.jobs j WHERE j.id = v_conv.job_id;
    IF v_owner IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM public.org_members WHERE user_id = v_owner) INTO v_has_team;
    END IF;
  END IF;

  IF v_has_team THEN
    IF NOT v_is_admin THEN
      PERFORM public.nx_notify_admins(
        COALESCE(NULLIF(v_conv.title, ''), 'New message'), v_preview, 'message',
        '/admin/messages/' || v_conv.id::text, v_conv.job_id);
    END IF;
    v_title := CASE WHEN v_is_admin THEN 'NEXPEC Admin replied' ELSE 'New team message' END;
    FOR r IN
      SELECT DISTINCT om.user_id
      FROM public.org_members om
      WHERE om.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_owner)
        AND om.user_id <> NEW.sender_id
    LOOP
      PERFORM public.nx_notify(
        r.user_id, v_title, v_preview, 'message',
        '/client/jobs/' || v_conv.job_id::text, v_conv.job_id);
    END LOOP;

  ELSE
    IF NEW.sender_id = v_conv.user_id THEN
      PERFORM public.nx_notify_admins(
        COALESCE(NULLIF(v_conv.title, ''), 'New message'), v_preview, 'message',
        '/admin/messages/' || v_conv.id::text, v_conv.job_id);
    ELSE
      PERFORM public.nx_notify(
        v_conv.user_id, 'NEXPEC Admin replied', v_preview, 'message',
        CASE WHEN v_conv.kind = 'job_inspector_admin'::public.conversation_kind
             THEN '/inspector/messages/' || v_conv.id::text
             ELSE '/client/messages/' || v_conv.id::text END,
        v_conv.job_id);
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tg_notify_messages failed: %', SQLERRM;
  RETURN NEW;
END $fn$;

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $test$
DECLARE v_def text := pg_get_functiondef(to_regprocedure('public.tg_notify_messages()'));
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages'
             AND policyname='insert_chat_msgs') THEN
    RAISE EXCEPTION 'SELFTEST: loose insert_chat_msgs still present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages'
                 AND policyname='msg_insert_party') THEN
    RAISE EXCEPTION 'SELFTEST: scoped msg_insert_party missing (would block legit posting)';
  END IF;
  IF position('~~' in v_def) > 0 OR position(' LIKE ' in v_def) > 0 THEN
    RAISE EXCEPTION 'SELFTEST: tg_notify_messages still uses LIKE on the kind enum';
  END IF;
  RAISE NOTICE 'message INSERT silo tightened + notify enum-safe.';
END $test$;

COMMIT;
