-- ════════════════════════════════════════════════════════════════════════════
--  20260801137000_money_flow_phase2_rpcs.sql   (PHASE 2 — money RPCs)
--
--  Internal-ledger escrow + 100% MANUAL payouts. Single-currency. All wallet
--  amounts are numeric MAJOR units (dollars, 2dp); jobs are integer cents, so
--  conversion is strictly cents/100.0 (mirrors the live debit_wallet_for_payout).
--  Inspector is ALWAYS routed via jobs.contractor_id. NO automated Stripe payouts
--  and NO FX (halalas/fx subsystem untouched).
--
--  Wallet buckets (confirmed live):
--    available_balance — cleared, withdrawable
--    pending_amount    — accrued earnings not yet cleared (net_terms)
--    pending_payouts   — funds reserved by an open withdrawal request (in flight)
--    total_earned      — lifetime gross
--
--  Flow:
--    report admin_confirmed  → credit inspector (prepay→available, net_terms→pending)
--    client settles          → pending → available (or recover a funded advance)
--    inspector requests payout → reserve: available → pending_payouts (+ row)
--    admin "Mark as Paid"     → pending_payouts -= amt (money wired OUTSIDE) + ledger
--    admin "Reject"           → pending_payouts → available (return funds)
--    advance (Option C)       → fund net-of-fee from pending now; recovered on settle
--
--  All RPCs SECURITY DEFINER + SET search_path; FOR UPDATE locks; idempotent.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ─── 0. Version the existing (live-only) inspector debit primitive ───────────
--   Verbatim from the live definition so a fresh rebuild has it. CREATE OR
--   REPLACE preserves existing grants.
CREATE OR REPLACE FUNCTION public.debit_wallet_for_payout(p_user_id uuid, p_amount_cents bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_balance NUMERIC;
  v_amount_dollars NUMERIC;
  v_txn_id UUID;
BEGIN
  v_amount_dollars := p_amount_cents::numeric / 100.0;
  SELECT available_balance INTO v_balance FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_balance < v_amount_dollars THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: % < %', v_balance, v_amount_dollars USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.wallets SET available_balance = available_balance - v_amount_dollars, updated_at = now()
   WHERE user_id = p_user_id;
  INSERT INTO public.transactions (user_id, type, amount, gross_amount_halalas, platform_fee_halalas, status, description, created_at)
  VALUES (p_user_id, 'payout', v_amount_dollars, p_amount_cents, 0, 'processing', 'Stripe Connect payout to bank', now())
  RETURNING id INTO v_txn_id;
  RETURN v_txn_id;
END $fn$;

-- ─── 1. Credit inspector earning on report approval ─────────────────────────
CREATE OR REPLACE FUNCTION public.credit_inspector_earning_on_approval(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_inspector uuid;
  v_cents bigint;
  v_dollars numeric(12,2);
  v_cleared boolean;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  v_inspector := v_job.contractor_id;                 -- canonical inspector link
  IF v_inspector IS NULL THEN RAISE EXCEPTION 'NO_CONTRACTOR_ON_JOB'; END IF;
  IF v_job.admin_confirmed_at IS NULL THEN RAISE EXCEPTION 'REPORT_NOT_CONFIRMED'; END IF;

  v_cents := COALESCE(v_job.inspector_payout_cents, 0);
  IF v_cents <= 0 THEN RAISE EXCEPTION 'NO_PAYOUT_AMOUNT'; END IF;
  v_dollars := round(v_cents::numeric / 100.0, 2);

  -- Idempotency: exactly one earning credit per job.
  IF EXISTS (SELECT 1 FROM public.transactions WHERE job_id = p_job_id AND inspector_id = v_inspector AND type = 'earning') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  INSERT INTO public.wallets(user_id) VALUES (v_inspector) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.wallets WHERE user_id = v_inspector FOR UPDATE;

  v_cleared := (COALESCE(v_job.payment_mode, 'prepay') = 'prepay');  -- prepay already funded

  IF v_cleared THEN
    UPDATE public.wallets
       SET available_balance = COALESCE(available_balance,0) + v_dollars,
           total_earned      = COALESCE(total_earned,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_inspector;
  ELSE
    UPDATE public.wallets
       SET pending_amount = COALESCE(pending_amount,0) + v_dollars,
           total_earned   = COALESCE(total_earned,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_inspector;
  END IF;

  INSERT INTO public.transactions(user_id, inspector_id, job_id, type, amount,
        gross_amount_halalas, platform_fee_halalas, net_amount_halalas, status, description)
  VALUES (v_inspector, v_inspector, p_job_id, 'earning', v_dollars,
        v_cents, 0, v_cents,
        CASE WHEN v_cleared THEN 'completed' ELSE 'pending' END,
        CASE WHEN v_cleared THEN 'Inspection earning (cleared)'
             ELSE 'Inspection earning (accrued — awaiting client settlement)' END);

  RETURN jsonb_build_object('ok', true, 'inspector_id', v_inspector, 'amount_cents', v_cents, 'cleared', v_cleared);
END $fn$;

-- ─── 1b. Trigger: auto-credit on the admin_confirmed_at transition ──────────
CREATE OR REPLACE FUNCTION public.tg_credit_inspector_on_confirm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.admin_confirmed_at IS NOT NULL AND OLD.admin_confirmed_at IS NULL THEN
    PERFORM public.credit_inspector_earning_on_approval(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_credit_inspector_on_confirm(%): %', NEW.id, SQLERRM;  -- never block confirm; idempotent re-run available
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_credit_inspector_on_confirm ON public.jobs;
CREATE TRIGGER trg_credit_inspector_on_confirm
  AFTER UPDATE OF admin_confirmed_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_credit_inspector_on_confirm();

-- ─── 2. Client settlement: Pending → Available (net_terms gate) ─────────────
CREATE OR REPLACE FUNCTION public.settle_client_payment(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_inspector uuid;
  v_cents bigint;
  v_dollars numeric(12,2);
  v_adv public.payout_advances%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_job.client_settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);  -- already settled
  END IF;

  v_inspector := v_job.contractor_id;
  v_cents := COALESCE(v_job.inspector_payout_cents, 0);
  v_dollars := round(v_cents::numeric / 100.0, 2);

  -- If an advance was already funded for this job, the inspector was paid net
  -- early from pending; settling just recovers it (platform keeps the client cash).
  SELECT * INTO v_adv FROM public.payout_advances
    WHERE job_id = p_job_id AND status = 'funded' ORDER BY funded_at DESC LIMIT 1;

  IF v_inspector IS NOT NULL AND v_cents > 0 AND v_adv.id IS NULL
     AND COALESCE(v_job.payment_mode,'prepay') = 'net_terms' THEN
    INSERT INTO public.wallets(user_id) VALUES (v_inspector) ON CONFLICT (user_id) DO NOTHING;
    PERFORM 1 FROM public.wallets WHERE user_id = v_inspector FOR UPDATE;
    UPDATE public.wallets
       SET pending_amount    = GREATEST(COALESCE(pending_amount,0) - v_dollars, 0),
           available_balance = COALESCE(available_balance,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_inspector;
    INSERT INTO public.transactions(user_id, inspector_id, job_id, type, amount,
          gross_amount_halalas, platform_fee_halalas, net_amount_halalas, status, description)
    VALUES (v_inspector, v_inspector, p_job_id, 'settlement', v_dollars, v_cents, 0, v_cents,
            'completed', 'Client settled — inspector funds cleared to available');
  ELSIF v_adv.id IS NOT NULL THEN
    UPDATE public.payout_advances SET status = 'recovered', recovered_at = now(), updated_at = now()
     WHERE id = v_adv.id;
  END IF;

  UPDATE public.jobs SET client_settled_at = now(), updated_at = now() WHERE id = p_job_id;
  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'cleared_cents', v_cents, 'advance_recovered', (v_adv.id IS NOT NULL));
END $fn$;

-- ─── 3. Inspector/Supplier requests a manual payout (reserves the funds) ─────
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount_cents bigint,
  p_method       text DEFAULT 'bank_transfer',
  p_note         text DEFAULT NULL,
  p_client_op_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_kind text;
  v_dollars numeric(12,2);
  v_avail numeric;
  v_avail_h bigint;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_method NOT IN ('bank_transfer','stripe_manual','other') THEN RAISE EXCEPTION 'INVALID_METHOD'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role = 'inspector' THEN v_kind := 'inspector';
  ELSIF v_role = 'supplier' THEN v_kind := 'supplier';
  ELSE RAISE EXCEPTION 'NOT_ELIGIBLE_FOR_PAYOUT'; END IF;

  -- Idempotent replay.
  IF p_client_op_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.withdrawal_requests WHERE client_op_id = p_client_op_id;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'request_id', v_id); END IF;
  END IF;

  -- One open request at a time (also enforced by a partial unique index).
  IF EXISTS (SELECT 1 FROM public.withdrawal_requests WHERE requester_id = v_uid AND status IN ('requested','approved')) THEN
    RAISE EXCEPTION 'OPEN_REQUEST_EXISTS';
  END IF;

  v_dollars := round(p_amount_cents::numeric / 100.0, 2);

  IF v_kind = 'inspector' THEN
    INSERT INTO public.wallets(user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
    SELECT available_balance INTO v_avail FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
    IF COALESCE(v_avail,0) < v_dollars THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.wallets
       SET available_balance = available_balance - v_dollars,
           pending_payouts   = COALESCE(pending_payouts,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_uid;
  ELSE  -- supplier ledger (halalas minor units)
    SELECT available_balance_halalas INTO v_avail_h FROM public.supplier_earnings WHERE supplier_id = v_uid FOR UPDATE;
    IF COALESCE(v_avail_h,0) < p_amount_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.supplier_earnings
       SET available_balance_halalas = available_balance_halalas - p_amount_cents,
           pending_halalas           = COALESCE(pending_halalas,0) + p_amount_cents,
           updated_at = now()
     WHERE supplier_id = v_uid;
  END IF;

  INSERT INTO public.withdrawal_requests(requester_id, requester_role, amount_cents, status, method, destination_note, client_op_id)
  VALUES (v_uid, v_kind, p_amount_cents, 'requested', p_method, p_note, p_client_op_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'request_id', v_id, 'reserved_cents', p_amount_cents);
END $fn$;

-- ─── 4. Admin marks a payout PAID (money wired OUTSIDE the platform) ─────────
CREATE OR REPLACE FUNCTION public.admin_mark_withdrawal_paid(p_id uuid, p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_req public.withdrawal_requests%ROWTYPE;
  v_dollars numeric(12,2);
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_req FROM public.withdrawal_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_req.status = 'paid' THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'request_id', p_id); END IF;
  IF v_req.status NOT IN ('requested','approved') THEN RAISE EXCEPTION 'INVALID_STATE: %', v_req.status; END IF;

  v_dollars := round(v_req.amount_cents::numeric / 100.0, 2);

  IF v_req.requester_role = 'inspector' THEN
    UPDATE public.wallets
       SET pending_payouts = GREATEST(COALESCE(pending_payouts,0) - v_dollars, 0),
           total_spent     = COALESCE(total_spent,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_req.requester_id;
    INSERT INTO public.transactions(user_id, inspector_id, type, amount,
          gross_amount_halalas, platform_fee_halalas, net_amount_halalas, status, description, reference_id)
    VALUES (v_req.requester_id, v_req.requester_id, 'payout', v_dollars,
          v_req.amount_cents, 0, v_req.amount_cents, 'completed',
          'Manual payout — admin confirmed', p_reference);
  ELSE
    UPDATE public.supplier_earnings
       SET pending_halalas = GREATEST(COALESCE(pending_halalas,0) - v_req.amount_cents, 0),
           updated_at = now()
     WHERE supplier_id = v_req.requester_id;
    INSERT INTO public.transactions(user_id, type, amount,
          gross_amount_halalas, platform_fee_halalas, net_amount_halalas, status, description, reference_id)
    VALUES (v_req.requester_id, 'payout', v_dollars,
          v_req.amount_cents, 0, v_req.amount_cents, 'completed',
          'Manual supplier payout — admin confirmed', p_reference);
  END IF;

  UPDATE public.withdrawal_requests
     SET status = 'paid', paid_at = now(), marked_paid_by = auth.uid(),
         external_reference = p_reference, decided_at = now(), decided_by = auth.uid(), updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'request_id', p_id, 'paid_cents', v_req.amount_cents);
END $fn$;

-- ─── 5. Admin rejects a payout (returns the reserved funds) ──────────────────
CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(p_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_req public.withdrawal_requests%ROWTYPE;
  v_dollars numeric(12,2);
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_req FROM public.withdrawal_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_req.status IN ('rejected','cancelled') THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'request_id', p_id); END IF;
  IF v_req.status NOT IN ('requested','approved') THEN RAISE EXCEPTION 'INVALID_STATE: %', v_req.status; END IF;

  v_dollars := round(v_req.amount_cents::numeric / 100.0, 2);

  IF v_req.requester_role = 'inspector' THEN
    UPDATE public.wallets
       SET pending_payouts   = GREATEST(COALESCE(pending_payouts,0) - v_dollars, 0),
           available_balance = COALESCE(available_balance,0) + v_dollars,
           updated_at = now()
     WHERE user_id = v_req.requester_id;
  ELSE
    UPDATE public.supplier_earnings
       SET pending_halalas           = GREATEST(COALESCE(pending_halalas,0) - v_req.amount_cents, 0),
           available_balance_halalas = available_balance_halalas + v_req.amount_cents,
           updated_at = now()
     WHERE supplier_id = v_req.requester_id;
  END IF;

  UPDATE public.withdrawal_requests
     SET status = 'rejected', reject_reason = p_reason, decided_at = now(), decided_by = auth.uid(), updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'request_id', p_id, 'returned_cents', v_req.amount_cents);
END $fn$;

-- ─── 6. Option C: inspector requests an early-payout advance (no money moves) ─
CREATE OR REPLACE FUNCTION public.request_payout_advance(p_job_id uuid, p_fee_bps int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_gross bigint;
  v_fee bigint;
  v_net bigint;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000'; END IF;
  IF p_fee_bps < 0 OR p_fee_bps > 10000 THEN RAISE EXCEPTION 'INVALID_FEE'; END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_job.contractor_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'NOT_YOUR_JOB' USING ERRCODE = '42501'; END IF;
  IF v_job.admin_confirmed_at IS NULL THEN RAISE EXCEPTION 'NOT_YET_EARNED'; END IF;
  IF COALESCE(v_job.payment_mode,'prepay') <> 'net_terms' OR v_job.client_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'ADVANCE_NOT_APPLICABLE';  -- only on accrued, not-yet-settled net_terms jobs
  END IF;

  v_gross := COALESCE(v_job.inspector_payout_cents, 0);
  IF v_gross <= 0 THEN RAISE EXCEPTION 'NO_ACCRUED_AMOUNT'; END IF;
  v_fee := round(v_gross::numeric * p_fee_bps / 10000.0)::bigint;
  v_net := v_gross - v_fee;
  IF v_net <= 0 THEN RAISE EXCEPTION 'FEE_EXCEEDS_AMOUNT'; END IF;

  IF EXISTS (SELECT 1 FROM public.payout_advances WHERE job_id = p_job_id AND status IN ('requested','approved','funded')) THEN
    RAISE EXCEPTION 'ADVANCE_ALREADY_OPEN';
  END IF;

  INSERT INTO public.payout_advances(requester_id, requester_role, job_id, gross_cents, fee_bps, fee_cents, net_cents, status)
  VALUES (v_uid, 'inspector', p_job_id, v_gross, p_fee_bps, v_fee, v_net, 'requested')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'advance_id', v_id, 'gross_cents', v_gross, 'fee_cents', v_fee, 'net_cents', v_net);
END $fn$;

-- ─── 7. Admin funds an advance: pays NET now from the accrued (pending) bucket ─
CREATE OR REPLACE FUNCTION public.admin_fund_advance(p_id uuid, p_funded_by text DEFAULT 'platform')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_adv public.payout_advances%ROWTYPE;
  v_gross_d numeric(12,2);
  v_net_d numeric(12,2);
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_funded_by NOT IN ('platform','partner') THEN RAISE EXCEPTION 'INVALID_FUNDER'; END IF;

  SELECT * INTO v_adv FROM public.payout_advances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADVANCE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_adv.status = 'funded' THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'advance_id', p_id); END IF;
  IF v_adv.status NOT IN ('requested','approved') THEN RAISE EXCEPTION 'INVALID_STATE: %', v_adv.status; END IF;

  v_gross_d := round(v_adv.gross_cents::numeric / 100.0, 2);
  v_net_d   := round(v_adv.net_cents::numeric / 100.0, 2);

  -- Consume the accrued (pending) amount; pay the inspector NET into available now.
  -- The fee (gross - net) is retained by the platform as advance revenue.
  PERFORM 1 FROM public.wallets WHERE user_id = v_adv.requester_id FOR UPDATE;
  UPDATE public.wallets
     SET pending_amount    = GREATEST(COALESCE(pending_amount,0) - v_gross_d, 0),
         available_balance = COALESCE(available_balance,0) + v_net_d,
         updated_at = now()
   WHERE user_id = v_adv.requester_id;

  INSERT INTO public.transactions(user_id, inspector_id, job_id, type, amount,
        gross_amount_halalas, platform_fee_halalas, net_amount_halalas, status, description)
  VALUES (v_adv.requester_id, v_adv.requester_id, v_adv.job_id, 'advance', v_net_d,
        v_adv.gross_cents, v_adv.fee_cents, v_adv.net_cents, 'completed',
        'Early payout advance (net of fee) — recovered on client settlement');

  UPDATE public.payout_advances
     SET status = 'funded', funded_at = now(), funded_by = p_funded_by, decided_by = auth.uid(), updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'advance_id', p_id, 'net_paid_cents', v_adv.net_cents, 'fee_cents', v_adv.fee_cents);
END $fn$;

-- ─── Grants: revoke PUBLIC default, expose intentionally ─────────────────────
REVOKE ALL ON FUNCTION public.credit_inspector_earning_on_approval(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.credit_inspector_earning_on_approval(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_client_payment(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.settle_client_payment(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal(bigint, text, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_withdrawal(bigint, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_mark_withdrawal_paid(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_mark_withdrawal_paid(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_reject_withdrawal(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reject_withdrawal(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.request_payout_advance(uuid, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_payout_advance(uuid, int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fund_advance(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_fund_advance(uuid, text) TO authenticated;

-- ─── Self-test ──────────────────────────────────────────────────────────────
DO $do$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.credit_inspector_earning_on_approval(uuid)',
    'public.settle_client_payment(uuid)',
    'public.request_withdrawal(bigint,text,text,uuid)',
    'public.admin_mark_withdrawal_paid(uuid,text)',
    'public.admin_reject_withdrawal(uuid,text)',
    'public.request_payout_advance(uuid,int)',
    'public.admin_fund_advance(uuid,text)',
    'public.debit_wallet_for_payout(uuid,bigint)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN RAISE EXCEPTION 'SELFTEST: % missing', v_fn; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_credit_inspector_on_confirm' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: confirm-credit trigger missing';
  END IF;
  RAISE NOTICE 'Phase 2 money RPCs ready: accrual+settle, manual request/mark-paid/reject, advance request/fund. Routing via jobs.contractor_id; single-currency cents/100.';
END $do$;

COMMIT;
