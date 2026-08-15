-- ════════════════════════════════════════════════════════════════════════════
--  20260801506000_signature_must_not_dispatch.sql
--
--  P0 — signing a contract DISPATCHED the inspector, bypassing the Admin.
--
--  ── REPRODUCED ─────────────────────────────────────────────────────────────
--  Running the canonical fixture through the real RPC chain:
--      nx_fx_dispatched_job(...)  ->  'Job is not in open state (current: assigned)'
--  The job was already 'assigned' by the time admin_dispatch_job ran, because
--  client_sign_job_contract promotes open -> assigned and stamps
--  hired_inspector_id. inspector_sign_job_contract does the same.
--
--  ── WHY THIS IS WRONG UNDER THE CANONICAL LIFECYCLE ────────────────────────
--  Step 10: "Client selection must not directly assign or dispatch."
--  Step 14: the Admin performs the final assignment/dispatch, and only after
--           the application is Client-selected, the contract is fully
--           executed, AND the initial 20% funding requirement is satisfied.
--
--  A client e-signature satisfies none of those on its own. As written, the
--  buyer's signature was the dispatch: it chose the inspector, and it did so
--  BEFORE the inspector had countersigned and without consulting the funding
--  gate for that transition. It also deadlocked the canonical path outright —
--  admin_dispatch_job requires status='open', so once a signature had moved
--  the job to 'assigned' the Admin could never dispatch it at all.
--
--  ── THE CHANGE IS TWO LINES ────────────────────────────────────────────────
--  Only the `status = 'assigned'` write is removed from each function. Both
--  keep everything else verbatim: the signature stamps, the status transition
--  of the CONTRACT itself, hired_inspector_id, the money reconciliation, the
--  audit events and the notifications. hired_inspector_id is deliberately
--  retained — it records who the executed contract binds, which is true at
--  signature time; it is contractor_id that means "dispatched", and only
--  admin_dispatch_job writes that.
--
--  Both UPDATEs remain guarded by `WHERE ... AND status = 'open'`, so they are
--  still no-ops on out-of-order or replayed events.
--
--  ── WHAT STILL ENFORCES DISPATCH ───────────────────────────────────────────
--  Nothing here loosens a gate. After this migration the job stays 'open'
--  until admin_dispatch_job runs, and that path is gated by
--  trg_jobs_dispatch_requires_funding (initial 20%) and
--  trg_jobs_dispatch_requires_contract (fully executed contract, 20260801504000).
--  The three preconditions of step 14 are therefore all enforced, and none of
--  them can be satisfied by a signature alone.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.client_sign_job_contract(p_contract_id uuid, p_typed_name text, p_ip text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
    -- status promotion REMOVED (20260801506000): the client's signature
    -- must not dispatch. Admin does that via admin_dispatch_job.
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
      '/contracts/job/' || p_contract_id::text,
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
END 
$fn$;

CREATE OR REPLACE FUNCTION public.inspector_sign_job_contract(p_contract_id uuid, p_typed_name text, p_ip text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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

  -- ★ SINGLE TRANSITION: open → assigned. Retained from 286000 to repair
  --   contracts whose client-sign step predates that migration. The financial
  --   columns previously written by the (now removed) in_progress step are
  --   folded in here so nothing is lost.
  --   'assigned' → 'in_progress' is DELIBERATELY ABSENT: that hop belongs to
  --   inspector_start_job and to nothing else.
  UPDATE public.jobs SET
    -- status promotion REMOVED (20260801506000): see header.
    hired_inspector_id     = v_c.inspector_id,
    inspector_payout_cents = v_c.inspector_payout_cents,
    payout_amount_cents    = v_c.inspector_payout_cents,
    client_price_cents     = v_c.client_price_cents,
    updated_at             = NOW()
  WHERE id = v_c.job_id AND status = 'open';

  -- If the job is ALREADY 'assigned' (the normal path — client_sign moved it
  -- there), only the money/assignment fields need reconciling. No status write,
  -- so the guard trigger sees no transition at all.
  UPDATE public.jobs SET
    hired_inspector_id     = v_c.inspector_id,
    inspector_payout_cents = v_c.inspector_payout_cents,
    payout_amount_cents    = v_c.inspector_payout_cents,
    client_price_cents     = v_c.client_price_cents,
    updated_at             = NOW()
  WHERE id = v_c.job_id AND status = 'assigned';

  -- Read the snapshot the BEFORE trigger just stamped (for the audit record).
  SELECT effective_identity_mode INTO v_eff FROM public.job_contracts WHERE id = p_contract_id;

  -- Distinguishing audit: inspector acceptance, then full execution. Unchanged.
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

  -- ★ Copy corrected: assignment, NOT commencement.
  BEGIN
    PERFORM public.create_system_notification(
      v_c.client_id, 'Contract fully executed',
      'The inspector signed and is now assigned to this job.',
      'contract_assigned',
      '/client/jobs/' || v_c.job_id::text, v_c.job_id);
    PERFORM public.create_system_notification(
      v_c.inspector_id, 'You are assigned',
      'Contract fully executed. Start the job when you begin work on site.',
      'assignment',
      '/inspector/jobs/' || v_c.job_id::text, v_c.job_id);
    PERFORM public.create_admin_notification(
      'Contract fully executed',
      'Both parties signed. Job moved to assigned; awaiting inspector start.',
      'contract_assigned',
      '/admin/jobs?inspect=' || v_c.job_id::text, v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', 'fully_executed', 'job_status', 'assigned');
END 
$fn$;

-- ─── Selftest — behavioural ─────────────────────────────────────────────────
DO $selftest$
DECLARE v_bad text;
BEGIN
  --  Neither signing function may promote a job to 'assigned'. Asserted on the
  --  source because the behaviour is a single write: if it comes back, this
  --  fails at migration time rather than surfacing as a mis-dispatched job.
  FOR v_bad IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('client_sign_job_contract','inspector_sign_job_contract')
       --  A SET-list item ends in a comma; `AND status = 'assigned'` in a
       --  WHERE clause does not. Matching the bare comparison would flag the
       --  legitimate money-reconciliation UPDATE that targets already-assigned
       --  jobs, so the comma is what distinguishes a write from a filter.
       AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~ 'status\s*=\s*''assigned''\s*,'
  LOOP
    RAISE EXCEPTION 'SELFTEST: % still promotes the job to assigned — signature would dispatch', v_bad;
  END LOOP;

  --  And the signature chain itself must be intact: the CONTRACT still moves.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='client_sign_job_contract'
                  AND prosrc ~ 'pending_inspector_signature') THEN
    RAISE EXCEPTION 'SELFTEST: client_sign_job_contract no longer advances the contract';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='inspector_sign_job_contract'
                  AND prosrc ~ 'fully_executed') THEN
    RAISE EXCEPTION 'SELFTEST: inspector_sign_job_contract no longer reaches fully_executed';
  END IF;

  --  Dispatch gates must both still be attached.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_jobs_dispatch_requires_contract' AND NOT tgisinternal)
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_jobs_dispatch_requires_funding'  AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: a dispatch gate is missing';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
