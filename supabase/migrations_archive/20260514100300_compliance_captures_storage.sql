-- ============================================================================
-- COMPLIANCE CAPTURES STORAGE — RLS for inspector field uploads
-- ============================================================================
--
-- Path layout: compliance/captures/<job_id>/<requirement_id>/<capture_id>.<ext>
--
-- Only the assigned inspector (jobs.contractor_id = auth.uid()) can
-- INSERT. Reads are open to any job party + admin. Edits / deletes are
-- admin-only — captures are evidence; the inspector cannot retract.
-- ============================================================================

BEGIN;

-- ─── INSERT (assigned inspector only) ────────────────────────
DROP POLICY IF EXISTS "compliance_captures_insert_inspector" ON storage.objects;
CREATE POLICY "compliance_captures_insert_inspector"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'captures'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id::text = (storage.foldername(name))[2]
        AND j.contractor_id = auth.uid()
    )
  );

-- ─── SELECT (any job party + admin) ──────────────────────────
DROP POLICY IF EXISTS "compliance_captures_select_job_party_or_admin" ON storage.objects;
CREATE POLICY "compliance_captures_select_job_party_or_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'captures'
    AND (
      public.nx_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id::text = (storage.foldername(name))[2]
          AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
      )
    )
  );

-- ─── UPDATE / DELETE (admin only) ────────────────────────────
DROP POLICY IF EXISTS "compliance_captures_update_admin" ON storage.objects;
CREATE POLICY "compliance_captures_update_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'captures'
    AND public.nx_is_admin()
  );

DROP POLICY IF EXISTS "compliance_captures_delete_admin" ON storage.objects;
CREATE POLICY "compliance_captures_delete_admin"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'captures'
    AND public.nx_is_admin()
  );

COMMIT;
