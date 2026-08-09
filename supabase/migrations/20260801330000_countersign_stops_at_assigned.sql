-- ════════════════════════════════════════════════════════════════════════════
--  20260801330000_countersign_stops_at_assigned.sql
--
--  Forward-only. Does NOT edit 20260801286000 (applied to Production).
--
--  ── PRODUCT DECISION ───────────────────────────────────────────────────────
--  A fully executed commercial agreement means the inspector is ASSIGNED and
--  authorized — not that field work has started. The canonical lifecycle is:
--
--      client signs → inspector counter-signs
--        → job_contracts.status = fully_executed
--        → jobs.status          = assigned
--      inspector presses Start Job  (inspector_start_job)
--        → jobs.status          = in_progress
--
--  ── DEFECT BEING FIXED ─────────────────────────────────────────────────────
--  286000's inspector_sign_job_contract ran a two-step promotion and ended at
--  'in_progress'. Two consequences:
--    1. The DB claimed work had started the instant ink dried.
--    2. inspector_start_job became UNREACHABLE — it requires status='assigned',
--       which the job had already left, so it always raised
--       'Job is not in assigned state (current: in_progress)'.
--
--  ── WHAT CHANGES ───────────────────────────────────────────────────────────
--  ONLY the 'assigned' → 'in_progress' UPDATE is removed, and the three
--  notification bodies stop claiming work is underway. The 'open' → 'assigned'
--  defensive promotion is KEPT (it repairs contracts whose client-sign step
--  predates 286000), and the payout/price columns it used to write are folded
--  into the assigned-state write so no financial field is lost.
--
--  ── WHAT DOES NOT CHANGE ───────────────────────────────────────────────────
--  Authorization (inspector-only, status precondition, typed-name check),
--  SECURITY DEFINER + search_path, contract status transition, the identity
--  snapshot read, both audit events and their metadata, and the notification
--  recipients/types. No RLS, no grant, no view, no identity disclosure.
--
--  ── ALSO FIXED: the contract deep link ─────────────────────────────────────
--  client_sign_job_contract emitted action_url '/inspector/contracts/job/<id>'.
--  That route does not exist — app/(inspector)/contracts/ is absent; the real
--  screen is app/contracts/job/[id].tsx → '/contracts/job/<id>'. Tapping
--  "Client signed — your turn" therefore did nothing. Future notifications now
--  carry the correct path; rows ALREADY in Production keep the old one, so the
--  client normalises the legacy prefix in app/notifications.tsx.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) inspector_sign_job_contract — counter-signature stops at 'assigned'.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- ★ SINGLE TRANSITION: open → assigned. Retained from 286000 to repair
  --   contracts whose client-sign step predates that migration. The financial
  --   columns previously written by the (now removed) in_progress step are
  --   folded in here so nothing is lost.
  --   'assigned' → 'in_progress' is DELIBERATELY ABSENT: that hop belongs to
  --   inspector_start_job and to nothing else.
  UPDATE public.jobs SET
    status                 = 'assigned',
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
END $$;

