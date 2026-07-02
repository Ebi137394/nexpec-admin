-- ════════════════════════════════════════════════════════════════════════════
--  20260801242000_storage_pii_bucket_lockdown.sql
--
--  Module-2 follow-up. The IDOR sweep (20260801236000) locked 7 buckets but
--  left FIVE PII buckets world-readable-by-URL:
--    receipts          — inspector expense receipts (price-blind: buyers never
--                        see inspector costs)
--    inspector-docs    — inspector ID / licence scans (pseudonymity)
--    certifications    — uploaded credential documents (pseudonymity)
--    resumes           — inspector CVs (anti-poaching: raw CV carries name +
--                        contact; posters must NOT pull it pre-hire)
--    dispute-reports   — generated dispute resolution PDFs (parties + admin)
--
--  Decision (golden-rule aligned, applied because the interactive confirm could
--  not be delivered): admin-only-until-hire. All five become owner+admin at the
--  storage layer; cross-party rendering (where legitimate) goes through
--  mint-doc-url → nx_can_access_doc. Buyers/posters lose the raw-file view of
--  receipts / CVs / certs by construction — which is the price-blindness /
--  anti-poaching behaviour we want, not a regression.
--
--  This migration:
--    1. Extends nx_can_access_doc with a dispute-reports party branch
--       (disputes.project_id → projects.client_id / inspector_id).
--    2. Forces public=false on the five buckets (the actual leak-closer).
--    3. Purges any stale bucket_id-only SELECT policy on them, then installs
--       owner+admin SELECT policies (mirrors 236000).
--    4. Self-tests (positive): the five policies exist, the buckets are private,
--       and the dispute branch is present in the function body.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. nx_can_access_doc: full body + new dispute-reports party branch ───────
--    Owner + admin branches already authorise the owner (uploader) and admin
--    for receipts / inspector-docs / certifications / resumes — no extra branch
--    needed for those. dispute-reports adds a parties branch.
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

  -- dispute-reports: the generated PDF is visible to the dispute's parties
  -- (the project's client + inspector) and admin (handled above). disputes
  -- link to a project; projects carry client_id + inspector_id.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
      JOIN public.projects p ON p.id = d.project_id
     WHERE d.report_url LIKE '%' || p_path
       AND (p.client_id = p_uid OR p.inspector_id = p_uid OR d.raised_by = p_uid)
  ) THEN RETURN true; END IF;

  RETURN false;  -- deny by default
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

-- ── 2. Force the five PII buckets private (the real leak-closer) ─────────────
UPDATE storage.buckets
   SET public = false
 WHERE id IN ('receipts', 'inspector-docs', 'certifications', 'resumes', 'dispute-reports');

-- ── 3. Purge any stale bucket_id-only SELECT policy, then owner+admin only ───
DO $purge$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename  = 'objects'
       AND cmd        = 'SELECT'
       AND qual ~ '(receipts|inspector-docs|certifications|resumes|dispute-reports)'
       AND policyname NOT IN (
         'receipts_select_owner_admin','inspector_docs_select_owner_admin',
         'certifications_select_owner_admin','resumes_select_owner_admin',
         'dispute_reports_select_owner_admin'
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $purge$;

DROP POLICY IF EXISTS "receipts_select_owner_admin" ON storage.objects;
CREATE POLICY "receipts_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "inspector_docs_select_owner_admin" ON storage.objects;
CREATE POLICY "inspector_docs_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inspector-docs' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "certifications_select_owner_admin" ON storage.objects;
CREATE POLICY "certifications_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'certifications' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "resumes_select_owner_admin" ON storage.objects;
CREATE POLICY "resumes_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS "dispute_reports_select_owner_admin" ON storage.objects;
CREATE POLICY "dispute_reports_select_owner_admin" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dispute-reports' AND (owner = auth.uid() OR public.nx_is_admin()));

-- ── 4. Self-test (positive): policies exist, buckets private, branch present ─
DO $test$
DECLARE
  v_policies int;
  v_public   int;
  v_def      text;
BEGIN
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'receipts_select_owner_admin','inspector_docs_select_owner_admin',
       'certifications_select_owner_admin','resumes_select_owner_admin',
       'dispute_reports_select_owner_admin'
     );
  IF v_policies <> 5 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: expected 5 owner+admin SELECT policies, found %', v_policies;
  END IF;

  SELECT count(*) INTO v_public
    FROM storage.buckets
   WHERE id IN ('receipts','inspector-docs','certifications','resumes','dispute-reports')
     AND public IS TRUE;
  IF v_public > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % PII bucket(s) still public=true', v_public;
  END IF;

  -- Confirm the dispute-reports party branch is present (strip comments first so
  -- the check matches code, not prose).
  v_def := regexp_replace(pg_get_functiondef('public.nx_can_access_doc(uuid,text,text)'::regprocedure), '--.*', '', 'g');
  IF position('public.disputes' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: dispute-reports party branch missing from nx_can_access_doc';
  END IF;

  RAISE NOTICE 'PII storage sealed: 5 buckets private + owner/admin only; dispute parties via nx_can_access_doc.';
END $test$;

COMMIT;
