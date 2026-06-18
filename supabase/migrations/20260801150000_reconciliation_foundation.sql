-- ════════════════════════════════════════════════════════════════════════════
--  20260801150000_reconciliation_foundation.sql
--
--  TREASURY RECONCILIATION — "accounting time-bomb" preventer (layer 1: DB).
--
--  Identity: the real cash in Stripe must be >= NEXPEC's total custodial
--  LIABILITIES. A shortfall (Stripe holds less than we owe) is the alarm.
--
--    liabilities_cents =
--        Σ wallets(available_balance + pending_amount + pending_payouts) * 100
--      + Σ supplier_earnings(available_balance_halalas + pending_halalas)   -- already cents
--      + Σ platform_wallet(balance) * 100
--
--  Diagnostics (NOT in the headline drift, to avoid double-counting — job
--  payments already credit wallet buckets): escrow_held_cents, open_payout
--  requests. All math in INTEGER CENTS (the unit-mismatch class this must catch).
--
--  Components:
--    • reconciliation_runs   — append-style audit of every run (admin-read; writes
--                              via RPC/service only; no client writes; no TRUNCATE)
--    • admin_ledger_snapshot()        — pure-SQL custody totals (admin-only)
--    • record_reconciliation_run(...) — snapshot + optional Stripe balance →
--                                       compute drift, insert a run, return it
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Runs ledger ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at               timestamptz NOT NULL DEFAULT now(),
  source               text NOT NULL DEFAULT 'manual'
                         CHECK (source IN ('manual','scheduled','ci')),
  wallets_cents        bigint NOT NULL DEFAULT 0,
  supplier_cents       bigint NOT NULL DEFAULT 0,
  platform_cents       bigint NOT NULL DEFAULT 0,
  liabilities_cents    bigint NOT NULL DEFAULT 0,
  escrow_held_cents    bigint NOT NULL DEFAULT 0,   -- diagnostic
  open_payouts_cents   bigint NOT NULL DEFAULT 0,   -- diagnostic
  stripe_balance_cents bigint,                      -- null when snapshot-only
  drift_cents          bigint,                      -- stripe_balance - liabilities (null if no stripe)
  status               text NOT NULL DEFAULT 'snapshot_only'
                         CHECK (status IN ('snapshot_only','solvent','shortfall','error')),
  detail               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reconciliation_runs_run_at_idx ON public.reconciliation_runs (run_at DESC);

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reconciliation_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reconciliation_runs TO authenticated;   -- admin-only via policy
GRANT ALL    ON TABLE public.reconciliation_runs TO service_role;
DROP POLICY IF EXISTS reconciliation_runs_admin_read ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_admin_read ON public.reconciliation_runs
  FOR SELECT TO authenticated USING (public.nx_is_admin());
-- No client write policy: rows are written only by the SECURITY DEFINER RPC / service_role.

-- ─── Snapshot: pure-SQL custody totals (admin-only) ──────────────────────────
CREATE OR REPLACE FUNCTION public.admin_ledger_snapshot()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_wallets   bigint;
  v_supplier  bigint;
  v_platform  bigint;
  v_escrow    bigint;
  v_openpay   bigint;
BEGIN
  -- Admin users OR service_role (auth.uid() IS NULL → the scheduled edge fn).
  -- Non-admin authenticated callers are denied.
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(round(SUM(
           COALESCE(available_balance,0) + COALESCE(pending_amount,0) + COALESCE(pending_payouts,0)
         ) * 100)::bigint, 0)
    INTO v_wallets FROM public.wallets;

  SELECT COALESCE(SUM(
           COALESCE(available_balance_halalas,0) + COALESCE(pending_halalas,0)
         ), 0)::bigint
    INTO v_supplier FROM public.supplier_earnings;

  SELECT COALESCE(round(SUM(COALESCE(balance,0)) * 100)::bigint, 0)
    INTO v_platform FROM public.platform_wallet;

  -- Diagnostic: client cash paid in, held, not yet settled out.
  SELECT COALESCE(SUM(COALESCE(client_price_cents,0)), 0)::bigint
    INTO v_escrow FROM public.jobs
   WHERE escrow_status IN ('funded','held') AND client_settled_at IS NULL;

  -- Diagnostic: payouts requested but not yet paid (reserved liability).
  SELECT COALESCE(SUM(COALESCE(amount_cents,0)), 0)::bigint
    INTO v_openpay FROM public.withdrawal_requests
   WHERE status IN ('requested','approved');

  RETURN jsonb_build_object(
    'wallets_cents',     v_wallets,
    'supplier_cents',    v_supplier,
    'platform_cents',    v_platform,
    'liabilities_cents', v_wallets + v_supplier + v_platform,
    'escrow_held_cents', v_escrow,
    'open_payouts_cents',v_openpay,
    'computed_at',       now()
  );
END
$fn$;

-- ─── Record a run (snapshot + optional Stripe balance → drift) ───────────────
CREATE OR REPLACE FUNCTION public.record_reconciliation_run(
  p_source               text DEFAULT 'manual',
  p_stripe_balance_cents bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_snap  jsonb;
  v_liab  bigint;
  v_drift bigint;
  v_status text;
  v_id    uuid;
BEGIN
  -- Admin users OR service_role (auth.uid() IS NULL → the scheduled edge fn).
  -- Non-admin authenticated callers are denied.
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_source NOT IN ('manual','scheduled','ci') THEN
    RAISE EXCEPTION 'INVALID_SOURCE: %', p_source;
  END IF;

  v_snap := public.admin_ledger_snapshot();
  v_liab := (v_snap->>'liabilities_cents')::bigint;

  IF p_stripe_balance_cents IS NULL THEN
    v_drift := NULL; v_status := 'snapshot_only';
  ELSE
    v_drift := p_stripe_balance_cents - v_liab;
    v_status := CASE WHEN v_drift < 0 THEN 'shortfall' ELSE 'solvent' END;
  END IF;

  INSERT INTO public.reconciliation_runs (
    source, wallets_cents, supplier_cents, platform_cents, liabilities_cents,
    escrow_held_cents, open_payouts_cents, stripe_balance_cents, drift_cents,
    status, detail, created_by
  ) VALUES (
    p_source,
    (v_snap->>'wallets_cents')::bigint,
    (v_snap->>'supplier_cents')::bigint,
    (v_snap->>'platform_cents')::bigint,
    v_liab,
    (v_snap->>'escrow_held_cents')::bigint,
    (v_snap->>'open_payouts_cents')::bigint,
    p_stripe_balance_cents, v_drift, v_status, v_snap, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'run_id', v_id, 'status', v_status,
                            'liabilities_cents', v_liab, 'drift_cents', v_drift);
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_ledger_snapshot()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_reconciliation_run(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ledger_snapshot()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_reconciliation_run(text, bigint) TO authenticated, service_role;
ALTER FUNCTION public.admin_ledger_snapshot()              OWNER TO postgres;
ALTER FUNCTION public.record_reconciliation_run(text, bigint) OWNER TO postgres;

-- ─── Self-test ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.reconciliation_runs') IS NULL
     OR to_regprocedure('public.admin_ledger_snapshot()') IS NULL
     OR to_regprocedure('public.record_reconciliation_run(text, bigint)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: reconciliation foundation incomplete';
  END IF;
  IF has_table_privilege('authenticated','public.reconciliation_runs','UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can UPDATE reconciliation_runs';
  END IF;
  RAISE NOTICE 'reconciliation foundation ready (snapshot + runs ledger + record RPC; admin-only, cents).';
END
$selftest$;
