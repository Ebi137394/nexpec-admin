-- ============================================================================
-- SPRINT 12A — Conversations + Messages v2
--
-- One canonical messaging pipeline:
--   conversations.kind ∈ {help_support, job_client_admin, job_inspector_admin}
--                                            ▲                ▲
--                                            │                │
--                          Client/agency/enterprise ↔ Admin   │
--                                                             │
--                                          Inspector ↔ Admin ─┘
--
-- GR4 + GR7: there is NO 'client_inspector' kind. The schema makes the
-- violation structurally impossible. RLS enforces party-scope on every
-- read/write.
--
-- This migration is FULLY IDEMPOTENT — safe to re-run without checking
-- the current state of the DB.
--
-- Pre-existing splinter tables (admin_direct_messages, helpdesk_messages,
-- job_messages, support_messages) are NOT modified here. job_messages is
-- currently UNRESTRICTED (no RLS) — flagged at the bottom as a follow-up.
-- ============================================================================

BEGIN;

-- ─── 1. conversation_kind enum ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_kind') THEN
    CREATE TYPE public.conversation_kind AS ENUM (
      'help_support',
      'job_client_admin',
      'job_inspector_admin'
    );
  END IF;
END $$;

-- ─── 2. conversations table (create-or-augment) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

-- Idempotent column adds. Each is a no-op if the column already exists.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS kind                  public.conversation_kind,
  ADD COLUMN IF NOT EXISTS job_id                uuid,
  ADD COLUMN IF NOT EXISTS user_id               uuid,
  ADD COLUMN IF NOT EXISTS title                 text,
  ADD COLUMN IF NOT EXISTS status                text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS last_message_at       timestamptz DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_message_preview  text,
  ADD COLUMN IF NOT EXISTS unread_for_user       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unread_for_admin      int NOT NULL DEFAULT 0;

-- Backfill kind/user_id for any pre-existing rows that lack them. If the
-- existing conversations table predates this migration, those rows will
-- have NULL kind and NULL user_id — we can't infer them, so we leave them
-- and the NOT NULL constraint application below will fail loudly. Decide:
-- attempt SET NOT NULL only when no orphaned rows remain.
DO $$
DECLARE n_orphans int;
BEGIN
  SELECT count(*) INTO n_orphans
    FROM public.conversations
   WHERE kind IS NULL OR user_id IS NULL;
  IF n_orphans = 0 THEN
    BEGIN
      ALTER TABLE public.conversations ALTER COLUMN kind    SET NOT NULL;
      ALTER TABLE public.conversations ALTER COLUMN user_id SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'NOT NULL on conversations.{kind,user_id} skipped: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'conversations: % rows have NULL kind or user_id — skipping NOT NULL', n_orphans;
  END IF;
END $$;

-- Foreign keys — drop-then-add for idempotency
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_job_id_fkey') THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_job_id_fkey;
  END IF;
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_user_id_fkey') THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_user_id_fkey;
  END IF;
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
END $$;

-- Shape constraint: job-kinds require job_id; help_support forbids it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_kind_shape') THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_kind_shape;
  END IF;
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_kind_shape
      CHECK (
        (kind IN ('job_client_admin','job_inspector_admin') AND job_id IS NOT NULL)
        OR (kind = 'help_support' AND job_id IS NULL)
      ) NOT VALID;
  -- NOT VALID so existing rows don't block the migration. Validate explicitly
  -- when the table is known to be clean: ALTER TABLE … VALIDATE CONSTRAINT …
END $$;

-- Status enum (string-CHECK, fewer DDL gymnastics than a real enum)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_status_enum') THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_status_enum;
  END IF;
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_status_enum
      CHECK (status IN ('open','closed','archived'));
END $$;

