-- ════════════════════════════════════════════════════════════════════════════
--  20260801200000_backfill_messages_conversation_id.sql  (Mobile Parity — Phase 1)
--
--  Legacy mobile chat inserted into `messages` keyed by `job_id` (room_id IS NULL)
--  with NO `conversation_id`. The hardened RLS only makes a row visible/insertable
--  through its `conversation_id` → those legacy rows are now invisible. This
--  backfills `conversation_id` so history survives the cutover.
--
--  HEURISTIC (documented + reversible — rows keep `job_id`, so a corrective re-run
--  is possible by re-nulling conversation_id):
--    For each job with legacy rows, ensure the two siloed conversations exist:
--      job_client_admin    (user_id = jobs.client_id)
--      job_inspector_admin (user_id = jobs.contractor_id)
--    Then route messages:
--      • sender = contractor  → inspector↔admin room (unambiguous)
--      • everyone else (client + admin + others) → client↔admin room
--        (admin-sent legacy messages are ambiguous in the old single-thread model;
--         routing them to the buyer channel preserves the client's history. The
--         retained job_id allows a later, finer re-classification if ever needed.)
--    Only touches rows where conversation_id IS NULL AND room_id IS NULL (the
--    legacy job-chat shape). admin_support `room_id` rows are left untouched
--    (handled separately by ensure_help_support_conversation at the app layer).
--  Idempotent: re-running affects only still-null rows.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DO $backfill$
DECLARE
  r              record;
  v_client_conv  uuid;
  v_insp_conv    uuid;
  v_remaining    bigint;
BEGIN
  FOR r IN
    SELECT DISTINCT m.job_id, j.client_id, j.contractor_id
    FROM public.messages m
    JOIN public.jobs j ON j.id = m.job_id
    WHERE m.conversation_id IS NULL
      AND m.room_id IS NULL
      AND m.job_id IS NOT NULL
  LOOP
    v_client_conv := NULL;
    v_insp_conv   := NULL;

    -- Ensure client↔admin conversation
    IF r.client_id IS NOT NULL THEN
      SELECT id INTO v_client_conv
        FROM public.conversations
       WHERE job_id = r.job_id AND kind = 'job_client_admin'::public.conversation_kind
         AND user_id = r.client_id
       LIMIT 1;
      IF v_client_conv IS NULL THEN
        INSERT INTO public.conversations (kind, user_id, job_id, title)
        VALUES ('job_client_admin'::public.conversation_kind, r.client_id, r.job_id, 'Job chat · client side')
        RETURNING id INTO v_client_conv;
      END IF;
    END IF;

    -- Ensure inspector↔admin conversation
    IF r.contractor_id IS NOT NULL THEN
      SELECT id INTO v_insp_conv
        FROM public.conversations
       WHERE job_id = r.job_id AND kind = 'job_inspector_admin'::public.conversation_kind
         AND user_id = r.contractor_id
       LIMIT 1;
      IF v_insp_conv IS NULL THEN
        INSERT INTO public.conversations (kind, user_id, job_id, title)
        VALUES ('job_inspector_admin'::public.conversation_kind, r.contractor_id, r.job_id, 'Job chat · inspector side')
        RETURNING id INTO v_insp_conv;
      END IF;
    END IF;

    -- Route inspector-sent messages to the inspector room (unambiguous)
    IF v_insp_conv IS NOT NULL THEN
      UPDATE public.messages
         SET conversation_id = v_insp_conv
       WHERE job_id = r.job_id AND room_id IS NULL AND conversation_id IS NULL
         AND sender_id = r.contractor_id;
    END IF;

    -- Route the remainder (client + admin + others) to the client room;
    -- if there is no client side, fall back to the inspector room.
    IF v_client_conv IS NOT NULL THEN
      UPDATE public.messages
         SET conversation_id = v_client_conv
       WHERE job_id = r.job_id AND room_id IS NULL AND conversation_id IS NULL;
    ELSIF v_insp_conv IS NOT NULL THEN
      UPDATE public.messages
         SET conversation_id = v_insp_conv
       WHERE job_id = r.job_id AND room_id IS NULL AND conversation_id IS NULL;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_remaining
    FROM public.messages
   WHERE conversation_id IS NULL AND room_id IS NULL AND job_id IS NOT NULL;
  RAISE NOTICE 'conversation_id backfill complete. Remaining null-conversation job messages: %', v_remaining;
END
$backfill$;

COMMIT;
