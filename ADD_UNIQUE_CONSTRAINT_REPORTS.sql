-- ============================================
-- Add UNIQUE constraint to reports.application_id
-- ============================================
-- This allows UPSERT to work properly with onConflict

-- First, check if constraint already exists and drop it if needed
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'reports_application_id_key'
    ) THEN
        ALTER TABLE public.reports DROP CONSTRAINT reports_application_id_key;
    END IF;
END $$;

-- Add the unique constraint
ALTER TABLE public.reports 
ADD CONSTRAINT reports_application_id_key 
UNIQUE (application_id);

-- Verify the constraint was added
SELECT 
    conname AS constraint_name,
    contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'public.reports'::regclass
AND conname = 'reports_application_id_key';

-- ============================================
-- DONE! ✅
-- ============================================
-- Now you can only have ONE report per application
-- UPSERT will update existing reports instead of creating duplicates

