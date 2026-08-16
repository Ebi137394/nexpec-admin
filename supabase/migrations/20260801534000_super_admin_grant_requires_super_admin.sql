-- ════════════════════════════════════════════════════════════════════════════
--  20260801534000_super_admin_grant_requires_super_admin.sql
--
--  P1 — any `admin` could promote itself to `super_admin`, so the platform
--  could not enforce its own headline access invariant: exactly one persistent
--  privileged human, the owner.
--
--  ── THE DEFECT (reproduced on Staging with a real admin JWT) ───────────────
--      PATCH /profiles?id=eq.<self>  { "role": "super_admin" }   ->  204
--  and a service-role read-back confirmed role = 'super_admin'. The account was
--  restored to 'admin' immediately; Staging currently holds exactly one
--  super_admin, the owner.
--
--  Two guards run on public.profiles and neither covers promotion:
--
--  1. guard_profile_privileged_columns() opens with
--         IF auth.uid() IS NULL OR public.nx_is_admin() THEN RETURN NEW;
--     so every admin is exempted from the WHOLE function — including its own
--     `role escalation denied` branch, which therefore only ever fires for
--     non-admins.
--
--  2. nx_protect_privileged_profiles() guards the Platform Owner and refuses to
--     demote, suspend or delete the LAST active super_admin. It says nothing
--     about creating an additional one.
--
--  ── WHY IT MATTERS EVEN THOUGH THE CAPABILITY DELTA IS SMALL ──────────────
--  Measured, not assumed: `is_super_admin()` in this schema is a misnomer —
--
--      SELECT EXISTS (SELECT 1 FROM public.profiles
--                      WHERE id = auth.uid()
--                        AND role IN ('admin','super_admin','support'));
--
--  — so the RESTRICTIVE `hide_soft_deleted` policies and
--  payout_requests.super_admin_full_access already admit `admin`. Promotion
--  buys very little extra reach TODAY.
--
--  It is still a real defect, for two reasons. First, the owner's access policy
--  is that exactly one privileged human persists; a self-promoting admin makes
--  that unenforceable and leaves an identity indistinguishable from the owner
--  in every role-based check. Second, the moment any future policy is written
--  against a STRICT super_admin test, this becomes a straightforward escalation
--  path. The invariant should hold because it is enforced, not because nothing
--  currently depends on it.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Grant and revocation of `super_admin` is lifted ABOVE the admin exemption
--  and gated on a genuine super_admin. `is_super_admin()` cannot be used for
--  this — it would authorise exactly the actor being blocked — so a strict
--  helper is added with a name that does not lie.
--
--  `is_super_admin()` is deliberately NOT renamed or narrowed here: five
--  RESTRICTIVE policies depend on its current, wider meaning, and changing it
--  would silently alter soft-deleted visibility for admin and support. That is
--  a separate decision, not a drive-by.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • The platform/service context (auth.uid() IS NULL) stays exempt, so the
--     owner-provisioning script and every SECURITY DEFINER RPC keep working.
--   • An admin keeps every other admin power, including assigning the
--     non-privileged roles and the `admin` role itself.
--   • nx_protect_privileged_profiles is untouched: the owner stays protected
--     and the last super_admin still cannot be demoted.
--   • No policy, grant, table or view.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- A strict test, because is_super_admin() admits admin and support.
CREATE OR REPLACE FUNCTION public.nx_is_strict_super_admin()
RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'super_admin'
  );
$fn$;

REVOKE ALL ON FUNCTION public.nx_is_strict_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_strict_super_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Trusted server contexts only: service_role and migrations, where
  -- auth.uid() is NULL. This is the owner-provisioning path.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── super_admin is the top of the hierarchy ──────────────────────────────
  -- Checked BEFORE the admin exemption below, which is the whole point: an
  -- admin used to fall straight through this function and could set its own
  -- role to super_admin. Covers revocation as well as grant, so an admin
  -- cannot quietly demote a super_admin either.
  IF NEW.role IS DISTINCT FROM OLD.role
     AND 'super_admin' IN (COALESCE(NEW.role,''), COALESCE(OLD.role,''))
     AND NOT public.nx_is_strict_super_admin()
  THEN
    RAISE EXCEPTION
      'SUPER_ADMIN_GRANT_DENIED: only an existing super_admin may grant or revoke super_admin. NEXPEC keeps exactly one persistent privileged human — the owner.'
      USING ERRCODE = '42501';
  END IF;

  -- Admins may change everything else.
  IF public.nx_is_admin() THEN
    RETURN NEW;
  END IF;

  -- ── everything below is unchanged from the previous definition ───────────
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role IN ('admin', 'super_admin') THEN
      RAISE EXCEPTION 'role escalation denied' USING ERRCODE = '42501';
    END IF;
    -- Allow only the initial onboarding assignment (null -> role); never a switch.
    IF OLD.role IS NOT NULL THEN
      RAISE EXCEPTION 'role change denied (admin only)' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id is immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.is_verified           IS DISTINCT FROM OLD.is_verified
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
     OR NEW.verified_at         IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by         IS DISTINCT FROM OLD.verified_by
     OR NEW.balance_cents       IS DISTINCT FROM OLD.balance_cents
     OR NEW.stripe_connect_id   IS DISTINCT FROM OLD.stripe_connect_id
     OR NEW.rating_average      IS DISTINCT FROM OLD.rating_average
     OR NEW.rating_count        IS DISTINCT FROM OLD.rating_count
     OR NEW.completed_jobs_count IS DISTINCT FROM OLD.completed_jobs_count
  THEN
    RAISE EXCEPTION 'privileged profile column change denied (admin only)' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'guard_profile_privileged_columns_trg'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'GUARD_TRIGGER_MISSING: guard_profile_privileged_columns_trg is not attached to public.profiles';
  END IF;
  RAISE NOTICE 'ok: super_admin grant now requires an existing super_admin.';
END $$;

COMMIT;
