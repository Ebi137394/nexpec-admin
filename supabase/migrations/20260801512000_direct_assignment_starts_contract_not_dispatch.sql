-- ════════════════════════════════════════════════════════════════════════════
--  20260801512000_direct_assignment_starts_contract_not_dispatch.sql
--
--  P0 — admin_assign_inspector_directly dispatched without a contract.
--
--  ── REPRODUCED ─────────────────────────────────────────────────────────────
--      CONTRACT_REQUIRED: job ... cannot be dispatched to inspector ...
--  admin_direct_assignment_test, the last failing suite. The RPC creates an
--  application and then delegates straight to admin_dispatch_job. It never
--  creates a contract, so the gate added by 20260801504000 refuses it — and
--  pre-creating one is impossible because the RPC itself refuses a job that
--  "already has a live contract".
--
--  ── WHY THE FIX IS IN THE PRODUCT, NOT THE TEST OR THE GATE ────────────────
--  The canonical lifecycle grants direct assignment no exemption. "Admin
--  remains the only final dispatch authority" names WHO may dispatch; it does
--  not waive the preconditions. An Admin's direct assignment was therefore
--  performing a dispatch with no contract, no signatures, and no check that
--  the initial 20% was funded — the same class of premature dispatch already
--  removed from the signing RPCs (506000) and the healing trigger (508000).
--
--  ── THE CHANGE ─────────────────────────────────────────────────────────────
--  The 'open' route now GENERATES the contract and stops, returning
--  route='contract_pending' instead of 'dispatch'. Everything else is verbatim:
--  authorization, the reason requirement, the brokered-job refusal, the
--  self-assignment and verification-override checks, the private
--  application_assignment_origin accountability record, the audit correlation
--  and intent, and the replacement route.
--
--  After this call the job is still 'open' with no contractor_id. Dispatch
--  happens later, through admin_dispatch_job, once:
--      • the contract is genuinely fully_executed (both real signatures), and
--      • trg_jobs_dispatch_requires_funding sees the initial 20%, and
--      • trg_jobs_dispatch_requires_contract sees the executed contract.
--
--  ── NOT A WEAKENING ────────────────────────────────────────────────────────
--  Nothing previously refused is now permitted. The RPC does strictly less: it
--  no longer performs a dispatch. No status is faked, no signature is
--  synthesised, and job_contracts.status is never written directly — the
--  contract is created through admin_generate_job_contract in its normal
--  pending_client_signature state.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_assign_inspector_directly(
  p_job_id uuid, p_inspector_id uuid, p_client_price_cents bigint,
  p_inspector_payout_cents bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_job         RECORD;
  v_insp        RECORD;
  v_app_id      uuid;
  v_route       text;
  v_live        int;
  v_actor       uuid := auth.uid();
  v_self        boolean := false;
  v_override    boolean := false;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a non-empty reason is required for a direct assignment' USING errcode = '22023';
  END IF;
  IF p_client_price_cents IS NULL OR p_client_price_cents <= 0
     OR p_inspector_payout_cents IS NULL OR p_inspector_payout_cents <= 0 THEN
    RAISE EXCEPTION 'client price and inspector payout must both be greater than zero' USING errcode = '22023';
  END IF;
  IF p_inspector_payout_cents > p_client_price_cents THEN
    RAISE EXCEPTION 'inspector payout cannot exceed client price' USING errcode = '22023';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  IF v_job.source_rfq_id IS NOT NULL THEN
    RAISE EXCEPTION 'job % is a supplier-RFQ (brokered) job; direct assignment is an Inspection Marketplace operation', p_job_id
      USING errcode = '42501';
  END IF;

  -- The target must be a REAL profile. Arbitrary uuids are still refused.
  SELECT p.id, p.role, COALESCE(p.is_verified, false) AS is_verified
    INTO v_insp
    FROM public.profiles p WHERE p.id = p_inspector_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspector not found' USING errcode = 'P0002';
  END IF;

  v_self     := (p_inspector_id = v_actor);
  v_override := NOT v_insp.is_verified;

  -- ★ OVERRIDE 1 — role. Previously: role had to be inspector|senior.
  --   Now an admin/super_admin may also be the inspector (the admin who
  --   personally performs the inspection). Buyers and suppliers are still
  --   refused: a client account can never become the inspector.
  IF v_insp.role NOT IN ('inspector', 'senior', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'user % cannot be assigned as an inspector (role=%)', p_inspector_id, v_insp.role
      USING errcode = '22023';
  END IF;

  -- ★ OVERRIDE 2 — verification. Previously: hard refusal when not verified.
  --   Now permitted for an admin caller, but ONLY with a stated internal reason,
  --   which is recorded privately below. The reason requirement is the whole
  --   point: the override is accountable, not silent.
  --   NOTE: this relaxation lives here and nowhere else. No policy, trigger or
  --   marketplace application path is changed, so an inspector applying in the
  --   ordinary way still meets every existing verification rule.
  IF (v_override OR v_self) AND length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION
      'an internal reason of at least 10 characters is required when overriding verification or self-assigning'
      USING errcode = '22023';
  END IF;

  -- RETAINED: the buyer may never inspect their own job. This is NOT the
  -- admin self-assignment case — it blocks the job's client/agency only.
  IF p_inspector_id IN (v_job.client_id, v_job.agency_id) THEN
    RAISE EXCEPTION 'the job owner cannot be assigned as its inspector' USING errcode = '42501';
  END IF;
  IF v_job.contractor_id = p_inspector_id THEN
    RAISE EXCEPTION 'inspector % is already assigned to this job', p_inspector_id USING errcode = '22023';
  END IF;

  -- RETAINED: never silently displace a working inspector.
  SELECT count(*) INTO v_live
    FROM public.job_contracts c
   WHERE c.job_id = p_job_id AND c.status <> 'voided';
  IF v_live > 0 THEN
    RAISE EXCEPTION 'job % already has a live contract; void or replace it from the replacement panel first', p_job_id
      USING errcode = '42501';
  END IF;

  PERFORM public.audit_set_correlation(gen_random_uuid());
  PERFORM public.audit_set_intent('Admin direct assignment: ' || btrim(p_reason));
  PERFORM set_config('nexpec.admin_direct_assignment', 'on', true);

  v_app_id := public.nx_admin_upsert_direct_application(
    p_job_id, p_inspector_id, p_inspector_payout_cents
  );

  -- Private accountability record. Admin-only by RLS; never client-visible.
  INSERT INTO public.application_assignment_origin (
    application_id, job_id, inspector_id, assigned_by, reason,
    verification_overridden, self_assigned,
    inspector_was_verified, inspector_role_at_assignment
  ) VALUES (
    v_app_id, p_job_id, p_inspector_id, v_actor, btrim(p_reason),
    v_override, v_self,
    v_insp.is_verified, v_insp.role
  )
  ON CONFLICT (application_id) DO UPDATE
    SET verification_overridden = EXCLUDED.verification_overridden,
        self_assigned           = EXCLUDED.self_assigned,
        inspector_was_verified  = EXCLUDED.inspector_was_verified,
        inspector_role_at_assignment = EXCLUDED.inspector_role_at_assignment,
        reason                  = EXCLUDED.reason;

  -- Delegate. No hire logic is reimplemented here, and the client-facing
  -- workflow is byte-for-byte the ordinary one.
  IF v_job.status = 'open' THEN
    --  Direct assignment STARTS the contract workflow; it does not dispatch.
    --  Previously this delegated straight to admin_dispatch_job, which made an
    --  Admin's direct assignment the dispatch itself — skipping the contract
    --  entirely and, since 20260801504000, being refused by CONTRACT_REQUIRED.
    --
    --  The canonical lifecycle has no exemption for this path: dispatch happens
    --  only once the selected Inspector's contract is genuinely fully_executed
    --  (both real signatures) AND the initial 20% is funded, and only when the
    --  Admin then calls admin_dispatch_job. So this generates the contract and
    --  stops. The job stays 'open' and no contractor_id is written.
    v_route := 'contract_pending';
    PERFORM public.admin_generate_job_contract(
      v_app_id, p_client_price_cents, p_inspector_payout_cents, NULL, NULL
    );
  ELSIF public.nx_job_awaiting_replacement(p_job_id) THEN
    v_route := 'replacement';
    PERFORM public.admin_replace_inspector(
      p_job_id, v_app_id, p_client_price_cents, p_inspector_payout_cents, btrim(p_reason)
    );
  ELSE
    RAISE EXCEPTION 'job % is not in an assignable state (status=%)', p_job_id, v_job.status
      USING errcode = '22023';
  END IF;

  PERFORM set_config('nexpec.admin_direct_assignment', 'off', true);

  -- The return value is consumed ONLY by the admin server action. It never
  -- reaches a client surface.
  RETURN jsonb_build_object(
    'ok',                      true,
    'job_id',                  p_job_id,
    'inspector_id',            p_inspector_id,
    'application_id',          v_app_id,
    'route',                   v_route,
    'verification_overridden', v_override,
    'self_assigned',           v_self
  );
END 
$fn$;

-- ─── Selftest — behavioural ─────────────────────────────────────────────────
DO $selftest$
DECLARE v_src text;
BEGIN
  --  Comments stripped: this migration's own header explains what it removed
  --  and names admin_dispatch_job, which would otherwise match and fail here.
  SELECT regexp_replace(prosrc, '--[^\n]*', ' ', 'g') INTO v_src
    FROM pg_proc WHERE proname='admin_assign_inspector_directly';

  --  It must no longer dispatch on the open route.
  IF v_src ~ 'admin_dispatch_job' THEN
    RAISE EXCEPTION
      'SELFTEST: admin_assign_inspector_directly still calls admin_dispatch_job — direct assignment would still dispatch';
  END IF;

  --  …but it must still START the contract workflow, or the Admin is left with
  --  an application and no route forward.
  IF v_src !~ 'admin_generate_job_contract' THEN
    RAISE EXCEPTION
      'SELFTEST: admin_assign_inspector_directly no longer generates a contract';
  END IF;

  --  And it must never write an executed status itself.
  IF v_src ~ 'fully_executed' THEN
    RAISE EXCEPTION
      'SELFTEST: admin_assign_inspector_directly references fully_executed — it must not fake execution';
  END IF;

  --  The accountability and authorization invariants must survive.
  IF v_src !~ 'application_assignment_origin' OR v_src !~ 'admin only' THEN
    RAISE EXCEPTION 'SELFTEST: an authorization or accountability invariant was lost';
  END IF;

  --  Both dispatch gates still attached.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_jobs_dispatch_requires_contract' AND NOT tgisinternal)
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_jobs_dispatch_requires_funding'  AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: a dispatch gate is missing';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
