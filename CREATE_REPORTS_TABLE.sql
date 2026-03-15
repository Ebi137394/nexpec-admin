-- ============================================
-- NEXPEC: Create Reports Table (CORRECT VERSION)
-- ============================================
-- Drop the old table if it exists (to start fresh)
DROP TABLE IF EXISTS public.reports CASCADE;

-- Create the reports table with ALL required columns
CREATE TABLE public.reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL,
  inspector_id UUID NOT NULL,  -- ⚠️ THIS WAS MISSING!
  result TEXT NOT NULL,
  comments TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS for testing (you can enable it later)
ALTER TABLE public.reports DISABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT ALL ON public.reports TO authenticated;
GRANT ALL ON public.reports TO anon;

-- ============================================
-- Verify the table was created
-- ============================================
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'reports' 
ORDER BY ordinal_position;

-- ============================================
-- DONE! ✅
-- ============================================

