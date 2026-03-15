-- ============================================
-- ENSURE APPLICATIONS TABLE RLS POLICIES
-- ============================================
-- Run this in Supabase SQL Editor to allow authenticated users
-- to INSERT applications for themselves

-- 1. Enable RLS on applications table (if not already enabled)
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- 2. Policy: Allow authenticated users to INSERT their own applications
CREATE POLICY "Users can insert their own applications"
ON public.applications
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = applicant_id);

-- 3. Policy: Allow users to SELECT their own applications
CREATE POLICY "Users can view their own applications"
ON public.applications
FOR SELECT
TO authenticated
USING (auth.uid() = applicant_id);

-- 4. Policy: Allow users to UPDATE their own applications (optional, for status changes)
CREATE POLICY "Users can update their own applications"
ON public.applications
FOR UPDATE
TO authenticated
USING (auth.uid() = applicant_id)
WITH CHECK (auth.uid() = applicant_id);

-- ============================================
-- VERIFY THE POLICIES
-- ============================================
-- Run this to check if policies exist:
-- SELECT * FROM pg_policies WHERE tablename = 'applications';

-- ============================================
-- IF YOU GET "POLICY ALREADY EXISTS" ERRORS
-- ============================================
-- Drop existing policies first:
-- DROP POLICY IF EXISTS "Users can insert their own applications" ON public.applications;
-- DROP POLICY IF EXISTS "Users can view their own applications" ON public.applications;
-- DROP POLICY IF EXISTS "Users can update their own applications" ON public.applications;
-- Then run the CREATE POLICY statements above again.

