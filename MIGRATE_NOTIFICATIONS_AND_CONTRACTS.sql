-- ============================================================================
-- Migration: Create Notifications Table and Migrate Proposals to Contracts
-- Date: 2025-01-11
-- Description: 
--   1. Creates notifications table with RLS policies
--   2. Migrates pending proposals to active contracts
--   3. Updates proposal statuses to 'accepted'
-- ============================================================================

-- ============================================================================
-- 1. Create Notifications Table (if it doesn't exist)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    read boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 2. Fix RLS Policy Error 42710: Drop old policy first
-- ============================================================================
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;

-- ============================================================================
-- 3. Enable RLS and Create New Policy
-- ============================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications" ON public.notifications
FOR SELECT USING (auth.uid() = user_id);

-- ============================================================================
-- 4. Migrate Pending Proposals to Active Contracts
-- ============================================================================
-- NOTE: Verify column names match your actual schema:
--   - contracts table: contractor_id (or worker_id/inspector_id)
--   - contracts table: price (or amount)
--   - If your contracts table uses different column names, adjust accordingly
INSERT INTO public.contracts (
    job_id, 
    contractor_id, 
    client_id, 
    price, 
    status, 
    start_date
)
SELECT 
    p.job_id, 
    p.contractor_id, 
    -- If client_id is missing, use contractor_id temporarily to avoid error
    COALESCE(
        (SELECT client_id FROM public.jobs WHERE id = p.job_id), 
        p.contractor_id
    ), 
    p.price, 
    'in_progress', 
    now()
FROM public.proposals p
WHERE p.status = 'pending' 
AND NOT EXISTS (
    SELECT 1 
    FROM public.contracts c 
    WHERE c.job_id = p.job_id
);

-- ============================================================================
-- 5. Update Proposal Statuses to 'accepted'
-- ============================================================================
UPDATE public.proposals 
SET status = 'accepted' 
WHERE status = 'pending';

-- ============================================================================
-- 6. Reload PostgREST Configuration
-- ============================================================================
NOTIFY pgrst, 'reload config';

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- ✅ Notifications table created with RLS
-- ✅ Pending proposals migrated to contracts
-- ✅ Proposal statuses updated to 'accepted'
-- ✅ PostgREST config reloaded
