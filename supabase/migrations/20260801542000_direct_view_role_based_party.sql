-- ════════════════════════════════════════════════════════════════════════════
--  20260801542000_direct_view_role_based_party.sql
--
--  Regression caught by the pgTAP anchor (direct_chat_role_parity, test 40)
--  immediately after 20260801540000 shipped.
--
--  That migration classified sender_party by IDENTITY:
--      sender = contractor            → inspector
--      sender = user_id OR client_id  → buyer
--      ELSE                           → admin
--
--  Agency and Enterprise buyers broke it: their jobs are owned through
--  jobs.agency_id, and the message sender can be any authorised ORG MEMBER —
--  not necessarily conversations.user_id. Those members fell into ELSE and were
--  labelled 'admin', which is the same class of audit corruption 540000 fixed,
--  just pointing the other way.
--
--  The durable rule is by ROLE, which is what "party" actually means here:
--      sender = contractor                        → inspector
--      sender's profile role admin/super_admin    → admin
--      ELSE (any authorised buyer-side member)    → buyer
--
--  Note nx_is_admin() also admits 'support'; the view's CASE deliberately
--  matches admin/super_admin only, because those are the roles that can appear
--  as mediators via msg_insert_party.
--
--  Blast radius: the same single admin-only view. Rollback:
--  supabase/rollback/20260801542000_rollback.sql (restores the identity CASE).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "public"."admin_direct_messages_view" AS
 SELECT m.id,
    m.conversation_id,
    c.job_id,
    m.sender_id,
    sp.full_name AS sender_name,
    sp.role AS sender_role,
        CASE
            WHEN m.sender_id = c.contractor_id THEN 'inspector'::text
            WHEN sp.role IN ('admin', 'super_admin') THEN 'admin'::text
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

COMMENT ON VIEW "public"."admin_direct_messages_view"
IS 'Admin oversight of Full-mode Buyer↔Inspector rooms. sender_party is classified by ROLE: contractor → inspector, admin/super_admin profile → admin, anything else (personal client, agency or enterprise org member) → buyer. Identity-based buyer matching broke agency/enterprise senders (20260801542000).';
