-- ============================================================================
-- profiles.role enum confirmation
--
-- The onboarding wizard offers 4 distinct paths: inspector / client /
-- agency / enterprise. Some earlier migrations narrowed `profiles.role`
-- with a CHECK constraint that only accepted client / inspector / admin /
-- super_admin, which silently coerced agency + enterprise signups back to
-- "client". This migration rewrites the check so all four onboarding
-- roles plus the two operator roles are explicitly allowed.
-- ============================================================================

BEGIN;

DO $$
DECLARE r RECORD;
BEGIN
  -- Drop ANY existing CHECK constraint on profiles.role so we can rewrite it
  -- with a known-good definition. We match by constraint definition (CHECK
  -- on the `role` column) rather than name, since prior migrations used
  -- different naming conventions.
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
       AND pg_get_constraintdef(oid) ILIKE '%client%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', r.conname);
    RAISE NOTICE 'Dropped role CHECK constraint: %', r.conname;
  END LOOP;
END $$;

-- Install the canonical check
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IS NULL OR role IN (
    'client',
    'agency',
    'enterprise',
    'inspector',
    'admin',
    'super_admin'
  )) NOT VALID;  -- NOT VALID so existing rows with legacy values don't block

-- Validate where possible (skips invalid rows quietly via NOT VALID guard)
-- We don't run VALIDATE CONSTRAINT to avoid breaking on legacy data.

-- Backfill: any profile that signed up after the multi-step wizard rolled
-- out has onboarding_role set in the metadata. If their actual `role`
-- column still says 'client' but the original intent was agency or
-- enterprise, promote it.
UPDATE public.profiles
   SET role = onboarding_role
 WHERE onboarding_role IN ('agency', 'enterprise')
   AND (role IS NULL OR role = '' OR role = 'client');

COMMIT;

-- Verify after running:
--   SELECT role, count(*) FROM public.profiles GROUP BY role ORDER BY 2 DESC;
-- Expect rows for client, inspector, agency (if any), enterprise (if any),
-- admin, super_admin.
