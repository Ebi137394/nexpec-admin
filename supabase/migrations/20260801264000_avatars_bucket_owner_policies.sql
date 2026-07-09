-- ════════════════════════════════════════════════════════════════════════════
--  20260801264000_avatars_bucket_owner_policies.sql
--
--  BUG: "Avatar upload failed: StorageApiError: new row violates row-level
--  security policy" on Edit Profile → change photo.
--
--  TWO causes, both fixed:
--   1. The client wrote to object name `avatars/<uid>/<ts>.jpg` — the redundant
--      bucket-name prefix made (storage.foldername(name))[1] = 'avatars', not
--      the uid. (Client patched to `<uid>/<ts>.jpg`.)
--   2. There were no version-controlled INSERT/UPDATE/DELETE policies on the
--      avatars bucket (any prod policy was dashboard-managed / mismatched), so
--      the write had nothing to satisfy → RLS rejection.
--
--  This makes the avatars bucket authoritative in migrations: public read
--  (avatars are public — getPublicUrl renders them), owner-folder write. A user
--  may only write objects whose first path segment is their own auth.uid().
--  Idempotent; no unqualified DELETE/UPDATE (safeupdate-safe).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Bucket exists + public (read via getPublicUrl).
INSERT INTO storage.buckets (id, name, public)
  VALUES ('avatars', 'avatars', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

-- Clear any prior avatars policies (dashboard-created or partial) so ours are
-- the single source of truth. DROP is DDL, not a guarded DELETE.
DO $purge$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname ILIKE '%avatar%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END
$purge$;

-- Public read (bucket is public; explicit policy covers authenticated listing too).
CREATE POLICY "avatars_select_public" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- Owner-folder writes: first path segment must equal the caller's uid.
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Self-test: the three owner-write policies + public read must exist.
DO $test$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('avatars_select_public','avatars_insert_own',
                        'avatars_update_own','avatars_delete_own');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: expected 4 avatars storage policies, found %', v_n;
  END IF;
  RAISE NOTICE 'avatars bucket: public read + owner-folder write policies installed — profile photo upload fixed.';
END
$test$;

COMMIT;
