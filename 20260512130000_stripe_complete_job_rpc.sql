-- ════════════════════════════════════════════════════════════════════════════
--  20260512130000_stripe_complete_job_rpc.sql
--  NEXPEC — STRIPE-005 strike: transactional job completion from payment webhook.
--
--  Background
--  ──────────
--  After STRIPE-003/004 hardened the create-payment-intent endpoint, a
--  Stripe `payment_intent.succeeded` event still has no server-side
--  handler. That means money lands in the platform's Stripe balance,
--  but `jobs.status` never advances to `completed`, and the audit
--  trail has zero record that the charge cleared. This RPC closes
--  that loop.
--
--  Contract
--  ────────
--  stripe_complete_job(p_job_id, p_payment_intent_id, p_amount_cents,
--                      p_transaction_ref_id, p_correlation_id)
--
--    Inputs (all required except correlation):
--      p_job_id              uuid   — jobs.id (read from PI metadata.job_id)
--      p_payment_intent_id   text   — Stripe pi_* (recorded in audit metadata)
--      p_amount_cents        bigint — captured amount (cross-checked vs job)
--      p_transaction_ref_id  uuid   — minted at PI creation, in PI metadata
--      p_correlation_id      uuid   — optional; grouping in audit trail
--
--    Returns: jsonb {
--      ok: boolean,
--      job_id: uuid,
--      previous_status: text,
--      new_status: text,
--      already_completed: boolean,    -- true if RPC was a no-op
--      correlation_id: uuid,
--      mismatch_warnings: jsonb       -- non-fatal divergences (e.g. amount drift)
--    }
--
--  Hard guarantees
--  ───────────────
--    1. SECURITY DEFINER + REVOKE from public/authenticated. Only
--       service_role (Edge Functions) can call it. The webhook owns
--       this surface end-to-end.
--    2. SELECT ... FOR UPDATE on jobs.id — two concurrent webhook
--       deliveries (e.g. payment_intent.processing chasing
--       payment_intent.succeeded) cannot both advance state.
--    3. Idempotent at the business level. If jobs.status is already
--       'completed', the RPC short-circuits with already_completed=true
--       and writes a single audit event recording the duplicate receipt
--       attempt. (Webhook-layer idempotency is already enforced by the
--       stripe_webhook_events ledger; this is belt-and-braces for the
--       case where two distinct Stripe events for the same PI arrive.)
--    4. Refuses to overwrite terminal/abnormal states. If a job is
--       'cancelled' or 'disputed' when the success webhook fires, the
--       RPC raises a critical audit event and returns ok=false without
--       mutating state. Operations team reconciles manually.
--    5. Audit-correlated. Sets audit_set_intent + audit_set_correlation
--       so the job.completed event written by the audit_capture trigger
--       inherits a human-readable intent ("Stripe payment captured") and
--       a grouping id that links it to the webhook delivery.
--
--  Notes on schema discipline (Principle #5)
--  ──────────────────────────────────────────
--  This migration does NOT add columns to jobs. We considered jobs.paid_at
--  / jobs.stripe_payment_intent_id, but those would be invented schema
--  with downstream consequences (RLS, indexes, code paths). The audit
--  trail IS the source of truth for "this PI succeeded for this job" —
--  every transition writes a row keyed on job_id with the PI id and
--  amount embedded in metadata. A future strike can promote those into
--  first-class columns once the data shape stabilises.
--
--  Reversible. Down path at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  UP
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.stripe_complete_job(
  p_job_id              uuid,
  p_payment_intent_id   text,
  p_amount_cents        bigint,
  p_transaction_ref_id  uuid,
  p_correlation_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job              public.jobs%ROWTYPE;
  v_correlation      uuid := COALESCE(p_correlation_id, gen_random_uuid());
  v_previous_status  text;
  v_new_status       text;
  v_already_done     boolean := false;
  v_warnings         jsonb   := '{}'::jsonb;
  v_intent_summary   text;
BEGIN
  -- ── 1. Input validation ───────────────────────────────────────────
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_payment_intent_id IS NULL OR length(trim(p_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'payment_intent_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive' USING ERRCODE = '22000';
  END IF;
  IF p_transaction_ref_id IS NULL THEN
    RAISE EXCEPTION 'transaction_ref_id is required' USING ERRCODE = '22000';
  END IF;

  -- ── 2. Lock the job row ───────────────────────────────────────────
  -- FOR UPDATE serialises this against any other writer on the same
  -- row, including the Spread Editor's admin_dispatch_job.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % not found', p_job_id USING ERRCODE = 'P0002';
  END IF;

  v_previous_status := v_job.status;

  -- ── 3. Cross-check captured amount vs job's canonical price ───────
  -- Non-fatal mismatch flag — if these diverge it usually means an
  -- admin changed jobs.client_price_cents AFTER the PI was created.
  -- We record the divergence in metadata so ops can reconcile. The
  -- Stripe captured amount is authoritative for what was actually
  -- charged; we don't roll back the completion.
  IF v_job.client_price_cents IS DISTINCT FROM p_amount_cents THEN
    v_warnings := v_warnings || jsonb_build_object(
      'amount_mismatch', jsonb_build_object(
        'job_client_price_cents',   v_job.client_price_cents,
        'stripe_captured_cents',    p_amount_cents
      )
    );
  END IF;

  -- ── 4. Audit grouping (Phase 5 integration) ───────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  v_intent_summary := 'Stripe payment captured (pi=' || p_payment_intent_id || ')';
  PERFORM public.audit_set_intent(v_intent_summary);

  -- ── 5. State-machine dispatch ─────────────────────────────────────
  -- Five cases:
  --   (a) already completed              → idempotent no-op + audit log
  --   (b) cancelled / disputed (terminal-ish) → refuse, raise critical
  --   (c) assigned / in_progress         → advance to completed
  --   (d) other unexpected status        → refuse, raise critical
  --
  -- The audit_capture trigger on jobs writes job.completed
  -- automatically when status transitions to 'completed'; we don't
  -- need to call it manually.

  IF v_previous_status = 'completed' THEN
    -- (a) Already done. Webhook retry or duplicate event.
    v_already_done := true;
    v_new_status   := 'completed';

    -- Touch updated_at on jobs to leave a footprint without changing
    -- semantically meaningful columns. The trigger fires as 'job.updated'
    -- and we override the intent with the duplicate-receipt language.
    -- Actually — we DON'T want a phantom 'job.updated' on every
    -- duplicate Stripe retry. The stripe_webhook_events ledger already
    -- catches retries of the SAME event_id; this branch only fires when
    -- DIFFERENT events for the same PI hit (e.g. processing then
    -- succeeded). One audit breadcrumb is appropriate.
    INSERT INTO public.audit_events (
      event_type,
      severity,
      actor_id,
      actor_role,
      actor_label,
      subject_table,
      subject_id,
      job_id,
      summary,
      delta,
      metadata,
      correlation_id
    ) VALUES (
      'job.payment_receipt_duplicate',
      'info',
      NULL,
      'system',
      'Stripe webhook',
      'jobs',
      v_job.id,
      'Duplicate payment success received for already-completed job',
      '{}'::jsonb,
      jsonb_build_object(
        'intent',              v_intent_summary,
        'payment_intent_id',   p_payment_intent_id,
        'transaction_ref_id',  p_transaction_ref_id,
        'amount_cents',        p_amount_cents,
        'warnings',            v_warnings
      ),
      v_correlation
    );

  ELSIF v_previous_status IN ('cancelled', 'disputed') THEN
    -- (b) Refuse. Money cleared on a job that was killed off platform-side.
    -- This is an operations incident — money in escrow with no payable
    -- counterparty. Log critical and bail without mutating state.
    INSERT INTO public.audit_events (
      event_type,
      severity,
      actor_id,
      actor_role,
      actor_label,
      subject_table,
      subject_id,
      job_id,
      summary,
      delta,
      metadata,
      correlation_id
    ) VALUES (
      'job.payment_on_terminal_state',
      'critical',
      NULL,
      'system',
      'Stripe webhook',
      'jobs',
      v_job.id,
      'Payment succeeded for job in terminal state (' || v_previous_status || ') — REFUND REQUIRED',
      '{}'::jsonb,
      jsonb_build_object(
        'intent',              v_intent_summary,
        'payment_intent_id',   p_payment_intent_id,
        'transaction_ref_id',  p_transaction_ref_id,
        'amount_cents',        p_amount_cents,
        'job_status',          v_previous_status,
        'warnings',            v_warnings
      ),
      v_correlation
    );

    RETURN jsonb_build_object(
      'ok',                 false,
      'job_id',             v_job.id,
      'previous_status',    v_previous_status,
      'new_status',         v_previous_status,
      'already_completed',  false,
      'correlation_id',     v_correlation,
      'mismatch_warnings',  v_warnings,
      'error',              'Job is in terminal state; payment requires manual refund.'
    );

  ELSIF v_previous_status IN ('assigned', 'in_progress') THEN
    -- (c) Advance to completed. The audit_capture trigger emits
    -- 'job.completed' automatically because of the status change.
    UPDATE public.jobs
    SET status     = 'completed',
        updated_at = now()
    WHERE id = v_job.id;

    -- Layer a money-specific audit event on top of the trigger's
    -- status-change event. The trigger's event records WHAT changed;
    -- this one records WHY (Stripe payment), with the PI metadata.
    INSERT INTO public.audit_events (
      event_type,
      severity,
      actor_id,
      actor_role,
      actor_label,
      subject_table,
      subject_id,
      job_id,
      summary,
      delta,
      metadata,
      correlation_id
    ) VALUES (
      'job.payment_succeeded',
      'info',
      NULL,
      'system',
      'Stripe webhook',
      'jobs',
      v_job.id,
      'Client payment captured: $'
        || to_char(p_amount_cents::numeric / 100, 'FM999G999G999D00'),
      '{}'::jsonb,
      jsonb_build_object(
        'intent',              v_intent_summary,
        'payment_intent_id',   p_payment_intent_id,
        'transaction_ref_id',  p_transaction_ref_id,
        'amount_cents',        p_amount_cents,
        'previous_status',     v_previous_status,
        'warnings',            v_warnings
      ),
      v_correlation
    );

    v_new_status := 'completed';

  ELSE
    -- (d) Unexpected state (e.g. 'open', 'pending', or future status).
    -- Don't quietly mutate; log + refuse so ops can investigate.
    INSERT INTO public.audit_events (
      event_type,
      severity,
      actor_id,
      actor_role,
      actor_label,
      subject_table,
      subject_id,
      job_id,
      summary,
      delta,
      metadata,
      correlation_id
    ) VALUES (
      'job.payment_on_unexpected_state',
      'critical',
      NULL,
      'system',
      'Stripe webhook',
      'jobs',
      v_job.id,
      'Payment succeeded but job status was ' || v_previous_status || ' — manual review required',
      '{}'::jsonb,
      jsonb_build_object(
        'intent',              v_intent_summary,
        'payment_intent_id',   p_payment_intent_id,
        'transaction_ref_id',  p_transaction_ref_id,
        'amount_cents',        p_amount_cents,
        'job_status',          v_previous_status,
        'warnings',            v_warnings
      ),
      v_correlation
    );

    RETURN jsonb_build_object(
      'ok',                 false,
      'job_id',             v_job.id,
      'previous_status',    v_previous_status,
      'new_status',         v_previous_status,
      'already_completed',  false,
      'correlation_id',     v_correlation,
      'mismatch_warnings',  v_warnings,
      'error',              'Job is not in a payable state; payment requires manual reconciliation.'
    );
  END IF;

  -- ── 6. Success summary ────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                 true,
    'job_id',             v_job.id,
    'previous_status',    v_previous_status,
    'new_status',         v_new_status,
    'already_completed',  v_already_done,
    'correlation_id',     v_correlation,
    'mismatch_warnings',  v_warnings
  );
END;
$$;

COMMENT ON FUNCTION public.stripe_complete_job(uuid, text, bigint, uuid, uuid) IS
  'STRIPE-005: Transactional job completion from Stripe payment_intent.succeeded webhook. Service-role only. Locks the job, refuses terminal/unexpected states, idempotent on already-completed jobs. Writes a job.payment_succeeded audit event with PI metadata for the Industrial Black Box.';

-- Lock down the surface. Only service_role (Edge Functions) calls this.
REVOKE EXECUTE ON FUNCTION public.stripe_complete_job(uuid, text, bigint, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stripe_complete_job(uuid, text, bigint, uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.stripe_complete_job(uuid, text, bigint, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.stripe_complete_job(uuid, text, bigint, uuid, uuid) TO service_role;

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. Function exists with the expected signature
-- SELECT pg_get_functiondef(p.oid)
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname='public' AND p.proname='stripe_complete_job';

-- B. Privilege lockdown — service_role only
-- SELECT grantee, privilege_type
-- FROM information_schema.routine_privileges
-- WHERE routine_schema='public' AND routine_name='stripe_complete_job';
-- Expected: only service_role with EXECUTE

-- C. Idempotency on already-completed job
-- BEGIN;
--   -- pick any job currently in 'assigned' or 'in_progress':
--   -- SELECT id, status FROM jobs WHERE status IN ('assigned','in_progress') LIMIT 1;
--   --
--   -- first call should advance to completed:
--   SELECT public.stripe_complete_job(
--     '<job-uuid>',
--     'pi_test_smoke',
--     12345,
--     gen_random_uuid(),
--     NULL
--   );
--   -- second call (same job) should return already_completed=true
--   SELECT public.stripe_complete_job(
--     '<job-uuid>',
--     'pi_test_smoke',
--     12345,
--     gen_random_uuid(),
--     NULL
--   );
-- ROLLBACK;
-- Expected: first call ok=true, new_status='completed';
--           second call ok=true, already_completed=true, new_status='completed'

-- D. Refusal on terminal state
-- BEGIN;
--   -- temporarily mark a job 'cancelled' (rollback at end):
--   -- UPDATE jobs SET status='cancelled' WHERE id='<job-uuid>';
--   SELECT public.stripe_complete_job(
--     '<job-uuid>',
--     'pi_test_terminal',
--     12345,
--     gen_random_uuid(),
--     NULL
--   );
-- ROLLBACK;
-- Expected: ok=false, error mentions terminal state, audit_events
--           gets one row of type 'job.payment_on_terminal_state' severity 'critical'


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback — Supabase CLI does not auto-execute down sections)
-- ────────────────────────────────────────────────────────────────────────────
--  Copy/paste the block below into the SQL editor if a rollback is needed.
--
--  BEGIN;
--    DROP FUNCTION IF EXISTS public.stripe_complete_job(uuid, text, bigint, uuid, uuid);
--  COMMIT;
