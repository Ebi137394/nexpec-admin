-- ============================================================================
--  20260516220000_profiles_select_lockdown.sql
--
--  STRIKE: NX-AUTH-002 Step 3 — final lockdown.
--
--  WHY (root cause):
--    The live policy dump showed seven legacy policies on public.profiles
--    that overlap, duplicate each other, or leak. The worst of them is
--    "Public profiles access" (SELECT, USING true, TO public) — it
--    grants SELECT on every profile row to every caller including
--    UNAUTHENTICATED anon. Other policies in the dump:
--      - duplicate self-read policies under three different names
--        (Users can read own profile, Users can view own profile,
--        profiles_select_own) — same predicate, no functional reason
--        for the duplication;
--      - duplicate insert policies (Users can insert own profile,
--        profiles_insert_own);
--      - the "Manage own profile" ALL policy that masks the per-verb
--        analysis we need for audit clarity;
--      - "Users can update own profile" with USING but WITH CHECK NULL
--        (so the policy allowed UPDATE-row-then-rewrite-id-to-another-
--        user). The role-mutation trigger from 20260516120000 catches
--        privilege fields, but the missing WITH CHECK on id was its own
--        defense-in-depth gap;
--      - two admin-bearing policies using is_admin() (whose body is
--        unverified) instead of the canonical nx_is_admin().
--
--    Step 2 of this strike re-pointed every cross-user UI read at
--    SECURITY DEFINER RPCs (get_public_profile, get_public_profiles,
--    get_client_branding, get_marketplace_inspectors,
--    get_organization_members). Those RPCs bypass RLS by design; this
--    migration's job is to make sure the BASE TABLE is no longer reachable
--    cross-user.
--
--  WHAT THIS DOES:
--    A. Idempotent RLS enable.
--    B. DROP every legacy policy by name with IF EXISTS (covers every
--       name observed in the live policy dump and in committed .sql
--       files), EXCEPT profiles_service_role (TO service_role, intentional).
--    C. Dynamic sweep — DO block that drops any remaining policy other
--       than profiles_service_role, covering any name created out-of-band
--       via Supabase SQL Editor.
--    D. Install the canonical six-policy set, one named policy per verb
--       per principal:
--         profiles_service_role  (KEPT from before, not touched here)
--         profiles_read_self     SELECT TO authenticated  USING auth.uid() = id
--         profiles_read_admin    SELECT TO authenticated  USING nx_is_admin()
--         profiles_insert_self   INSERT TO authenticated  WITH CHECK auth.uid() = id
--         profiles_update_self   UPDATE TO authenticated  USING + WITH CHECK auth.uid() = id
--         profiles_update_admin  UPDATE TO authenticated  USING + WITH CHECK nx_is_admin()
--         profiles_delete_admin  DELETE TO authenticated  USING nx_is_admin()
--
--    Notes on the new shape:
--      - Every policy explicitly carries TO authenticated. Anon callers
--        no longer satisfy any policy and therefore see / write nothing
--        on the base table. Public verify pages (anon) continue to work
--        because they go through SECURITY DEFINER RPCs that bypass RLS.
--      - Every UPDATE policy has a WITH CHECK clause. The legacy
--        "Users can update own profile" had USING but null WITH CHECK,
--        which allowed UPDATE-then-id-rewrite to another user's uuid.
--      - Admin paths use public.nx_is_admin() (admin OR super_admin),
--        matching the rest of the platform. Legacy is_admin() references
--        are dropped.
--      - The 20260516120000 role-mutation trigger remains the
--        authoritative gate against privilege escalation. This migration
--        narrows the attack surface; the trigger remains the final
--        backstop.
--
--  PRESERVED:
--    - profiles_service_role (ALL TO service_role USING true WITH CHECK true)
--      stays untouched. The Supabase service-role JWT (Edge Functions
--      using SUPABASE_SERVICE_ROLE_KEY, the dashboard's SQL Editor as
--      postgres, the handle_new_user trigger) is the only caller that
--      satisfies its TO clause.
--    - The role-mutation trigger from 20260516120000 fires alongside
--      this policy set.
--    - The vocabulary-lock CHECK from 20260516130000.
--    - The hardened handle_new_user from 20260516140000.
--
--  UP   path: this file.
--  DOWN path: enumerated at the foot of this file. Rollback re-introduces
--             NX-AUTH-002 and should only be run with an incident reason
--             and a documented re-deploy plan.
--
--  Idempotent: every DROP is IF EXISTS; the dynamic sweep handles any
--  policy I didn't enumerate.
-- ============================================================================

