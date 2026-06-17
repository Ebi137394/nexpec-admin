-- ============================================================================
-- AFFIDAVIT HTML COLUMNS + STORAGE POLICIES
-- ============================================================================
BEGIN;

ALTER TABLE public.verification_affidavits
  ADD COLUMN IF NOT EXISTS html_storage_path text,
  ADD COLUMN IF NOT EXISTS html_sha256        text;

DROP POLICY IF EXISTS "compliance_affidavits_select_parties_or_admin" ON storage.objects;
CREATE POLICY "compliance_affidavits_select_parties_or_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'affidavits'
    AND (
      public.nx_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id::text = (storage.foldername(name))[2]
          AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
      )
    )
  );

DROP POLICY IF EXISTS "compliance_affidavits_update_admin" ON storage.objects;
CREATE POLICY "compliance_affidavits_update_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'affidavits'
    AND public.nx_is_admin()
  );

DROP POLICY IF EXISTS "compliance_affidavits_delete_admin" ON storage.objects;
CREATE POLICY "compliance_affidavits_delete_admin"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'affidavits'
    AND public.nx_is_admin()
  );

COMMIT;
