-- ============================================================================
--  20260517140000_storage_rls_lockdown.sql
--
--  STRIKE: Module 2 — Storage RLS lockdown.
--          NX-STORAGE-001 / 002 / 003 / 004 / 007 close together because
--          they all live in the same RLS layer.
--
--  WHAT THIS DOES:
--    1. Sets every non-avatar bucket to public=false.
--    2. Sets file_size_limit + allowed_mime_types on every bucket that
--       was missing one (the bucket-level MIME check is the authoritative
--       server-side gate — client-side Content-Type can be lied about).
--    3. Drops every legacy storage.objects policy from the diagnostic
--       (~57 named drops) EXCEPT the four policy families that are
--       already correct (compliance_*, fr_storage_*, the service-role
--       contracts policy).
--    4. Installs a single named policy per bucket per verb, with
--       path-prefix isolation where the file-naming convention supports
--       it. Where the convention is mixed (documents bucket uses both
--       user-id folders AND project_<job_id> folders), the new policy
--       is "authenticated only, no anon" — a Phase 5.5 follow-up will
--       add job-party scoping once a single canonical path layout is
--       chosen.
--
--  BUCKETS KEPT PUBLIC (intentionally):
--    avatars — typical pattern for cross-user display in cards.
--              Risk is just the avatar image, not the user's data.
--
--  BUCKETS LOCKED PRIVATE:
--    report-images, inspection-photos, inspection_photos, documents,
--    job-documents, chat_attachments, inspection-reports, inspector-docs,
--    certifications, certificates, receipts, dispute-evidence, contracts,
--    resumes, branding_assets.
--
--  POLICIES PRESERVED (already correct, not touched):
--    - All `compliance_*` policies (compliance bucket — added in
--      20260514100x_*).
--    - All `fr_storage_*` policies (flash-report-attachments).
--    - "Service role can manage contracts" (intentional service-role
--      backdoor for contracts admin tooling).
--    - "Users manage own branding assets" (already self-scoped).
--
--  DEFERRED to Phase 5.5:
--    - Job-party-scoped SELECT on documents / job-documents / chat_attachments
--      (requires a single canonical path layout per bucket).
--    - SECURITY DEFINER signed-URL minting RPCs for cross-tenant viewing
--      (e.g. client viewing inspector's report images).
--    - Migration of existing `documents` rows from `project_<jobid>/` to
--      a consolidated `<jobid>/<uid>/` layout.
--
--  Idempotent: every DROP is IF EXISTS, every CREATE replaces the new
--  named policy. Safe to re-run.
-- ============================================================================

BEGIN;

-- ─── A. Set bucket flags ─────────────────────────────────────────────────
-- Private (anon-denied, RLS-only access):
UPDATE storage.buckets
   SET public = FALSE
 WHERE id IN (
   'report-images', 'inspection-photos', 'inspection_photos',
   'documents',     'job-documents',     'chat_attachments',
   'inspection-reports', 'inspector-docs',
   'certifications', 'certificates', 'receipts',
   'dispute-evidence', 'contracts', 'resumes', 'branding_assets'
 );

-- Public (intentional — avatars):
UPDATE storage.buckets
   SET public = TRUE
 WHERE id = 'avatars';

-- ─── B. File-size + MIME limits where missing ────────────────────────────
-- Conservative caps. The compliance bucket already has these; we mirror
-- the pattern here. Bucket-level MIME enforcement rejects mismatched
-- bytes server-side regardless of client Content-Type.
UPDATE storage.buckets SET
  file_size_limit = COALESCE(file_size_limit, 10485760),  -- 10 MB
  allowed_mime_types = COALESCE(allowed_mime_types, ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'
  ])
 WHERE id IN ('report-images', 'inspection-photos', 'inspection_photos',
              'avatars', 'inspection-reports');

UPDATE storage.buckets SET
  file_size_limit = COALESCE(file_size_limit, 20971520),  -- 20 MB
  allowed_mime_types = COALESCE(allowed_mime_types, ARRAY[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ])
 WHERE id IN ('documents', 'job-documents', 'chat_attachments',
              'inspector-docs', 'dispute-evidence', 'contracts');

