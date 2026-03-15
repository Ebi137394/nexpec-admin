-- =============================================================================
-- DATABASE FIXES FOR PROFILE UPDATE & JOB APPLICATION ISSUES
-- =============================================================================
-- Run this script in Supabase SQL Editor to fix:
-- 1. Missing columns in profiles table
-- 2. RLS policies for profiles
-- 3. NOT NULL constraint on proposed_price in job_applications
-- =============================================================================

-- =============================================================================
-- PART 1: FIX PROFILES TABLE - ADD MISSING COLUMNS
-- =============================================================================

-- Add first_name column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'first_name'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN first_name TEXT;
    RAISE NOTICE 'Added first_name column';
  END IF;
END $$;

-- Add last_name column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'last_name'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN last_name TEXT;
    RAISE NOTICE 'Added last_name column';
  END IF;
END $$;

-- Add phone column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN phone TEXT;
    RAISE NOTICE 'Added phone column';
  END IF;
END $$;

-- Add bio column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'bio'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN bio TEXT;
    RAISE NOTICE 'Added bio column';
  END IF;
END $$;

-- Add specialties column if it doesn't exist (as TEXT[] array)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'specialties'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN specialties TEXT[];
    RAISE NOTICE 'Added specialties column';
  END IF;
END $$;

-- Add years_experience column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'years_experience'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN years_experience INTEGER;
    RAISE NOTICE 'Added years_experience column';
  END IF;
END $$;

-- Add title column if it doesn't exist (professional title)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'title'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN title TEXT;
    RAISE NOTICE 'Added title column';
  END IF;
END $$;

-- Add professional_title column if it doesn't exist (alternative name)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'professional_title'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN professional_title TEXT;
    RAISE NOTICE 'Added professional_title column';
  END IF;
END $$;

-- Add years_of_experience column if it doesn't exist (alternative name)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'years_of_experience'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN years_of_experience INTEGER;
    RAISE NOTICE 'Added years_of_experience column';
  END IF;
END $$;

-- Ensure email column exists (should already exist, but safe check)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email TEXT;
    RAISE NOTICE 'Added email column';
  END IF;
END $$;

-- =============================================================================
-- PART 2: FIX RLS POLICIES FOR PROFILES TABLE
-- =============================================================================

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Enable update for users based on id" ON public.profiles;

-- Policy 1: Users can INSERT their own profile (for upsert to work)
-- CRITICAL: Required for upsert when row doesn't exist
CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- Policy 2: Users can UPDATE their own profile
-- CRITICAL: Required for upsert when row exists
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy 3: Users can SELECT their own profile
-- CRITICAL: Required for upsert - Supabase needs SELECT to check if row exists
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Policy 4: Users can VIEW all profiles (for job listings, etc.)
-- This allows public read access to profiles
CREATE POLICY "Users can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- =============================================================================
-- PART 3: FIX JOB_APPLICATIONS TABLE - REMOVE NOT NULL FROM proposed_price
-- =============================================================================

-- Fix job_applications table (primary table used in code)
DO $$ 
BEGIN
  -- Check if column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'job_applications' 
    AND column_name = 'proposed_price'
  ) THEN
    -- Remove NOT NULL constraint if it exists
    ALTER TABLE public.job_applications 
    ALTER COLUMN proposed_price DROP NOT NULL;
    
    RAISE NOTICE 'Removed NOT NULL constraint from job_applications.proposed_price';
  ELSE
    -- If column doesn't exist, add it as nullable
    ALTER TABLE public.job_applications 
    ADD COLUMN proposed_price NUMERIC;
    
    RAISE NOTICE 'Added proposed_price column (nullable) to job_applications';
  END IF;
END $$;

-- =============================================================================
-- PART 3B: FIX APPLICATIONS TABLE (if it exists separately)
-- =============================================================================

-- Fix applications table (if it's a separate table from job_applications)
DO $$ 
BEGIN
  -- Check if applications table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'applications'
  ) THEN
    -- Check if proposed_price column exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'applications' 
      AND column_name = 'proposed_price'
    ) THEN
      -- Remove NOT NULL constraint if it exists
      ALTER TABLE public.applications 
      ALTER COLUMN proposed_price DROP NOT NULL;
      
      RAISE NOTICE 'Removed NOT NULL constraint from applications.proposed_price';
    ELSE
      -- If column doesn't exist, add it as nullable
      ALTER TABLE public.applications 
      ADD COLUMN proposed_price NUMERIC;
      
      RAISE NOTICE 'Added proposed_price column (nullable) to applications';
    END IF;
  ELSE
    RAISE NOTICE 'applications table does not exist, skipping';
  END IF;
END $$;

-- =============================================================================
-- PART 4: VERIFY CHANGES
-- =============================================================================

-- Verify profiles columns
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
  AND column_name IN ('first_name', 'last_name', 'phone', 'bio', 'specialties', 'years_experience', 'title', 'email')
ORDER BY column_name;

-- Verify job_applications.proposed_price
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'job_applications'
  AND column_name = 'proposed_price';

-- Verify applications.proposed_price (if table exists)
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'applications'
  AND column_name = 'proposed_price';

-- Verify RLS policies
SELECT 
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;

-- =============================================================================
-- SUCCESS MESSAGE
-- =============================================================================
DO $$ 
BEGIN
  RAISE NOTICE '✅ Database fixes completed successfully!';
  RAISE NOTICE '✅ Profiles table columns added/verified';
  RAISE NOTICE '✅ RLS policies created for profiles';
  RAISE NOTICE '✅ proposed_price constraint removed from job_applications';
  RAISE NOTICE '✅ proposed_price constraint removed from applications (if exists)';
END $$;

