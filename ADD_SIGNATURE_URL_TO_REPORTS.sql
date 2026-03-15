-- Add signature column to reports table
-- This column will store the base64-encoded signature image as a data URI
-- Example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."

ALTER TABLE reports 
ADD COLUMN IF NOT EXISTS signature TEXT;

-- Add a comment to document the column
COMMENT ON COLUMN reports.signature IS 'Base64-encoded signature image as data URI (e.g., data:image/png;base64,iVBOR...)';

-- Optional: Add a check constraint to ensure valid data URI format
-- This ensures the signature starts with "data:image/" and contains ";base64,"
ALTER TABLE reports 
ADD CONSTRAINT signature_format_check 
CHECK (signature IS NULL OR signature ~ '^data:image/[^;]+;base64,');

-- Optional: Add an index for faster queries if needed
-- CREATE INDEX IF NOT EXISTS idx_reports_signature_url ON reports(signature_url);

-- Verify the column was added successfully
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'reports' AND column_name = 'signature';

-- Show the updated table structure
SELECT column_name, data_type, is_nullable, column_default, 
       CASE WHEN column_name = 'signature' THEN 'NEW COLUMN' ELSE '' END as status
FROM information_schema.columns 
WHERE table_name = 'reports' 
ORDER BY ordinal_position;
