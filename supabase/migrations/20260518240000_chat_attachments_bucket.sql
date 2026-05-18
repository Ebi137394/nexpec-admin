-- ============================================================================
-- CHAT ATTACHMENTS — private bucket + storage RLS
--
-- Path: chat_attachments/{conversation_id}/{ts}-{filename}
-- Path[1] = conversation_id  → RLS checks party membership against
--                              the conversations table.
--
-- Reads: party of the conversation OR admin.
-- Writes: party of the conversation only.
-- ============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat_attachments',
  'chat_attachments',
  false,
  52428800, -- 50 MB
  ARRAY[
    'image/jpeg','image/png','image/webp','image/heic','image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'video/mp4','video/quicktime','video/webm',
    'audio/mpeg','audio/wav','audio/webm','audio/ogg','audio/mp4',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- SELECT — party of the conversation OR admin
DROP POLICY IF EXISTS "chat_att_select_party_or_admin" ON storage.objects;
CREATE POLICY "chat_att_select_party_or_admin" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat_attachments'
    AND (
      public.nx_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.conversations c
         WHERE c.id::text = (storage.foldername(name))[1]
           AND c.user_id = auth.uid()
      )
    )
  );

-- INSERT — party of the conversation
DROP POLICY IF EXISTS "chat_att_insert_party" ON storage.objects;
CREATE POLICY "chat_att_insert_party" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat_attachments'
    AND (
      public.nx_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.conversations c
         WHERE c.id::text = (storage.foldername(name))[1]
           AND c.user_id = auth.uid()
      )
    )
  );

-- UPDATE / DELETE — admin only (messages are append-only; soft-delete the
-- message row via deleted_at, leave the storage object alone)
DROP POLICY IF EXISTS "chat_att_mutate_admin" ON storage.objects;
CREATE POLICY "chat_att_mutate_admin" ON storage.objects FOR UPDATE
  USING (bucket_id = 'chat_attachments' AND public.nx_is_admin())
  WITH CHECK (bucket_id = 'chat_attachments' AND public.nx_is_admin());

DROP POLICY IF EXISTS "chat_att_delete_admin" ON storage.objects;
CREATE POLICY "chat_att_delete_admin" ON storage.objects FOR DELETE
  USING (bucket_id = 'chat_attachments' AND public.nx_is_admin());

-- Ensure messages.attachment_url stores STORAGE PATH (not signed URL).
-- This is a documentation comment — no DDL change since column already
-- exists. Servers mint signed URLs at read time.
COMMENT ON COLUMN public.messages.attachment_url IS
  'STORAGE PATH in chat_attachments bucket (e.g. {conversation_id}/{ts}-{filename}). Read by minting a signed URL at fetch time. NOT a public URL.';

COMMIT;
