-- ============================================
-- ADD IMAGE_URL COLUMN TO REPORTS TABLE
-- ============================================
-- This allows reports to store photo evidence from inspections

-- 1. Add image_url column to reports table
ALTER TABLE public.reports 
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Add a comment to describe the column
COMMENT ON COLUMN public.reports.image_url IS 'URL of the uploaded inspection photo stored in Supabase Storage';

-- ============================================
-- CREATE STORAGE BUCKET FOR INSPECTION PHOTOS
-- ============================================
-- Run this in the Supabase SQL Editor OR create manually in Storage UI

-- Note: If creating manually via UI:
-- 1. Go to Storage in Supabase Dashboard
-- 2. Click "New Bucket"
-- 3. Name it: inspection-photos
-- 4. Set to Public (so URLs are accessible)
-- 5. Save

-- To create via SQL (requires superuser privileges):
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-photos', 'inspection-photos', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- SET UP RLS POLICIES FOR STORAGE
-- ============================================
-- Allow authenticated users to upload photos
CREATE POLICY IF NOT EXISTS "Authenticated users can upload inspection photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'inspection-photos');

-- Allow anyone to view photos (since bucket is public)
CREATE POLICY IF NOT EXISTS "Anyone can view inspection photos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'inspection-photos');

-- Allow users to delete their own photos
CREATE POLICY IF NOT EXISTS "Users can delete their own inspection photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'inspection-photos');

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Check if column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'reports' AND column_name = 'image_url';

-- Check if bucket exists
SELECT * FROM storage.buckets WHERE id = 'inspection-photos';

