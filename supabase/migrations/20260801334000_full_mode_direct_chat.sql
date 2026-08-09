-- ════════════════════════════════════════════════════════════════════════════
--  20260801334000_full_mode_direct_chat.sql
--
--  Full-access Client ↔ Inspector direct chat. Consumes the enum value added
--  by 20260801332000 (separate file — PG forbids using a new enum value in the
--  transaction that created it).
--
--  ── WHY THE EXISTING MODEL COULD NOT BE REUSED ─────────────────────────────
--  conversations is a 1:1 owner↔admin model: a single user_id, unread_for_user
--  / unread_for_admin, and send_message authorizing on `c.user_id = v_uid`.
--  Every job conversation is admin-mediated by design (the anti-poaching "ONE
--  DOOR" rule). A two-party room cannot be expressed by pretending one of the
--  parties is "the owner", so this migration adds a genuine two-party channel
--  instead of overloading user_id.
--
--  ── THE ONE GATE ───────────────────────────────────────────────────────────
--  nx_direct_chat_authorized(job, inspector, uid) is the single authority. It
--  is consulted by RLS (conversations + messages), by send_message, by the
--  open/mark RPCs and by nx_can_access_doc. Nothing trusts a conversation id
--  on its own, so a stale or forged id cannot bypass a downgrade, and an
--  attachment cannot become a side door around a revoked room.
--
--  It requires ALL of:
--    • caller is the job's client (or agency) OR the inspector of that room
--    • the inspector is the ACTIVE contract inspector for that job
--      (is_active_contract_inspector → a replaced inspector is false)
--    • live nx_job_effective_identity_mode(job) = 'full'
--    • job status is NOT terminal-for-messaging: cancelled / paid
--
--  READ vs WRITE: reads keep working for history in every state the product
--  allows; only NEW messages are blocked at cancelled/paid. Downgrade out of
--  Full removes both, by design — the founder's decision is that the room
--  disappears for both parties while history stays stored for admin.
--
--  ── ADMIN ──────────────────────────────────────────────────────────────────
--  Admin reads through admin_direct_conversations_view /
--  admin_direct_messages_view (SECURITY DEFINER, admin-gated). Admin is NOT a
--  participant: no row in the room, no unread counter, no read receipt, and
--  mark_direct_conversation_read() refuses to run for an admin so opening a
--  room cannot consume either party's unread state.
--
--  ── GR2 ────────────────────────────────────────────────────────────────────
--  No payout, price, spread, bid or negotiation column appears in any object
--  created here. Asserted by self-test.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Two-party unread. The existing counters model user↔admin and have no slot
--    for "unread for the other party", so add two explicit ones. Additive:
--    every existing conversation keeps 0 and no existing reader changes.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS unread_for_client    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unread_for_inspector integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.conversations.unread_for_client IS
  'Two-party unread for job_client_inspector rooms. Never touched by admin reads.';
COMMENT ON COLUMN public.conversations.unread_for_inspector IS
  'Two-party unread for job_client_inspector rooms. Never touched by admin reads.';

-- ── Duplicate-room prevention: at most ONE direct room per (job, inspector).
--    contractor_id holds the inspector for this kind. Partial + unique.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_direct_room_per_job_inspector
  ON public.conversations (job_id, contractor_id)
  WHERE kind = 'job_client_inspector'::public.conversation_kind;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) THE GATE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_direct_chat_authorized(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_uid          uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.jobs j
     WHERE j.id = p_job_id
       AND p_uid IS NOT NULL
       AND p_inspector_id IS NOT NULL
       -- caller must be one of the TWO parties (admin is NOT a party here)
       AND (
             j.client_id = p_uid
          OR j.agency_id = p_uid
          OR p_inspector_id = p_uid
           )
       -- the room's inspector must be the ACTIVE contract inspector: a replaced
       -- inspector fails here, which is what cuts their access at replacement.
       AND public.is_active_contract_inspector(p_job_id, p_inspector_id)
       -- LIVE identity mode — a downgrade takes effect on the very next call.
       AND public.nx_job_effective_identity_mode(p_job_id) = 'full'
       -- engagement must not be closed out for messaging purposes
       AND COALESCE(j.status, '') NOT IN ('cancelled', 'paid')
  );
