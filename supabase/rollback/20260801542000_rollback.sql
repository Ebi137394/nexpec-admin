-- Rollback for 20260801542000_direct_view_role_based_party.sql
-- Restores the identity-based CASE from 20260801540000 (which mislabels
-- agency/enterprise org-member senders as 'admin').
CREATE OR REPLACE VIEW "public"."admin_direct_messages_view" AS
 SELECT m.id,
    m.conversation_id,
    c.job_id,
    m.sender_id,
    sp.full_name AS sender_name,
    sp.role AS sender_role,
        CASE
            WHEN m.sender_id = c.contractor_id THEN 'inspector'::text
            WHEN m.sender_id = c.user_id OR m.sender_id = c.client_id THEN 'buyer'::text
            ELSE 'admin'::text
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
