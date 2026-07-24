-- ════════════════════════════════════════════════════════════════════════════
--  20260801286000_identity_replacement_rpcs.sql
--
--  INSPECTION MARKETPLACE — Admin policy / void / replace RPCs, the RFQ-exclusion
--  chokepoint guard, and audit-distinguishing additions to the two sign RPCs.
--
--  Depends on …284000 (columns, snapshot trigger, helper functions).
--  Touches Workflow A only. Supplier/Brokered objects are never referenced.
--
--  GR2 (price-blindness): since 20260801230000 the raw audit_events table is
--  admin-only; non-admins read the redacted `audit_events_public` view (which
--  strips inspector-pay / spread / identity keys). As defense-in-depth we STILL
--  never write inspector payout / platform spread into audit metadata or
--  notification bodies here, so nothing sensitive exists to leak even if a
--  future read path widens.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) RFQ-exclusion chokepoint: a job_contract may only be created for an
--    Inspection Marketplace job. Supplier-RFQ-spawned jobs (source_rfq_id NOT
--    NULL) are handled by the brokered engagement flow and must never receive a
--    job_contract. Enforcing this on INSERT covers EVERY creation path
--    (admin_generate_job_contract AND admin_replace_inspector) at one point,
--    closing the residual RLS-level dual-workflow gap without rewriting the
--    existing generation RPC. (Preflight finding: applications_insert RLS does
--    not filter source_rfq_id; this trigger makes exclusivity provable.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_job_contracts_reject_brokered_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.source_rfq_id IS NOT NULL) THEN
    RAISE EXCEPTION 'job_contracts are for Inspection Marketplace jobs only; job % originates from a supplier RFQ and is served by the brokered engagement flow', NEW.job_id
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.tg_job_contracts_reject_brokered_job() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_job_contracts_reject_brokered_job ON public.job_contracts;
CREATE TRIGGER trg_job_contracts_reject_brokered_job
  BEFORE INSERT ON public.job_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_job_contracts_reject_brokered_job();

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) admin_set_project_policy — Admin sets the two project policies on a Job.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_project_policy(
  p_job_id          uuid,
  p_identity_mode   text,
  p_replacement_mode text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_job  RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  IF p_identity_mode IS NULL OR p_identity_mode NOT IN ('protected','professional','full') THEN
    RAISE EXCEPTION 'invalid identity_mode (protected|professional|full)' USING errcode = '22023';
  END IF;
  IF p_replacement_mode IS NULL OR p_replacement_mode NOT IN ('client_reapproval','admin_authorized') THEN
    RAISE EXCEPTION 'invalid replacement_mode (client_reapproval|admin_authorized)' USING errcode = '22023';
  END IF;

  -- Lock the Job row for the duration of the policy update.
  SELECT id, identity_mode, replacement_mode
    INTO v_job
    FROM public.jobs
   WHERE id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  -- Update ONLY the two policy fields. Never touches contracts, signatures, or
  -- the immutable execution-time snapshot on historical contracts.
  UPDATE public.jobs
     SET identity_mode    = p_identity_mode,
         replacement_mode = p_replacement_mode,
         updated_at       = NOW()
   WHERE id = p_job_id;

  -- Immutable audit trail (no payout/spread — redacted for non-admins, kept out as defense-in-depth).
  INSERT INTO public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
  VALUES ('job.policy.updated', 'info', auth.uid(), 'jobs', p_job_id, p_job_id,
    'Project policy updated',
    jsonb_build_object(
      'old_identity_mode',    v_job.identity_mode,
      'new_identity_mode',    p_identity_mode,
      'old_replacement_mode', v_job.replacement_mode,
      'new_replacement_mode', p_replacement_mode
    ));

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'identity_mode', p_identity_mode,
    'replacement_mode', p_replacement_mode
  );
