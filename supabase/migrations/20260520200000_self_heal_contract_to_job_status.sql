-- ════════════════════════════════════════════════════════════════════════════
--  20260520200000_self_heal_contract_to_job_status.sql
--
--  PRODUCTION BUG FIX — UX/Data Black Hole
--
--  Symptom:
--    A job whose contract is `fully_executed` (all three signatures landed)
--    vanishes from the inspector's "Active Assignments" board — not in the
--    pipeline, not in In Progress, not in Completed.
--
--  Root cause:
--    The active-assignments fetcher reads from `applications` filtered to
--    status IN ('hired', 'accepted'). When the contract is born via the
--    counter-offer flow (inspector accepts admin's counter → admin issues
--    contract immediately), nothing bumps `applications.status` to 'hired'
--    or 'accepted'. The row stays at 'pending' / 'shortlisted' and the
--    fetcher silently drops it.
--
--    Additionally: `inspector_sign_job_contract` only bumps `jobs.status`
--    from 'assigned' → 'in_progress'. If the job sat in any other pre-
--    execution state at the moment of signature (e.g. 'awarded',
--    'pending_approval'), the bump is a no-op and the job lingers
--    invisibly.
--
--  Fix (architectural):
--    A `fully_executed` contract is the SOURCE OF TRUTH that the inspector
--    is hired and the job is active. Encode that invariant in the database
--    with a trigger so EVERY path that writes a fully_executed contract —
--    RPC, admin override, future migration, manual DBA fix-up — self-heals
--    the two satellite tables.
--
--  Three pieces:
--    1. Idempotent helper function  public.heal_contract_to_active(p_id)
--       — given a contract id, ensures its job is at least 'in_progress'
--         (unless already past — completed / disputed / cancelled stay)
--       — ensures its linked application is 'hired'
--    2. AFTER-UPDATE trigger on job_contracts firing on status →
--       'fully_executed' that calls the helper.
--    3. One-shot backfill that runs the helper on every existing
--       fully_executed contract — rescues prod orphans.
--
--  This is strictly defensive. It never DOWNGRADES a status. Jobs that
--  legitimately moved past 'in_progress' (completed, disputed, cancelled)
--  are left alone. Applications that already say 'hired' / 'accepted' are
--  left alone. Re-firing the trigger on the same contract is a no-op.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Helper: reconcile both satellite rows from a fully_executed contract
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.heal_contract_to_active(p_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_c   RECORD;
  v_job RECORD;
BEGIN
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RETURN;  -- nothing to heal
  END IF;

  -- Only act on fully-executed, non-voided contracts.
  IF v_c.status IS DISTINCT FROM 'fully_executed' THEN
    RETURN;
  END IF;
  IF v_c.voided_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- ── Heal jobs.status ────────────────────────────────────────────────
  -- Promote any pre-execution state to 'in_progress'. We intentionally
  -- list each acceptable pre-state so a typo on the jobs.status guard
  -- trigger surfaces here instead of silently no-op'ing. Statuses past
  -- 'in_progress' (completed / disputed / cancelled / refunded) are
  -- terminal and must never be regressed.
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
      -- If a guard trigger rejects the leap (e.g. open → in_progress is
      -- forbidden), step through 'assigned' first then retry.
      BEGIN
        UPDATE public.jobs SET
          status             = 'assigned',
          hired_inspector_id = COALESCE(hired_inspector_id, v_c.inspector_id),
          updated_at         = NOW()
        WHERE id = v_c.job_id AND status IN ('open', 'awarded', 'pending_approval', 'pending_review', 'draft', 'review');

        UPDATE public.jobs SET
          status                 = 'in_progress',
          hired_inspector_id     = COALESCE(hired_inspector_id, v_c.inspector_id),
          inspector_payout_cents = COALESCE(inspector_payout_cents, v_c.inspector_payout_cents),
          payout_amount_cents    = COALESCE(payout_amount_cents,    v_c.inspector_payout_cents),
          client_price_cents     = COALESCE(client_price_cents,     v_c.client_price_cents),
          updated_at             = NOW()
        WHERE id = v_c.job_id AND status = 'assigned';
      EXCEPTION WHEN OTHERS THEN
        -- Give up silently rather than block the contract — the broadened
        -- fetcher will still surface the job via the contracts view.
        RAISE NOTICE 'heal_contract_to_active: could not advance jobs.status for job_id=%', v_c.job_id;
      END;
    END;
  END IF;

  -- ── Heal applications.status ────────────────────────────────────────
  -- Bump the linked application to 'hired' if it isn't already at a
  -- post-hire state. This is what the assignments fetcher reads.
  IF v_c.application_id IS NOT NULL THEN
    UPDATE public.applications
       SET status     = 'hired',
           hired_at   = COALESCE(hired_at, NOW()),
           updated_at = NOW()
     WHERE id = v_c.application_id
       AND status NOT IN ('hired', 'accepted', 'completed', 'cancelled', 'rejected');
  ELSE
    -- No direct application link? Best-effort heal by (job_id, inspector_id).
    UPDATE public.applications
       SET status     = 'hired',
           hired_at   = COALESCE(hired_at, NOW()),
           updated_at = NOW()
     WHERE job_id      = v_c.job_id
       AND applicant_id = v_c.inspector_id
       AND status NOT IN ('hired', 'accepted', 'completed', 'cancelled', 'rejected');
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.heal_contract_to_active(uuid) TO authenticated;
COMMENT ON FUNCTION public.heal_contract_to_active(uuid) IS
  'Idempotent reconciliation: given a fully_executed contract id, ensures jobs.status >= in_progress and applications.status >= hired. Used by the AFTER-UPDATE trigger and the one-shot backfill in the same migration.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Trigger: fire heal_contract_to_active whenever a contract becomes
--    fully_executed (transition from any other state).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_heal_contract_on_executed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $tg$
BEGIN
  -- Only react to the transition INTO fully_executed.
  IF NEW.status = 'fully_executed'
     AND (OLD.status IS DISTINCT FROM 'fully_executed')
  THEN
    PERFORM public.heal_contract_to_active(NEW.id);
  END IF;
  RETURN NEW;
END
$tg$;

DROP TRIGGER IF EXISTS heal_contract_on_executed ON public.job_contracts;
CREATE TRIGGER heal_contract_on_executed
  AFTER UPDATE OF status ON public.job_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_heal_contract_on_executed();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Backfill: rescue every existing fully_executed contract whose
--    satellite rows weren't reconciled. This is the part that makes
--    "testing this job in the website 2" reappear immediately upon
--    deployment without touching the row by hand.
-- ─────────────────────────────────────────────────────────────────────────
DO $backfill$
DECLARE
  r RECORD;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.job_contracts
    WHERE status = 'fully_executed'
      AND voided_at IS NULL
  LOOP
    PERFORM public.heal_contract_to_active(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'self_heal_backfill: reconciled % fully_executed contracts', n;
END
$backfill$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY — run this after deployment. Every fully_executed contract
-- should show its job at in_progress (or terminal) and its application
-- at hired/accepted (or terminal).
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT
--   c.id            AS contract_id,
--   c.status        AS contract_status,
--   j.status        AS job_status,
--   a.status        AS application_status,
--   c.client_signed_at  IS NOT NULL AS client_signed,
--   c.inspector_signed_at IS NOT NULL AS inspector_signed
-- FROM public.job_contracts c
-- JOIN public.jobs j         ON j.id = c.job_id
-- LEFT JOIN public.applications a ON a.id = c.application_id
-- WHERE c.status = 'fully_executed'
--   AND c.voided_at IS NULL
-- ORDER BY c.updated_at DESC;
