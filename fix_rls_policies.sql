-- Fix Database Permissions (RLS) - Root Cause of "Submission Failed" Error

-- 1. Clear existing conflicting policies
DROP POLICY IF EXISTS "Allow users to insert their own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can see relevant jobs" ON public.jobs;

-- 2. Allow INSERT for Clients/Agencies (Crucial for the error you see)
CREATE POLICY "Enable insert for authenticated users" 
ON public.jobs FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = client_id);

-- 3. Strict Isolation for SELECT
CREATE POLICY "Strict data isolation" 
ON public.jobs FOR SELECT 
TO authenticated 
USING (
  client_id = auth.uid() -- Owners see their own
  OR (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')) -- Admin sees all
  OR (status = 'open') -- Inspectors see approved jobs only
);