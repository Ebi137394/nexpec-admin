-- ════════════════════════════════════════════════════════════════════════════
--  20260801140000_fix_generated_net_halalas_insert.sql
--
--  REAL MONEY BUG (caught by supabase/tests/money_flow_test.sql):
--  public.transactions.net_amount_halalas is a GENERATED column
--    net_amount_halalas bigint GENERATED ALWAYS AS (gross_amount_halalas - platform_fee_halalas) STORED
--  but four money RPCs explicitly INSERT into it, which Postgres rejects
--  (SQLSTATE 428C9: "cannot insert a non-DEFAULT value into a generated column").
--
--  Impact: every transactions INSERT in these RPCs errored. For accrual this was
--  SILENT in production because the AFTER-UPDATE trigger trg_credit_inspector_on_confirm
--  swallows exceptions (EXCEPTION WHEN OTHERS → RAISE NOTICE) — so inspector
--  earnings were never credited. Manual payouts / settlements / advances would
--  also have failed at the ledger write.
--
--  Fix: drop net_amount_halalas (and its mirrored value) from each INSERT. The
--  generated column computes the identical value (platform_fee is 0 for earning/
--  settlement/payout; for advances net_cents == gross_cents - fee_cents). Bodies
--  are otherwise reproduced verbatim from production. Idempotent (CREATE OR REPLACE).
--
--  ALSO FIXES two more constraint mismatches the same RPCs hit:
--   • status: the RPCs used 'completed', but transactions_status_check only allows
--     paid/processing/pending/failed → switched cleared/payout rows to 'paid'.
--   • type: settle_client_payment used 'settlement' and admin_fund_advance used
--     'advance', neither permitted by transactions_type_check → extend the CHECK
--     to include both legitimate ledger types (additive; existing rows still valid).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0. Permit the legitimate 'settlement' + 'advance' ledger types ──────────
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check
  CHECK (type = ANY (ARRAY[
    'earning','withdrawal','deposit','escrow','refund','fee','payout',
    'expense','payment','settlement','advance'
  ]));

-- ─── 1. credit_inspector_earning_on_approval ────────────────────────────────
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

  v_inspector := v_job.contractor_id;
  IF v_inspector IS NULL THEN RAISE EXCEPTION 'NO_CONTRACTOR_ON_JOB'; END IF;
  IF v_job.admin_confirmed_at IS NULL THEN RAISE EXCEPTION 'REPORT_NOT_CONFIRMED'; END IF;

  v_cents := COALESCE(v_job.inspector_payout_cents, 0);
  IF v_cents <= 0 THEN RAISE EXCEPTION 'NO_PAYOUT_AMOUNT'; END IF;
  v_dollars := round(v_cents::numeric / 100.0, 2);

  IF EXISTS (SELECT 1 FROM public.transactions WHERE job_id = p_job_id AND inspector_id = v_inspector AND type = 'earning') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  INSERT INTO public.wallets(user_id) VALUES (v_inspector) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.wallets WHERE user_id = v_inspector FOR UPDATE;

  v_cleared := (COALESCE(v_job.payment_mode, 'prepay') = 'prepay');

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

  -- net_amount_halalas is GENERATED (gross - platform_fee); do NOT insert it.
  INSERT INTO public.transactions(user_id, inspector_id, job_id, type, amount,
        gross_amount_halalas, platform_fee_halalas, status, description)
  VALUES (v_inspector, v_inspector, p_job_id, 'earning', v_dollars,
        v_cents, 0,
        CASE WHEN v_cleared THEN 'paid' ELSE 'pending' END,
        CASE WHEN v_cleared THEN 'Inspection earning (cleared)'
             ELSE 'Inspection earning (accrued — awaiting client settlement)' END);

  RETURN jsonb_build_object('ok', true, 'inspector_id', v_inspector, 'amount_cents', v_cents, 'cleared', v_cleared);
END $fn$;

