-- ════════════════════════════════════════════════════════════════════════════
--  20260801510000_contract_heal_must_not_prehire_application.sql
--
--  P0, fourth and last auto-dispatch artifact.
--
--  After 506000 and 508000 the fixture failed with
--      'Application is not in CLIENT_SELECTED state (current: hired)'
--  heal_contract_to_active also promotes applications.status to 'hired' when a
--  contract executes, pre-empting step 7 of admin_dispatch_job — which is the
--  only place that promotion belongs, because it is the moment the Admin
--  actually brokers the assignment.
--
--  The effect was the same class of bug as the jobs promotion: executing a
--  contract silently completed a step the Admin is supposed to perform, and
--  then blocked the Admin from performing it.
--
--  ── THE CHANGE ─────────────────────────────────────────────────────────────
--  The application heal is not removed — it is SCOPED. Both UPDATEs now
--  additionally require the job to be genuinely dispatched:
--      j.status = 'assigned' AND j.contractor_id IS NOT NULL
--  so post-dispatch reconciliation (the function's real purpose, repairing
--  applications whose status drifted after a legitimate dispatch) still works,
--  while a contract that merely became executed can no longer hire anybody.
--
--  contractor_id is required as well as status, deliberately: status alone can
--  be 'assigned' transiently, and contractor_id is the field that actually
--  means an inspector was dispatched.
--
--  The EXCEPTION guard around this block is preserved verbatim — an
--  application-side rejection must never roll back the executed contract that
--  triggered the heal.
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
         AND status NOT IN ('hired','accepted','completed','cancelled','rejected')
         AND EXISTS (SELECT 1 FROM public.jobs j
                      WHERE j.id = v_c.job_id
                        AND j.status = 'assigned'
                        AND j.contractor_id IS NOT NULL);
    ELSE
      UPDATE public.applications
         SET status     = 'hired',
             hired_at   = COALESCE(hired_at, NOW()),
             updated_at = NOW()
       WHERE job_id       = v_c.job_id
         AND applicant_id = v_c.inspector_id
         AND status NOT IN ('hired','accepted','completed','cancelled','rejected')
         AND EXISTS (SELECT 1 FROM public.jobs j
                      WHERE j.id = v_c.job_id
                        AND j.status = 'assigned'
                        AND j.contractor_id IS NOT NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'heal_contract_to_active: could not advance applications.status for contract_id=% (%)',
      p_contract_id, SQLERRM;
  END;
END;


$fn$;

DO $selftest$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='heal_contract_to_active'
                  AND prosrc ~ 'j\.contractor_id IS NOT NULL') THEN
    RAISE EXCEPTION
      'SELFTEST: the application heal is not scoped to dispatched jobs — executing a contract could still hire';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='heal_contract_to_active'
                  AND prosrc ~ 'EXCEPTION') THEN
    RAISE EXCEPTION 'SELFTEST: the best-effort EXCEPTION guard was lost';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
