-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801348000_two_party_media_live_gate
--
--  ⚠ THIS RESTORES A KNOWN CROSS-PARTY MEDIA LEAK. Reverting to the 340000
--  body puts back the kind-agnostic legacy chat-attachment branch, under which
--  a buyer whose identity mode was downgraded (or an inspector who was
--  replaced) can still mint a fresh signed URL for the OTHER party's
--  direct-chat attachment, because that branch matches on conversations.user_id
--  and job membership rather than the live gate. Roll back only together with
--  340000/334000, never on its own.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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

  -- ★★ SUPPLIER-INSPECTOR / BUYER-SUPPLIER ATTACHMENTS (20260801340000).
  --    Same shape as the direct-room branch above: media obeys EXACTLY the gate
  --    its message row obeys, so a supplier whose contract was voided cannot
  --    mint a URL for a drawing they can no longer read.
  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'job_supplier_inspector'::public.conversation_kind
       AND public.nx_supplier_inspector_chat_authorized(c.job_id, c.contractor_id, c.client_id, p_uid)
  ) THEN RETURN true; END IF;

  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'buyer_supplier'::public.conversation_kind
       AND public.nx_buyer_supplier_chat_authorized(c.user_id, c.contractor_id, p_uid)
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

DO $verify$
DECLARE v text;
BEGIN
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);
  IF v ~ 'cv\.kind NOT IN' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the kind scope survived on the legacy branch';
  END IF;
  IF v !~ 'work_orders' OR v !~ 'resumes' THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: a pre-existing document branch was lost';
  END IF;
  RAISE WARNING '348000 rolled back — cross-party stale media access is possible again.';
END
$verify$;

COMMIT;
