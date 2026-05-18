-- Add branding columns to profiles table for white-label reporting
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS company_logo_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS report_header_text TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS report_footer_text TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS use_custom_branding BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#7C3AED';

-- Create storage bucket for branding assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding_assets',
  'branding_assets',
  TRUE,
  2097152,  -- 2MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: users can only manage their own folder
CREATE POLICY "Users manage own branding assets"
ON storage.objects FOR ALL
USING (
  bucket_id = 'branding_assets'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'branding_assets'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Optional: track PDF exports
CREATE TABLE IF NOT EXISTS report_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
  exported_at TIMESTAMPTZ DEFAULT NOW(),
  export_type TEXT DEFAULT 'pdf_share'
);