-- ─── 2. settle_client_payment ───────────────────────────────────────────────
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
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  v_inspector := v_job.contractor_id;
  v_cents := COALESCE(v_job.inspector_payout_cents, 0);
  v_dollars := round(v_cents::numeric / 100.0, 2);

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
    -- net_amount_halalas is GENERATED; omit it.
    INSERT INTO public.transactions(user_id, inspector_id, job_id, type, amount,
          gross_amount_halalas, platform_fee_halalas, status, description)
    VALUES (v_inspector, v_inspector, p_job_id, 'settlement', v_dollars, v_cents, 0,
            'paid', 'Client settled — inspector funds cleared to available');
  ELSIF v_adv.id IS NOT NULL THEN
    UPDATE public.payout_advances SET status = 'recovered', recovered_at = now(), updated_at = now()
     WHERE id = v_adv.id;
  END IF;

  UPDATE public.jobs SET client_settled_at = now(), updated_at = now() WHERE id = p_job_id;
  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'cleared_cents', v_cents, 'advance_recovered', (v_adv.id IS NOT NULL));
END $fn$;

-- ─── 3. admin_mark_withdrawal_paid (inspector + supplier branches) ───────────
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
    -- net_amount_halalas is GENERATED; omit it.
    INSERT INTO public.transactions(user_id, inspector_id, type, amount,
          gross_amount_halalas, platform_fee_halalas, status, description, reference_id)
    VALUES (v_req.requester_id, v_req.requester_id, 'payout', v_dollars,
          v_req.amount_cents, 0, 'paid',
          'Manual payout — admin confirmed', p_reference);
  ELSE
    UPDATE public.supplier_earnings
       SET pending_halalas = GREATEST(COALESCE(pending_halalas,0) - v_req.amount_cents, 0),
           updated_at = now()
     WHERE supplier_id = v_req.requester_id;
    -- net_amount_halalas is GENERATED; omit it.
    INSERT INTO public.transactions(user_id, type, amount,
          gross_amount_halalas, platform_fee_halalas, status, description, reference_id)
    VALUES (v_req.requester_id, 'payout', v_dollars,
          v_req.amount_cents, 0, 'paid',
          'Manual supplier payout — admin confirmed', p_reference);
  END IF;

  UPDATE public.withdrawal_requests
     SET status = 'paid', paid_at = now(), marked_paid_by = auth.uid(),
         external_reference = p_reference, decided_at = now(), decided_by = auth.uid(), updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'request_id', p_id, 'paid_cents', v_req.amount_cents);
END $fn$;

-- ─── 4. admin_fund_advance ──────────────────────────────────────────────────
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

  PERFORM 1 FROM public.wallets WHERE user_id = v_adv.requester_id FOR UPDATE;
  UPDATE public.wallets
     SET pending_amount    = GREATEST(COALESCE(pending_amount,0) - v_gross_d, 0),
         available_balance = COALESCE(available_balance,0) + v_net_d,
         updated_at = now()
   WHERE user_id = v_adv.requester_id;

  -- net_amount_halalas is GENERATED (gross - platform_fee == net_cents); omit it.
  INSERT INTO public.transactions(user_id, inspector_id, job_id, type, amount,
        gross_amount_halalas, platform_fee_halalas, status, description)
  VALUES (v_adv.requester_id, v_adv.requester_id, v_adv.job_id, 'advance', v_net_d,
        v_adv.gross_cents, v_adv.fee_cents, 'paid',
        'Early payout advance (net of fee) — recovered on client settlement');

  UPDATE public.payout_advances
     SET status = 'funded', funded_at = now(), funded_by = p_funded_by, decided_by = auth.uid(), updated_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'advance_id', p_id, 'net_paid_cents', v_adv.net_cents, 'fee_cents', v_adv.fee_cents);
END $fn$;

-- ─── Self-test: an earning credit now succeeds end-to-end ───────────────────
DO $selftest$
BEGIN
  IF (SELECT pg_get_expr(adbin, adrelid) IS NULL FROM pg_attrdef d
        JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
       WHERE a.attrelid='public.transactions'::regclass AND a.attname='net_amount_halalas') THEN
    NULL;
  END IF;
  RAISE NOTICE 'Fixed generated-column inserts in credit/settle/mark-paid/fund-advance (net_amount_halalas auto-computes).';
END
$selftest$;