-- ─── 3. Indexes on conversations ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_user_kind
  ON public.conversations(user_id, kind, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_job
  ON public.conversations(job_id)
  WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_admin_queue
  ON public.conversations(status, last_message_at DESC)
  WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conversations_help_support_per_user
  ON public.conversations(user_id)
  WHERE kind = 'help_support';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conversations_job_room_per_user_kind
  ON public.conversations(job_id, user_id, kind)
  WHERE job_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._touch_conversations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS conversations_touch_updated ON public.conversations;
CREATE TRIGGER conversations_touch_updated
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public._touch_conversations_updated_at();

-- ─── 4. messages table — idempotent ALTER (existing columns are no-ops) ──
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS conversation_id  uuid,
  ADD COLUMN IF NOT EXISTS sender_id        uuid,
  ADD COLUMN IF NOT EXISTS content          text,
  ADD COLUMN IF NOT EXISTS is_read          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at       timestamptz DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS sender_role      text,
  ADD COLUMN IF NOT EXISTS room_id          text,
  ADD COLUMN IF NOT EXISTS attachment_url   text,
  ADD COLUMN IF NOT EXISTS attachment_type  text,
  ADD COLUMN IF NOT EXISTS attachment_name  text,
  ADD COLUMN IF NOT EXISTS job_id           uuid,
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS client_op_id     uuid;

-- Content + attachment XOR enforcement (one or the other must be present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_content_or_attachment') THEN
    ALTER TABLE public.messages DROP CONSTRAINT messages_content_or_attachment;
  END IF;
  ALTER TABLE public.messages
    ADD CONSTRAINT messages_content_or_attachment
      CHECK (
        (content IS NOT NULL AND char_length(content) BETWEEN 1 AND 8000)
        OR (attachment_url IS NOT NULL)
      ) NOT VALID;
END $$;

-- Auto-fill sender_role from profiles.role
CREATE OR REPLACE FUNCTION public._messages_fill_sender_role()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sender_role IS NULL AND NEW.sender_id IS NOT NULL THEN
    SELECT role INTO NEW.sender_role FROM public.profiles WHERE id = NEW.sender_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_fill_role ON public.messages;
CREATE TRIGGER messages_fill_role
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public._messages_fill_sender_role();

-- Maintain conversation last_message_at + previews + unread counts
CREATE OR REPLACE FUNCTION public._conversation_on_new_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT user_id INTO v_user_id FROM public.conversations WHERE id = NEW.conversation_id;
  UPDATE public.conversations
     SET last_message_at       = NEW.created_at,
         last_message_preview  = LEFT(COALESCE(NEW.content, '[attachment]'), 200),
         unread_for_admin      = unread_for_admin + CASE WHEN NEW.sender_id = v_user_id THEN 1 ELSE 0 END,
         unread_for_user       = unread_for_user  + CASE WHEN NEW.sender_id <> v_user_id THEN 1 ELSE 0 END,
         updated_at            = NOW()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_touch_conversation ON public.messages;
CREATE TRIGGER messages_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public._conversation_on_new_message();

-- Indexes on messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.messages(conversation_id, is_read)
  WHERE is_read = false AND deleted_at IS NULL;

-- ─── 5. RLS — conversations ──────────────────────────────────────────────
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_select_self_or_admin" ON public.conversations;
CREATE POLICY "conv_select_self_or_admin" ON public.conversations FOR SELECT
  USING (user_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "conv_insert_self_or_admin" ON public.conversations;
CREATE POLICY "conv_insert_self_or_admin" ON public.conversations FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "conv_update_admin_or_user_status" ON public.conversations;
CREATE POLICY "conv_update_admin_or_user_status" ON public.conversations FOR UPDATE
  USING (user_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (user_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "conv_delete_admin" ON public.conversations;
CREATE POLICY "conv_delete_admin" ON public.conversations FOR DELETE
  USING (public.nx_is_admin());

-- ─── 6. RLS — messages ──────────────────────────────────────────────────
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "msg_select_via_conv" ON public.messages;
CREATE POLICY "msg_select_via_conv" ON public.messages FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      public.nx_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.conversations c
         WHERE c.id = messages.conversation_id
           AND c.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "msg_insert_party" ON public.messages;
CREATE POLICY "msg_insert_party" ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      public.nx_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.conversations c
         WHERE c.id = messages.conversation_id
           AND c.user_id = auth.uid()
           AND c.status = 'open'
      )
    )
  );

DROP POLICY IF EXISTS "msg_update_self_or_admin" ON public.messages;
CREATE POLICY "msg_update_self_or_admin" ON public.messages FOR UPDATE
  USING (sender_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (sender_id = auth.uid() OR public.nx_is_admin());

-- ─── 7. RPCs — atomic conversation ensure ───────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_help_support_conversation()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  SELECT id INTO v_conv_id FROM public.conversations
   WHERE user_id = v_uid AND kind = 'help_support' LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations(kind, user_id, title)
      VALUES ('help_support', v_uid, 'Help & Support')
      RETURNING id INTO v_conv_id;
  END IF;
  RETURN v_conv_id;
END $$;

GRANT EXECUTE ON FUNCTION public.ensure_help_support_conversation() TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_job_conversation(
  p_job_id uuid,
  p_kind   text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_conv_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_kind NOT IN ('job_client_admin','job_inspector_admin') THEN
    RAISE EXCEPTION 'invalid conversation kind';
  END IF;

  -- Caller-role gate. Client/agency/enterprise → job_client_admin only.
  -- Inspector (must be the *assigned* one) → job_inspector_admin only.
  IF p_kind = 'job_client_admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND client_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the job''s client may open a job_client_admin room';
    END IF;
  ELSE -- job_inspector_admin
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND assigned_inspector_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the assigned inspector may open a job_inspector_admin room';
    END IF;
  END IF;

  SELECT id INTO v_conv_id FROM public.conversations
   WHERE job_id = p_job_id AND kind = p_kind::public.conversation_kind AND user_id = v_uid
   LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations(kind, user_id, job_id, title)
      VALUES (
        p_kind::public.conversation_kind, v_uid, p_job_id,
        CASE p_kind
          WHEN 'job_client_admin'    THEN 'Job chat · client side'
          WHEN 'job_inspector_admin' THEN 'Job chat · inspector side'
        END
      )
      RETURNING id INTO v_conv_id;
  END IF;
  RETURN v_conv_id;
END $$;

GRANT EXECUTE ON FUNCTION public.ensure_job_conversation(uuid, text) TO authenticated;

-- Mark all unread messages in a conversation as read FOR THE CALLER.
-- Admin marks unread_for_admin → 0. Non-admin marks unread_for_user → 0.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conv_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.nx_is_admin();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  -- Caller must be a party to the conversation OR admin
  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.conversations WHERE id = p_conv_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not a party to this conversation';
  END IF;

  UPDATE public.messages
     SET is_read = true
   WHERE conversation_id = p_conv_id
     AND is_read = false
     AND deleted_at IS NULL
     AND sender_id <> v_uid;  -- don't mark your own as read

  IF v_is_admin THEN
    UPDATE public.conversations SET unread_for_admin = 0 WHERE id = p_conv_id;
  ELSE
    UPDATE public.conversations SET unread_for_user  = 0 WHERE id = p_conv_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

-- ─── 8. Realtime publication ────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- FOLLOW-UPS (DO NOT RUN HERE)
-- ----------------------------------------------------------------------------
-- 1. public.job_messages is currently UNRESTRICTED (no RLS). Either enable
--    RLS with self-or-admin policies, OR migrate its rows into messages +
--    conversations and DROP the table. Suggested follow-up sprint.
-- 2. admin_direct_messages / helpdesk_messages / support_messages are also
--    splinter tables. Consolidate or formally deprecate.
-- 3. Validate the NOT VALID CHECKs once existing data is verified clean:
--      ALTER TABLE public.conversations VALIDATE CONSTRAINT conversations_kind_shape;
--      ALTER TABLE public.messages       VALIDATE CONSTRAINT messages_content_or_attachment;
-- ============================================================================

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT typname FROM pg_type WHERE typname = 'conversation_kind';
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.conversations'::regclass;
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.messages'::regclass;
-- SELECT public.ensure_help_support_conversation();
-- ============================================================================
