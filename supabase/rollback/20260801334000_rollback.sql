-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801334000_full_mode_direct_chat
--
--  Removes the Full-mode Client<->Inspector direct chat surface.
--
--  ENUM VALUE IS NOT REMOVED. PostgreSQL cannot drop an enum value, so
--  'job_client_inspector' (20260801332000) stays in conversation_kind. Harmless:
--  with the policies, RPCs and views below gone nothing can create, read or post
--  to a room of that kind, and no pre-existing conversation uses it.
--
--  MESSAGE HISTORY IS PRESERVED. Direct conversations and their messages are
--  deliberately NOT deleted -- they are commercial and compliance records.
--
--  Restores verbatim:
--    send_message      -> 20260801288000 (no direct-room branch)
--    nx_can_access_doc -> 20260801328000 (no chat_attachments direct branch)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS conv_direct_select         ON public.conversations;
DROP POLICY IF EXISTS conv_direct_update_parties ON public.conversations;
DROP POLICY IF EXISTS msg_direct_select          ON public.messages;
DROP POLICY IF EXISTS msg_direct_insert          ON public.messages;

DROP TRIGGER  IF EXISTS direct_message_fanout ON public.messages;
DROP FUNCTION IF EXISTS public.tg_direct_message_fanout();

DROP VIEW IF EXISTS public.admin_direct_messages_view;
DROP VIEW IF EXISTS public.admin_direct_conversations_view;

DROP FUNCTION IF EXISTS public.mark_direct_conversation_read(uuid);
DROP FUNCTION IF EXISTS public.open_direct_conversation(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_direct_conversation_authorized(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_direct_chat_authorized(uuid, uuid, uuid);

DROP INDEX IF EXISTS public.conversations_one_direct_room_per_job_inspector;

-- unread_for_client / unread_for_inspector are additive, default 0. Left in
-- place so history and any re-apply stay consistent; inert without the feature.

-- ── send_message: 20260801288000 verbatim ───────────────────────────────────
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

  IF v_kind = 'job_team_internal'::public.conversation_kind THEN
    -- GHOST INTEGRITY: internal threads accept posts ONLY from non-viewer
    -- teammates. There is deliberately NO admin branch — a platform-admin post
    -- would uncloak the ghost — and this explicit check neutralises the DEFINER
    -- RLS bypass (the RESTRICTIVE policy guards every other insert path).
    IF NOT public.nx_can_team_manage_internal(p_conversation_id) THEN
      RAISE EXCEPTION 'not authorised to post to this internal team thread' USING errcode = '42501';
    END IF;
  ELSE
    -- Admin, the conversation OWNER on an open thread, or a non-viewer TEAMMATE.
    -- ADDED: on a job conversation, an owner who is/was the inspector (has a
    -- contract) but is NOT the active contract inspector (i.e. a former,
    -- replaced inspector) may not post. Clients, managers (no contract), and the
    -- active inspector are unaffected.
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
  VALUES (p_conversation_id, v_uid, btrim(COALESCE(p_content, '')),
          p_attachment_url, p_attachment_type, p_attachment_name)
  RETURNING * INTO v_row;

  RETURN v_row;
END
$fn$;

ALTER FUNCTION public.send_message(uuid, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.send_message(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, text, text) TO authenticated, service_role;

-- ── nx_can_access_doc: 20260801328000 verbatim ──────────────────────────────
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

  -- ★ applicant résumé released by JOB-SCOPED identity disclosure,
  --   now cut off when the engagement itself is over.
  IF p_bucket = 'resumes' AND EXISTS (
    SELECT 1
      FROM public.applications a
      JOIN public.jobs      j  ON j.id = a.job_id
      JOIN public.profiles  pr ON pr.id = a.applicant_id
     WHERE (j.client_id = p_uid OR j.agency_id = p_uid)
       AND a.forwarded_to_client_at IS NOT NULL
       AND public.nx_job_effective_identity_mode(j.id) IN ('professional', 'full')
       -- ★ CUTOFF 1: the job's engagement must still be live.
       AND NOT (j.status = ANY (public.nx_terminal_job_statuses()))
       -- ★ CUTOFF 2: this applicant must still be a live candidate.
       AND a.status NOT IN ('rejected', 'withdrawn')
       -- ★ CUTOFF 3: if a contract exists for this pairing it must not be voided.
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
  --   Healed by 20260801252000. Never rewire this back: those columns do not
  --   exist and the branch throws the first time control reaches it.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
      JOIN public.work_orders w ON w.id = d.project_id
     WHERE d.report_url LIKE '%' || p_path
       AND (w.client_id = p_uid OR w.inspector_id = p_uid OR d.raised_by = p_uid)
  ) THEN RETURN true; END IF;

  RETURN false;
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

DO $verify$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.nx_direct_chat_authorized(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the direct-chat gate still exists';
  END IF;
  IF to_regclass('public.admin_direct_messages_view') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: an admin monitoring view still exists';
  END IF;
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.send_message(uuid,text,text,text,text)'::regprocedure);
  IF v ~* 'job_client_inspector' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: send_message still has the direct-room branch';
  END IF;
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);
  IF v ~* 'chat_attachments' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the direct attachment branch survived';
  END IF;
  RAISE WARNING '334000 rolled back -- direct chat unreachable; history retained; enum value remains.';
END
$verify$;

COMMIT;
