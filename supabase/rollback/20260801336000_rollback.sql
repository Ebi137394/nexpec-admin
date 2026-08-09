-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801336000_direct_chat_role_parity
--
--  Reverts Full-mode direct chat to the 20260801334000 (Client-only) shape.
--
--  ⚠ READ THIS BEFORE RUNNING IT. 334000 CANNOT open a direct room on an
--  Agency- or Enterprise-owned job: those jobs have client_id = NULL by
--  CONSTRAINT jobs_owner_xor, and open_direct_conversation writes
--  conversations.user_id = client_id, which is NOT NULL. Rolling back
--  re-introduces that failure. Use this only to undo 336000 in isolation; the
--  supported way back from the whole feature is the 334000 rollback.
--
--  Rooms already created on agency jobs are NOT deleted — they are commercial
--  records. After this rollback their fanout will resolve a NULL recipient and
--  silently drop notifications, which is precisely the defect 336000 fixed.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── admin views: back to the client_* shape ─────────────────────────────────
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

-- ── gate / room creation / fanout: 20260801334000 verbatim ──────────────────
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

ALTER FUNCTION public.nx_direct_chat_authorized(uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.open_direct_conversation(uuid, uuid)        OWNER TO postgres;
ALTER FUNCTION public.tg_direct_message_fanout()                  OWNER TO postgres;

-- The buyer-side helpers are dropped last: the functions above no longer
-- reference them, so nothing depends on them by this point.
DROP FUNCTION IF EXISTS public.nx_is_job_buyer_side(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_job_buyer_principal(uuid);

DO $verify$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.nx_is_job_buyer_side(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: nx_is_job_buyer_side still exists';
  END IF;
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.nx_direct_chat_authorized(uuid,uuid,uuid)'::regprocedure);
  IF v ~* 'nx_is_job_buyer_side' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the gate still calls the org helper';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'direct_message_fanout' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the fanout trigger was lost';
  END IF;
  RAISE WARNING '336000 rolled back — direct chat is Client-only again and AGENCY/ENTERPRISE JOBS CANNOT OPEN A ROOM.';
END
$verify$;

COMMIT;
