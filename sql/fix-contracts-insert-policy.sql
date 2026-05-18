-- ============================================================
-- NEXPEC: allow inspectors to insert their own contracts
-- The contracts table only has: client_id and contractor_id.
-- (No inspector_id, no worker_id.) The existing INSERT policy
-- restricted to auth.uid() = client_id, which silently blocked
-- inspectors when they tried to sign the Job Agreement.
-- This widens it to also accept auth.uid() = contractor_id.
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE IF EXISTS public.contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_insert_parties" ON public.contracts;

CREATE POLICY "contracts_insert_parties"
  ON public.contracts
  FOR INSERT
  WITH CHECK (
    auth.uid() = client_id
    OR auth.uid() = contractor_id
  );

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

-- Verify after inspector signs once:
--   SELECT count(*) FROM public.contracts;
