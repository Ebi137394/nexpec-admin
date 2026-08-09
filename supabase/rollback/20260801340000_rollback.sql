-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801340000_supplier_operational_chat
--
--  Removes the supplier↔inspector and buyer↔supplier channels and returns
--  send_message / nx_can_access_doc to their 20260801334000 shape (which
--  20260801336000 did not touch, so this is the correct restore point for both).
--
--  ENUM VALUES REMAIN. PostgreSQL cannot drop an enum value, so
--  job_supplier_admin / job_supplier_inspector / buyer_supplier stay in
--  conversation_kind. Inert: with the policies, RPCs and views below gone,
--  nothing can create, read or post to a room of those kinds.
--
--  MESSAGE HISTORY IS PRESERVED — commercial and compliance records. Rooms
--  already created simply become unreachable to their participants; admins can
--  still reach the rows directly with service_role if an investigation needs them.
--
--  unread_for_supplier is left in place: additive, defaulted, harmless, and
--  dropping it would destroy state needed if the feature is re-applied.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS conv_supplier_inspector_select ON public.conversations;
DROP POLICY IF EXISTS conv_supplier_inspector_update ON public.conversations;
DROP POLICY IF EXISTS conv_buyer_supplier_select     ON public.conversations;
DROP POLICY IF EXISTS conv_buyer_supplier_update     ON public.conversations;
DROP POLICY IF EXISTS msg_supplier_inspector_select  ON public.messages;
DROP POLICY IF EXISTS msg_supplier_inspector_insert  ON public.messages;
DROP POLICY IF EXISTS msg_buyer_supplier_select      ON public.messages;
DROP POLICY IF EXISTS msg_buyer_supplier_insert      ON public.messages;

DROP TRIGGER  IF EXISTS operational_message_fanout ON public.messages;
DROP FUNCTION IF EXISTS public.tg_operational_message_fanout();

DROP VIEW IF EXISTS public.admin_operational_messages_view;
DROP VIEW IF EXISTS public.admin_operational_conversations_view;

DROP FUNCTION IF EXISTS public.mark_operational_conversation_read(uuid);
DROP FUNCTION IF EXISTS public.open_buyer_supplier_conversation(uuid, uuid);
DROP FUNCTION IF EXISTS public.open_supplier_inspector_conversation(uuid, uuid, uuid);

DROP INDEX IF EXISTS public.conversations_one_buyer_supplier_room;
DROP INDEX IF EXISTS public.conversations_one_supplier_inspector_room;

-- ── send_message: 20260801334000 verbatim ───────────────────────────────────
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

-- ── nx_can_access_doc: 20260801334000 verbatim ──────────────────────────────
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

-- Authorization helpers last: nothing references them by this point.
DROP FUNCTION IF EXISTS public.nx_buyer_supplier_conversation_authorized(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_buyer_supplier_chat_authorized(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_is_buyer_principal_side(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_buyer_supplier_related(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_supplier_inspector_conversation_authorized(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_supplier_inspector_chat_authorized(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_is_job_supplier(uuid, uuid);

DO $verify$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.nx_supplier_inspector_chat_authorized(uuid,uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the supplier-inspector gate still exists';
  END IF;
  IF to_regprocedure('public.nx_buyer_supplier_chat_authorized(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the buyer-supplier gate still exists';
  END IF;
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.send_message(uuid,text,text,text,text)'::regprocedure);
  IF v ~* 'job_supplier_inspector|buyer_supplier' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: send_message still has an operational branch';
  END IF;
  IF v !~* 'job_client_inspector' THEN
    RAISE EXCEPTION 'ROLLBACK BROKE buyer-inspector chat: the direct branch is gone';
  END IF;
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);
  IF v ~* 'nx_supplier_inspector_chat_authorized|nx_buyer_supplier_chat_authorized' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: an operational attachment branch survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'direct_message_fanout' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK BROKE the buyer-inspector fanout trigger';
  END IF;
  RAISE WARNING '340000 rolled back — supplier channels unreachable; history retained; enum values remain.';
END
$verify$;

COMMIT;
