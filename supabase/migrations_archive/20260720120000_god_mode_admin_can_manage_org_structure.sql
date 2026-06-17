-- ════════════════════════════════════════════════════════════════════════════
--  20260720120000_god_mode_admin_can_manage_org_structure.sql
--
--  SINGLE GOD-MODE ADMIN RULE
--  --------------------------
--  The platform `admin` role is the absolute owner of NEXPEC and must have 100%
--  access to everything — identical to `super_admin`. There is no meaningful
--  distinction between the two in business logic; `admin` ⊇ `super_admin`.
--
--  The original can_manage_org_structure() granted only `super_admin`, which
--  silently locked the God-mode `admin` account out of org-structure /
--  department-budget / approval-policy writes at the DATABASE level (RLS), even
--  though nx_is_admin() already treats role IN ('admin','super_admin') as admin.
--  This unifies the platform branch to match nx_is_admin(), leaving the
--  org-scoped owner / procurement_admin branch completely untouched.
--
--  PURELY ADDITIVE: grants the platform owner the access they already intended;
--  removes no existing grantee. CREATE OR REPLACE preserves the function's ACL.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_manage_org_structure(
  p_org_id  uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- God-mode platform admin: full access to every org's structure.
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND role IN ('admin', 'super_admin')
    )
    -- Org-scoped elevation: unchanged.
    OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id  = p_org_id
        AND user_id = p_user_id
        AND role IN ('owner', 'procurement_admin')
    );
$$;
