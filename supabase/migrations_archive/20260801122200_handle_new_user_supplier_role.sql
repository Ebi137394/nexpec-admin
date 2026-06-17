-- ════════════════════════════════════════════════════════════════════════════
--  20260801122200_handle_new_user_supplier_role.sql
--
--  Add 'supplier' to the public-signup role whitelist in handle_new_user.
--  Marketplace vendors register through the normal sign-up flow and must land
--  with role='supplier' (so submit_quote's `is a supplier` guard passes and the
--  Profile→Marketplace surfaces appear). Previously the trigger collapsed any
--  role outside {client, inspector, agency} to 'client', silently downgrading
--  every supplier signup. super_admin / admin / enterprise remain admin-RPC
--  only — NOT public-signup roles. Idempotent CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
BEGIN
  v_full_name := NULLIF(TRIM(NEW.raw_user_meta_data ->> 'full_name'), '');
  v_role := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data ->> 'role'), ''),
    'client'
  );

  -- Whitelist the role. Anything outside the public-signup set collapses to
  -- 'client'. super_admin / admin / enterprise are administered via admin RPCs.
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
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;

CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Bootstraps public.profiles from auth.users.raw_user_meta_data on signup. Whitelists role to {client, inspector, agency, supplier}.';
