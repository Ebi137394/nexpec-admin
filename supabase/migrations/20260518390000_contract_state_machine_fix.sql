-- ============================================================================
-- Contract → job state machine fix.
--
-- Old behaviour:
--   client_sign_job_contract     — did NOT touch jobs.status
--   inspector_sign_job_contract  — tried to jump jobs.status open → in_progress
--                                  → blocked by the guard trigger
--                                  ("Illegal jobs.status transition")
--
-- New behaviour:
--   client_sign      → jobs.status moves open → assigned (inspector chosen)
--   inspector_sign   → jobs.status moves assigned → in_progress (work begins)
-- ============================================================================

BEGIN;

-- ── client_sign_job_contract — now also flips jobs.status to 'assigned' ─
CREATE OR REPLACE FUNCTION public.client_sign_job_contract(
  p_contract_id uuid,
  p_typed_name  text,
  p_ip          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF v_c.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'only the client can sign this contract';
  END IF;
  IF v_c.status <> 'pending_client_signature' THEN
    RAISE EXCEPTION 'contract not awaiting client signature (status=%)', v_c.status;
  END IF;
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN
    RAISE EXCEPTION 'type your full legal name to sign';
  END IF;

  UPDATE public.job_contracts SET
    client_signed_at   = NOW(),
    client_signed_name = trim(p_typed_name),
    client_signed_ip   = p_ip,
    status             = 'pending_inspector_signature'
  WHERE id = p_contract_id;

  -- Promote job: open → assigned (inspector is now formally chosen).
  -- Guarded by status='open' so re-signs / out-of-order events are no-ops.
  UPDATE public.jobs SET
    status             = 'assigned',
    hired_inspector_id = v_c.inspector_id,
    updated_at         = NOW()
  WHERE id = v_c.job_id AND status = 'open';

  -- Notify the inspector
  BEGIN
    PERFORM public.create_system_notification(
      v_c.inspector_id,
      'Client signed — your turn',
      'Open the contract to sign and accept the assignment.',
      'contract_assigned',
      '/inspector/contracts/job/' || p_contract_id::text,
      v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Notify admins (audit)
  BEGIN
    PERFORM public.create_admin_notification(
      'Client signed a job contract',
      'Awaiting inspector signature. Job moved to assigned.',
      'contract_assigned',
      '/admin/jobs?inspect=' || v_c.job_id::text,
      v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', 'pending_inspector_signature');
END $fn$;

GRANT EXECUTE ON FUNCTION public.client_sign_job_contract(uuid, text, text) TO authenticated;

-- ── inspector_sign_job_contract — assigned → in_progress, defensively ──
CREATE OR REPLACE FUNCTION public.inspector_sign_job_contract(
  p_contract_id uuid,
  p_typed_name  text,
  p_ip          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF v_c.inspector_id <> auth.uid() THEN
    RAISE EXCEPTION 'only the assigned inspector can sign';
  END IF;
  IF v_c.status <> 'pending_inspector_signature' THEN
    RAISE EXCEPTION 'contract not awaiting inspector signature (status=%)', v_c.status;
  END IF;
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN
    RAISE EXCEPTION 'type your full legal name to sign';
  END IF;

  UPDATE public.job_contracts SET
    inspector_signed_at   = NOW(),
    inspector_signed_name = trim(p_typed_name),
    inspector_signed_ip   = p_ip,
    status                = 'fully_executed'
  WHERE id = p_contract_id;

  -- DEFENSIVE TWO-STEP TRANSITION:
  --   1. If somehow the client-sign step left jobs.status='open' (e.g. the
  --      contract was retroactively signed before this migration), promote
  --      to 'assigned' first.
  --   2. Then promote 'assigned' → 'in_progress'.
  -- Each UPDATE is gated by the current status so the guard trigger sees
  -- a legal hop every time.
  UPDATE public.jobs SET
    status             = 'assigned',
    hired_inspector_id = v_c.inspector_id,
    updated_at         = NOW()
  WHERE id = v_c.job_id AND status = 'open';

  UPDATE public.jobs SET
    status                 = 'in_progress',
    hired_inspector_id     = v_c.inspector_id,
    inspector_payout_cents = v_c.inspector_payout_cents,
    payout_amount_cents    = v_c.inspector_payout_cents,
    client_price_cents     = v_c.client_price_cents,
    updated_at             = NOW()
  WHERE id = v_c.job_id AND status = 'assigned';

  -- Notify everyone
  BEGIN
    PERFORM public.create_system_notification(
      v_c.client_id, 'Contract fully executed',
      'Inspector signed. Job is now in progress.',
      'contract_assigned',
      '/client/jobs/' || v_c.job_id::text, v_c.job_id);
    PERFORM public.create_system_notification(
      v_c.inspector_id, 'Job confirmed',
      'You signed the contract. Job is now in progress on your dashboard.',
      'assignment',
      '/inspector/jobs/' || v_c.job_id::text, v_c.job_id);
    PERFORM public.create_admin_notification(
      'Contract fully executed',
      'Both parties signed. Job moved to in_progress.',
      'contract_assigned',
      '/admin/jobs?inspect=' || v_c.job_id::text, v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', 'fully_executed');
END $fn$;

GRANT EXECUTE ON FUNCTION public.inspector_sign_job_contract(uuid, text, text) TO authenticated;

-- ── Backfill: clear up any contract that's stuck in a weird state ───────
-- For any contract where the client has already signed but the parent
-- job is still 'open', force the assigned transition retroactively.
UPDATE public.jobs j
   SET status             = 'assigned',
       hired_inspector_id = c.inspector_id,
       updated_at         = NOW()
  FROM public.job_contracts c
 WHERE c.job_id = j.id
   AND c.status = 'pending_inspector_signature'
   AND j.status = 'open';

COMMIT;

-- ── VERIFY ─────────────────────────────────────────────────────────────
-- Run this after COMMIT — every active contract should now line up with
-- a legally-transitioned job.
SELECT
  c.id            AS contract_id,
  c.status        AS contract_status,
  j.status        AS job_status,
  c.client_signed_at IS NOT NULL AS client_signed,
  c.inspector_signed_at IS NOT NULL AS inspector_signed
FROM public.job_contracts c
JOIN public.jobs j ON j.id = c.job_id
WHERE c.status <> 'voided'
ORDER BY c.created_at DESC;
