-- Add contractor_payout_amount column for Managed Escrow Disbursement
ALTER TABLE public.jobs 
ADD COLUMN IF NOT EXISTS contractor_payout_amount NUMERIC DEFAULT 0;

COMMENT ON COLUMN public.jobs.contractor_payout_amount IS 'The manually negotiated payout for the inspector, allowing for flexible service commissions.';