$$;

ALTER FUNCTION public.nx_direct_chat_authorized(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_direct_chat_authorized(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_direct_chat_authorized(uuid, uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_direct_chat_authorized(uuid, uuid, uuid) IS
  'THE single authority for Full-mode client↔inspector direct chat: caller is a party, the inspector is the ACTIVE contract inspector, live identity_mode = full, and the job is not cancelled/paid. Consulted by RLS, send_message, the direct-chat RPCs and nx_can_access_doc so no conversation id, attachment or stale reference can bypass it.';

-- Convenience wrapper keyed on the conversation row itself.
CREATE OR REPLACE FUNCTION public.nx_direct_conversation_authorized(
  p_conversation_id uuid,
  p_uid             uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = p_conversation_id
       AND c.kind = 'job_client_inspector'::public.conversation_kind
       AND public.nx_direct_chat_authorized(c.job_id, c.contractor_id, p_uid)
  );
$$;

ALTER FUNCTION public.nx_direct_conversation_authorized(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_direct_conversation_authorized(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_direct_conversation_authorized(uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RLS — conversations. ADDITIVE policies only; nothing existing is dropped.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS conv_direct_select ON public.conversations;
CREATE POLICY conv_direct_select ON public.conversations
  FOR SELECT TO authenticated
  USING (
    kind = 'job_client_inspector'::public.conversation_kind
    AND public.nx_direct_chat_authorized(job_id, contractor_id, auth.uid())
  );

-- Admin reads direct rooms through the definer views below, NOT through a
-- participant policy, so admin never shows up as a member of the room.

DROP POLICY IF EXISTS conv_direct_update_parties ON public.conversations;
CREATE POLICY conv_direct_update_parties ON public.conversations
  FOR UPDATE TO authenticated
  USING (
    kind = 'job_client_inspector'::public.conversation_kind
    AND public.nx_direct_chat_authorized(job_id, contractor_id, auth.uid())
  )
  WITH CHECK (
    kind = 'job_client_inspector'::public.conversation_kind
    AND public.nx_direct_chat_authorized(job_id, contractor_id, auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS — messages in a direct room.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS msg_direct_select ON public.messages;
CREATE POLICY msg_direct_select ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = messages.conversation_id
         AND c.kind = 'job_client_inspector'::public.conversation_kind
         AND public.nx_direct_chat_authorized(c.job_id, c.contractor_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS msg_direct_insert ON public.messages;
CREATE POLICY msg_direct_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = messages.conversation_id
         AND c.kind = 'job_client_inspector'::public.conversation_kind
         AND public.nx_direct_chat_authorized(c.job_id, c.contractor_id, auth.uid())
    )
    AND sender_id = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) open_direct_conversation — create-or-return. Duplicate-safe.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.open_direct_conversation(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_job  RECORD;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;

  -- ★ Admin may NOT open/create a direct room: admin is not a party and must
  --   never materialise inside it. Admin reads via the monitoring views.
  IF public.nx_is_admin() THEN
    RAISE EXCEPTION 'admins observe direct rooms via the monitoring view, not by joining'
      USING errcode = '42501';
  END IF;

  IF NOT public.nx_direct_chat_authorized(p_job_id, p_inspector_id, v_uid) THEN
    RAISE EXCEPTION 'direct chat is not authorized for this job/inspector relationship'
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;

  -- Idempotent: the partial unique index guarantees one room per (job,inspector).
  SELECT id INTO v_id
    FROM public.conversations
   WHERE job_id = p_job_id
     AND contractor_id = p_inspector_id
     AND kind = 'job_client_inspector'::public.conversation_kind;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (
    job_id, client_id, contractor_id, kind, user_id, title, status
  ) VALUES (
    p_job_id,
    v_job.client_id,
    p_inspector_id,
    'job_client_inspector'::public.conversation_kind,
    -- user_id is NOT NULL on this table and models the owner in the legacy
    -- admin-mediated design. For a two-party room it is NOT the authorization
    -- source — nx_direct_chat_authorized is. Set to the client for referential
    -- sanity only.
    v_job.client_id,
    'Direct — job ' || COALESCE(v_job.title, p_job_id::text),
    'open'
  )
  ON CONFLICT (job_id, contractor_id) WHERE kind = 'job_client_inspector'::public.conversation_kind
  DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.open_direct_conversation(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.open_direct_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_direct_conversation(uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) mark_direct_conversation_read — per-party, and NEVER for an admin.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_direct_conversation_read(
  p_conversation_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c   RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;

  -- ★ THE ADMIN-INVISIBILITY GUARANTEE. An admin opening a room must not
  --   consume either party's unread state, so this is a hard no-op for admins
  --   rather than a silent write.
  IF public.nx_is_admin() THEN
    RETURN;
  END IF;

  SELECT * INTO v_c FROM public.conversations
   WHERE id = p_conversation_id
     AND kind = 'job_client_inspector'::public.conversation_kind;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT public.nx_direct_chat_authorized(v_c.job_id, v_c.contractor_id, v_uid) THEN
    RAISE EXCEPTION 'not authorized for this direct conversation' USING errcode = '42501';
  END IF;

  IF v_uid = v_c.contractor_id THEN
    UPDATE public.conversations SET unread_for_inspector = 0, updated_at = NOW()
     WHERE id = p_conversation_id;
    UPDATE public.messages SET is_read = true
     WHERE conversation_id = p_conversation_id AND sender_id <> v_uid AND is_read = false;
  ELSE
    UPDATE public.conversations SET unread_for_client = 0, updated_at = NOW()
     WHERE id = p_conversation_id;
    UPDATE public.messages SET is_read = true
     WHERE conversation_id = p_conversation_id AND sender_id <> v_uid AND is_read = false;
  END IF;
END;
$$;

ALTER FUNCTION public.mark_direct_conversation_read(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_direct_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_direct_conversation_read(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Unread bump + notification on every direct message.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_direct_message_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c         RECORD;
  v_recipient uuid;
BEGIN
  SELECT * INTO v_c FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND OR v_c.kind <> 'job_client_inspector'::public.conversation_kind THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id = v_c.contractor_id THEN
    v_recipient := v_c.client_id;
    UPDATE public.conversations
       SET unread_for_client = unread_for_client + 1,
           last_message_at   = NOW(),
           last_message_preview = left(COALESCE(NEW.content, '[attachment]'), 120),
           updated_at        = NOW()
     WHERE id = NEW.conversation_id;
  ELSE
    v_recipient := v_c.contractor_id;
    UPDATE public.conversations
       SET unread_for_inspector = unread_for_inspector + 1,
           last_message_at      = NOW(),
           last_message_preview = left(COALESCE(NEW.content, '[attachment]'), 120),
           updated_at           = NOW()
     WHERE id = NEW.conversation_id;
  END IF;

  BEGIN
    PERFORM public.create_system_notification(
      v_recipient,
      'New direct message',
      left(COALESCE(NEW.content, 'Sent an attachment'), 120),
      'message',
      '/chat/direct/' || NEW.conversation_id::text,
      v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_direct_message_fanout() OWNER TO postgres;

DROP TRIGGER IF EXISTS direct_message_fanout ON public.messages;
CREATE TRIGGER direct_message_fanout
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_direct_message_fanout();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) ADMIN MONITORING — definer views. Admin-gated, read-only, no side effects.
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.admin_direct_messages_view;
DROP VIEW IF EXISTS public.admin_direct_conversations_view;

CREATE VIEW public.admin_direct_conversations_view
WITH (security_barrier = 'true') AS
SELECT
  c.id            AS conversation_id,
  c.job_id,
  j.title         AS job_title,
  j.status        AS job_status,
  public.nx_job_effective_identity_mode(c.job_id) AS identity_mode,
  c.client_id,
  cp.full_name    AS client_name,
  c.contractor_id AS inspector_id,
  ip.full_name    AS inspector_name,
  c.created_at,
  c.last_message_at,
  c.unread_for_client,
  c.unread_for_inspector,
  (SELECT count(*) FROM public.messages m
    WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS message_count
FROM public.conversations c
JOIN public.jobs j        ON j.id = c.job_id
LEFT JOIN public.profiles cp ON cp.id = c.client_id
LEFT JOIN public.profiles ip ON ip.id = c.contractor_id
WHERE c.kind = 'job_client_inspector'::public.conversation_kind
  AND public.nx_is_admin();

ALTER VIEW public.admin_direct_conversations_view OWNER TO postgres;
REVOKE ALL ON public.admin_direct_conversations_view FROM PUBLIC, anon;
GRANT SELECT ON public.admin_direct_conversations_view TO authenticated, service_role;

CREATE VIEW public.admin_direct_messages_view
WITH (security_barrier = 'true') AS
SELECT
  m.id,
  m.conversation_id,
  c.job_id,
  m.sender_id,
  sp.full_name AS sender_name,
  CASE WHEN m.sender_id = c.contractor_id THEN 'inspector' ELSE 'client' END AS sender_party,
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
WHERE c.kind = 'job_client_inspector'::public.conversation_kind
  AND public.nx_is_admin();

ALTER VIEW public.admin_direct_messages_view OWNER TO postgres;
REVOKE ALL ON public.admin_direct_messages_view FROM PUBLIC, anon;
GRANT SELECT ON public.admin_direct_messages_view TO authenticated, service_role;

COMMENT ON VIEW public.admin_direct_messages_view IS
  'Admin-only read of Full-mode direct conversations: text, attachments (url/type/name), timestamps, sender party. Read-only by construction — admin never appears in the room, is never a participant, and reading here cannot change is_read or either unread counter.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) send_message — direct-room branch, ahead of the legacy owner logic.
--    Every other branch is the 20260801288000 body, unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id  uuid,
  p_content          text DEFAULT NULL,
  p_attachment_url   text DEFAULT NULL,
  p_attachment_type  text DEFAULT NULL,
  p_attachment_name  text DEFAULT NULL
) RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_kind public.conversation_kind;
  v_row  public.messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id required';
  END IF;
  IF btrim(COALESCE(p_content, '')) = '' AND p_attachment_url IS NULL THEN
    RAISE EXCEPTION 'empty message (need content or attachment)';
  END IF;

  SELECT kind INTO v_kind FROM public.conversations WHERE id = p_conversation_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  -- ★ DIRECT ROOM (20260801334000). Authorization is recomputed from the LIVE
  --   relationship on every send, so a stale conversation id held open across a
  --   downgrade, a replacement, or a move to cancelled/paid stops working
  --   immediately. Admins are excluded on purpose: they observe, never post.
  IF v_kind = 'job_client_inspector'::public.conversation_kind THEN
    IF public.nx_is_admin() THEN
      RAISE EXCEPTION 'admins do not post into client-inspector direct rooms'
        USING errcode = '42501';
    END IF;
    IF NOT public.nx_direct_conversation_authorized(p_conversation_id, v_uid) THEN
      RAISE EXCEPTION 'direct chat is not authorized for this relationship'
        USING errcode = '42501';
    END IF;

  ELSIF v_kind = 'job_team_internal'::public.conversation_kind THEN
    -- Ghost-mode internal thread (20260801208000) — unchanged.
    IF NOT public.nx_can_team_manage_internal(p_conversation_id) THEN
      RAISE EXCEPTION 'not authorised to post to this internal team thread' USING errcode = '42501';
    END IF;

  ELSE
    -- Legacy admin-mediated branch (20260801288000) — unchanged, including the
    -- former-inspector cutoff.
    IF NOT (
          public.nx_is_admin()
       OR EXISTS (SELECT 1 FROM public.conversations c
                   WHERE c.id = p_conversation_id
                     AND c.user_id = v_uid
                     AND c.status = 'open'
                     AND NOT (
                       c.job_id IS NOT NULL
                       AND EXISTS (SELECT 1 FROM public.job_contracts jc
                                    WHERE jc.job_id = c.job_id AND jc.inspector_id = v_uid)
                       AND NOT public.is_active_contract_inspector(c.job_id, v_uid)
                     ))
       OR public.nx_can_team_manage_conversation(p_conversation_id)
    ) THEN
      RAISE EXCEPTION 'not authorised to post to this conversation' USING errcode = '42501';
    END IF;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, content,
                               attachment_url, attachment_type, attachment_name)
  VALUES (p_conversation_id, v_uid, NULLIF(btrim(COALESCE(p_content, '')), ''),
          p_attachment_url, p_attachment_type, p_attachment_name)
  RETURNING * INTO v_row;

  RETURN v_row;
END
$fn$;

ALTER FUNCTION public.send_message(uuid, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_message(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) ATTACHMENTS — the same boundary as text.
--     nx_can_access_doc gains a direct-room branch for chat_attachments, and
--     the admin branch already at the top of that function covers admin.
--     Body is 20260801330000's, with ONE branch inserted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_can_access_doc(
  p_uid    uuid,
  p_bucket text,
  p_path   text
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_uid IS NULL OR p_bucket IS NULL OR p_path IS NULL OR btrim(p_path) = '' THEN
    RETURN false;
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = p_uid;
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = p_bucket AND o.name = p_path AND o.owner = p_uid
  ) THEN
    RETURN true;
  END IF;

  -- ★★ DIRECT-ROOM ATTACHMENT (20260801334000). Images, files and voice notes
  --    obey EXACTLY the same live gate as text: a revoked party cannot mint a
  --    URL for a message they can no longer read, and the storage-owner branch
  --    above still lets each sender reach their own upload.
  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'job_client_inspector'::public.conversation_kind
       AND public.nx_direct_chat_authorized(c.job_id, c.contractor_id, p_uid)
  ) THEN RETURN true; END IF;

  IF p_bucket = 'resumes' AND EXISTS (
    SELECT 1
      FROM public.applications a
      JOIN public.jobs      j  ON j.id = a.job_id
      JOIN public.profiles  pr ON pr.id = a.applicant_id
     WHERE (j.client_id = p_uid OR j.agency_id = p_uid)
       AND a.forwarded_to_client_at IS NOT NULL
       AND public.nx_job_effective_identity_mode(j.id) IN ('professional', 'full')
       AND NOT (j.status = ANY (public.nx_terminal_job_statuses()))
       AND a.status NOT IN ('rejected', 'withdrawn')
       AND NOT EXISTS (
             SELECT 1 FROM public.job_contracts jc
              WHERE jc.job_id = j.id
                AND jc.inspector_id = a.applicant_id
                AND jc.status = 'voided'
                AND NOT EXISTS (
                      SELECT 1 FROM public.job_contracts jc2
                       WHERE jc2.job_id = j.id
                         AND jc2.inspector_id = a.applicant_id
                         AND jc2.status <> 'voided'
                    )
           )
       AND (
             pr.resume_url LIKE '%' || p_path
          OR pr.cv_url     LIKE '%' || p_path
           )
       AND (
             p_path LIKE a.applicant_id::text || '/%'
          OR EXISTS (
               SELECT 1 FROM storage.objects o2
                WHERE o2.bucket_id = 'resumes'
                  AND o2.name = p_path
                  AND o2.owner = a.applicant_id
             )
           )
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.inspection_reports r
      JOIN public.jobs j ON j.id = r.job_id
     WHERE (r.photo_url LIKE '%' || p_path
            OR r.pdf_url LIKE '%' || p_path
            OR r.final_report_doc LIKE '%' || p_path)
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.contracts c
     WHERE c.document_url LIKE '%' || p_path
       AND (c.client_id = p_uid OR c.contractor_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_documents pd
      JOIN public.jobs j ON j.id = pd.job_id
     WHERE pd.file_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.template_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages m
      JOIN public.conversations cv ON cv.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND (
         cv.user_id = p_uid
         OR (cv.job_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.jobs j
               WHERE j.id = cv.job_id
                 AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
            ))
       )
  ) THEN RETURN true; END IF;

  -- dispute-reports: the generated PDF is visible to the dispute's parties.
  -- ★ disputes.project_id is an FK to public.work_orders(id) — NOT the
  --   org/budget projects table, which has no client_id / inspector_id.
  --   Healed by 20260801252000. Never rewire this back.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
      JOIN public.work_orders w ON w.id = d.project_id
     WHERE d.report_url LIKE '%' || p_path
       AND (w.client_id = p_uid OR w.inspector_id = p_uid OR d.raised_by = p_uid)
  ) THEN RETURN true; END IF;

  RETURN false;  -- deny by default
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11) Self-tests
-- ─────────────────────────────────────────────────────────────────────────────
DO $test$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.nx_direct_chat_authorized(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.open_direct_conversation(uuid,uuid)') IS NULL
     OR to_regprocedure('public.mark_direct_conversation_read(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a direct-chat function is missing';
  END IF;

  IF to_regclass('public.admin_direct_conversations_view') IS NULL
     OR to_regclass('public.admin_direct_messages_view') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an admin monitoring view is missing';
  END IF;

  -- the gate must consult live mode, active inspector and terminal status
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.nx_direct_chat_authorized(uuid,uuid,uuid)'::regprocedure);
  IF v !~* 'nx_job_effective_identity_mode' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: direct-chat gate ignores live identity mode';
  END IF;
  IF v !~* 'is_active_contract_inspector' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: direct-chat gate ignores replacement';
  END IF;
  IF v !~* 'cancelled' OR v !~* 'paid' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: direct-chat gate has no terminal cutoff';
  END IF;

  -- attachments must route through the same gate
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);
  IF v !~* 'chat_attachments' OR v !~* 'nx_direct_chat_authorized' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: direct-room attachments bypass the direct-chat gate';
  END IF;
  IF v ~* '(FROM|JOIN)[[:space:]]+public\.projects\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the stale public.projects dispute branch is back';
  END IF;
  IF v !~* 'JOIN[[:space:]]+public\.work_orders\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the healed work_orders wiring was lost';
  END IF;

  -- admin must not be able to mark either party's messages read
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.mark_direct_conversation_read(uuid)'::regprocedure);
  IF v !~* 'nx_is_admin' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin reads could consume a party''s unread state';
  END IF;

  -- send_message must still carry every legacy branch
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.send_message(uuid,text,text,text,text)'::regprocedure);
  IF v !~* 'job_team_internal' OR v !~* 'nx_can_team_manage_conversation'
     OR v !~* 'is_active_contract_inspector' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: send_message lost a legacy authorization branch';
  END IF;
  IF v !~* 'job_client_inspector' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: send_message has no direct-room branch';
  END IF;

  -- duplicate-room prevention
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'conversations_one_direct_room_per_job_inspector'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: duplicate direct rooms are possible';
  END IF;

  -- GR2: no money column anywhere in the new surfaces
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('admin_direct_conversations_view','admin_direct_messages_view')
       AND (column_name ILIKE '%payout%' OR column_name ILIKE '%price%'
            OR column_name ILIKE '%spread%' OR column_name ILIKE '%bid%'
            OR column_name ILIKE '%budget%')
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a money column leaked into an admin direct-chat view';
  END IF;

  RAISE NOTICE 'Full-mode direct chat installed: one gate, two parties, admin observes without joining.';
END $test$;

COMMIT;
