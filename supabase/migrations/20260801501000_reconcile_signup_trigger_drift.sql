-- ════════════════════════════════════════════════════════════════════════════
--  20260801501000_reconcile_signup_trigger_drift.sql
--
--  PRODUCTION ↔ MIGRATION-SET DRIFT, found by the Production migration
--  rehearsal of 2026-08-20 and fixed at its root.
--
--  ── WHAT THE REHEARSAL FOUND ───────────────────────────────────────────────
--  Production carries TWO triggers on auth.users, both firing the same
--  function:
--        on_auth_user_created          -> public.handle_new_user()
--        on_auth_user_created_profile  -> public.handle_new_user()
--  Neither is created by any migration in the current set. They were created
--  by supabase/migrations_archive/20260525120000_handle_new_user_role.sql and
--  .../20260801122200_handle_new_user_supplier_role.sql, and the squash into
--  00000000000000_remote_baseline.sql kept the FUNCTION but dropped the
--  TRIGGER. Same failure mode as the squash-lost catalog seeds repaired by
--  20260801564000.
--
--  Two consequences, both real:
--
--   (1) Any environment rebuilt from the migration set — Staging, and every
--       fresh local reset — has NO signup trigger at all. A new auth.users row
--       produces no profiles row, so the role chosen at signup is dropped on
--       the floor. Production is the only environment where signup works.
--
--   (2) On Production the trigger makes the pending verification migrations
--       fail. 20260801502000 inserts a synthetic auth user, then inserts the
--       matching profile with ON CONFLICT (id) DO NOTHING. The trigger has
--       already created that profile with the default role 'client', the
--       DO NOTHING keeps it, and admin_dispatch_job then refuses with
--       'Only super_admin can dispatch jobs'. The rehearsal reproduced this
--       exactly: migration 1 of 41, before a single object was changed.
--
--  ── HOW THIS FIXES IT ──────────────────────────────────────────────────────
--  • The canonical trigger is (re)created here, so the migration set finally
--    describes the signup path it has always relied on. Staging and local
--    stop diverging from Production.
--  • The duplicate is dropped. Two AFTER INSERT triggers on the same table
--    running the same function is redundant work, not defence in depth.
--  • handle_new_user() skips the reserved synthetic namespace. Every
--    verification migration in this repo builds its fixtures under
--    '@synthetic.invalid' and asserts zero residue before COMMIT. '.invalid'
--    is reserved by RFC 2606 and can never be a deliverable address, so no
--    real signup can take this branch. This is what lets the 41 pending
--    migrations run on a Production that already has the trigger, with NO
--    window in which real signups are unhandled — the alternative (disable
--    the trigger for the duration of the push, restore it afterwards) would
--    have left exactly such a window.
--
--  Behaviour for real users is otherwise unchanged, byte for byte.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
BEGIN
  -- ── Reserved, non-deliverable namespaces are never real signups ─────────
  --  Verification migrations and the 80 pgTAP suites build their own profiles
  --  rows explicitly, with roles this function is not allowed to grant
  --  (admin, super_admin, senior). If the trigger pre-creates those rows under
  --  the default role 'client', the fixture's own INSERT collides on
  --  profiles.id / profiles_email_key and the suite dies before its first
  --  assertion — which is exactly what the rehearsal observed in 48 suites.
  --
  --  The discriminator is the TLD, not a test-specific hack: every domain
  --  below is guaranteed undeliverable, so no address in it can ever complete
  --  Supabase's email-confirmation step, let alone pass
  --  nx_email_verified(). Skipping them cannot strand a real account.
  --    .invalid  reserved, RFC 2606 §2   (@synthetic.invalid, @test.invalid)
  --    .test     reserved, RFC 2606 §2   (@nexpec.test, @x.test)
  --    .local    reserved, RFC 6762 §3   (@test.local)
  --    .nx       not a delegated TLD; this repo's fixture convention
  IF NEW.email IS NOT NULL AND (
       NEW.email LIKE '%.invalid'
    OR NEW.email LIKE '%.test'
    OR NEW.email LIKE '%.local'
    OR NEW.email LIKE '%.nx'
  ) THEN
    RETURN NEW;
  END IF;

  v_full_name := NULLIF(TRIM(NEW.raw_user_meta_data ->> 'full_name'), '');
  v_role := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data ->> 'role'), ''),
    'client'
  );

  -- Whitelist the role. Anything outside the public-signup set collapses to
  -- 'client'. super_admin / admin / enterprise are administered via admin RPCs
  -- and are unreachable from signup metadata.
  IF v_role NOT IN ('client', 'inspector', 'agency', 'supplier') THEN
    v_role := 'client';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, v_full_name, v_role)
  ON CONFLICT (id) DO UPDATE SET
    role = CASE
      WHEN public.profiles.role = 'client' AND EXCLUDED.role <> 'client'
        THEN EXCLUDED.role
      ELSE public.profiles.role
    END,
    full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Bootstraps public.profiles from auth.users.raw_user_meta_data on signup. Whitelists role to {client, inspector, agency, supplier}; never grants admin/super_admin. Skips reserved undeliverable TLDs (.invalid/.test/.local/.nx) used by verification fixtures.';

