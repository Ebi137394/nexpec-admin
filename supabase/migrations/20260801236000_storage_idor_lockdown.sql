-- ============================================================================
--  20260801236000_storage_idor_lockdown.sql
--
--  RED TEAM P0 — cross-tenant document IDOR.
--
--  7 private buckets shipped with SELECT policies of the form
--  `USING (bucket_id = 'X')` — i.e. ANY authenticated user could read ANY file
--  if they knew/guessed the path, and the mobile client minted signed URLs
--  directly from caller-supplied paths.
--
--  Fix (Option A — server-authorized minting):
--    1. Lock each bucket's SELECT to OWNER + ADMIN only (no more any-authenticated
--       reads). Cross-party reads (e.g. a client viewing the inspector's report
--       image) now go through the `mint-doc-url` edge function, which runs as
--       service_role (bypasses these policies) AFTER authorizing via
--       nx_can_access_doc().
--    2. Add nx_can_access_doc(uid, bucket, path) — the single authorization
--       oracle: admin OR storage-owner OR job-party (the path is referenced by a
--       job/contract/conversation the caller is a party to). Deny-by-default:
--       an unrecognized path is refused (safe — never a silent allow).
--
--  Writes are left as-is (already owner/auth-scoped). SAFE TO RE-RUN.
-- ============================================================================

BEGIN;

-- ── 1. Authorization oracle ────────────────────────────────────────────────
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
  IF p_uid IS NULL OR p_bucket IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  -- admin / super_admin (god-mode)
  SELECT role INTO v_role FROM public.profiles WHERE id = p_uid;
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN true;
  END IF;

  -- storage owner (the uploader)
  IF EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = p_bucket AND o.name = p_path AND o.owner = p_uid
  ) THEN
    RETURN true;
  END IF;

  -- job-party linkage. Suffix match ('%' || path) tolerates rows that stored a
  -- full public URL vs. a bare path. Each branch gates on the caller being a
  -- party (client / agency / assigned contractor) to the owning job.
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

  -- chat attachments: caller owns the conversation, or is a job-party of the
  -- conversation's job.
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

  RETURN false;  -- deny by default
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

-- ── 2. Lock the 7 buckets' SELECT to owner + admin ─────────────────────────
DROP POLICY IF EXISTS "report_images_select_auth"        ON storage.objects;
CREATE POLICY "report_images_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'report-images' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "documents_select_auth"            ON storage.objects;
CREATE POLICY "documents_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "job_documents_select_auth"        ON storage.objects;
CREATE POLICY "job_documents_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-documents' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "chat_attachments_select_auth"     ON storage.objects;
CREATE POLICY "chat_attachments_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat_attachments' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "inspection_photos_select_auth"    ON storage.objects;
CREATE POLICY "inspection_photos_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inspection-photos' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "inspection_photos_us_select_auth" ON storage.objects;
CREATE POLICY "inspection_photos_us_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inspection_photos' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "inspection_reports_select_auth"   ON storage.objects;
CREATE POLICY "inspection_reports_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inspection-reports' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "contracts_select_auth"            ON storage.objects;
CREATE POLICY "contracts_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contracts' AND (owner = auth.uid() OR public.nx_is_admin()));

-- ── Self-test: no bucket_id-only SELECT policy survives on the 7 buckets ────
DO $test$
DECLARE
  v_leak int;
BEGIN
  SELECT count(*) INTO v_leak
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('report_images_select_auth','documents_select_auth',
                    'job_documents_select_auth','chat_attachments_select_auth',
                    'inspection_photos_select_auth','inspection_photos_us_select_auth',
                    'inspection_reports_select_auth','contracts_select_auth');
  IF v_leak > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % bucket_id-only SELECT policy(ies) survive', v_leak;
  END IF;
  RAISE NOTICE 'storage IDOR sealed: 7 buckets owner+admin only; cross-party via mint-doc-url + nx_can_access_doc.';
END
$test$;

COMMIT;