END;
$$;
ALTER FUNCTION public.admin_set_project_policy(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_project_policy(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_project_policy(uuid, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) admin_void_contract — void a single contract (standalone), revoking the
--    former inspector's operational access while preserving all history.
--    Never touches payments / escrow / transactions / invoices / wallets.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_void_contract(
  p_contract_id uuid,
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_c   RECORD;
  v_job RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a non-empty reason is required to void a contract' USING errcode = '22023';
  END IF;

  -- Lock the contract, then the job.
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found' USING errcode = 'P0002';
  END IF;

  -- Idempotent-friendly: already voided → no-op success (do not overwrite history).
  IF v_c.status = 'voided' THEN
    RETURN jsonb_build_object('ok', true, 'already_voided', true, 'contract_id', p_contract_id, 'status', 'voided');
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = v_c.job_id FOR UPDATE;

  -- Void (preserve every existing field; only stamp the void columns + status).
  UPDATE public.job_contracts
     SET status        = 'voided',
         voided_at     = NOW(),
         voided_by     = auth.uid(),
         voided_reason = btrim(p_reason),
         updated_at    = NOW()
   WHERE id = p_contract_id;

  -- Revoke the former inspector's OPERATIONAL access: clear the Job's live
  -- inspector pointers where they still point at this contract/inspector. Job
  -- STATUS is intentionally left unchanged (no new status; "awaiting
  -- replacement" is derived = in_progress + no non-voided contract). RLS write
  -- access is already revoked because the contract is now voided
  -- (is_active_contract_inspector → false). Authorship-scoped historical READ is
  -- preserved (inspector_id = auth.uid() policies).
  UPDATE public.jobs
     SET contractor_id      = CASE WHEN contractor_id      = v_c.inspector_id THEN NULL ELSE contractor_id      END,
         hired_inspector_id = CASE WHEN hired_inspector_id = v_c.inspector_id THEN NULL ELSE hired_inspector_id END,
         inspector_id       = CASE WHEN inspector_id       = v_c.inspector_id THEN NULL ELSE inspector_id       END,
         contract_id        = CASE WHEN contract_id        = p_contract_id    THEN NULL ELSE contract_id        END,
         updated_at         = NOW()
   WHERE id = v_c.job_id;

  -- Audit (no payout/spread — redacted for non-admins, kept out as defense-in-depth).
  INSERT INTO public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
  VALUES ('contract.voided', 'warning', auth.uid(), 'job_contracts', p_contract_id, v_c.job_id,
    'Contract voided by admin',
    jsonb_build_object('inspector_id', v_c.inspector_id, 'prior_status', v_c.status, 'reason', btrim(p_reason)));

  -- Transactional notifications (former inspector + admins). No payout in bodies.
  BEGIN
    PERFORM public.create_system_notification(
      v_c.inspector_id,
      'Assignment ended',
      'An admin has ended your assignment on this job. Your submitted work remains on record.',
      'contract_voided',
      '/inspector/jobs/' || v_c.job_id::text,
      v_c.job_id);
    PERFORM public.create_admin_notification(
      'Contract voided',
      'A job contract was voided. Job is awaiting a replacement inspector.',
      'contract_voided',
      '/admin/jobs?inspect=' || v_c.job_id::text,
      v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'contract_id', p_contract_id, 'status', 'voided', 'job_id', v_c.job_id);
END;
$$;
ALTER FUNCTION public.admin_void_contract(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_void_contract(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_contract(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) admin_replace_inspector — void-and-reissue in ONE transaction.
--    Reuses the existing signing lifecycle; never creates a new Job; never
--    touches Supplier/Brokered objects or any money table.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_replace_inspector(
  p_job_id                uuid,
  p_new_application_id    uuid,
  p_client_price_cents    bigint,
  p_inspector_payout_cents bigint,
  p_reason                text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_job         RECORD;
  v_app         RECORD;
  v_old         RECORD;
  v_mode        text;
  v_envelope    bigint;
  v_new_id      uuid;
  v_new_status  text;
  v_approval    text;
BEGIN
  -- 1. Admin authorization.
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a non-empty reason is required to replace an inspector' USING errcode = '22023';
  END IF;
  IF p_client_price_cents < 0 OR p_inspector_payout_cents < 0 THEN
    RAISE EXCEPTION 'prices must be non-negative' USING errcode = '22023';
  END IF;

  -- 2. Lock the Job.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  -- 3. Inspection Marketplace job only (never an RFQ/brokered job).
  IF v_job.source_rfq_id IS NOT NULL THEN
    RAISE EXCEPTION 'job % is a supplier-RFQ (brokered) job; inspector replacement is an Inspection Marketplace operation', p_job_id
      USING errcode = '42501';
  END IF;

  -- v_mode drives the branch. Fail-closed to client_reapproval if somehow NULL.
  v_mode := COALESCE(v_job.replacement_mode, 'client_reapproval');

  -- 4. Validate the selected replacement application.
  SELECT a.id, a.job_id, a.applicant_id, a.status
    INTO v_app
    FROM public.applications a
   WHERE a.id = p_new_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'replacement application not found' USING errcode = 'P0002';
  END IF;
  IF v_app.job_id <> p_job_id THEN
    RAISE EXCEPTION 'application % does not belong to job %', p_new_application_id, p_job_id USING errcode = '22023';
  END IF;
  IF v_app.status IN ('rejected','withdrawn') THEN
    RAISE EXCEPTION 'replacement application is not in an eligible state (status=%)', v_app.status USING errcode = '22023';
  END IF;

  -- Current active (non-voided) contract, if any. Locked. (May be absent when a
  -- standalone void already ran — replacement then just reissues.)
  SELECT * INTO v_old
    FROM public.job_contracts
   WHERE job_id = p_job_id AND status <> 'voided'
   FOR UPDATE;

  -- 4b. No-conflict: the replacement inspector must not already hold the active contract.
  IF v_old.id IS NOT NULL AND v_old.inspector_id = v_app.applicant_id THEN
    RAISE EXCEPTION 'application % already maps to the active inspector on this job', p_new_application_id USING errcode = '22023';
  END IF;

  -- 5. Pricing envelope: the Client price the client already agreed to must be
  --    preserved (no unauthorized re-charge). Envelope = job.client_price_cents,
  --    falling back to the voided/old contract price when the job field is unset.
  v_envelope := COALESCE(v_job.client_price_cents, v_old.client_price_cents, p_client_price_cents);
  IF p_client_price_cents <> v_envelope THEN
    RAISE EXCEPTION 'client price envelope must be preserved (expected %, got %)', v_envelope, p_client_price_cents USING errcode = '22023';
  END IF;

  -- 6. Void the current active contract (approved void behavior), if present.
  IF v_old.id IS NOT NULL THEN
    UPDATE public.job_contracts
       SET status        = 'voided',
           voided_at     = NOW(),
           voided_by     = auth.uid(),
           voided_reason = 'Replaced: ' || btrim(p_reason),
           updated_at    = NOW()
     WHERE id = v_old.id;
  END IF;

  -- 7. Branch by replacement_mode → new contract's initial state.
  IF v_mode = 'admin_authorized' THEN
    -- Admin authorization stands in for the CLIENT-approval side only. The
    -- inspector must still accept/sign. client_signed_* stay NULL. Contract
    -- starts already past the client-signature step.
    v_new_status := 'pending_inspector_signature';
    v_approval   := 'admin_authorized';
  ELSE
    -- client_reapproval: a fresh, real Client signature is required.
    v_new_status := 'pending_client_signature';
    v_approval   := 'client_signature';
  END IF;

  -- 7b. Insert the replacement contract. The BEFORE INSERT guard confirms this
  --     is not a brokered job; the identity-snapshot trigger leaves
  --     effective_identity_mode NULL until execution.
  INSERT INTO public.job_contracts (
    job_id, application_id, client_id, inspector_id,
    client_price_cents, inspector_payout_cents,
    contract_text_md, custom_contract_url,
    status, generated_by,
    client_approval_type, admin_authorized_by, admin_authorized_at, admin_authorization_reason
  ) VALUES (
    p_job_id, v_app.id, v_job.client_id, v_app.applicant_id,
    p_client_price_cents, p_inspector_payout_cents,
    COALESCE(v_old.contract_text_md, NULL), COALESCE(v_old.custom_contract_url, NULL),
    v_new_status, auth.uid(),
    v_approval,
    CASE WHEN v_mode = 'admin_authorized' THEN auth.uid() ELSE NULL END,
    CASE WHEN v_mode = 'admin_authorized' THEN NOW()      ELSE NULL END,
    CASE WHEN v_mode = 'admin_authorized' THEN btrim(p_reason) ELSE NULL END
  )
  RETURNING id INTO v_new_id;

  -- 8. Update the derived Job pointers atomically to the NEW inspector. This
  --    revokes the former inspector's operational (job-party) READ and grants
  --    the replacement continuity. Job STATUS is left unchanged (stays
  --    in_progress; no new status is introduced).
  UPDATE public.jobs
     SET contractor_id        = v_app.applicant_id,
         hired_inspector_id   = v_app.applicant_id,
         inspector_id         = v_app.applicant_id,
         contract_id          = v_new_id,
         contract_generated_at = NOW(),
         updated_at           = NOW()
   WHERE id = p_job_id;

  -- 9. Audit (no payout/spread — redacted for non-admins, kept out as defense-in-depth).
  INSERT INTO public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
  VALUES ('contract.inspector_replaced', 'warning', auth.uid(), 'job_contracts', v_new_id, p_job_id,
    'Inspector replaced via void-and-reissue',
    jsonb_build_object(
      'old_contract_id',      v_old.id,
      'old_inspector_id',     v_old.inspector_id,
      'new_contract_id',      v_new_id,
      'new_inspector_id',     v_app.applicant_id,
      'new_application_id',   p_new_application_id,
      'replacement_mode',     v_mode,
      'client_approval_type', v_approval,
      'reason',               btrim(p_reason)
    ));

  -- 10. Transactional notifications. No payout in bodies.
  BEGIN
    -- Replacement inspector: must review & accept/sign.
    PERFORM public.create_system_notification(
      v_app.applicant_id,
      'New assignment — action required',
      'You have been assigned to a job. Open the contract to review and sign.',
      'contract_assigned',
      '/inspector/contracts/job/' || v_new_id::text,
      p_job_id);

    IF v_mode = 'admin_authorized' THEN
      -- Client: informational (admin authorized the change on their behalf).
      PERFORM public.create_system_notification(
        v_job.client_id,
        'Inspector replaced',
        'An admin has assigned a replacement inspector for your job. No action is needed from you.',
        'contract_assigned',
        '/client/jobs/' || p_job_id::text,
        p_job_id);
    ELSE
      -- Client: must re-approve (sign) the new contract.
      PERFORM public.create_system_notification(
        v_job.client_id,
        'Replacement contract ready for signature',
        'A replacement inspector has been prepared. Review and sign to confirm.',
        'contract_assigned',
        '/client/contracts/job/' || v_new_id::text,
        p_job_id);
    END IF;

    PERFORM public.create_admin_notification(
      'Inspector replaced',
      'A replacement contract was issued (' || v_mode || ').',
      'contract_assigned',
      '/admin/jobs?inspect=' || p_job_id::text,
      p_job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'old_contract_id', v_old.id,
    'new_contract_id', v_new_id,
    'replacement_mode', v_mode,
    'client_approval_type', v_approval,
    'status', v_new_status
  );
END;
$$;
ALTER FUNCTION public.admin_replace_inspector(uuid, uuid, bigint, bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_replace_inspector(uuid, uuid, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_inspector(uuid, uuid, bigint, bigint, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Sign RPCs — reproduce baseline behavior VERBATIM and add audit_events that
--    distinguish the approval stages. The execution-time identity snapshot is
--    applied by the BEFORE trigger (…284000), so these RPCs cannot bypass it and
--    need no snapshot logic of their own. All prior behavior is preserved.
--
--    Approval-stage audit map:
--      • actual Client signature        → 'contract.client_signed'   (here)
--      • Admin-authorized Client side   → recorded by admin_replace_inspector
--                                          ('contract.inspector_replaced',
--                                           client_approval_type='admin_authorized')
--      • inspector acceptance           → 'contract.inspector_accepted' (here)
--      • full execution                 → 'contract.fully_executed'     (here)
-- ─────────────────────────────────────────────────────────────────────────────
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

NOTIFY pgrst, 'reload schema';