ALTER FUNCTION public.inspector_sign_job_contract(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.inspector_sign_job_contract(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inspector_sign_job_contract(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.inspector_sign_job_contract(uuid, text, text) IS
  'Inspector counter-signature. Contract → fully_executed, job → assigned. Does NOT start work: assigned → in_progress belongs exclusively to inspector_start_job (20260801330000).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) client_sign_job_contract — EXPLICIT redefinition, transcribed from the
--    live 20260801286000 body. The ONLY difference is the notification
--    action_url literal:
--        '/inspector/contracts/job/'   (dead route — app/(inspector)/contracts/
--                                       does not exist, so the deep link on
--                                       "Client signed — your turn" did nothing)
--        '/contracts/job/'             (the real screen, app/contracts/job/[id])
--    Authorization, signature evidence, the open→assigned promotion, the audit
--    event, both notifications, SECURITY DEFINER, search_path and grants are
--    reproduced unchanged.
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
END $$;

ALTER FUNCTION public.client_sign_job_contract(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.client_sign_job_contract(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_sign_job_contract(uuid, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) heal_contract_to_active — THE REMAINING ROOT CAUSE.
--
--    Trigger chain: heal_contract_on_executed → tg_heal_contract_on_executed()
--    → heal_contract_to_active(). The 296000 body explicitly drove a fully
--    executed contract's job to 'in_progress' (and, if the guard rejected the
--    leap, stepped through 'assigned' and then forced in_progress anyway). So
--    even with inspector_sign_job_contract corrected above, this trigger put
--    the job straight back into in_progress and re-broke inspector_start_job.
--
--    Redefined here — SAME NAME, since the trigger and internal callers
--    reference it — to reconcile the job to ASSIGNED-or-later and never start
--    work. Signature, ownership, SECURITY DEFINER, search_path and the revoked
--    grants (20260801308000) are untouched.
--
--    Also fixes a real money bug carried by 296000:
--        COALESCE(inspector_payout_cents, v_c.inspector_payout_cents)
--    keeps an existing ZERO forever, because 0 is not NULL. The contract is the
--    authoritative source, so the operands are reversed: take the contract
--    value whenever it is non-null, and fall back to the row only when the
--    contract has nothing to say.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- ── Heal jobs.status → ASSIGNED (never in_progress) ─────────────────
  SELECT * INTO v_job FROM public.jobs WHERE id = v_c.job_id;
  IF FOUND THEN
    BEGIN
      IF v_job.status IN (
        'open', 'awarded', 'pending_approval',
        'pending_review', 'draft', 'review'
      ) THEN
        -- Pre-assignment state → promote exactly one step, to 'assigned'.
        UPDATE public.jobs SET
          status                 = 'assigned',
          hired_inspector_id     = COALESCE(v_c.inspector_id, hired_inspector_id),
          inspector_payout_cents = COALESCE(v_c.inspector_payout_cents, inspector_payout_cents),
          payout_amount_cents    = COALESCE(v_c.inspector_payout_cents, payout_amount_cents),
          client_price_cents     = COALESCE(v_c.client_price_cents,     client_price_cents),
          updated_at             = NOW()
        WHERE id = v_c.job_id;

      ELSIF v_job.status = 'assigned' THEN
        -- Already assigned → reconcile assignment/money ONLY. No status write,
        -- so the guard trigger sees no transition at all.
        UPDATE public.jobs SET
          hired_inspector_id     = COALESCE(v_c.inspector_id, hired_inspector_id),
          inspector_payout_cents = COALESCE(v_c.inspector_payout_cents, inspector_payout_cents),
          payout_amount_cents    = COALESCE(v_c.inspector_payout_cents, payout_amount_cents),
          client_price_cents     = COALESCE(v_c.client_price_cents,     client_price_cents),
          updated_at             = NOW()
        WHERE id = v_c.job_id;

      -- in_progress / disputed / completed / cancelled / paid: the engagement
      -- has already moved past assignment. NEVER downgrade it back.
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'heal_contract_to_active: could not reconcile jobs row for job_id=% (%)',
        v_c.job_id, SQLERRM;
    END;
  END IF;

  -- ── Heal applications.status ────────────────────────────────────────
  --  Carried over unchanged from 296000, EXCEPTION-guard included: this is
  --  best-effort reconciliation and an application-side guard rejecting it must
  --  NEVER roll back the executed contract that triggered the heal.
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

COMMENT ON FUNCTION public.heal_contract_to_active(uuid) IS
  'Reconciles a FULLY EXECUTED, non-voided contract onto its job: promotes a pre-assignment job to ASSIGNED, reconciles assignment/money when already assigned, and never downgrades a job that has moved past assignment. Does NOT start work — assigned → in_progress belongs exclusively to inspector_start_job (20260801330000). Application healing to hired is best-effort and EXCEPTION-isolated.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Self-tests — the release gate expects every migration to prove itself.
-- ─────────────────────────────────────────────────────────────────────────────
DO $test$
DECLARE v text;
BEGIN
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.inspector_sign_job_contract(uuid,text,text)'::regprocedure);

  -- the removed hop must be gone
  IF v ~* 'status\s*=\s*''in_progress''' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: counter-signature still promotes the job to in_progress';
  END IF;

  -- the contract must still fully execute, and the assignment must still land
  IF v !~* 'status\s*=\s*''fully_executed''' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: contract no longer reaches fully_executed';
  END IF;
  IF v !~* 'status\s*=\s*''assigned''' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: job no longer reaches assigned';
  END IF;

  -- financial + assignment fields must survive
  IF v !~* 'hired_inspector_id' OR v !~* 'inspector_payout_cents'
     OR v !~* 'payout_amount_cents' OR v !~* 'client_price_cents' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an assignment/payout field was dropped';
  END IF;

  -- authorization must survive
  IF v !~* 'only the assigned inspector can sign'
     OR v !~* 'pending_inspector_signature'
     OR v !~* 'type your full legal name to sign' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an authorization check was dropped';
  END IF;

  -- both audit events must survive
  IF v !~* 'contract\.inspector_accepted' OR v !~* 'contract\.fully_executed' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an audit event was dropped';
  END IF;

  -- copy must not claim work started
  IF v ~* 'now in progress' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: notification copy still claims work has started';
  END IF;

  -- inspector_start_job must still exist and still gate on assigned
  IF to_regprocedure('public.inspector_start_job(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspector_start_job is missing';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.inspector_start_job(uuid)'::regprocedure)
       !~* 'not in assigned state' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspector_start_job no longer requires assigned';
  END IF;

  -- the deep link must be repaired for future notifications
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.client_sign_job_contract(uuid,text,text)'::regprocedure);
  IF v ~* '/inspector/contracts/job/' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: client_sign_job_contract still emits the dead /inspector route';
  END IF;
  IF v !~* '/contracts/job/' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: client_sign_job_contract lost the contract deep link';
  END IF;

  -- ── heal_contract_to_active must not start work ───────────────────────────
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.heal_contract_to_active(uuid)'::regprocedure);
  IF v ~* 'status\s*=\s*''in_progress''' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: heal_contract_to_active still drives the job to in_progress';
  END IF;
  IF v !~* 'status\s*=\s*''assigned''' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: heal_contract_to_active no longer reconciles to assigned';
  END IF;
  IF v !~* 'applications' OR v !~* '''hired''' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: application reconciliation was dropped from the heal';
  END IF;
  IF v !~* 'EXCEPTION WHEN OTHERS' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the heal lost its EXCEPTION isolation';
  END IF;

  -- ── the trigger chain must still be intact ────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'heal_contract_on_executed' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: heal_contract_on_executed trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgname = 'heal_contract_on_executed'
       AND NOT tg.tgisinternal
       AND p.proname = 'tg_heal_contract_on_executed'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: heal_contract_on_executed no longer calls tg_heal_contract_on_executed';
  END IF;

  RAISE NOTICE 'counter-signature now stops at assigned; start-job owns in_progress; deep link repaired.';
END $test$;

COMMIT;
