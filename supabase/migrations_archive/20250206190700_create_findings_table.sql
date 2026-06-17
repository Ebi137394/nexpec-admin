-- Create findings table for compliance tracking
-- Replay-safety: finding_severity was created out-of-band on the live DB and is in no
-- migration, so a from-scratch replay (db reset / --include-all) died here. Create it
-- guarded + make the table idempotent. No effect on prod (which already has the type).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finding_severity') THEN
    CREATE TYPE finding_severity AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS findings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inspector_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL,
  severity finding_severity NOT NULL DEFAULT 'low',
  description TEXT NOT NULL,
  location VARCHAR(255),
  asset_tag VARCHAR(100),
  photo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for performance
CREATE INDEX idx_findings_project_id ON findings(project_id);
CREATE INDEX idx_findings_inspector_id ON findings(inspector_id);
CREATE INDEX idx_findings_severity ON findings(severity);
CREATE INDEX idx_findings_category ON findings(category);

-- Enable Row Level Security
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for findings
CREATE POLICY "Clients can view findings for their projects" ON findings
  FOR SELECT USING (
    project_id IN (
      SELECT p.id FROM projects p 
      WHERE p.client_id = auth.uid()
    )
  );

CREATE POLICY "Inspectors can view their own findings" ON findings
  FOR SELECT USING (inspector_id = auth.uid());

CREATE POLICY "Inspectors can insert findings" ON findings
  FOR INSERT WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Inspectors can update their own findings" ON findings
  FOR UPDATE USING (inspector_id = auth.uid());

CREATE POLICY "Inspectors can delete their own findings" ON findings
  FOR DELETE USING (inspector_id = auth.uid());

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_findings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_findings_updated_at ON findings;
CREATE TRIGGER update_findings_updated_at
  BEFORE UPDATE ON findings
  FOR EACH ROW
  EXECUTE FUNCTION update_findings_updated_at();