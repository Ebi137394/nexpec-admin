-- Rollback for 20260801556000 — removes the compliance bucket's policies.
-- The bucket row itself is left in place: dropping it would orphan or destroy
-- uploaded evidence objects, and an empty extra bucket is harmless.
DROP POLICY IF EXISTS nx_compliance_insert_own ON storage.objects;
DROP POLICY IF EXISTS nx_compliance_update_own ON storage.objects;
DROP POLICY IF EXISTS nx_compliance_delete_own ON storage.objects;
DROP POLICY IF EXISTS nx_compliance_select_own_admin ON storage.objects;
DROP POLICY IF EXISTS nx_compliance_select_affidavit_public ON storage.objects;
