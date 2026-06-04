-- Function to handle the complete assignment transaction
-- This function will be called from the pending assignments screen
CREATE OR REPLACE FUNCTION assign_inspector_to_job(
    p_job_id UUID,
    p_inspector_id UUID,
    p_payout_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job_status TEXT;
    v_current_applications RECORD;
BEGIN
    -- Start transaction
    BEGIN
        -- Check if job exists and is in client_selected status
        SELECT status INTO v_job_status
        FROM jobs 
        WHERE id = p_job_id;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Job not found';
        END IF;
        
        -- Update job status to assigned and set contractor details
        UPDATE jobs 
        SET 
            status = 'assigned',
            contractor_id = p_inspector_id,
            payout_amount = p_payout_amount,
            updated_at = NOW()
        WHERE id = p_job_id;
        
        -- Update all applications for this job
        -- Set the selected inspector to 'assigned'
        UPDATE job_applications 
        SET 
            status = 'assigned',
            updated_at = NOW()
        WHERE job_id = p_job_id 
        AND applicant_id = p_inspector_id;
        
        -- Set all other applications for this job to 'rejected'
        UPDATE job_applications 
        SET 
            status = 'rejected',
            updated_at = NOW()
        WHERE job_id = p_job_id 
        AND applicant_id != p_inspector_id;
        
        -- Commit transaction
        RETURN TRUE;
        
    EXCEPTION WHEN OTHERS THEN
        -- Rollback transaction on any error
        RAISE EXCEPTION 'Assignment failed: %', SQLERRM;
        RETURN FALSE;
    END;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION assign_inspector_to_job(UUID, UUID, NUMERIC) TO authenticated;

-- Add RLS policy for the function (if needed)
-- Note: Functions bypass RLS by default, but we can add additional security if needed