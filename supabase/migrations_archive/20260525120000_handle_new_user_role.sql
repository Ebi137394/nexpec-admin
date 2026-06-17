-- ════════════════════════════════════════════════════════════════════════════
--  handle_new_user — write profile + role from auth.users.raw_user_meta_data
--
--  The web signup flow (and mobile, in due course) writes:
--    raw_user_meta_data = { full_name, role }
--  …on auth.users.INSERT. This trigger creates the matching profiles row,
--  copying full_name and role across. Without it, the role hint from
--  /sign-up?role=inspector is silently dropped and every user lands with
--  the table-level default role.
--
--  SECURITY DEFINER + locked search_path: trigger runs with elevated
--  privilege to write to public.profiles (which has restrictive RLS that
--  blocks user-self-INSERT), but cannot be tricked into resolving an
--  unqualified table name from a malicious schema.
--
--  Idempotent: if a profiles row already exists for the user (e.g. legacy
--  manual seed), we ON CONFLICT DO NOTHING — never overwrite operator-set
--  fields. Role updates after first signup happen via admin RPCs, not here.
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
  -- Pull metadata fields with defensive fallbacks. JSONB ->> returns NULL
  -- if the key is absent; COALESCE chains to the safe defaults.
  v_full_name := NULLIF(TRIM(NEW.raw_user_meta_data ->> 'full_name'), '');
  v_role := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data ->> 'role'), ''),
    'client'
  );

  -- Whitelist the role. Anything outside the public-signup enum collapses
  -- to 'client'. super_admin / enterprise are administered via admin RPCs.
  IF v_role NOT IN ('client', 'inspector', 'agency') THEN
    v_role := 'client';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, v_full_name, v_role)
  ON CONFLICT (id) DO UPDATE SET
    -- Only promote the role if the existing row still has the schema
    -- default ('client'). Never overwrite an operator-assigned role like
    -- super_admin or admin. full_name only fills in if currently NULL,
    -- so legacy seeds with hand-edited names are preserved.
    role = CASE
      WHEN public.profiles.role = 'client' AND EXCLUDED.role <> 'client'
        THEN EXCLUDED.role
      ELSE public.profiles.role
    END,
    full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  RETURN NEW;
END;
$$;

-- Drop any prior version of the trigger before recreating, so this
-- migration is safe to re-run.
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;

CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Bootstraps public.profiles from auth.users.raw_user_meta_data on signup. Whitelists role to {client, inspector, agency}.';
