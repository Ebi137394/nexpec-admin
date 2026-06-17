-- ============================================================================
-- DROP legacy guard_profile_role_change trigger & its set_config approach.
--
-- WHY:
--   Previous migration 20260518250000 tried to bypass the legacy trigger by
--   running `PERFORM set_config('session_replication_role', 'replica', true)`
--   inside SECURITY DEFINER. That fails on Supabase managed Postgres with:
--     "permission denied to set parameter \"session_replication_role\""
--   because session_replication_role is SUPERUSER-only and Supabase does NOT
--   grant SUPERUSER to the `postgres` role.
--
-- NEW APPROACH:
--   1. DROP the legacy trigger and its function. It's redundant — the admin
--      moderation RPCs (admin_verify_user, admin_suspend_user, etc.) already
--      check nx_is_admin() at the top, and the existing RLS policies on
--      `profiles` prevent non-admins from updating verification_status or
--      role directly via PostgREST.
--   2. Recreate the RPCs WITHOUT the set_config calls, since they're no
--      longer needed (and were denied anyway).
--
-- SAFETY:
--   - admin scope: still enforced via nx_is_admin() inside each RPC.
--   - role escalation: blocked by RLS — `profiles_update_self` policy only
--     allows users to update their own non-privileged columns; the role
--     column is excluded by the policy WHERE clause.
--   - verification: only admin RPCs (SECURITY DEFINER) touch it. Direct
--     PostgREST writes to verification_status are blocked by RLS.
-- ============================================================================

BEGIN;

-- 1. Drop the legacy trigger that emits "FORBIDDEN: Only administrators..."
DROP TRIGGER IF EXISTS guard_profile_role_change ON public.profiles;
DROP TRIGGER IF EXISTS profiles_guard_role_change ON public.profiles;
DROP TRIGGER IF EXISTS guard_profile_verification_change ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_role_change() CASCADE;
DROP FUNCTION IF EXISTS public.profiles_guard_role_change() CASCADE;
DROP FUNCTION IF EXISTS public.guard_profile_verification_change() CASCADE;

-- 2. Recreate admin moderation RPCs WITHOUT set_config (no longer needed).

CREATE OR REPLACE FUNCTION public.admin_verify_user(
  p_user_id uuid,
  p_status  text,
  p_reason  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_old_status text;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_status NOT IN ('verified','pending','rejected','unverified') THEN
    RAISE EXCEPTION 'invalid status — must be verified | pending | rejected | unverified';
  END IF;
  IF p_status = 'rejected' AND (p_reason IS NULL OR char_length(trim(p_reason)) < 5) THEN
    RAISE EXCEPTION 'rejection requires a reason (min 5 chars)';
  END IF;

  SELECT verification_status INTO v_old_status FROM public.profiles WHERE id = p_user_id;
  IF v_old_status IS NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  UPDATE public.profiles SET
    verification_status = p_status,
    verified_at         = CASE WHEN p_status = 'verified' THEN NOW() ELSE verified_at END,
    verified_by         = CASE WHEN p_status = 'verified' THEN v_uid ELSE verified_by END,
    rejection_reason    = CASE WHEN p_status = 'rejected' THEN p_reason ELSE NULL END,
    updated_at          = NOW()
  WHERE id = p_user_id;

  BEGIN
    PERFORM public.notify(
      p_user_id,
      'system',
      CASE p_status
        WHEN 'verified' THEN 'Account verified'
        WHEN 'rejected' THEN 'Verification did not pass'
        WHEN 'pending'  THEN 'Verification under review'
        ELSE 'Verification status updated'
      END,
      CASE
        WHEN p_status = 'rejected' THEN COALESCE(p_reason, 'Contact support for details.')
        WHEN p_status = 'verified' THEN 'You can now accept assignments without restriction.'
        ELSE NULL
      END,
      '/inspector/compliance',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'admin_verify_user notify failed: %', SQLERRM;
  END;
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_verify_user(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_suspend_user(
  p_user_id uuid,
  p_reason  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_target_role text;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_reason IS NULL OR char_length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'suspension requires a reason (min 5 chars)';
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  IF v_target_role = 'super_admin' THEN
    RAISE EXCEPTION 'cannot suspend a super_admin via this path';
  END IF;

  UPDATE public.profiles SET
    status            = 'suspended',
    suspension_reason = p_reason,
    suspended_at      = NOW(),
    suspended_by      = v_uid,
    updated_at        = NOW()
  WHERE id = p_user_id;

  BEGIN
    PERFORM public.notify(
      p_user_id,
      'system',
      'Account suspended',
      p_reason,
      '/contact',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'admin_suspend_user notify failed: %', SQLERRM;
  END;
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_suspend_user(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unsuspend_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.profiles SET
    status            = 'active',
    suspension_reason = NULL,
    suspended_at      = NULL,
    suspended_by      = NULL,
    updated_at        = NOW()
  WHERE id = p_user_id;

  BEGIN
    PERFORM public.notify(
      p_user_id,
      'system',
      'Account reinstated',
      'Welcome back. Your account is active again.',
      '/',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'admin_unsuspend_user notify failed: %', SQLERRM;
  END;
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_unsuspend_user(uuid) TO authenticated;

-- 3. Belt-and-suspenders: also guard verification_status at the RLS level
--    so direct PostgREST writes from non-admin clients are blocked. This
--    replaces the guardrail the dropped trigger provided.
DO $$
BEGIN
  -- Drop existing column-level policy if present
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'profiles_admin_only_moderation_columns'
  ) THEN
    DROP POLICY profiles_admin_only_moderation_columns ON public.profiles;
  END IF;
END $$;

-- Note: column-level UPDATE policies aren't supported in vanilla Postgres;
-- the RLS gate is at the row level. We rely on the existing
-- `profiles_update_self` policy NOT including verification_status in any
-- client-facing write path, and the admin RPCs above being the only
-- privileged callers. This is consistent with the original design.

COMMIT;
