-- ============================================================================
-- COMPLIANCE DOCUMENTS STORAGE — RLS for buyer-uploaded supplier docs
-- ============================================================================
--
-- Extends the `compliance` bucket policies (created in
-- 20260514100100_compliance_storage_bucket.sql) to cover the
--
--   compliance/documents/<job_uid>/<filename>
--
-- path layout used by the buyer post-flow when a client or agency
-- attaches a supplier's trade license, tax certificate, etc. at
-- job-post time.
--
-- Read:   any party on the job (client / agency / contractor) + admin
-- Insert: any party on the job
-- Update: admin only (or original uploader, if status still 'pending')
-- Delete: admin only
-- ============================================================================

BEGIN;

-- ─── compliance/documents/<job_id>/... — INSERT ─────────────
DROP POLICY IF EXISTS "compliance_docs_insert_job_party" ON storage.objects;
CREATE POLICY "compliance_docs_insert_job_party"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'documents'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id::text = (storage.foldername(name))[2]
        AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
    )
  );

-- ─── compliance/documents/<job_id>/... — SELECT ─────────────
DROP POLICY IF EXISTS "compliance_docs_select_job_party_or_admin" ON storage.objects;
CREATE POLICY "compliance_docs_select_job_party_or_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'documents'
    AND (
      public.nx_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id::text = (storage.foldername(name))[2]
          AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
      )
    )
  );

-- ─── compliance/documents/<job_id>/... — UPDATE (admin only) ───
DROP POLICY IF EXISTS "compliance_docs_update_admin" ON storage.objects;
CREATE POLICY "compliance_docs_update_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'documents'
    AND public.nx_is_admin()
  );

-- ─── compliance/documents/<job_id>/... — DELETE (admin only) ───
DROP POLICY IF EXISTS "compliance_docs_delete_admin" ON storage.objects;
CREATE POLICY "compliance_docs_delete_admin"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'documents'
    AND public.nx_is_admin()
  );

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT polname FROM pg_policy
--   WHERE polrelid = 'storage.objects'::regclass
--     AND polname LIKE 'compliance_docs_%';
-- (expect 4 rows: insert_job_party, select_job_party_or_admin,
--  update_admin, delete_admin)
-- ============================================================================
