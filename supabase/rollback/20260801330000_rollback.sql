-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801330000_countersign_stops_at_assigned
--
--  ⚠  RESTORES A STATE-MACHINE DEFECT. The 286000 body promotes the job all
--  the way to 'in_progress' on counter-signature, which (a) claims field work
--  has started the moment the contract is signed and (b) makes
--  inspector_start_job PERMANENTLY UNREACHABLE — it requires status='assigned'
--  and would always raise 'Job is not in assigned state (current: in_progress)'.
--
--  Restores THREE functions to their pre-330000 live definitions, VERBATIM:
--    • inspector_sign_job_contract — including the assigned→in_progress hop
--    • client_sign_job_contract    — including the OLD /inspector/contracts/job/
--                                    action_url
--    • heal_contract_to_active     — 20260801296000, including the automatic
--                                    drive to in_progress AND the
--                                    COALESCE(existing_zero, contract) money bug
--  ⚠ The restored deep link points at a route that does not exist, so
--  "Client signed — your turn" will again do nothing when tapped. That is the
--  prior live behaviour and rolling back means accepting it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.inspector_sign_job_contract(
  "p_contract_id" uuid, "p_typed_name" text, "p_ip" text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_c   RECORD;
  v_eff text;
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

  -- Read the snapshot the BEFORE trigger just stamped (for the audit record).
  SELECT effective_identity_mode INTO v_eff FROM public.job_contracts WHERE id = p_contract_id;

  -- Distinguishing audit: inspector acceptance, then full execution.
  BEGIN
    INSERT INTO public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
    VALUES
      ('contract.inspector_accepted', 'info', auth.uid(), 'job_contracts', p_contract_id, v_c.job_id,
        'Inspector accepted and signed the contract',
        jsonb_build_object('inspector_id', v_c.inspector_id, 'client_approval_type', v_c.client_approval_type)),
      ('contract.fully_executed', 'info', auth.uid(), 'job_contracts', p_contract_id, v_c.job_id,
        'Contract fully executed',
        jsonb_build_object('inspector_id', v_c.inspector_id,
                           'client_approval_type', v_c.client_approval_type,
                           'effective_identity_mode', v_eff));
  EXCEPTION WHEN OTHERS THEN NULL; END;

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
END $$;

ALTER FUNCTION public.inspector_sign_job_contract(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.inspector_sign_job_contract(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inspector_sign_job_contract(uuid, text, text) TO authenticated, service_role;

DO $verify$
DECLARE v text;
BEGIN
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.inspector_sign_job_contract(uuid,text,text)'::regprocedure);
  IF v !~* 'status\s*=\s*''in_progress''' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the in_progress promotion was not restored';
  END IF;
  IF (SELECT prosrc FROM pg_proc
       WHERE oid = 'public.client_sign_job_contract(uuid,text,text)'::regprocedure)
       !~ '/inspector/contracts/job/' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: client_sign_job_contract action_url not restored';
  END IF;
  IF (SELECT prosrc FROM pg_proc
       WHERE oid = 'public.heal_contract_to_active(uuid)'::regprocedure)
       !~ 'status\s*=\s*''in_progress''' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: heal_contract_to_active in_progress behaviour not restored';
  END IF;
  RAISE WARNING '330000 rolled back — counter-signature again jumps to in_progress and inspector_start_job is unreachable.';
END
$verify$;

-- ── client_sign_job_contract: 286000 verbatim, OLD action_url restored ───────
CREATE OR REPLACE FUNCTION public.client_sign_job_contract(
  "p_contract_id" uuid, "p_typed_name" text, "p_ip" text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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

  -- Distinguishing audit: an ACTUAL client e-signature occurred.
  BEGIN
    INSERT INTO public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
    VALUES ('contract.client_signed', 'info', auth.uid(), 'job_contracts', p_contract_id, v_c.job_id,
      'Client signed the contract',
      jsonb_build_object('inspector_id', v_c.inspector_id, 'client_approval_type', v_c.client_approval_type));
  EXCEPTION WHEN OTHERS THEN NULL; END;

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
END $$;

ALTER FUNCTION public.client_sign_job_contract(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.client_sign_job_contract(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_sign_job_contract(uuid, text, text) TO authenticated, service_role;

-- ── heal_contract_to_active: 20260801296000 verbatim ────────────────────────
--    ⚠ Restores the trigger-driven jump to in_progress, which is what made
--    inspector_start_job unreachable in the first place.
CREATE OR REPLACE FUNCTION public.heal_contract_to_active("p_contract_id" uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
DECLARE
  v_c   RECORD;
  v_job RECORD;
BEGIN
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_c.status IS DISTINCT FROM 'fully_executed' THEN
    RETURN;
  END IF;
  IF v_c.voided_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- ── Heal jobs.status ────────────────────────────────────────────────
  SELECT * INTO v_job FROM public.jobs WHERE id = v_c.job_id;
  IF FOUND AND v_job.status IN (
    'open', 'assigned', 'awarded', 'pending_approval',
    'pending_review', 'draft', 'review'
  ) THEN
    BEGIN
      UPDATE public.jobs SET
        status                 = 'in_progress',
        hired_inspector_id     = COALESCE(hired_inspector_id, v_c.inspector_id),
        inspector_payout_cents = COALESCE(inspector_payout_cents, v_c.inspector_payout_cents),
        payout_amount_cents    = COALESCE(payout_amount_cents,    v_c.inspector_payout_cents),
        client_price_cents     = COALESCE(client_price_cents,     v_c.client_price_cents),
        updated_at             = NOW()
      WHERE id = v_c.job_id;
    EXCEPTION WHEN OTHERS THEN
      -- Guard trigger rejected the leap → step through 'assigned' first
      BEGIN
        UPDATE public.jobs SET
          status             = 'assigned',
          hired_inspector_id = COALESCE(hired_inspector_id, v_c.inspector_id),
          updated_at         = NOW()
        WHERE id = v_c.job_id
          AND status IN ('open','awarded','pending_approval','pending_review','draft','review');

        UPDATE public.jobs SET
          status                 = 'in_progress',
          hired_inspector_id     = COALESCE(hired_inspector_id, v_c.inspector_id),
          inspector_payout_cents = COALESCE(inspector_payout_cents, v_c.inspector_payout_cents),
          payout_amount_cents    = COALESCE(payout_amount_cents,    v_c.inspector_payout_cents),
          client_price_cents     = COALESCE(client_price_cents,     v_c.client_price_cents),
          updated_at             = NOW()
        WHERE id = v_c.job_id AND status = 'assigned';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'heal_contract_to_active: could not advance jobs.status for job_id=%', v_c.job_id;
      END;
    END;
  END IF;

  -- ── Heal applications.status ────────────────────────────────────────
  --  ★ EXCEPTION-guarded (this migration). This is best-effort reconciliation;
  --    an application-side guard rejecting it must NEVER roll back the executed
  --    contract that triggered the heal. Previously unguarded, which is what made
  --    every inspector counter-signature fail.
  BEGIN
    IF v_c.application_id IS NOT NULL THEN
      UPDATE public.applications
         SET status     = 'hired',
             hired_at   = COALESCE(hired_at, NOW()),
             updated_at = NOW()
       WHERE id = v_c.application_id
         AND status NOT IN ('hired','accepted','completed','cancelled','rejected');
    ELSE
      UPDATE public.applications
         SET status     = 'hired',
             hired_at   = COALESCE(hired_at, NOW()),
             updated_at = NOW()
       WHERE job_id       = v_c.job_id
         AND applicant_id = v_c.inspector_id
         AND status NOT IN ('hired','accepted','completed','cancelled','rejected');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'heal_contract_to_active: could not advance applications.status for contract_id=% (%)',
      p_contract_id, SQLERRM;
  END;
END;
$$;

ALTER FUNCTION public.heal_contract_to_active(uuid) OWNER TO postgres;

COMMIT;
