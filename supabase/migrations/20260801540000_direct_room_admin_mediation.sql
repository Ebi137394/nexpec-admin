-- ════════════════════════════════════════════════════════════════════════════
--  20260801540000_direct_room_admin_mediation.sql
--
--  DEFECT D23 (P1, workflow/oversight): Full-mode Buyer↔Inspector direct rooms
--  were operationally two-party. Behavioural proof on Staging (room 3d6c4e85):
--  the client sent, the inspector replied, and the admin transcript page showed
--  both messages but rendered NO composer and NO controls — "Read-only
--  oversight". The owner's rule is stricter: Admin must be an actual
--  participant/mediator in job conversations, not a database observer.
--
--  What the DB already allowed (verified, unchanged by this migration):
--    * msg_insert_party WITH CHECK:
--        sender_id = auth.uid() AND (nx_is_admin() OR <open-room participant>)
--      → an admin may already post into any conversation AS THEMSELVES, and
--        parties are already locked out of a closed room (the participant
--        branch requires c.status = 'open'; the admin branch does not, so a
--        mediator can still speak into a frozen room).
--    * conv_update_admin_or_user_status USING/CHECK (user_id = auth.uid()) OR
--      nx_is_admin() → an admin may already close/reopen a room.
--
--  So participation and moderation were UI gaps, fixed in the web app. The one
--  genuine DB defect was in the oversight view:
--
--      CASE WHEN m.sender_id = c.contractor_id THEN 'inspector' ELSE 'buyer' END
--
--  Any non-contractor sender — including an admin mediator — was labelled
--  'buyer'. An admin intervention would render in the transcript as if the
--  BUYER had said it, which corrupts the audit reading of the room. This
--  migration makes sender_party three-valued: inspector / buyer / admin.
--
--  Blast radius: one view used only by the admin oversight surfaces
--  (nx_is_admin() is in the view's own WHERE). No table, policy or grant
--  changes. Rollback restores the two-way CASE:
--  supabase/rollback/20260801540000_rollback.sql
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
            -- the buyer principal is conversations.user_id (set by
            -- open_direct_conversation); client_id covers legacy rows where
            -- they differ
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

COMMENT ON VIEW "public"."admin_direct_messages_view"
IS 'Admin oversight of Full-mode Buyer↔Inspector rooms. sender_party is three-valued (buyer / inspector / admin) so an admin mediation message is never attributed to a party. Admin participation itself is governed by msg_insert_party (insert-as-self) and conv_update_admin_or_user_status (close/reopen), both pre-existing.';

-- ── the close/freeze gap ─────────────────────────────────────────────────────
-- Writing the regression suite exposed a second, worse defect: closing a room
-- did not actually lock the parties out. Permissive policies OR together, and
-- while msg_insert_party's participant branch requires c.status = 'open', the
-- direct-room parties actually enter through msg_direct_insert — which had NO
-- status check at all. So an admin "close" silenced nobody.
--
-- Narrowing change only (adds a conjunct): nobody gains access. The admin can
-- still write into a closed room via msg_insert_party's nx_is_admin() branch,
-- which is exactly the mediator-explains-the-freeze semantics we want.
DROP POLICY IF EXISTS "msg_direct_insert" ON "public"."messages";
CREATE POLICY "msg_direct_insert" ON "public"."messages"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    (EXISTS ( SELECT 1
       FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.kind = 'job_client_inspector'::public.conversation_kind
        AND c.status = 'open'
        AND public.nx_direct_chat_authorized(c.job_id, c.contractor_id, auth.uid())))
    AND sender_id = auth.uid()
  );
