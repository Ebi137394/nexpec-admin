-- ============================================
-- SUPABASE STORAGE FIX FOR IMAGE RENDERING
-- Run this script in Supabase SQL Editor
-- ============================================

-- 1. Make the 'report-images' bucket PUBLIC
UPDATE storage.buckets
SET public = true
WHERE id = 'report-images';

-- If bucket doesn't exist, create it as public
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-images', 'report-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Fix MIME types for existing files based on file extension
-- Update PNG files
UPDATE storage.objects
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{mimetype}',
  '"image/png"'
)
WHERE bucket_id = 'report-images'
  AND name LIKE '%.png'
  AND (metadata->>'mimetype' IS NULL OR metadata->>'mimetype' = 'application/octet-stream');

-- Update JPG/JPEG files
UPDATE storage.objects
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{mimetype}',
  '"image/jpeg"'
)
WHERE bucket_id = 'report-images'
  AND (name LIKE '%.jpg' OR name LIKE '%.jpeg')
  AND (metadata->>'mimetype' IS NULL OR metadata->>'mimetype' = 'application/octet-stream');

-- Update GIF files
UPDATE storage.objects
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{mimetype}',
  '"image/gif"'
)
WHERE bucket_id = 'report-images'
  AND name LIKE '%.gif'
  AND (metadata->>'mimetype' IS NULL OR metadata->>'mimetype' = 'application/octet-stream');

-- Update WEBP files
UPDATE storage.objects
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{mimetype}',
  '"image/webp"'
)
WHERE bucket_id = 'report-images'
  AND name LIKE '%.webp'
  AND (metadata->>'mimetype' IS NULL OR metadata->>'mimetype' = 'application/octet-stream');

-- 3. Ensure RLS policies allow public SELECT access
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;

-- Create a policy that allows public SELECT for report-images bucket
CREATE POLICY "Allow public read for report-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'report-images');

-- Also ensure authenticated users can read
CREATE POLICY "Allow authenticated read for report-images"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'report-images');

-- 4. Verify the bucket is public
SELECT id, name, public, created_at, updated_at
FROM storage.buckets
WHERE id = 'report-images';

-- 5. Check MIME types after update
SELECT 
  name,
  metadata->>'mimetype' as mimetype,
  created_at
FROM storage.objects
WHERE bucket_id = 'report-images'
ORDER BY created_at DESC
LIMIT 20;