UPDATE storage.buckets SET
  file_size_limit = COALESCE(file_size_limit, 10485760),  -- 10 MB
  allowed_mime_types = COALESCE(allowed_mime_types, ARRAY[
    'application/pdf', 'image/jpeg', 'image/png'
  ])
 WHERE id IN ('certifications', 'certificates', 'receipts',
              'resumes', 'branding_assets');

-- ─── C. Drop every legacy policy from the diagnostic ─────────────────────
DROP POLICY IF EXISTS "Allow Authenticated Uploads"                  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads"                  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated viewing"                  ON storage.objects;
DROP POLICY IF EXISTS "Allow public reads"                           ON storage.objects;
DROP POLICY IF EXISTS "Allow users to delete own files"              ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view avatars"                      ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view report images"                ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view reports"                      ON storage.objects;
DROP POLICY IF EXISTS "Auth Upload"                                  ON storage.objects;
DROP POLICY IF EXISTS "Auth Upload Access"                           ON storage.objects;
DROP POLICY IF EXISTS "Auth Upload job-documents"                    ON storage.objects;
DROP POLICY IF EXISTS "Auth Users can Upload Documents"              ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload"                         ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload"                         ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete images"        ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload chat files"    ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload report images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view chat files"      ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly accessible"        ON storage.objects;
DROP POLICY IF EXISTS "Clients can upload dispute evidence"          ON storage.objects;
DROP POLICY IF EXISTS "Ebi_Master_Chat_Read"                         ON storage.objects;
DROP POLICY IF EXISTS "Ebi_Master_Chat_Upload"                       ON storage.objects;
DROP POLICY IF EXISTS "Ebi_Master_Update_Policy"                     ON storage.objects;
DROP POLICY IF EXISTS "Ebi_Master_Upload_Policy"                     ON storage.objects;
DROP POLICY IF EXISTS "Full Public Access"                           ON storage.objects;
DROP POLICY IF EXISTS "Give public access to report-images"          ON storage.objects;
DROP POLICY IF EXISTS "Inspectors can delete their own documents"    ON storage.objects;
DROP POLICY IF EXISTS "Inspectors can delete their reports"          ON storage.objects;
DROP POLICY IF EXISTS "Inspectors can upload reports"                ON storage.objects;
DROP POLICY IF EXISTS "Inspectors can upload their own documents"    ON storage.objects;
DROP POLICY IF EXISTS "Inspectors can view their own documents"      ON storage.objects;
DROP POLICY IF EXISTS "Public Access"                                ON storage.objects;
DROP POLICY IF EXISTS "Public Access job-documents"                  ON storage.objects;
DROP POLICY IF EXISTS "Public Access to Documents"                   ON storage.objects;
DROP POLICY IF EXISTS "Public View"                                  ON storage.objects;
DROP POLICY IF EXISTS "Public View Access"                           ON storage.objects;
DROP POLICY IF EXISTS "Public read report-images"                    ON storage.objects;
DROP POLICY IF EXISTS "Upload cert images"                           ON storage.objects;
DROP POLICY IF EXISTS "Upload certs"                                 ON storage.objects;
DROP POLICY IF EXISTS "Upload inspection photos"                     ON storage.objects;
DROP POLICY IF EXISTS "Upload receipts"                              ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar"            ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents"         ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own documents"           ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar"            ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own documents"         ON storage.objects;
DROP POLICY IF EXISTS "Users can upload certification docs"          ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own resume"                  ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar"            ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own documents"         ON storage.objects;
DROP POLICY IF EXISTS "Users can view certification docs"            ON storage.objects;
DROP POLICY IF EXISTS "Users can view dispute evidence"              ON storage.objects;
DROP POLICY IF EXISTS "Users can view resumes"                       ON storage.objects;
DROP POLICY IF EXISTS "View cert images"                             ON storage.objects;
DROP POLICY IF EXISTS "View certs"                                   ON storage.objects;
DROP POLICY IF EXISTS "View inspection photos"                       ON storage.objects;
DROP POLICY IF EXISTS "View receipts"                                ON storage.objects;
DROP POLICY IF EXISTS "allow_upload ufeng1_0"                        ON storage.objects;
DROP POLICY IF EXISTS "contracts bucket access"                      ON storage.objects;

