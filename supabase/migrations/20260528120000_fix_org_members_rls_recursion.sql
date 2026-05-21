-- ════════════════════════════════════════════════════════════════════════════
--  20260528120000_fix_org_members_rls_recursion.sql
--  Hotfix — eliminate the 42P17 recursion in org_members + cascade.
--
--  ROOT CAUSE
--  ──────────
--  The original `org_members_select_members` policy (from
--  20260521120100_organizations_schema_align.sql) queries `org_members`
--  from inside its own USING clause:
--
--      USING (
--        user_id = auth.uid()
--        OR EXISTS (
--          SELECT 1 FROM public.org_members m2
--          WHERE m2.org_id = org_members.org_id ...
--        )
--      );
--
--  Postgres re-applies RLS recursively on every subquery against the same
--  table → `42P17: infinite recursion detected in policy`. The bug was
--  latent because /admin/orgs catches the error in fetchOrganizations()
--  and silently returns an empty list, so the surface looked merely
--  "empty" rather than broken.
--
--  Same trap exists transitively in:
--    · organizations_select_members  (subqueries org_members)
--    · departments_select_members    (subqueries org_members)
--    · department_members_select_members (subqueries org_members)
--
--  FIX
--  ───
--  Extract the "is this user in this org?" check into a SECURITY DEFINER
--  function. It runs without row-level security, so it cannot recurse
--  back into the policy that called it. Every member-visibility policy
--  points at the function instead of inline subqueries.
--
--  Authorization semantics are PRESERVED exactly — same allow set,
--  cleaner implementation.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  is_member_of_org — RLS-bypassing membership check
--
--  STABLE + SECURITY DEFINER lets the planner inline it AND skip RLS
--  on the org_members read inside. `SET search_path = public` is the
--  Supabase convention to keep schema-resolution explicit.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_member_of_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.org_members
     WHERE org_id  = p_org_id
       AND user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_member_of_org(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_member_of_org(uuid) IS
  'RLS-bypassing membership check. Use inside policies to avoid recursion when checking org membership from tables whose own RLS would re-enter org_members.';

-- ─────────────────────────────────────────────────────────────────────
--  org_members — read policy without self-recursion
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS org_members_select_members ON public.org_members;

CREATE POLICY org_members_select_members
  ON public.org_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_member_of_org(org_members.org_id)
  );

-- ─────────────────────────────────────────────────────────────────────
--  organizations — member visibility now goes through the helper
--  so the org row visibility check no longer touches org_members RLS.
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS organizations_select_members ON public.organizations;

CREATE POLICY organizations_select_members
  ON public.organizations FOR SELECT
  USING (public.is_member_of_org(organizations.id));

-- ─────────────────────────────────────────────────────────────────────
--  departments — same treatment. Members of an org can read its tree.
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS departments_select_members ON public.departments;

CREATE POLICY departments_select_members
  ON public.departments FOR SELECT
  USING (public.is_member_of_org(departments.org_id));

-- ─────────────────────────────────────────────────────────────────────
--  department_members — read your own assignments or any assignment
--  inside an org you belong to. The dept→org hop is unavoidable, but
--  the org membership check is now the helper, not raw org_members RLS.
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS department_members_select_members ON public.department_members;

CREATE POLICY department_members_select_members
  ON public.department_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
        FROM public.departments d
       WHERE d.id = department_members.department_id
         AND public.is_member_of_org(d.org_id)
    )
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
--  VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1. List the rebuilt policies — should all reference is_member_of_org.
-- SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
--   FROM pg_policy
--  WHERE polname IN (
--    'org_members_select_members',
--    'organizations_select_members',
--    'departments_select_members',
--    'department_members_select_members'
--  );
--
-- 2. Impersonate yourself and confirm the recursion is gone.
-- BEGIN;
--   SELECT set_config('request.jwt.claim.sub',
--                     'efa609bf-57c2-4b65-a284-62178599b305', true);
--   SET LOCAL ROLE authenticated;
--   SELECT count(*) AS visible_orgs FROM public.organizations;
-- ROLLBACK;
