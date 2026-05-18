-- ============================================================
-- NEXPEC: widen the contracts.status CHECK constraint
-- The current contracts_status_chk rejects 'signed', which is
-- the value System A (Sign Job Agreement) writes when an
-- inspector signs. PostgreSQL throws:
--   new row for relation "contracts" violates check
--   constraint "contracts_status_chk"
-- before any RLS or app logic ever runs.
--
-- Fix: drop the old check, install a new one that covers every
-- status the app actually uses across both contract systems.
-- Idempotent: safe to re-run.
-- ============================================================

-- Drop any prior CHECK on contracts.status (matches by definition).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class      rel ON rel.oid = con.conrelid
    JOIN pg_namespace  nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'contracts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.contracts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Install the canonical CHECK covering every value used by:
--   System A (sign job agreement)  -> 'signed'
--   System B (Smart Contracts Hub) -> 'draft', 'pending_signature',
--                                      'active', 'in_progress',
--                                      'completed', 'cancelled'
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_status_chk
  CHECK (status IN (
    'draft',
    'pending_signature',
    'signed',
    'active',
    'in_progress',
    'completed',
    'cancelled'
  ));

-- Reload PostgREST so the change is picked up immediately.
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

-- Verify after the inspector signs once:
--   SELECT count(*), status FROM public.contracts GROUP BY status;
