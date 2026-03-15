-- Add priority column to work_orders table if it doesn't exist
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium';

-- Verify the column was added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'work_orders' AND column_name = 'priority';