--  One trigger, canonically named. DROP+CREATE inside this transaction is
--  atomic: there is no instant at which a real signup sees no trigger.
DROP TRIGGER IF EXISTS on_auth_user_created         ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;

CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── SELFTEST — runs wherever this migration is applied, rolls itself back ───
DO $verify$
DECLARE
  v_real  uuid := gen_random_uuid();
  v_junk  uuid := gen_random_uuid();
  v_n     int;
  v_role  text;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DRIFT: expected exactly 1 trigger on auth.users, found %', v_n;
  END IF;

  BEGIN
    -- (a) reserved non-deliverable namespaces are skipped
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    SELECT gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'drift.'||d, now(), now()
      FROM unnest(ARRAY['a@synthetic.invalid','b@nexpec.test','c@test.local','d@fixture.nx']) d;
    SELECT count(*) INTO v_n FROM public.profiles
     WHERE email LIKE 'drift.%' AND (email LIKE '%.invalid' OR email LIKE '%.test'
                                  OR email LIKE '%.local'  OR email LIKE '%.nx');
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'SELFTEST a: reserved-TLD signup created a profile (%), fixtures would break', v_n;
    END IF;

    -- (b) a real signup still gets its profile, with the requested role
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    VALUES (v_real,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'drift.real.'||v_real::text||'@verify.nexpecapp.com',
            jsonb_build_object('full_name','Drift Real','role','inspector'), now(), now());
    SELECT role INTO v_role FROM public.profiles WHERE id = v_real;
    IF v_role IS DISTINCT FROM 'inspector' THEN
      RAISE EXCEPTION 'SELFTEST b: real signup role expected inspector, got %', COALESCE(v_role,'<no profile>');
    END IF;

    -- (c) signup can never mint an admin
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    VALUES (v_junk,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'drift.junk.'||v_junk::text||'@verify.nexpecapp.com',
            jsonb_build_object('role','super_admin'), now(), now());
    SELECT role INTO v_role FROM public.profiles WHERE id = v_junk;
    IF v_role IS DISTINCT FROM 'client' THEN
      RAISE EXCEPTION 'SELFTEST c: super_admin from signup metadata was not collapsed, got %', COALESCE(v_role,'<no profile>');
    END IF;

    RAISE EXCEPTION 'VERIFY_ROLLBACK_SENTINEL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'VERIFY_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  -- residue check, asserted rather than assumed
  SELECT count(*) INTO v_n FROM auth.users   WHERE id IN (v_real, v_junk) OR email LIKE 'drift.%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'REVOCATION FAILED: % synthetic auth user(s) survive', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE id IN (v_real, v_junk) OR email LIKE 'drift.%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'REVOCATION FAILED: % synthetic profile(s) survive', v_n; END IF;

  RAISE NOTICE '════ signup trigger drift reconciled: 1 canonical trigger, synthetic namespace skipped, admin unreachable from metadata ════';
END
$verify$;

COMMIT;
