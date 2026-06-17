-- Create legal_consents table
CREATE TABLE IF NOT EXISTS legal_consents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  signature_base64 TEXT NOT NULL,
  signature_stroke_count INTEGER DEFAULT 0,
  nda_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  data_processing_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  confidentiality_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  liability_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address TEXT,
  user_agent TEXT,
  geo_country TEXT,
  geo_region TEXT,
  geo_city TEXT,
  policy_version TEXT NOT NULL,
  consent_status TEXT NOT NULL DEFAULT 'completed',
  signed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_legal_consents_user_id ON legal_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_legal_consents_document_id ON legal_consents(document_id);
CREATE INDEX IF NOT EXISTS idx_legal_consents_signed_at ON legal_consents(signed_at);

-- Enable RLS
ALTER TABLE legal_consents ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users
CREATE POLICY "Users can view their own consents" ON legal_consents
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own consents" ON legal_consents
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_legal_consents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_legal_consents_updated_at ON legal_consents;
CREATE TRIGGER update_legal_consents_updated_at
    BEFORE UPDATE ON legal_consents
    FOR EACH ROW
    EXECUTE FUNCTION update_legal_consents_updated_at();

-- Create function to check if user has valid consent for a document
CREATE OR REPLACE FUNCTION has_valid_consent(
    p_user_id TEXT,
    p_document_id TEXT,
    p_policy_version TEXT DEFAULT '2.1.0'
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM legal_consents 
        WHERE user_id = p_user_id 
        AND document_id = p_document_id 
        AND policy_version = p_policy_version
        AND consent_status = 'completed'
        AND nda_accepted = true
        AND data_processing_accepted = true
        AND confidentiality_accepted = true
        AND liability_accepted = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get latest consent for user and document
CREATE OR REPLACE FUNCTION get_latest_consent(
    p_user_id TEXT,
    p_document_id TEXT
) RETURNS legal_consents AS $$
BEGIN
    RETURN (
        SELECT * FROM legal_consents 
        WHERE user_id = p_user_id 
        AND document_id = p_document_id 
        ORDER BY signed_at DESC 
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;