-- ════════════════════════════════════════════════════════════════════════════
--  20260801246000_client_documents_bucket_lockdown.sql
--
--  The IDOR sweeps (236000 + 242000) missed the `client_documents` storage
--  bucket (NDA/MSA/insurance/regulatory/audit docs). The TABLE
--  public.client_documents is correctly RLS'd (owner + assigned-inspector +
--  admin), but the storage OBJECTS were not — so a known file_path could be
--  signed by any authenticated user.
--
--  Fix mirrors the table's own access model at the storage layer, so every
--  legitimate reader (the four classes below) keeps working with the existing
--  createSignedUrl calls — NO app code change required:
--    • storage object owner (the uploader)
--    • admin / super_admin
--    • the document's owner_id (the client) — even if the storage owner differs
--    • the inspector assigned (jobs.contractor_id) to the doc's job
--
--  Idempotent + self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Force the bucket private (the real leak-closer; idempotent).
UPDATE storage.buckets SET public = false WHERE id = 'client_documents';

-- Purge any stale bucket_id-only SELECT policy on client_documents.
DO $purge$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects' AND cmd='SELECT'
       AND qual ~ 'client_documents'
       AND policyname <> 'client_documents_select_party_admin'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $purge$;

DROP POLICY IF EXISTS "client_documents_select_party_admin" ON storage.objects;
CREATE POLICY "client_documents_select_party_admin" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'client_documents'
    AND (
      owner = auth.uid()
      OR public.nx_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.client_documents cd
         WHERE cd.file_path = storage.objects.name
           AND (
             cd.owner_id = auth.uid()
             OR (
               cd.job_id IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM public.jobs j
                  WHERE j.id = cd.job_id AND j.contractor_id = auth.uid()
               )
             )
           )
      )
    )
  );

-- Self-test: bucket private + the owner/party/admin policy exists.
DO $test$
DECLARE v_pub int; v_pol int;
BEGIN
  SELECT count(*) INTO v_pub FROM storage.buckets WHERE id='client_documents' AND public IS TRUE;
  IF v_pub > 0 THEN RAISE EXCEPTION 'SELFTEST FAILED: client_documents still public'; END IF;
  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects' AND policyname='client_documents_select_party_admin';
  IF v_pol <> 1 THEN RAISE EXCEPTION 'SELFTEST FAILED: client_documents storage policy missing'; END IF;
  RAISE NOTICE 'client_documents sealed: private + owner/client/assigned-inspector/admin SELECT only.';
END $test$;

COMMIT;
