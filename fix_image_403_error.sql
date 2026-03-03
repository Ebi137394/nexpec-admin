-- ============================================
-- QUICK FIX FOR 403 IMAGE LOADING ERROR
-- Run this in Supabase SQL Editor
-- ============================================

-- Step 1: Ensure bucket is public
UPDATE storage.buckets
SET public = true
WHERE id = 'report-images';

-- Step 2: Drop any existing conflicting policies
DROP POLICY IF EXISTS "Allow public read for report-images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon read" ON storage.objects;

-- Step 3: Create comprehensive public SELECT policy
CREATE POLICY "Allow public read for report-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'report-images');

-- Also allow authenticated users
CREATE POLICY "Allow authenticated read for report-images"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'report-images');

-- Step 4: Verify the fix
SELECT 
  'Bucket Status' as check_type,
  id,
  name,
  public,
  CASE 
    WHEN public = true THEN '✅ Public'
    ELSE '❌ Not Public'
  END as status
FROM storage.buckets
WHERE id = 'report-images'

UNION ALL

SELECT 
  'RLS Policies' as check_type,
  policyname as id,
  cmd::text as name,
  CASE 
    WHEN 'anon' = ANY(roles) OR 'public' = ANY(roles) THEN true
    ELSE false
  END as public,
  CASE 
    WHEN 'anon' = ANY(roles) OR 'public' = ANY(roles) THEN '✅ Public access allowed'
    ELSE '❌ No public access'
  END as status
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%report-images%'
  AND cmd = 'SELECT';

-- ============================================
-- TEST YOUR URL AFTER RUNNING THIS
-- ============================================
-- URL: https://sxqpjxhslzzcdrdctatm.supabase.co/storage/v1/object/public/report-images/reports/0a4130bc-bcc9-4c95-bb40-326d54f84d93_1767117076365.png
-- 
-- 1. Copy the URL above
-- 2. Open incognito browser
-- 3. Paste and press Enter
-- 4. Image should now display ✅
-- ============================================

