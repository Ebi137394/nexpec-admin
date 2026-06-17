-- ============================================================================
-- ADMIN USER MODERATION — additive only
--
-- Adds suspension metadata + moderation RPCs:
--   admin_verify_user(user_id, status, reason?)
--   admin_suspend_user(user_id, reason)
--   admin_unsuspend_user(user_id)
--
-- Password reset is intentionally NOT a DB RPC — it lives in the server
-- action which calls supabase.auth.admin.generateLink() with the service
-- role key.
--
-- NO-REGRESSION MANDATE: all changes are additive. Existing `status` column
-- on profiles is preserved as-is; we only ADD columns.
-- ============================================================================

BEGIN;

-- ─── Additive columns ────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at      timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by      uuid;

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_suspended_by_fkey') THEN
      ALTER TABLE public.profiles DROP CONSTRAINT profiles_suspended_by_fkey;
    END IF;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_suspended_by_fkey
      FOREIGN KEY (suspended_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'profiles_suspended_by_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_suspension_reason_len') THEN
      ALTER TABLE public.profiles DROP CONSTRAINT profiles_suspension_reason_len;
    END IF;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_suspension_reason_len
      CHECK (suspension_reason IS NULL OR char_length(suspension_reason) <= 1000) NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'profiles_suspension_reason_len: %', SQLERRM; END;
END $$;

-- ─── RPC: admin_verify_user ──────────────────────────────────────────
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
  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  UPDATE public.profiles SET
    verification_status = p_status,
    verified_at         = CASE WHEN p_status = 'verified' THEN NOW() ELSE verified_at END,
    verified_by         = CASE WHEN p_status = 'verified' THEN v_uid ELSE verified_by END,
    rejection_reason    = CASE WHEN p_status = 'rejected' THEN p_reason ELSE NULL END,
    updated_at          = NOW()
  WHERE id = p_user_id;

  -- Notify the target user
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

-- ─── RPC: admin_suspend_user ─────────────────────────────────────────
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

  -- Defence: never suspend a super_admin via this RPC
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

  -- Notify the target
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

-- ─── RPC: admin_unsuspend_user ───────────────────────────────────────
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

COMMIT;