BEGIN;

-- A. Idempotent RLS enable.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- B. DROP every observed legacy policy by name. IF EXISTS makes each a
--    no-op if absent. profiles_service_role is intentionally NOT in this
--    list because we keep it.
DROP POLICY IF EXISTS "Manage own profile"                    ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile"          ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own"                   ON public.profiles;
DROP POLICY IF EXISTS "Public profiles access"                ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile"            ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile"            ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles"           ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin"                 ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own"                   ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"          ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin"                 ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"                   ON public.profiles;
DROP POLICY IF EXISTS "Admin can read all profiles"           ON public.profiles;
DROP POLICY IF EXISTS "Admin can update verification status"  ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users"      ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Enable update for users based on id"   ON public.profiles;
-- Pre-emptive drops for the new names (so this migration is fully
-- idempotent if re-run after a previous partial apply):
DROP POLICY IF EXISTS "profiles_read_self"                    ON public.profiles;
DROP POLICY IF EXISTS "profiles_read_admin"                   ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self"                  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self"                  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin"                 ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin"                 ON public.profiles;

-- C. Dynamic sweep — drop any other policy that survives, EXCEPT
--    profiles_service_role (the intentional service-role bypass).
--    Auditable: each drop logs via NOTICE.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'profiles'
       AND policyname <> 'profiles_service_role'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', pol.policyname);
    RAISE NOTICE 'Dropped surviving legacy policy %.%',
                 'public.profiles', pol.policyname;
  END LOOP;
END $$;

-- D. Install the canonical policy set. Six new named policies + the
--    untouched profiles_service_role = seven total.

-- ─── SELECT: self only or admin only. No anon access. ────────────────
CREATE POLICY profiles_read_self
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

COMMENT ON POLICY profiles_read_self ON public.profiles IS
  'Authoritative self-read. Cross-user reads must go through the '
  'SECURITY DEFINER RPCs (get_public_profile, get_client_branding, '
  'get_marketplace_inspectors, get_organization_members).';

CREATE POLICY profiles_read_admin
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.nx_is_admin());

COMMENT ON POLICY profiles_read_admin ON public.profiles IS
  'Admins (role IN admin, super_admin via nx_is_admin) read every row. '
  'Used by the admin user-list, support inbox, verification queue, etc.';

-- ─── INSERT: only self. handle_new_user runs as service_role and ──────
--    is admitted by profiles_service_role; it does not need this policy.
CREATE POLICY profiles_insert_self
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

COMMENT ON POLICY profiles_insert_self ON public.profiles IS
  'Authenticated user can only create a profile row for themselves. '
  'Defense-in-depth alongside handle_new_user (which runs as service '
  'role and creates the row at signup time).';

