-- ════════════════════════════════════════════════════════════════════════════
--  20260719120000_financial_lockdown.sql
--
--  LOCK DOWN THE MONEY LAYER. Two shipped holes let ANY user credit their own
--  wallet with no payment (a "+$5000" cheat button + an AddFundsModal that did
--  `wallets.update({ balance: balance + amount })` against a fake "Demo" card).
--  Both were neutralized client-side; this closes the ROOT CAUSE at the database
--  so client-side minting is impossible regardless of app code, and makes the
--  withdrawal path safe for the offline outbox (at-least-once delivery).
--
--  Live schema was pulled from Supabase and is reproduced here (these four
--  objects existed in prod but had NO migration). See [[project_financial_security_crisis]].
--
--  WHAT THIS DOES
--  ──────────────
--   1. Versions wallets / transactions / job_expenses (CREATE TABLE IF NOT EXISTS
--      → no-op on prod, gives fresh dev/CI rebuilds a baseline). FK constraints
--      omitted to avoid fresh-build ordering failures — prod keeps its real FKs.
--   2. transactions gains `client_op_id` + a partial unique index (idempotency).
--   3. wallets RLS: ENABLE + drop ALL existing policies + owner-SELECT only +
--      REVOKE writes. Balance now changes ONLY through SECURITY DEFINER RPCs,
--      which run as the table owner and bypass (non-forced) RLS.
--   4. transactions RLS: same lock — the ledger is server-write-only.
--   5. job_expenses RLS: inspector owns their own rows (these ARE user-authored,
--      unlike a balance) + job parties / admin can read.
--   6. process_withdrawal: DROP the non-idempotent 2-arg version, CREATE a 3-arg
--      version that is ATOMIC (FOR UPDATE), IDEMPOTENT (p_client_op_id), and
--      sets the NON-NULL *_halalas columns the old body omitted.
--
--  SAFETY: every step is idempotent / re-runnable. nx_is_admin() is a pre-existing
--  helper. The 2-arg → 3-arg signature change is why we DROP+CREATE (a bare
--  CREATE OR REPLACE would leave the old non-idempotent overload callable).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. Version the previously-unversioned financial tables ════════════════════
CREATE TABLE IF NOT EXISTS public.wallets (
  user_id           uuid PRIMARY KEY,
  balance           numeric,
  currency          text,
  updated_at        timestamptz,
  available_balance numeric,
  total_earned      numeric,
  pending_amount    numeric,
  escrow_amount     numeric,
  total_spent       numeric,
  total_volume      numeric,
  agency_revenue    numeric,
  pending_payouts   numeric
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,
  amount               numeric NOT NULL,
  type                 text NOT NULL,
  description          text,
  job_id               uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  organization_id      uuid,
  project_id           uuid,
  category             text,
  date                 timestamptz,
  status               text,
  inspector_id         uuid,
  gross_amount_halalas int8 NOT NULL DEFAULT 0,
  platform_fee_halalas int8 NOT NULL DEFAULT 0,
  net_amount_halalas   int8,
  metadata             jsonb,
  reference_id         text
);

CREATE TABLE IF NOT EXISTS public.job_expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL,
  inspector_id uuid NOT NULL,
  description  text NOT NULL,
  amount       numeric NOT NULL,
  receipt_url  text,
  status       text DEFAULT 'pending',
  created_at   timestamptz DEFAULT now()
);

-- ═══ 2. Idempotency key on transactions (outbox at-least-once) ═════════════════
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS client_op_id text;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_client_op_id_key
  ON public.transactions (client_op_id) WHERE client_op_id IS NOT NULL;
COMMENT ON COLUMN public.transactions.client_op_id IS
  'Offline-outbox idempotency key — unique when present so an at-least-once retry of process_withdrawal dedups to one ledger row (20260719).';

-- ═══ 3. wallets — balance is SERVER-ONLY ══════════════════════════════════════
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.wallets'::regclass LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.wallets', p.polname);
  END LOOP;
END $$;
CREATE POLICY wallets_select_self ON public.wallets
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY wallets_select_admin ON public.wallets
  FOR SELECT TO authenticated USING (public.nx_is_admin());
-- No INSERT/UPDATE/DELETE policy → all client writes denied. SECURITY DEFINER
-- RPCs (owner) bypass non-forced RLS, so process_withdrawal still works.
REVOKE INSERT, UPDATE, DELETE ON public.wallets FROM anon, authenticated;

