-- =============================================================================
-- NEXPEC — RESTORE ADMIN VISIBILITY ON `contracts`
-- =============================================================================
-- Problem: the existing RLS policies on public.contracts only grant SELECT to
-- the inspector/contractor/worker and the client. Super-admins have no
-- matching foreign-key column, so every `select` returned zero rows even
-- though contracts existed in the table. The admin's Legal & Contracts
-- screen rendered the empty state forever.
--
-- Fix: add super-admin SELECT/UPDATE policies that fall through to the
-- existing `is_super_admin()` helper (created earlier for applications/jobs).
-- Idempotent — safe to re-run.
-- =============================================================================

-- 0. Ensure the super-admin helper exists. (No-op if already created.)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin', 'support')
  );
$$;

-- 1. Make sure RLS is on (does nothing if already enabled).
ALTER TABLE IF EXISTS public.contracts ENABLE ROW LEVEL SECURITY;

-- 2. Drop any prior versions of the admin policies so we can recreate cleanly.
DROP POLICY IF EXISTS "contracts_admin_read"  ON public.contracts;
DROP POLICY IF EXISTS "contracts_admin_write" ON public.contracts;

-- 3. Admin can SELECT every contract (audit trail / Legal & Contracts screen).
CREATE POLICY "contracts_admin_read"
  ON public.contracts
  FOR SELECT
  USING (public.is_super_admin());

-- 4. Admin can UPDATE any contract (e.g. mark void, attach final PDF).
CREATE POLICY "contracts_admin_write"
  ON public.contracts
  FOR UPDATE
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 5. Reload PostgREST so the policy changes take effect immediately.
NOTIFY pgrst, 'reload config';

-- =============================================================================
-- VERIFICATION — run this after the policies are in place to confirm
-- the admin can actually see contract rows. Should return > 0 if any
-- contracts have been signed.
-- =============================================================================
-- SELECT count(*) AS contracts_visible_to_admin FROM public.contracts;