-- ─── UPDATE: self with explicit WITH CHECK, admin with both. ──────────
--    The role-mutation trigger (20260516120000) is the authoritative
--    block on role/organization_id/id mutation; this policy enforces
--    row ownership so a non-admin cannot UPDATE someone else's row at
--    all.
CREATE POLICY profiles_update_self
  ON public.profiles FOR UPDATE
  TO authenticated
  USING      (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

COMMENT ON POLICY profiles_update_self ON public.profiles IS
  'Authenticated user updates their own row only. WITH CHECK matches '
  'USING so the user cannot rewrite their id to another user''s uuid. '
  'The role-mutation trigger (guard_profile_role_change) is the '
  'authoritative block on role/org_id/id mutation.';

CREATE POLICY profiles_update_admin
  ON public.profiles FOR UPDATE
  TO authenticated
  USING      (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

COMMENT ON POLICY profiles_update_admin ON public.profiles IS
  'Admins update any row. WITH CHECK matches USING so an admin cannot '
  'accidentally hand-off a row mid-UPDATE to a non-admin id.';

-- ─── DELETE: admin only. Self-delete is not part of the product flow. ─
CREATE POLICY profiles_delete_admin
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.nx_is_admin());

COMMENT ON POLICY profiles_delete_admin ON public.profiles IS
  'Profile deletion is an admin tooling operation. End-user account '
  'closure flows through a separate soft-deletion / anonymisation path '
  'not covered by this policy.';

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
--  -- 1. Exactly the expected seven policies survive.
--  SELECT policyname, cmd, roles, qual, with_check
--    FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'profiles'
--   ORDER BY cmd, policyname;
--
--  -- Expected output (eight rows because the ALL policy lists once):
--  --   profiles_service_role  | ALL    | {service_role}  | true            | true
--  --   profiles_delete_admin  | DELETE | {authenticated} | nx_is_admin()   | -
--  --   profiles_insert_self   | INSERT | {authenticated} | -               | auth.uid() = id
--  --   profiles_read_admin    | SELECT | {authenticated} | nx_is_admin()   | -
--  --   profiles_read_self     | SELECT | {authenticated} | auth.uid() = id | -
--  --   profiles_update_admin  | UPDATE | {authenticated} | nx_is_admin()   | nx_is_admin()
--  --   profiles_update_self   | UPDATE | {authenticated} | auth.uid() = id | auth.uid() = id
--
--  -- 2. Anon callers must read zero rows from the base table.
--  SET ROLE anon;
--  SELECT count(*) FROM public.profiles;
--   -- expect: 0  (was: every row prior to this migration).
--  SELECT count(*) FROM public.get_public_profile('<any-uuid>'::uuid);
--   -- expect: ERROR 42501  (anon cannot EXECUTE the RPC either; only
--   --                       authenticated callers can).
--  RESET ROLE;
--
--  -- 3. Authenticated non-admin user reads only own row.
--  --    (Run under a real auth.uid().)
--  SELECT id FROM public.profiles;
--   -- expect: exactly one row, equal to auth.uid().
--
--  -- 4. Cross-user reads through the public RPCs still work.
--  SELECT * FROM public.get_public_profile('<other-user-uuid>');
--   -- expect: one row with display_name/avatar/role/rating triplet.
--
--  -- 5. Privilege escalation is still blocked (the trigger still fires).
--  UPDATE public.profiles SET role = 'super_admin' WHERE id = auth.uid();
--   -- expect: ERROR 42501  Cannot escalate profile role to: super_admin
--
--  -- 6. Cross-user UPDATE is blocked.
--  UPDATE public.profiles SET full_name = 'pwned'
--    WHERE id = '<some-other-uuid>';
--   -- expect: 0 rows updated (RLS hides the target row from USING).
--
--  -- 7. Admin paths still function (run as a user whose role is
--  --    admin or super_admin):
--  SELECT count(*) FROM public.profiles;
--   -- expect: every row in the table.
--
--  -- 8. handle_new_user signup path still works (service-role context):
--  --    Create a fresh user via supabase.auth.signUp. The profile row
--  --    appears with the hardened role assignment. (Covered by
--  --    20260516140000 verification block.)
-- ============================================================================

-- ============================================================================
-- DOWN PATH (rollback — re-introduces NX-AUTH-002; document an incident
--                       reason before running)
-- ============================================================================
--  BEGIN;
--
--  DROP POLICY IF EXISTS profiles_read_self    ON public.profiles;
--  DROP POLICY IF EXISTS profiles_read_admin   ON public.profiles;
--  DROP POLICY IF EXISTS profiles_insert_self  ON public.profiles;
--  DROP POLICY IF EXISTS profiles_update_self  ON public.profiles;
--  DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
--  DROP POLICY IF EXISTS profiles_delete_admin ON public.profiles;
--
--  -- Restore the most-permissive pre-strike pair so the UI is not
--  -- entirely broken during rollback:
--  CREATE POLICY "Public profiles access"
--    ON public.profiles FOR SELECT
--    TO public
--    USING (true);
--  CREATE POLICY "Manage own profile"
--    ON public.profiles FOR ALL
--    TO public
--    USING (auth.uid() = id)
--    WITH CHECK (auth.uid() = id);
--
--  COMMIT;
--
--  After rollback, run the Step 2 UI patches in reverse — point each
--  RPC call back at .from('profiles').select(...). Do not leave the
--  app in a state where the UI requires RPCs while the base table is
--  also unrestricted; that's auditing surface area without security.
-- ============================================================================
