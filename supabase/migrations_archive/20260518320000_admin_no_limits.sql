-- ============================================================================
-- Admin = god mode.
--
-- Strip every artificial business-rule check from admin RPCs. Admins still
-- need to BE admins (nx_is_admin gate stays), but the substance of what they
-- can do is unbounded:
--   • set any inspector payout, including $0 (pro bono) or > $1M
--   • approve / reject / request edits with or without notes
--   • verify users to any status, with or without a rejection reason
--   • suspend any user, including super_admins, with or without a reason
--   • unsuspend likewise
--
-- The only safety still enforced: nx_is_admin() at the top. Everything below
-- is the admin's discretion. RLS still applies to *non-admin* writes.
-- ============================================================================

BEGIN;

-- 1) admin_set_job_pricing — no caps, no min, no non-negative check ----------
CREATE OR REPLACE FUNCTION public.admin_set_job_pricing(
  p_job_id                 uuid,
  p_inspector_payout_cents bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_job RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.jobs SET
    inspector_payout_cents = p_inspector_payout_cents,
    payout_amount_cents    = p_inspector_payout_cents,
    updated_at             = NOW()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'inspector_payout_cents', v_job.inspector_payout_cents
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_set_job_pricing(uuid, bigint) TO authenticated;

-- 2) admin_review_job — no notes-required, no decision-rule constraints -----
CREATE OR REPLACE FUNCTION public.admin_review_job(
  p_job_id   uuid,
  p_decision text,
  p_notes    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_job             RECORD;
  v_correlation_id  uuid := gen_random_uuid();
  v_new_job_status  text;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  -- Decision still has to be one of the three values understood by the
  -- jobs.moderation_status enum; otherwise the UPDATE itself would reject.
  -- We keep this lone validation because it's a schema-level constraint,
  -- not a business rule.
  IF p_decision NOT IN ('approved','edits_requested','rejected') THEN
    RAISE EXCEPTION 'invalid decision (must be approved | edits_requested | rejected)';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  v_new_job_status := CASE
    WHEN p_decision = 'rejected' THEN 'cancelled'
    ELSE v_job.status
  END;

  UPDATE public.jobs SET
    moderation_status      = p_decision,
    moderation_notes       = p_notes,
    moderation_reviewed_at = NOW(),
    moderation_reviewed_by = auth.uid(),
    status                 = v_new_job_status,
    cancelled_at           = CASE WHEN p_decision='rejected' THEN NOW() ELSE v_job.cancelled_at END,
    cancelled_by           = CASE WHEN p_decision='rejected' THEN auth.uid() ELSE v_job.cancelled_by END,
    cancel_reason          = CASE WHEN p_decision='rejected' THEN p_notes ELSE v_job.cancel_reason END,
    updated_at             = NOW()
  WHERE id = p_job_id;

  BEGIN
    PERFORM public.notify_safe(
      COALESCE(v_job.client_id, v_job.agency_id),
      'job_moderated',
      CASE p_decision
        WHEN 'approved'        THEN 'Job approved'
        WHEN 'edits_requested' THEN 'Edits requested on your job'
        WHEN 'rejected'        THEN 'Job rejected'
        ELSE 'Job moderation update'
      END,
      COALESCE(p_notes, v_job.title),
      '/client/jobs/' || v_job.id::text,
      v_job.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok',                true,
    'job_id',            v_job.id,
    'moderation_status', p_decision,
    'job_status',        v_new_job_status,
    'correlation_id',    v_correlation_id::text
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_review_job(uuid, text, text) TO authenticated;

-- 3) admin_verify_user — no rejection-reason requirement --------------------
CREATE OR REPLACE FUNCTION public.admin_verify_user(
  p_user_id uuid,
  p_status  text,
  p_reason  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_status NOT IN ('verified','pending','rejected','unverified') THEN
    RAISE EXCEPTION 'invalid status (verified | pending | rejected | unverified)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
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
    PERFORM public.notify_safe(
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
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_verify_user(uuid, text, text) TO authenticated;

-- 4) admin_suspend_user — no min-reason length, can suspend anyone (incl.
--    super_admins). Caller is responsible for not locking themselves out.
CREATE OR REPLACE FUNCTION public.admin_suspend_user(
  p_user_id uuid,
  p_reason  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  UPDATE public.profiles SET
    status            = 'suspended',
    suspension_reason = p_reason,
    suspended_at      = NOW(),
    suspended_by      = v_uid,
    updated_at        = NOW()
  WHERE id = p_user_id;

  BEGIN
    PERFORM public.notify_safe(
      p_user_id, 'system',
      'Account suspended',
      COALESCE(p_reason, 'Contact support for details.'),
      '/contact', NULL
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_suspend_user(uuid, text) TO authenticated;

COMMIT;
