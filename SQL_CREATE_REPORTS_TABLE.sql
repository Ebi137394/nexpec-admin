-- ============================================
-- NEXPEC: Create Reports Table
-- ============================================
-- This table stores inspection reports submitted by inspectors
-- after completing a job.

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  inspector_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  result TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
  comments TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_reports_application_id ON public.reports(application_id);
CREATE INDEX IF NOT EXISTS idx_reports_inspector_id ON public.reports(inspector_id);

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Enable RLS
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Policy 1: Inspectors can INSERT their own reports
CREATE POLICY "Inspectors can submit their own reports"
ON public.reports
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = inspector_id);

-- Policy 2: Inspectors can VIEW their own reports
CREATE POLICY "Inspectors can view their own reports"
ON public.reports
FOR SELECT
TO authenticated
USING (auth.uid() = inspector_id);

-- Policy 3: Admins/Clients can VIEW all reports
-- (Optional: If you want clients to see reports for their projects)
CREATE POLICY "Everyone can view all reports"
ON public.reports
FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- Grant Permissions
-- ============================================

GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT SELECT ON public.reports TO anon;

-- ============================================
-- DONE! ✅
-- ============================================
-- Now inspectors can submit reports after being hired!

