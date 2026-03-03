-- NEXPEC Inspection Reporting System - Database Setup
-- Run this SQL in Supabase SQL Editor

-- ============================================
-- TASK 1: CREATE REPORTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inspector_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  comments TEXT,
  result TEXT NOT NULL CHECK (result IN ('Pass', 'Fail')),
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Approved', 'Needs_Revision')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_reports_project_id ON reports(project_id);
CREATE INDEX IF NOT EXISTS idx_reports_inspector_id ON reports(inspector_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);

-- ============================================
-- TASK 2: ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on reports table
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can insert their own reports
CREATE POLICY "Authenticated users can insert reports"
  ON reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = inspector_id
  );

-- Policy: Users can view reports for projects they are involved in
-- (either as inspector who created it, or as client who owns the project)
CREATE POLICY "Users can view reports for their projects"
  ON reports
  FOR SELECT
  TO authenticated
  USING (
    inspector_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = reports.project_id 
      AND projects.client_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM applications 
      WHERE applications.project_id = reports.project_id 
      AND applications.applicant_id = auth.uid()
      AND applications.status = 'Accepted'
    )
  );

-- Policy: Inspectors can update their own reports (only if status is 'Submitted' or 'Needs_Revision')
CREATE POLICY "Inspectors can update their own reports"
  ON reports
  FOR UPDATE
  TO authenticated
  USING (
    inspector_id = auth.uid()
    AND (status = 'Submitted' OR status = 'Needs_Revision')
  )
  WITH CHECK (
    inspector_id = auth.uid()
  );

-- Policy: Clients can update report status (approve or request revision)
CREATE POLICY "Clients can update report status"
  ON reports
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = reports.project_id 
      AND projects.client_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = reports.project_id 
      AND projects.client_id = auth.uid()
    )
  );

-- ============================================
-- TASK 3: CREATE UPDATED_AT TRIGGER
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION update_reports_updated_at();

-- ============================================
-- VERIFICATION QUERIES (Optional - Run to verify)
-- ============================================

-- Verify table structure
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'reports' 
-- ORDER BY ordinal_position;

-- Verify RLS is enabled
-- SELECT tablename, rowsecurity 
-- FROM pg_tables 
-- WHERE tablename = 'reports';

-- Verify policies
-- SELECT * FROM pg_policies WHERE tablename = 'reports';

