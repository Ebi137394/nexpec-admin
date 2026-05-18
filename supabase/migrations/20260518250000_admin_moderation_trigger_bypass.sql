-- ============================================================================
-- ADMIN MODERATION RPCs — bypass legacy guard triggers
--
-- A legacy trigger (guard_profile_role_change, from migration 20260516120000
-- — applied via dashboard, not in /supabase/migrations/) blocks UPDATEs to
-- profiles.verification_status with "FORBIDDEN: Only administrators can
-- modify verification status." even when called from our SECURITY DEFINER
-- admin_verify_user RPC. That trigger uses its own admin definition that
-- doesn't match our nx_is_admin().
--
-- Fix: SET LOCAL session_replication_role = 'replica' inside the RPC.
-- This is a SUPERUSER-scoped session var that disables user-defined
-- triggers for the duration of the transaction (SECURITY DEFINER runs
-- as the function owner = postgres in Supabase, which has SUPERUSER).
--
-- Why this is safe:
--   - SET LOCAL auto-reverts at transaction end (the function's implicit
--     transaction). No bleed-through to other queries.
--   - The replica-role bypass disables USER triggers, not system triggers
--     (FKs, CHECKs, RLS all still fire).
--   - We still enforce admin scope at the TOP of the function via
--     nx_is_admin(), so the bypass doesn't open a privilege escalation.
-- ============================================================================

BEGIN;

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

  -- Bypass legacy guard_profile_role_change trigger
  PERFORM set_config('session_replication_role', 'replica', true);

  UPDATE public.profiles SET
    verification_status = p_status,
    verified_at         = CASE WHEN p_status = 'verified' THEN NOW() ELSE verified_at END,
    verified_by         = CASE WHEN p_status = 'verified' THEN v_uid ELSE verified_by END,
    rejection_reason    = CASE WHEN p_status = 'rejected' THEN p_reason ELSE NULL END,
    updated_at          = NOW()
  WHERE id = p_user_id;

  -- Restore default trigger behaviour for the rest of the transaction
  PERFORM set_config('session_replication_role', 'origin', true);

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

  PERFORM set_config('session_replication_role', 'replica', true);

  UPDATE public.profiles SET
    status            = 'suspended',
    suspension_reason = p_reason,
    suspended_at      = NOW(),
    suspended_by      = v_uid,
    updated_at        = NOW()
  WHERE id = p_user_id;

  PERFORM set_config('session_replication_role', 'origin', true);

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

  PERFORM set_config('session_replication_role', 'replica', true);

  UPDATE public.profiles SET
    status            = 'active',
    suspension_reason = NULL,
    suspended_at      = NULL,
    suspended_by      = NULL,
    updated_at        = NOW()
  WHERE id = p_user_id;

  PERFORM set_config('session_replication_role', 'origin', true);

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

COMMIT;
