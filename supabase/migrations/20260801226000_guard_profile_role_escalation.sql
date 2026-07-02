-- ============================================================================
--  20260801226000_guard_profile_role_escalation.sql
--
--  RED TEAM P0 — self-service role escalation.
--
--  THREAT: profiles_update_self is `USING (auth.uid()=id) WITH CHECK (auth.uid()=id)`
--  — it constrains the ROW, never the COLUMNS. The role-mutation guard the policy
--  comment relies on (`guard_profile_role_change`) is NOT present in the committed
--  migrations (it was reportedly dashboard-applied out-of-band). If absent on prod,
--  ANY authenticated user can `PATCH profiles?id=eq.<self>` with {"role":"admin"} and
--  gain god-mode (nx_is_admin() reads profiles.role).
--
--  This commits a VERSIONED guard so it can never silently disappear:
--    • non-admins may NOT set role to admin/super_admin (escalation),
--    • non-admins may set a role ONLY during onboarding (OLD.role IS NULL) and may
--      not switch an already-set role,
--    • id is immutable for non-admins,
--    • service-role / trusted contexts (auth.uid() IS NULL) and admins are exempt
--      (so the email-domain org-linking trigger, admin tooling, and SECURITY
--      DEFINER RPCs keep working). organization_id is intentionally NOT guarded
--      here so the auto-link trigger is unaffected.
--
--  SAFE TO RE-RUN: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; transactional.
--  NOTE: if a prod-only guard with a different name already exists, this is purely
--  additive (both can coexist); recommend consolidating later.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
BEGIN
  -- Trusted server contexts (service_role → auth.uid() IS NULL) and admins
  -- may change anything.
  IF auth.uid() IS NULL OR public.nx_is_admin() THEN
    RETURN NEW;
  END IF;

  -- Role changes by a non-admin:
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NEW.role IN ('admin', 'super_admin') THEN
      RAISE EXCEPTION 'role escalation denied' USING ERRCODE = '42501';
    END IF;
    -- Allow only the initial onboarding assignment (null -> role); never a switch.
    IF OLD.role IS NOT NULL THEN
      RAISE EXCEPTION 'role change denied (admin only)' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Identity is immutable for non-admins.
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id is immutable' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_profile_privileged_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS guard_profile_privileged_columns_trg ON public.profiles;
CREATE TRIGGER guard_profile_privileged_columns_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileged_columns();

COMMIT;
