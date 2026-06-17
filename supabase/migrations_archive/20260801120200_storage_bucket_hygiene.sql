-- ============================================================================
--  20260801120200_storage_bucket_hygiene.sql   (rev 2 — storage.protect_delete safe)
--
--  PHASE 1 · STORAGE HYGIENE — resolve the inspection-photos bucket drift.
--
--  THE DRIFT: two buckets for one purpose —
--    • 'inspection-photos' (hyphen)   ← canonical; submitReport (web) + report (mobile)
--    • 'inspection_photos' (underscore) ← only the offline sync engine wrote here.
--  The code fix (src/utils/syncEngine.ts → 'inspection-photos') ships with this,
--  so NEW offline uploads go to the canonical bucket.
--
--  ⚠️ rev 2: a bucket CANNOT be dropped from SQL — `storage.protect_delete()`
--  blocks  DELETE FROM storage.buckets  ("Direct deletion from storage tables is
--  not allowed. Use the Storage API instead."). So this migration NO LONGER tries
--  to delete the bucket. It only:
--    • reports whether 'inspection_photos' is empty,
--    • drops the orphan RLS policies for it (DDL — allowed, guarded), and
--    • tells you to remove the empty bucket via the Storage API / dashboard.
--  Bucket removal (and object migration, if any) is done by
--    node scripts/ops/merge-bucket.mjs inspection_photos inspection-photos --delete
--    node scripts/ops/merge-bucket.mjs --drop-empty inspection_photos
--  which goes through the Storage API as Supabase requires.
--
--  certificates / certifications / inspector_certificates are NOT blind-merged —
--  the verification query at the foot lists every bucket + object count so the
--  team decides from real data.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_cnt int;
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'inspection_photos') THEN
    SELECT count(*) INTO v_cnt FROM storage.objects WHERE bucket_id = 'inspection_photos';

    IF v_cnt = 0 THEN
      RAISE NOTICE 'storage-hygiene: inspection_photos is EMPTY. SQL cannot DELETE storage.buckets (storage.protect_delete). Remove it via the Storage API: node scripts/ops/merge-bucket.mjs --drop-empty inspection_photos  (or the dashboard).';
      -- Orphan RLS policies are DDL, not row deletes — safe to drop here (guarded
      -- in case storage.objects is owned by a role we can''t alter).
      BEGIN
        DROP POLICY IF EXISTS "inspection_photos_select_auth"     ON storage.objects;
        DROP POLICY IF EXISTS "inspection_photos_insert_auth"     ON storage.objects;
        DROP POLICY IF EXISTS "inspection_photos_us_select_auth"  ON storage.objects;
        DROP POLICY IF EXISTS "inspection_photos_us_insert_auth"  ON storage.objects;
        DROP POLICY IF EXISTS "inspection_photos_update_auth"     ON storage.objects;
        DROP POLICY IF EXISTS "inspection_photos_delete_auth"     ON storage.objects;
        RAISE NOTICE 'storage-hygiene ✓ dropped orphan inspection_photos policies';
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'storage-hygiene: could not drop storage.objects policies (insufficient privilege) — remove them from the dashboard Storage policies UI.';
      END;
    ELSE
      RAISE WARNING 'storage-hygiene: inspection_photos holds % object(s) — migrate + drop via the Storage API: node scripts/ops/merge-bucket.mjs inspection_photos inspection-photos --delete', v_cnt;
    END IF;
  ELSE
    RAISE NOTICE 'storage-hygiene: bucket inspection_photos already absent — nothing to do';
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION — full bucket inventory + object counts (decide any other drift,
-- e.g. certificates vs certifications, from real data, not names):
--   SELECT b.id AS bucket, b.public, count(o.id) AS objects
--     FROM storage.buckets b
--     LEFT JOIN storage.objects o ON o.bucket_id = b.id
--    GROUP BY b.id, b.public
--    ORDER BY b.id;
-- ─────────────────────────────────────────────────────────────────────
