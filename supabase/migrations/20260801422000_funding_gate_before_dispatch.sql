-- ════════════════════════════════════════════════════════════════════════════
--  20260801422000_funding_gate_before_dispatch.sql
--
--  P0-1. Today an inspector can be dispatched to site with no client money
--  confirmed. I checked every lifecycle RPC — admin_dispatch_job,
--  inspector_start_job, mark_job_completed, client_sign_job_contract,
--  inspector_sign_job_contract — and not one of them references payment,
--  escrow, Stripe or funded state. admin_dispatch_job takes p_payout_status
--  defaulting to 'unpaid' and assigns the contractor regardless.
--
--  So the inspection is performed entirely on credit: NEXPEC pays a real
--  inspector to travel and work before it holds anything from the buyer.
--
--  ── NO SECOND PAYMENT ARCHITECTURE ─────────────────────────────────────────
--  Everything this gate needs already exists and is reused verbatim:
--
--    jobs.payment_mode                    'prepay' | 'net_terms'
--                                         (jobs_payment_mode_chk, baseline)
--    jobs.client_settled_at               'When the client actually paid
--                                          NEXPEC' (baseline comment). Written
--                                          canonically by settle_client_payment
--                                          and, for Stripe, by
--                                          nx_stripe_settle_job (20260801420000).
--    profiles.client_credit_limit_cents   'Max outstanding (invoiced-but-
--                                          unsettled) net_terms exposure NEXPEC
--                                          will extend this client.
--                                          0 = no credit (prepay only).'
--    nx_job_buyer_principal(job_id)       the existing buyer-principal resolver
--
--  No new column. No new table. No new payment concept.
--
--  ── THE RULE ───────────────────────────────────────────────────────────────
--      prepay     -> jobs.client_settled_at IS NOT NULL
--                    the client's money is actually in.
--      net_terms  -> the buyer principal holds an authorised credit line
--                    (client_credit_limit_cents > 0). This is precisely what
--                    that column was defined to mean: 0 = no credit, prepay
--                    only. A net_terms job for a zero-limit buyer is not an
--                    enterprise arrangement, it is an unfunded job wearing a
--                    different label.
--      anything else -> refuse. UNKNOWN FAILS CLOSED.
--
--  jobs.client_invoiced_at was considered for the net_terms signal and
--  rejected: nothing anywhere in the schema ever writes it. Gating dispatch on
--  a column no code sets would block every net_terms job forever.
--
--  ── WHY A TRIGGER AND NOT AN EDIT TO admin_dispatch_job ────────────────────
--  20260801412000 set the precedent for exactly this shape of rule: "Structural,
--  so it binds PostgREST and any future writer, not just an RPC." A gate that
--  lives inside one RPC is bypassed by the next writer, by a direct PostgREST
--  PATCH, or by a second dispatch path added later. This binds the transition
--  itself. It is also far smaller than re-emitting the 124-line baseline RPC.
--
--  Fires on the moment of dispatch, defined as either half of it:
--    * status entering 'assigned', or
--    * contractor_id going from NULL to set  (direct assignment)
--
--  ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
--  No percentage split — no 50/50, no 30/70, nothing deposit-shaped. That is a
--  commercial decision and this migration deliberately does not pre-empt it;
--  it establishes only the binary "is this job funded enough to send a human".
--  No automatic payout. No report-approval payout trigger. No change to manual
--  Treasury settlement. No existing row is touched, no backfill.
--
--  Service-role/postgres is NOT exempt. guard_jobs_status_transition exempts
--  them because orchestration RPCs legitimately move status; but "we are the
--  backend" is not evidence that a client paid, and the Stripe webhook (the one
--  service_role caller that matters here) settles funding rather than
--  dispatching. Exempting service_role would leave the hole open to the exact
--  automated paths most likely to widen it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_guard_dispatch_requires_funding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_mode       text;
  v_dispatch   boolean;
  v_buyer      uuid;
  v_limit      bigint;
