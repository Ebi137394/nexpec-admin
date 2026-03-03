-- ============================================
-- FIX SUPABASE STORAGE RLS FOR PUBLIC ACCESS
-- ============================================
-- This script ensures that the 'anon' (unauthenticated) role
-- has SELECT permissions on storage.objects for the 'report-images' bucket

-- Step 1: Ensure the bucket is public
UPDATE storage.buckets
SET public = TRUE
WHERE id = 'report-images';

-- Step 2: Remove any existing conflicting policies
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow public SELECT" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "anon_select_report_images" ON storage.objects;

-- Step 3: Create a policy that allows public (anon) SELECT access
-- This allows unauthenticated users to read files from the report-images bucket
CREATE POLICY "anon_select_report_images"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'report-images');

-- Step 4: Ensure authenticated users can INSERT (upload)
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_insert_report_images" ON storage.objects;

CREATE POLICY "authenticated_insert_report_images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'report-images');

-- Step 5: Allow authenticated users to UPDATE their own files
DROP POLICY IF EXISTS "authenticated_update_report_images" ON storage.objects;

CREATE POLICY "authenticated_update_report_images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'report-images' AND owner = auth.uid())
WITH CHECK (bucket_id = 'report-images' AND owner = auth.uid());

-- Step 6: Allow authenticated users to DELETE their own files
DROP POLICY IF EXISTS "authenticated_delete_report_images" ON storage.objects;

CREATE POLICY "authenticated_delete_report_images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'report-images' AND owner = auth.uid());

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check bucket is public
SELECT id, name, public 
FROM storage.buckets 
WHERE id = 'report-images';

-- Check RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%report_images%'
ORDER BY policyname;

-- Test: List files in bucket (should work for anon)
-- SELECT * FROM storage.objects WHERE bucket_id = 'report-images' LIMIT 5;

