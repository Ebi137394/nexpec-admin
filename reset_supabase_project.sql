-- ============================================
-- COMPLETE SUPABASE PROJECT RESET SCRIPT
-- WARNING: This will DELETE ALL DATA
-- Run this in Supabase SQL Editor
-- ============================================

-- ============================================
-- STEP 1: DELETE ALL DATA FROM TABLES
-- ============================================

-- Disable foreign key checks temporarily (if needed)
SET session_replication_role = 'replica';

-- Truncate tables (removes all data but keeps table structure)
TRUNCATE TABLE reports CASCADE;
TRUNCATE TABLE projects CASCADE;
TRUNCATE TABLE profiles CASCADE;

-- Also truncate related tables if they exist
TRUNCATE TABLE IF EXISTS applications CASCADE;
TRUNCATE TABLE IF EXISTS messages CASCADE;

-- Re-enable foreign key checks
SET session_replication_role = 'origin';

-- Verify tables are empty
SELECT 'reports' as table_name, COUNT(*) as row_count FROM reports
UNION ALL
SELECT 'projects', COUNT(*) FROM projects
UNION ALL
SELECT 'profiles', COUNT(*) FROM profiles;

-- ============================================
-- STEP 2: DELETE ALL STORAGE FILES
-- ============================================

-- Delete all objects from report-images bucket
DELETE FROM storage.objects
WHERE bucket_id = 'report-images';

-- Verify deletion
SELECT 
  COUNT(*) as remaining_files,
  pg_size_pretty(SUM(metadata->>'size')::bigint) as total_size
FROM storage.objects
WHERE bucket_id = 'report-images';

-- ============================================
-- STEP 3: DELETE STORAGE BUCKET
-- ============================================

-- First, delete all policies on the bucket
DROP POLICY IF EXISTS "Allow public read for report-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read for report-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated insert for report-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update for report-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete for report-images" ON storage.objects;

-- Delete all objects (if any remain)
DELETE FROM storage.objects WHERE bucket_id = 'report-images';

-- Delete the bucket itself
DELETE FROM storage.buckets WHERE id = 'report-images';

-- Verify bucket is deleted
SELECT id, name, public, created_at
FROM storage.buckets
WHERE id = 'report-images';

-- Should return 0 rows if successful

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check all tables are empty
SELECT 
  'reports' as table_name, 
  COUNT(*) as row_count 
FROM reports
UNION ALL
SELECT 'projects', COUNT(*) FROM projects
UNION ALL
SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL
SELECT 'applications', COUNT(*) FROM applications
UNION ALL
SELECT 'messages', COUNT(*) FROM messages;

-- Check storage is clean
SELECT 
  COUNT(*) as total_buckets,
  (SELECT COUNT(*) FROM storage.objects) as total_objects
FROM storage.buckets;

-- ============================================
-- RESET COMPLETE
-- ============================================
-- Next: Go to Supabase Dashboard to recreate the bucket
-- See instructions below

