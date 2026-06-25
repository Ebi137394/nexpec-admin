-- ════════════════════════════════════════════════════════════════════════════
--  20260801190000_notify_team_fanout.sql   (Agency Team Workspaces — Set 3, notify)
--
--  Makes the message-notification trigger TEAM-AWARE for buyer-side job threads
--  (kind='job_client_admin') whose owner has an org. The whole team is kept in
--  sync, and admins are still notified when any buyer-side party writes:
--
--     buyer-side party (principal OR teammate) posts → notify admins
--                                                     + every other org member
--     admin replies                                  → notify every org member
--
--  For EVERY non-team conversation (inspector threads, help_support, solo clients
--  with no org) the ORIGINAL behavior is reproduced byte-for-byte — no regression.
--  Reuses the existing nx_notify / nx_notify_admins primitives. Trigger binding
--  (trg_notify_messages) is unchanged; only the function body is replaced.
--  Idempotent. ADDITIVE behavior.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

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

  -- Buyer-side job thread whose owner belongs to an org team?
  IF v_conv.kind = 'job_client_admin' AND v_conv.job_id IS NOT NULL THEN
    SELECT COALESCE(j.agency_id, j.client_id) INTO v_owner
      FROM public.jobs j WHERE j.id = v_conv.job_id;
    IF v_owner IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM public.org_members WHERE user_id = v_owner) INTO v_has_team;
    END IF;
  END IF;

  IF v_has_team THEN
    -- ── Team-aware fan-out ──
    IF NOT v_is_admin THEN
      -- a buyer-side party wrote → it's a message to admin
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
    -- ── ORIGINAL behavior (unchanged) for non-team conversations ──
    IF NEW.sender_id = v_conv.user_id THEN
      PERFORM public.nx_notify_admins(
        COALESCE(NULLIF(v_conv.title, ''), 'New message'), v_preview, 'message',
        '/admin/messages/' || v_conv.id::text, v_conv.job_id);
    ELSE
      PERFORM public.nx_notify(
        v_conv.user_id, 'NEXPEC Admin replied', v_preview, 'message',
        CASE WHEN v_conv.kind LIKE 'job_%inspector%'
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
  IF v_def IS NULL THEN RAISE EXCEPTION 'SELFTEST: tg_notify_messages missing'; END IF;
  IF position('org_members' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: trigger not team-aware (no org_members fan-out)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_messages'
                 AND tgrelid = 'public.messages'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: trg_notify_messages not bound to public.messages';
  END IF;
  RAISE NOTICE 'team notification fan-out OK (buyer-side org threads).';
END $test$;

COMMIT;
