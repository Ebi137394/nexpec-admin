-- Rollback for 20260801540000_direct_room_admin_mediation.sql
--
-- Restores the two-way sender_party CASE. Running this re-opens the D23 audit
-- defect: an admin message in a direct room is labelled 'buyer' in the
-- oversight transcript.

CREATE OR REPLACE VIEW "public"."admin_direct_messages_view" AS
 SELECT m.id,
    m.conversation_id,
    c.job_id,
    m.sender_id,
    sp.full_name AS sender_name,
    sp.role AS sender_role,
        CASE
            WHEN m.sender_id = c.contractor_id THEN 'inspector'::text
            ELSE 'buyer'::text
        END AS sender_party,
    m.content,
    m.attachment_url,
    m.attachment_type,
    m.attachment_name,
    m.created_at,
    m.is_read,
    m.deleted_at
   FROM public.messages m
     JOIN public.conversations c ON c.id = m.conversation_id
     LEFT JOIN public.profiles sp ON sp.id = m.sender_id
  WHERE c.kind = 'job_client_inspector'::public.conversation_kind AND public.nx_is_admin();

-- restore the status-blind direct insert policy (re-opens the freeze gap)
DROP POLICY IF EXISTS "msg_direct_insert" ON "public"."messages";
CREATE POLICY "msg_direct_insert" ON "public"."messages"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    (EXISTS ( SELECT 1
       FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.kind = 'job_client_inspector'::public.conversation_kind
        AND public.nx_direct_chat_authorized(c.job_id, c.contractor_id, auth.uid())))
    AND sender_id = auth.uid()
  );
