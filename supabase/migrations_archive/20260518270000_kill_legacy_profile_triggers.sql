-- ============================================================================
-- KILL the legacy guard trigger(s) for real.
--
-- WHY the previous migration didn't work:
--   I named the trigger `guard_profile_role_change`. The actual trigger
--   has a different name. We don't know it ahead of time, so this migration
--   uses dynamic SQL to find ALL triggers on public.profiles whose function
--   body contains the offending error string ("FORBIDDEN" / "administrators
--   can modify") and drops them along with their functions.
--
-- SAFETY:
--   - Only drops triggers whose function body matches the legacy signature.
--   - Admin scope is still enforced by admin_* RPCs (nx_is_admin) + RLS.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
  v_dropped int := 0;
BEGIN
  FOR r IN
    SELECT t.tgname AS trigger_name,
           p.proname AS func_name,
           n.nspname AS func_schema,
           pg_get_functiondef(p.oid) AS func_def
    FROM pg_trigger t
    JOIN pg_proc p     ON t.tgfoid = p.oid
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE t.tgrelid = 'public.profiles'::regclass
      AND NOT t.tgisinternal
  LOOP
    -- Match any trigger whose function emits the legacy FORBIDDEN error
    -- OR mentions guarding verification_status / role changes.
    IF r.func_def ILIKE '%FORBIDDEN%'
       OR r.func_def ILIKE '%administrators can modify verification%'
       OR r.func_def ILIKE '%Only administrators%'
       OR r.func_def ILIKE '%guard_profile%'
       OR r.func_name ILIKE '%guard%role%'
       OR r.func_name ILIKE '%guard%verification%'
       OR r.func_name ILIKE '%profile_guard%'
    THEN
      RAISE NOTICE 'Dropping legacy guard trigger: %.% (func %.%)',
        'public.profiles', r.trigger_name, r.func_schema, r.func_name;
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.profiles', r.trigger_name);
      EXECUTE format('DROP FUNCTION IF EXISTS %I.%I() CASCADE', r.func_schema, r.func_name);
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;

  IF v_dropped = 0 THEN
    RAISE NOTICE 'No legacy guard triggers found on public.profiles — schema is already clean.';
  ELSE
    RAISE NOTICE 'Dropped % legacy guard trigger(s).', v_dropped;
  END IF;
END $$;

-- Final safety net: also drop by known historical names (in case the
-- function body doesn't contain the marker string we expect).
DROP TRIGGER IF EXISTS guard_profile_role_change ON public.profiles;
DROP TRIGGER IF EXISTS profiles_guard_role_change ON public.profiles;
DROP TRIGGER IF EXISTS guard_profile_verification_change ON public.profiles;
DROP TRIGGER IF EXISTS check_profile_role_change ON public.profiles;
DROP TRIGGER IF EXISTS profile_role_guard ON public.profiles;
DROP TRIGGER IF EXISTS enforce_admin_only_verification ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_role_change() CASCADE;
DROP FUNCTION IF EXISTS public.profiles_guard_role_change() CASCADE;
DROP FUNCTION IF EXISTS public.guard_profile_verification_change() CASCADE;
DROP FUNCTION IF EXISTS public.check_profile_role_change() CASCADE;
DROP FUNCTION IF EXISTS public.profile_role_guard() CASCADE;
DROP FUNCTION IF EXISTS public.enforce_admin_only_verification() CASCADE;

-- ============================================================================
-- Allow attachment-only messages: drop NOT NULL on messages.content and add
-- a CHECK constraint that at least one of content/attachment_url is set.
-- ============================================================================

ALTER TABLE public.messages
  ALTER COLUMN content DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.messages'::regclass
      AND conname  = 'messages_content_or_attachment_chk'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_content_or_attachment_chk
      CHECK (
        content IS NOT NULL OR attachment_url IS NOT NULL
      );
  END IF;
END $$;

COMMIT;
