---
name: project_money_flow
description: "NEXPEC payment/escrow/payout architecture — internal ledger, net-terms, 100% manual payouts, money-unit reality, FX separation"
metadata: 
  node_type: memory
  type: project
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

**Operator decisions (locked):** support all 3 payment modes (prepay escrow / B2B net-terms / Option-C early-payout advance); payouts are **100% MANUAL** — inspector/supplier *requests*, admin wires money OUTSIDE the system, then clicks "Mark as Paid" to debit. **No automated Stripe Connect payouts.** Inspector is ALWAYS routed via `jobs.contractor_id` (never inspector_id/assigned_inspector_id).

**MONEY-UNIT REALITY (do not guess):** three representations coexist — `jobs.*_cents` (integer minor), `wallets.*` are **numeric MAJOR units (dollars, 2dp)**: `available_balance` (cleared/withdrawable), `pending_amount` (accrued, net-terms), `pending_payouts` (reserved by an open request), `total_earned`, `escrow_amount`. `transactions.amount` numeric dollars + NON-NULL `gross_amount_halalas/platform_fee_halalas/net_amount_halalas` (int minor; "halalas == cents", 1:1). Conversion is purely **cents/100.0**, NEVER FX. `wallets.currency` default 'CAD' (cosmetic; treated single-currency).

**FX subsystem is SEPARATE and ACTIVE — never touch from the payout path:** `fx_rates` + `convert_cents(amount_cents, from, to, as_of)` (USD-pivot, returns NULL if no path) + `upsert_fx_rate`/`cron_upsert_fx_rate` + `refresh-fx-rates` EF (OpenExchangeRates). Used ONLY by budget/procurement/invoice roll-up reporting (`20260602/20260604`), read-time projection. `process_withdrawal` and all wallet RPCs do ZERO rate math. Never rename `*_halalas` (live money unit) or touch the FX functions.

**Shipped (commit 633b45f):**
- `20260801136000` (Phase 1, additive/RLS-locked): `jobs.payment_mode`(prepay|net_terms)+`client_invoiced_at`+`client_settled_at`; `profiles.client_payment_terms`+`client_credit_limit_cents` (distinct from the existing inspector-rate `profiles.payment_terms`); tables `withdrawal_requests` (one-open-per-user partial unique idx, client_op_id idempotency) + `payout_advances`; writes REVOKEd from authenticated (RPC-only).
- `20260801137000` (Phase 2, RPCs — SECURITY DEFINER, FOR UPDATE, idempotent, self-tested): `credit_inspector_earning_on_approval(job)` (prepay→available, net_terms→pending; **auto-fired by trigger `trg_credit_inspector_on_confirm` on jobs admin_confirmed_at null→set**), `settle_client_payment(job)` (pending→available, or recover a funded advance + stamp client_settled_at), `request_withdrawal(amount_cents,method,note,client_op_id)` (reserves available→pending_payouts; supplier branch uses `supplier_earnings.available_balance_halalas/pending_halalas`), `admin_mark_withdrawal_paid(id,ref)` + `admin_reject_withdrawal(id,reason)` (manual; debit/return here), `request_payout_advance(job,fee_bps)` + `admin_fund_advance(id,funded_by)` (net-of-fee). **Versioned the previously live-only `debit_wallet_for_payout(uuid,bigint)`**. `credit_inspector_earnings` confirmed NON-EXISTENT (created fresh as credit-on-approval). Legacy ghost `payout_requests` + `process-payout` EF (Custom/CAD) to be RETIRED (not dropped yet).

**NEEDS:** `supabase db push` to apply 136000+137000 (sandbox can't reach DB).

**Stripe finalize state (from audit):** webhooks signature-verified + claim-idempotent; create-payment-intent server-derives from jobs.client_price_cents; Connect onboarding wired; deploy/secrets runbook = `docs/ops/DEPLOY_RUNBOOK.md`. "mint money" vuln already closed by `20260719120000_financial_lockdown` (wallets/transactions SELECT-only, writes revoked).

**NEXT:** Phase 3 = finance-tab redesign per role (web+mobile): inspector/supplier two-bucket wallet (Available + "Request Payout"; Pending "clears ~date"; advance offer); client/agency/enterprise escrow+outstanding+credit-limit meter; **admin "Treasury Control Tower"** (receivables vs payable, the withdrawal_requests queue with Mark-as-Paid, advance approvals). Phase 4 = Stripe TEST-mode end-to-end test matrix. See [[project_financial_security_crisis]], [[reference_nexpec_schema_gotchas]].
