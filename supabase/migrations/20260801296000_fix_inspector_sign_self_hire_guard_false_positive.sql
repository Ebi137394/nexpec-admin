-- ════════════════════════════════════════════════════════════════════════════
--  20260801296000_fix_inspector_sign_self_hire_guard_false_positive.sql
--
--  P0 BUG — the inspector can never counter-sign a job contract. The signature
--  submits, nothing is recorded, the contract never reaches fully_executed and
--  the job never reaches in_progress. The client's signature works fine.
--
--  REPRODUCTION (web, LIVE): client signs → inspector opens
--  /inspector/contracts/job/<id> → types their legal name, ticks the terms box,
--  presses "Sign & accept assignment" → returns to the same form, nothing saved.
--
--  ROOT CAUSE — a false positive in the self-hire guard, reached through an
--  UNGUARDED reconciliation UPDATE:
--
--    inspector_sign_job_contract()            [SECURITY DEFINER, auth.uid()=INSPECTOR]
--     └─ UPDATE job_contracts SET status='fully_executed'
--         └─ AFTER UPDATE  heal_contract_on_executed
--             └─ tg_heal_contract_on_executed        ← no EXCEPTION handler
--                 └─ heal_contract_to_active()
--                     ├─ UPDATE jobs …               ← already EXCEPTION-guarded
--                     └─ UPDATE applications SET status='hired'   ← UNGUARDED
--                         └─ BEFORE UPDATE OF status
--                            guard_application_self_transition_trg (20260801234000)
--                              • auth.uid() is the INSPECTOR (SECURITY DEFINER does
--                                NOT clear the JWT claim), so the "trusted context"
--                                bypass `auth.uid() IS NULL` does not apply;
--                              • NEW.applicant_id = auth.uid() — of course it does,
--                                the inspector is the applicant on their own job;
--                              • NEW.status='hired' <> 'withdrawn'
--                              → RAISE EXCEPTION 42501
--                              → the ENTIRE signing transaction rolls back.
--
--  That guard exists to stop a REAL P0: an inspector PATCHing their own
--  application straight to 'accepted' to self-hire with no broker, no contract
--  and no escrow. That protection must stay. What it cannot currently tell apart
--  is the platform promoting the application as a side effect of a contract the
--  ADMIN generated and the CLIENT signed — which is the opposite of self-hire.
--
--  Why only the inspector side breaks: client_sign_job_contract sets
--  'pending_inspector_signature', which never fires heal_contract_on_executed,
--  so the applications row (and the guard) is never touched.
--
--  FIX — two layers:
--    1. ROOT CAUSE. guard_application_self_transition() gains a CONTRACT-BACKED
--       exemption: promoting an application to hired/accepted is allowed when a
--       non-voided, fully-executed job_contract already names this applicant as
--       the inspector for this job. An applicant cannot forge that — only
--       admin_generate_job_contract creates the contract and only the client's
--       signature moves it past pending_client_signature. Every other
--       applicant-initiated status change stays blocked exactly as before.
--    2. DEFENCE IN DEPTH. heal_contract_to_active()'s applications UPDATE is
--       wrapped in an EXCEPTION handler, matching the two jobs UPDATEs beside it
--       that were already guarded. The function is documented as "idempotent
--       reconciliation" — best-effort healing must never roll back the
--       authoritative act (an executed, signed contract). This makes the signing
--       path immune to ANY future application-side guard as well.
--
--  No workflow, RLS policy, RPC signature or status vocabulary changes.
--  Idempotent (CREATE OR REPLACE) + self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Self-hire guard: allow the contract-backed hire ──────────────────────
CREATE OR REPLACE FUNCTION public.guard_application_self_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
BEGIN
  -- Trusted server contexts and admins are exempt (unchanged).
  IF auth.uid() IS NULL OR public.nx_is_admin() THEN
    RETURN NEW;
  END IF;

  -- ★ CONTRACT-BACKED HIRE (this migration): the promotion to hired/accepted is
  --   sanctioned by a fully-executed contract, i.e. an admin generated it AND the
  --   client signed it AND it is not voided. That is the broker path, not a
  --   self-hire — the applicant cannot manufacture such a row. Checked against
  --   the CURRENT transaction, so the inspector's own signature (which sets
  --   job_contracts.status='fully_executed' immediately before the heal runs)
  --   qualifies.
  IF NEW.status IN ('hired', 'accepted')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND EXISTS (
       SELECT 1
         FROM public.job_contracts c
        WHERE c.job_id       = NEW.job_id
          AND c.inspector_id = NEW.applicant_id
          AND c.status       = 'fully_executed'
          AND c.voided_at IS NULL
     )
  THEN
    RETURN NEW;
  END IF;

  -- A user acting on THEIR OWN application may only withdraw it. This blocks
  -- self-hire (accepted/hired/CLIENT_SELECTED set by the applicant themselves).
  -- Buyers nominating an applicant are NOT the applicant (applicant_id differs),
  -- so this does not touch the CLIENT_SELECTED path.
  IF NEW.applicant_id = auth.uid()
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status <> 'withdrawn'
  THEN
    RAISE EXCEPTION
      'an applicant may only withdraw their own application (attempted status=%)', NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_application_self_transition() OWNER TO postgres;

-- ── 2) Reconciliation must never roll back an executed contract ─────────────
--  Byte-for-byte the previous body, except the two applications UPDATEs are now
--  EXCEPTION-guarded (the jobs UPDATEs above them already were).
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

COMMENT ON FUNCTION public.heal_contract_to_active(uuid) IS
  'Idempotent reconciliation: given a fully_executed contract id, ensures jobs.status >= in_progress and applications.status >= hired. Every write is EXCEPTION-guarded — reconciliation is best-effort and must never roll back the executed contract that triggered it.';

-- ── 3) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_guard text := pg_get_functiondef('public.guard_application_self_transition()'::regprocedure);
  v_heal  text := pg_get_functiondef('public.heal_contract_to_active(uuid)'::regprocedure);
  v_apps_body text;
BEGIN
  -- (a) the self-hire protection is still present
  IF position('an applicant may only withdraw their own application' IN v_guard) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: self-hire protection removed from the guard';
  END IF;
  IF position('42501' IN v_guard) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: guard no longer raises 42501 for applicant self-transitions';
  END IF;

  -- (b) the contract-backed exemption is wired and is scoped to executed,
  --     non-voided contracts only (never a blanket bypass)
  IF position('fully_executed' IN v_guard) = 0 OR position('voided_at IS NULL' IN v_guard) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: contract-backed exemption missing or not scoped to executed/non-voided contracts';
  END IF;

  -- (c) the applications heal is now inside an EXCEPTION block
  v_apps_body := substring(v_heal FROM position('Heal applications.status' IN v_heal));
  IF position('EXCEPTION WHEN OTHERS' IN v_apps_body) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: applications heal is still unguarded — an inspector signature can still be rolled back';
  END IF;

  -- (d) the guard trigger is still attached
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.applications'::regclass
       AND tgname  = 'guard_application_self_transition_trg'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: applicant self-transition guard trigger missing';
  END IF;

  RAISE NOTICE 'inspector counter-signature unblocked: contract-backed hires exempt from the self-hire guard; reconciliation can no longer roll back an executed contract.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