BEGIN
  -- Is this UPDATE a dispatch? Either half counts.
  v_dispatch :=
       (NEW.status = 'assigned' AND OLD.status IS DISTINCT FROM 'assigned')
    OR (NEW.contractor_id IS NOT NULL AND OLD.contractor_id IS NULL);

  IF NOT v_dispatch THEN
    RETURN NEW;
  END IF;

  v_mode := COALESCE(NEW.payment_mode, 'prepay');

  -- ── PREPAY: the money must actually be in ─────────────────────────────────
  IF v_mode = 'prepay' THEN
    IF NEW.client_settled_at IS NULL THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is prepay and has no confirmed client payment (jobs.client_settled_at IS NULL). Dispatching would send an inspector to site against nothing.',
        NEW.id
        USING ERRCODE = '22000',
              HINT = 'Client payment settles through the Stripe webhook (nx_stripe_settle_job) or settle_client_payment. Confirm funding, then dispatch.';
    END IF;
    RETURN NEW;
  END IF;

  -- ── NET_TERMS: an authorised credit line must exist ───────────────────────
  IF v_mode = 'net_terms' THEN
    v_buyer := public.nx_job_buyer_principal(NEW.id);

    IF v_buyer IS NULL THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is net_terms but has no resolvable buyer principal, so no credit authority can be established.',
        NEW.id
        USING ERRCODE = '22000';
    END IF;

    SELECT COALESCE(p.client_credit_limit_cents, 0) INTO v_limit
      FROM public.profiles p WHERE p.id = v_buyer;

    IF COALESCE(v_limit, 0) <= 0 THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is net_terms but buyer principal % holds no authorised credit line (profiles.client_credit_limit_cents = 0 means prepay only).',
        NEW.id, v_buyer
        USING ERRCODE = '22000',
              HINT = 'Grant an explicit credit limit to the buyer, or set the job to prepay and collect payment.';
    END IF;

    RETURN NEW;
  END IF;

  -- ── UNKNOWN MODE: fail closed ─────────────────────────────────────────────
  RAISE EXCEPTION
    'FUNDING_REQUIRED: job % has unrecognised payment_mode %; refusing dispatch rather than guessing that it is funded.',
    NEW.id, v_mode
    USING ERRCODE = '22000';
END $fn$;

ALTER FUNCTION public.nx_guard_dispatch_requires_funding() OWNER TO postgres;

COMMENT ON FUNCTION public.nx_guard_dispatch_requires_funding() IS
  'BEFORE UPDATE trigger on jobs. Refuses dispatch (status -> assigned, or contractor_id NULL -> set) unless the job is funded for its payment_mode: prepay requires jobs.client_settled_at; net_terms requires the buyer principal to hold profiles.client_credit_limit_cents > 0, which is exactly what that column was defined to mean. Unknown payment_mode fails closed. Structural, so it binds PostgREST and any future writer rather than a single RPC. Deliberately does NOT exempt service_role: being the backend is not evidence that a client paid. Enforces no percentage split and triggers no payout.';

DROP TRIGGER IF EXISTS trg_jobs_dispatch_requires_funding ON public.jobs;
CREATE TRIGGER trg_jobs_dispatch_requires_funding
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_dispatch_requires_funding();

-- ── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.nx_job_buyer_principal(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ORDERING: nx_job_buyer_principal must exist before 422000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND column_name = 'client_credit_limit_cents'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: profiles.client_credit_limit_cents is missing — the net_terms credit authority does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'jobs'
       AND column_name = 'client_settled_at'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: jobs.client_settled_at is missing — the prepay funding signal does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_jobs_dispatch_requires_funding'
       AND tgrelid = 'public.jobs'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'SELFTEST: the funding gate trigger is not installed on public.jobs';
  END IF;

  v_src := pg_get_functiondef('public.nx_guard_dispatch_requires_funding()'::regprocedure);

  -- The gate must never become a payout path.
  IF v_src ~* 'payout_status\s*=|payout_paid_at\s*=|INSERT\s+INTO\s+public\.(wallets|transactions)' THEN
    RAISE EXCEPTION 'SELFTEST: the funding gate writes payout/wallet state — it must only refuse or permit';
  END IF;

  -- It must not have quietly acquired a service_role escape hatch.
  IF v_src ~* 'service_role' THEN
    RAISE EXCEPTION 'SELFTEST: the funding gate exempts service_role — being the backend is not proof of payment';
  END IF;

  -- Both modes must be handled explicitly.
  IF strpos(v_src, 'client_settled_at') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the gate does not check the prepay funding signal';
  END IF;
  IF strpos(v_src, 'client_credit_limit_cents') = 0 THEN
    RAISE EXCEPTION 'SELFTEST: the gate does not check the net_terms credit authority';
  END IF;
END
$selftest$;

COMMIT;