-- ═══ 4. transactions — ledger is SERVER-WRITE-ONLY ════════════════════════════
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.transactions'::regclass LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', p.polname);
  END LOOP;
END $$;
CREATE POLICY transactions_select_self ON public.transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR inspector_id = auth.uid());
CREATE POLICY transactions_select_admin ON public.transactions
  FOR SELECT TO authenticated USING (public.nx_is_admin());
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM anon, authenticated;

-- ═══ 5. job_expenses — inspector owns their own (user-authored, not a balance) ═
ALTER TABLE public.job_expenses ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.job_expenses'::regclass LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.job_expenses', p.polname);
  END LOOP;
END $$;
CREATE POLICY job_expenses_self_all ON public.job_expenses
  FOR ALL TO authenticated
  USING (inspector_id = auth.uid()) WITH CHECK (inspector_id = auth.uid());
CREATE POLICY job_expenses_select_job_parties ON public.job_expenses
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_expenses.job_id
                 AND (j.client_id = auth.uid() OR j.contractor_id = auth.uid())));
CREATE POLICY job_expenses_admin_read ON public.job_expenses
  FOR SELECT TO authenticated USING (public.nx_is_admin());

-- ═══ 6. process_withdrawal — atomic + idempotent + fee-complete ═══════════════
DROP FUNCTION IF EXISTS public.process_withdrawal(numeric, jsonb);

CREATE FUNCTION public.process_withdrawal(
  p_amount        numeric,
  p_bank_details  jsonb,
  p_client_op_id  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id           uuid;
  v_available_balance numeric;
  v_new_tx_id         uuid;
  v_gross_halalas     int8;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive' USING ERRCODE = '22000';
  END IF;

  -- Lock the wallet row FIRST. This serializes concurrent withdrawals AND makes
  -- the idempotency check below race-free: a replay blocks on FOR UPDATE until
  -- the original commits, then sees the original's transaction row.
  SELECT available_balance INTO v_available_balance
    FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
  IF v_available_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for this user' USING ERRCODE = 'P0002';
  END IF;

  -- ★ IDEMPOTENT REPLAY (offline outbox) ★ — WITHOUT this, an at-least-once retry
  -- would decrement the balance and insert a withdrawal TWICE (double-charge).
  -- Returns the original result, untouched.
  IF p_client_op_id IS NOT NULL THEN
    SELECT id INTO v_new_tx_id
      FROM public.transactions
     WHERE client_op_id = p_client_op_id AND user_id = v_user_id
     LIMIT 1;
    IF v_new_tx_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true, 'idempotent', true,
        'message', 'Withdrawal already processed',
        'transaction_id', v_new_tx_id, 'new_balance', v_available_balance);
    END IF;
  END IF;

  IF v_available_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient funds. Your real balance is: %', v_available_balance
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.wallets
     SET available_balance = available_balance - p_amount, updated_at = now()
   WHERE user_id = v_user_id;

  -- Withdrawals carry no platform fee (the fee was taken on the earning). amount
  -- is in currency units; the *_halalas columns are NON-NULL, so set them.
  v_gross_halalas := ROUND(p_amount * 100)::int8;

  INSERT INTO public.transactions
    (user_id, type, amount, description, status, metadata,
     gross_amount_halalas, platform_fee_halalas, net_amount_halalas, client_op_id)
  VALUES (
    v_user_id, 'withdrawal', p_amount,
    'Withdrawal request to ' || COALESCE(p_bank_details->>'bank_name', 'Bank Account'),
    'pending', p_bank_details,
    v_gross_halalas, 0, v_gross_halalas, p_client_op_id
  ) RETURNING id INTO v_new_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_new_tx_id,
    'new_balance', v_available_balance - p_amount,
    'message', 'Withdrawal request submitted successfully');
END;
$$;

COMMENT ON FUNCTION public.process_withdrawal(numeric, jsonb, text) IS
  'Atomic (FOR UPDATE) + idempotent (p_client_op_id) wallet withdrawal. Decrements available_balance and writes a pending withdrawal ledger row exactly once per client op, even under outbox at-least-once retries (20260719).';

REVOKE EXECUTE ON FUNCTION public.process_withdrawal(numeric, jsonb, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.process_withdrawal(numeric, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
