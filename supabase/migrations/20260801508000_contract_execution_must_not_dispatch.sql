-- ════════════════════════════════════════════════════════════════════════════
--  20260801508000_contract_execution_must_not_dispatch.sql
--
--  P0, third and final auto-dispatch path.
--
--  20260801506000 stopped the two signing RPCs from promoting a job to
--  'assigned'. The canonical fixture still failed with
--      'Job is not in open state (current: assigned)'
--  because a THIRD path does it: the trigger heal_contract_on_executed fires
--  when a contract reaches 'fully_executed' and calls heal_contract_to_active,
--  whose pre-assignment branch promotes the job to 'assigned'.
--
--  Enumerated exhaustively rather than guessed — every function in public that
--  writes a jobs.status = 'assigned' SET item:
--      admin_dispatch_job        (correct: this IS dispatch)
--      assign_job_contractor     (the legacy direct-assign RPC)
--      heal_contract_to_active   (this one)
--
--  ── THE CHANGE ─────────────────────────────────────────────────────────────
--  Only the status write in the PRE-ASSIGNMENT branch is removed. Everything
--  else is kept verbatim, including hired_inspector_id, the payout and price
--  reconciliation, and the entire already-assigned branch — which is genuine
--  post-dispatch healing and is untouched.
--
--  The function keeps its name and its healing purpose. What it may no longer
--  do is manufacture a dispatch: under the canonical lifecycle the Admin
--  performs the final assignment, after Client selection, full contract
--  execution AND the initial 20% funding — three preconditions a contract
--  signature satisfies exactly one of.
--
--  ── NOT A WEAKENING ────────────────────────────────────────────────────────
--  Removing an automatic promotion narrows what the system does by itself. The
--  job now stays 'open' until admin_dispatch_job runs, and that path is gated
--  by trg_jobs_dispatch_requires_funding and
--  trg_jobs_dispatch_requires_contract. Nothing that was previously refused is
--  now permitted.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.heal_contract_to_active(p_contract_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
          -- status promotion REMOVED (20260801508000): executing a contract
          -- must not dispatch. Money and binding are still reconciled below;
          -- only admin_dispatch_job may set the job to assigned.
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

$fn$;

-- ─── Selftest ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_bad text;
BEGIN
  --  No function may promote a job to 'assigned' except the dispatch RPCs.
  --  A SET-list item ends in a comma; `AND status = 'assigned'` in a WHERE
  --  clause does not, so the comma distinguishes a write from a filter.
  FOR v_bad IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname NOT IN ('admin_dispatch_job','assign_job_contractor')
       AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~ 'status\s*=\s*''assigned''\s*,'
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % promotes a job to assigned — only the dispatch RPCs may do that', v_bad;
  END LOOP;

  --  The healing purpose must survive: the already-assigned branch still
  --  reconciles, so this is not a silent deletion of the function's job.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='heal_contract_to_active'
                  AND prosrc ~ 'hired_inspector_id') THEN
    RAISE EXCEPTION 'SELFTEST: heal_contract_to_active no longer reconciles the assignment';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_jobs_dispatch_requires_contract' AND NOT tgisinternal)
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_jobs_dispatch_requires_funding'  AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: a dispatch gate is missing';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
