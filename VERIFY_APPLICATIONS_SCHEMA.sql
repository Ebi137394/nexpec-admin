-- ============================================
-- VERIFY APPLICATIONS TABLE SCHEMA
-- ============================================
-- Run this in Supabase SQL Editor to check your actual column names

-- 1. Check the actual column names in applications table
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'applications'
ORDER BY ordinal_position;

-- ============================================
-- EXPECTED COLUMNS:
-- ============================================
-- id (uuid)
-- project_id (uuid)
-- applicant_id (uuid)  <-- THIS IS THE CORRECT COLUMN NAME
-- status (text)
-- created_at (timestamp)
-- updated_at (timestamp)

-- ============================================
-- IF YOUR TABLE HAS 'inspector_id' INSTEAD:
-- ============================================
-- You need to rename it:
-- ALTER TABLE public.applications RENAME COLUMN inspector_id TO applicant_id;

-- ============================================
-- CHECK EXISTING RLS POLICIES
-- ============================================
-- Run this to see if any policies reference the wrong column:
SELECT 
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'applications';

-- ============================================
-- FIX RLS POLICIES IF THEY USE inspector_id
-- ============================================
-- If you see policies with 'inspector_id', drop and recreate them:

-- Drop old policies (if they exist)
DROP POLICY IF EXISTS "Users can insert their own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can view their own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can update their own applications" ON public.applications;

-- Create correct policies with applicant_id
CREATE POLICY "Users can insert their own applications"
ON public.applications
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = applicant_id);

CREATE POLICY "Users can view their own applications"
ON public.applications
FOR SELECT
TO authenticated
USING (auth.uid() = applicant_id);

CREATE POLICY "Users can update their own applications"
ON public.applications
FOR UPDATE
TO authenticated
USING (auth.uid() = applicant_id)
WITH CHECK (auth.uid() = applicant_id);

