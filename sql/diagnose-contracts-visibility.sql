-- =============================================================================
-- NEXPEC — DIAGNOSE WHY ADMIN CAN'T SEE CONTRACTS
-- Run each query separately in Supabase SQL Editor while logged in as
-- the SAME user account that opens the admin Legal & Contracts screen.
-- The combined output tells us exactly which layer is blocking.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Who am I, and does my profile.role qualify for is_super_admin()?
--    Expected: role IN ('admin', 'super_admin', 'support')
--    If role is anything else (e.g. 'enterprise', 'super-admin', NULL), the
--    helper returns false and admin policies deny every row.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  auth.uid()                       AS my_auth_uid,
  p.role                           AS my_profile_role,
  public.is_super_admin()          AS am_i_super_admin
FROM public.profiles p
WHERE p.id = auth.uid();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. How many contract rows physically exist (bypasses RLS via a DB function)?
--    Run this as the project owner via SQL Editor — RLS is bypassed for the
--    SQL Editor's privileged role, so this is the real ground-truth count.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT count(*) AS total_contracts_in_table FROM public.contracts;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. What columns do the existing contract rows actually have populated?
--    NOTE: The `contracts` table does NOT have an `inspector_id` column —
--    the inspector reference is stored on `contractor_id` (canonical) with
--    `worker_id` as a legacy alias.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  id,
  job_id,
  status,
  contractor_id IS NOT NULL AS has_contractor_id,
  worker_id IS NOT NULL     AS has_worker_id,
  client_id IS NOT NULL     AS has_client_id,
  created_at
FROM public.contracts
ORDER BY created_at DESC
LIMIT 10;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Are the admin RLS policies actually installed?
--    Expected: at least one row each for SELECT and UPDATE with the
--    is_super_admin() predicate. If the rows are missing, the migration
--    didn't run successfully — re-run sql/fix-contracts-admin-rls.sql.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  policyname,
  cmd,
  qual          AS using_clause,
  with_check    AS with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'contracts'
ORDER BY policyname;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Force PostgREST to reload its policy cache. If everything else looks
--    right but the admin app still sees zero contracts, run this and try
--    the screen again.
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- EXPECTED INTERPRETATION
-- =============================================================================
--   Q1 returns am_i_super_admin = false  →  fix the role on your admin
--                                            profile (UPDATE profiles SET
--                                            role = 'super_admin' WHERE
--                                            id = '<your uuid>')
--
--   Q2 returns total_contracts_in_table = 0  →  no rows exist in DB at all,
--                                                 the inspector you saw must
--                                                 be reading from a different
--                                                 path or a stale cache. Have
--                                                 the inspector re-sign the
--                                                 job agreement once and the
--                                                 admin will see the new row.
--
--   Q4 returns no rows for contracts_admin_read  →  the migration didn't
--                                                     actually commit.
--                                                     Re-run it.
--
--   Q1 looks right, Q2 > 0, Q4 has the policies, but app still empty
--      →  Q5's NOTIFY commands flush PostgREST's cache. Refresh the app.
-- =============================================================================