-- Pre-emptive drops for the new named policies (idempotent re-run safety):
DROP POLICY IF EXISTS "avatars_select_public"            ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_self"              ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_self"              ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_self"              ON storage.objects;
DROP POLICY IF EXISTS "report_images_select_auth"        ON storage.objects;
DROP POLICY IF EXISTS "report_images_insert_owner"       ON storage.objects;
DROP POLICY IF EXISTS "report_images_delete_owner"       ON storage.objects;
DROP POLICY IF EXISTS "documents_select_auth"            ON storage.objects;
DROP POLICY IF EXISTS "documents_insert_auth"            ON storage.objects;
DROP POLICY IF EXISTS "documents_delete_owner"           ON storage.objects;
DROP POLICY IF EXISTS "job_documents_select_auth"        ON storage.objects;
DROP POLICY IF EXISTS "job_documents_insert_auth"        ON storage.objects;
DROP POLICY IF EXISTS "chat_attachments_select_auth"     ON storage.objects;
DROP POLICY IF EXISTS "chat_attachments_insert_auth"     ON storage.objects;
DROP POLICY IF EXISTS "inspection_photos_select_auth"    ON storage.objects;
DROP POLICY IF EXISTS "inspection_photos_insert_auth"    ON storage.objects;
DROP POLICY IF EXISTS "inspection_photos_us_select_auth" ON storage.objects;
DROP POLICY IF EXISTS "inspection_photos_us_insert_auth" ON storage.objects;
DROP POLICY IF EXISTS "inspection_reports_select_auth"   ON storage.objects;
DROP POLICY IF EXISTS "inspection_reports_insert_owner"  ON storage.objects;
DROP POLICY IF EXISTS "inspection_reports_delete_owner"  ON storage.objects;
DROP POLICY IF EXISTS "inspector_docs_select_self_or_admin" ON storage.objects;
DROP POLICY IF EXISTS "inspector_docs_insert_self"       ON storage.objects;
DROP POLICY IF EXISTS "inspector_docs_delete_self"       ON storage.objects;
DROP POLICY IF EXISTS "certifications_select_auth"       ON storage.objects;
DROP POLICY IF EXISTS "certifications_insert_owner"      ON storage.objects;
DROP POLICY IF EXISTS "certifications_delete_owner"      ON storage.objects;
DROP POLICY IF EXISTS "certificates_select_auth"         ON storage.objects;
DROP POLICY IF EXISTS "certificates_insert_owner"        ON storage.objects;
DROP POLICY IF EXISTS "receipts_select_owner_or_admin"   ON storage.objects;
DROP POLICY IF EXISTS "receipts_insert_owner"            ON storage.objects;
DROP POLICY IF EXISTS "dispute_evidence_select_owner_or_admin" ON storage.objects;
DROP POLICY IF EXISTS "dispute_evidence_insert_self"     ON storage.objects;
DROP POLICY IF EXISTS "contracts_select_auth"            ON storage.objects;
DROP POLICY IF EXISTS "contracts_insert_auth"            ON storage.objects;
DROP POLICY IF EXISTS "resumes_select_owner_or_admin"    ON storage.objects;
DROP POLICY IF EXISTS "resumes_insert_owner"             ON storage.objects;
DROP POLICY IF EXISTS "branding_assets_all_self"         ON storage.objects;

-- ─── D. Install canonical policies ───────────────────────────────────────

-- AVATARS (PUBLIC SELECT, self-scoped writes via folder convention path[1]=uid)
CREATE POLICY "avatars_select_public"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_insert_self"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_update_self"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_delete_self"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- REPORT-IMAGES (private; auth read; owner-prefixed filename writes)
-- Current convention: reports/<userid>_<ts>_<rand>.<ext>
CREATE POLICY "report_images_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'report-images');

CREATE POLICY "report_images_insert_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'report-images'
    AND name LIKE 'reports/' || auth.uid()::text || '_%'
  );

CREATE POLICY "report_images_delete_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'report-images'
    AND owner = auth.uid()
  );

