-- ════════════════════════════════════════════════════════════════════════════
--  20260801420000_stripe_settlement_is_not_completion.sql
--
--  P0-2. The Stripe payments webhook calls stripe_complete_job, which is NOT
--  defined anywhere in supabase/migrations. It lives in a loose file at the
--  repository root (20260512130000_stripe_complete_job_rpc.sql), alongside 50
--  other stray .sql files. `supabase db push` never applies it, so the canonical
--  deployable schema does not contain the function the live payment webhook
--  depends on.
--
--  ── THE INVESTIGATION, BEFORE ANY CODE ─────────────────────────────────────
--  The instruction was to check whether an equivalent canonical function
--  already exists before copying anything forward. It does:
--
--      public.settle_client_payment(p_job_id uuid)
--          -> 20260801140000_fix_generated_net_halalas_insert.sql
--
--  It is the real settlement path. It sets jobs.client_settled_at, clears
--  inspector funds Pending -> Available on net_terms, recovers a funded
--  payout_advance, is idempotent on client_settled_at, and — decisively —
--  it NEVER touches jobs.status.
--
--  So this is not a missing function. It is a SUPERSEDED one, and the loose
--  copy carries semantics that are actively wrong:
--
--      stripe_complete_job:  payment succeeded  =>  jobs.status := 'completed'
--
--  That conflates "the client's money arrived" with "the inspection work is
--  operationally finished". They are different facts about different parties at
--  different times. A prepaid job is funded BEFORE anyone drives to site; under
--  the loose function, paying up front would mark the job completed before the
--  inspector had started. Preserving that for compatibility would cement a
--  lifecycle defect into canonical schema.
--
--  This migration therefore does NOT copy the loose file forward. It defines a
--  Stripe-facing wrapper with the correct separation and delegates the actual
--  settlement to the canonical function, so there is exactly one place that
--  knows how settlement works.
--
--      PAYMENT / FUNDING STATE   ->  jobs.client_settled_at   (this migration)
--      OPERATIONAL COMPLETION    ->  jobs.status              (untouched here)
--
--  ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
--  No automatic inspector payout. No automatic job completion. No change to
--  manual Treasury settlement. No new payment architecture — settlement effect
--  is delegated, not reimplemented. jobs.status is never written.
--
--  Terminal-state money is NOT silently swallowed: a PaymentIntent that lands
--  on a cancelled or disputed job records a CRITICAL audit event flagging a
--  refund, and deliberately does not settle.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_stripe_settle_job(
  p_job_id             uuid,
  p_payment_intent_id  text,
  p_amount_cents       bigint,
  p_transaction_ref_id text,
  p_correlation_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job    public.jobs%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Service-role only. The webhook is the sole caller; a logged-in user must
  -- never be able to declare their own job funded. auth.uid() IS NULL is the
  -- service-role signature used by settle_client_payment itself.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_payment_intent_id IS NULL OR length(trim(p_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'payment_intent_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive' USING ERRCODE = '22000';
  END IF;
  IF p_transaction_ref_id IS NULL OR length(trim(p_transaction_ref_id)) = 0 THEN
    RAISE EXCEPTION 'transaction_ref_id is required' USING ERRCODE = '22000';
  END IF;

  -- Serialise against any other writer on this job.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % not found', p_job_id USING ERRCODE = 'P0002';
  END IF;

  -- ── Idempotency: Stripe retries, and it retries on success too ────────────
  IF v_job.client_settled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true, 'job_id', p_job_id,
      'settled_at', v_job.client_settled_at, 'status_changed', false);
  END IF;

  -- ── Money landed on a job nobody can deliver ──────────────────────────────
  -- Record loudly, settle nothing. A human decides the refund.
  IF v_job.status IN ('cancelled', 'disputed') THEN
    INSERT INTO public.audit_events (
      event_type, severity, subject_table, subject_id, job_id,
      summary, delta, metadata, correlation_id
    ) VALUES (
      'stripe_payment_on_terminal_job', 'critical', 'jobs', p_job_id, p_job_id,
      'PaymentIntent succeeded for a job in terminal state (' || v_job.status
        || ') — REFUND REQUIRED. Job NOT settled.',
      '{}'::jsonb,
      jsonb_build_object(
        'payment_intent_id',  p_payment_intent_id,
        'amount_cents',       p_amount_cents,
        'transaction_ref_id', p_transaction_ref_id,
        'job_status',         v_job.status),
      p_correlation_id
    );
    RETURN jsonb_build_object(
      'ok', false, 'refund_required', true, 'job_id', p_job_id,
      'job_status', v_job.status, 'status_changed', false);
  END IF;

  -- ── Settle. Delegated, never reimplemented ────────────────────────────────
  -- settle_client_payment owns what settlement MEANS: client_settled_at, the
  -- net_terms Pending -> Available clearing, and payout_advance recovery. It is
  -- SECURITY DEFINER and admits auth.uid() IS NULL, which is what we are.
  v_result := public.settle_client_payment(p_job_id);

  INSERT INTO public.audit_events (
    event_type, severity, subject_table, subject_id, job_id,
    summary, delta, metadata, correlation_id
  ) VALUES (
    'stripe_job_settled', 'info', 'jobs', p_job_id, p_job_id,
    'Client payment settled via Stripe. Funding state only — job status unchanged.',
    '{}'::jsonb,
    jsonb_build_object(
      'payment_intent_id',  p_payment_intent_id,
      'amount_cents',       p_amount_cents,
      'transaction_ref_id', p_transaction_ref_id,
      'payment_mode',       COALESCE(v_job.payment_mode, 'prepay'),
      'job_status',         v_job.status,
      'settlement_result',  v_result),
    p_correlation_id
  );

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'job_id', p_job_id,
    'settlement', v_result, 'status_changed', false);
END $fn$;

ALTER FUNCTION public.nx_stripe_settle_job(uuid, text, bigint, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_stripe_settle_job(uuid, text, bigint, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_stripe_settle_job(uuid, text, bigint, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.nx_stripe_settle_job(uuid, text, bigint, text, uuid) IS
  'Canonical Stripe payment -> FUNDING STATE for a job. Replaces the loose, unmigrated stripe_complete_job, which set jobs.status = ''completed'' when a PaymentIntent succeeded and so conflated the client paying with the inspection being operationally finished. This function writes funding state ONLY (jobs.client_settled_at, via the canonical settle_client_payment) and NEVER writes jobs.status. Idempotent on client_settled_at because Stripe retries successful deliveries. Money arriving on a cancelled or disputed job is recorded as a CRITICAL audit event flagging a refund and is deliberately not settled. service_role only: a logged-in caller must never be able to declare their own job funded. No automatic inspector payout — payout remains manual.';

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.settle_client_payment(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ORDERING: settle_client_payment must exist (20260801140000) before 420000';
  END IF;

  v_src := pg_get_functiondef('public.nx_stripe_settle_job(uuid,text,bigint,text,uuid)'::regprocedure);

  -- The defect this migration exists to not repeat.
  IF v_src ~* 'UPDATE\s+public\.jobs\s+SET[^;]*\bstatus\b' THEN
    RAISE EXCEPTION
      'SELFTEST: nx_stripe_settle_job writes jobs.status — payment must never imply operational completion';
  END IF;

  IF has_function_privilege('authenticated',
       'public.nx_stripe_settle_job(uuid,text,bigint,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: nx_stripe_settle_job is callable by authenticated — a client could self-declare funding';
  END IF;
  IF has_function_privilege('anon',
       'public.nx_stripe_settle_job(uuid,text,bigint,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: nx_stripe_settle_job is reachable by anon';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.nx_stripe_settle_job(uuid,text,bigint,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: service_role cannot execute nx_stripe_settle_job — the webhook is dead';
  END IF;

  -- No automatic payout may be introduced here.
  IF v_src ~* 'payout_status\s*=|payout_paid_at\s*=' THEN
    RAISE EXCEPTION 'SELFTEST: nx_stripe_settle_job touches payout state — payout must remain manual';
  END IF;
END
$selftest$;

COMMIT;
