-- NEXPEC Database Upgrade Script
-- Run this in Supabase SQL Editor

-- ============================================
-- TASK 1: UPDATE PROJECTS TABLE
-- ============================================

-- Add payment_mode column (Hourly or Fixed)
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS payment_mode TEXT CHECK (payment_mode IN ('Hourly', 'Fixed'));

-- Add price column (numeric for payment amount)
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS price NUMERIC;

-- Add currency column (e.g., USD, EUR, CAD)
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';

-- Add travel_expenses column (boolean)
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS travel_expenses BOOLEAN DEFAULT false;

-- Add interview_required column (boolean)
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS interview_required BOOLEAN DEFAULT false;

-- Add payment_status column
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS payment_status TEXT;

-- ============================================
-- TASK 2: UPDATE REPORTS TABLE
-- ============================================

-- Add status column with check constraint
ALTER TABLE reports 
ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('Submitted', 'Approved', 'Needs_Revision')) DEFAULT 'Submitted';

-- Add revision_comments column
ALTER TABLE reports 
ADD COLUMN IF NOT EXISTS revision_comments TEXT;

-- ============================================
-- TASK 3: CREATE MESSAGES TABLE
-- ============================================

-- Create messages table for project chat
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- ============================================
-- TASK 4: ENABLE RLS ON MESSAGES TABLE
-- ============================================

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view messages for projects they are involved in
-- (either as client or as inspector who applied/accepted)
CREATE POLICY "Users can view messages for their projects"
  ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = messages.project_id 
      AND (
        projects.client_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM applications 
          WHERE applications.project_id = projects.id 
          AND applications.applicant_id = auth.uid()
          AND applications.status = 'Accepted'
        )
      )
    )
  );

-- Policy: Users can insert messages for projects they are involved in
CREATE POLICY "Users can send messages for their projects"
  ON messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = messages.project_id 
      AND (
        projects.client_id = auth.uid() 
        OR EXISTS (
          SELECT 1 FROM applications 
          WHERE applications.project_id = projects.id 
          AND applications.applicant_id = auth.uid()
          AND applications.status = 'Accepted'
        )
      )
    )
    AND sender_id = auth.uid()
  );

-- Policy: Users can update their own messages
CREATE POLICY "Users can update their own messages"
  ON messages
  FOR UPDATE
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- Policy: Users can delete their own messages
CREATE POLICY "Users can delete their own messages"
  ON messages
  FOR DELETE
  USING (sender_id = auth.uid());

-- ============================================
-- TASK 5: CREATE UPDATED_AT TRIGGER FOR MESSAGES
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VERIFICATION QUERIES (Optional - Run to verify)
-- ============================================

-- Verify projects table columns
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'projects' AND column_name IN ('payment_mode', 'price', 'currency', 'travel_expenses', 'interview_required', 'payment_status');

-- Verify reports table columns
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'reports' AND column_name IN ('status', 'revision_comments');

-- Verify messages table exists
-- SELECT * FROM information_schema.tables WHERE table_name = 'messages';

-- Verify RLS policies on messages
-- SELECT * FROM pg_policies WHERE tablename = 'messages';