-- DOCUMENTS (private; mixed path conventions accepted)
CREATE POLICY "documents_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "documents_insert_auth"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text     -- legacy user folders
      OR (storage.foldername(name))[1] LIKE 'project\_%' ESCAPE '\'  -- project_<jobid>
    )
  );

CREATE POLICY "documents_delete_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents' AND owner = auth.uid());

-- JOB-DOCUMENTS (private; auth-only)
CREATE POLICY "job_documents_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'job-documents');

CREATE POLICY "job_documents_insert_auth"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'job-documents');

-- CHAT ATTACHMENTS (private; auth-only — was PUBLIC R/W via Ebi_Master_*)
CREATE POLICY "chat_attachments_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat_attachments');

CREATE POLICY "chat_attachments_insert_auth"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat_attachments');

-- INSPECTION-PHOTOS (with dash) — was PUBLIC R/W via Ebi_Master_*
CREATE POLICY "inspection_photos_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'inspection-photos');

CREATE POLICY "inspection_photos_insert_auth"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'inspection-photos');

-- INSPECTION_PHOTOS (with underscore) — separate bucket
CREATE POLICY "inspection_photos_us_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'inspection_photos');

CREATE POLICY "inspection_photos_us_insert_auth"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'inspection_photos');

-- INSPECTION-REPORTS (private; owner-scoped writes)
CREATE POLICY "inspection_reports_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'inspection-reports');

CREATE POLICY "inspection_reports_insert_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-reports'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "inspection_reports_delete_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'inspection-reports'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- INSPECTOR-DOCS (self-only; admin override via nx_is_admin)
CREATE POLICY "inspector_docs_select_self_or_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'inspector-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.nx_is_admin()
    )
  );

CREATE POLICY "inspector_docs_insert_self"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspector-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "inspector_docs_delete_self"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'inspector-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.nx_is_admin()
    )
  );

-- CERTIFICATIONS (owner-scoped; cross-user read deferred to RPC)
CREATE POLICY "certifications_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'certifications' AND owner = auth.uid());

CREATE POLICY "certifications_insert_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'certifications' AND owner = auth.uid());

CREATE POLICY "certifications_delete_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'certifications' AND owner = auth.uid());

-- CERTIFICATES (owner-scoped)
CREATE POLICY "certificates_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'certificates' AND owner = auth.uid());

CREATE POLICY "certificates_insert_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'certificates' AND owner = auth.uid());

-- RECEIPTS (owner-scoped; admin override)
CREATE POLICY "receipts_select_owner_or_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (owner = auth.uid() OR public.nx_is_admin())
  );

CREATE POLICY "receipts_insert_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND owner = auth.uid());

-- DISPUTE-EVIDENCE (uploader-scoped path; admin override)
CREATE POLICY "dispute_evidence_select_owner_or_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'dispute-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.nx_is_admin()
    )
  );

CREATE POLICY "dispute_evidence_insert_self"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'dispute-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- CONTRACTS (auth-only; service-role policy kept separately for ops tooling)
CREATE POLICY "contracts_select_auth"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'contracts');

CREATE POLICY "contracts_insert_auth"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'contracts');

-- RESUMES (owner-only; admin override)
CREATE POLICY "resumes_select_owner_or_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'resumes'
    AND (owner = auth.uid() OR public.nx_is_admin())
  );

CREATE POLICY "resumes_insert_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND owner = auth.uid());

-- BRANDING_ASSETS (already had a correct policy; re-declared cleanly)
CREATE POLICY "branding_assets_all_self"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'branding_assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'branding_assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
-- 1. Every bucket except 'avatars' must be private:
--   SELECT id, public FROM storage.buckets ORDER BY id;
--
-- 2. No policy on storage.objects should grant SELECT or INSERT to {public}
--    OR to anon EXCEPT the avatars_select_public policy:
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects'
--      AND 'public' = ANY(roles) AND policyname <> 'avatars_select_public';
--   -- expect: only compliance_* and fr_storage_* policies (TO public is
--   --         their intentional shape; they self-gate via path predicate).
--
-- 3. Anon GET on a public report-images URL must now 400/403.
-- ============================================================================
