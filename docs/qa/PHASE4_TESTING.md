# Phase 4 — End-to-End Debug & Test Matrix

The goal: prove the money engine (escrow accrual → settlement → **manual** payout)
is correct, idempotent, and abuse-resistant, and that the manual-payout model
cannot be circumvented. Single-currency USD/cents; FX + `_halalas` untouched.

Decisions locked for this phase:

- **Local `supabase start` (Docker)** runs the pgTAP suites (deterministic, isolated).
- **Staging Supabase** runs the Node E2E + any Stripe webhook checks (where edge
  functions actually execute).
- Build order: **pgTAP core first**, then expand.
- The 8 legacy Stripe Connect/payout edge functions (`create-stripe-payout`,
  `process-payout`, `create-stripe-connect-link`, `stripe-connect-webhook`,
  `create-supplier-payout`, `sync-stripe-connect-status`, `stripe-connect-redirect`,
  `stripe-payments-webhook`) contradict the manual model → Phase 4 must prove they
  can't move money, then schedule their removal.

## The four layers

| Layer | Where | What it proves | Status |
|------|-------|----------------|--------|
| 1. pgTAP money-flow | local | RPC logic: accrual routing, settlement, payout reserve/mark-paid, idempotency, insufficient-balance, authz | **built** (`supabase/tests/money_flow_test.sql`) |
| 2. pgTAP RLS deny-matrix | local | role × table × op denial incl. `TRUNCATE` revoke (wallets, invoices, withdrawal_requests, payout_advances) | next |
| 3. Node E2E runner | staging | full lifecycle as real per-role JWTs; balances move end-to-end | planned (`scripts/qa/`) |
| 4. Manual UI smoke | staging | the human clicks through Treasury / inspector wallet / client escrow on real screens | planned (checklist below) |

## How to run Layer 1 (pgTAP) locally

```bash
# from repo root, with Docker running
supabase start            # boots local stack from versioned migrations
supabase test db          # runs every supabase/tests/*.sql via pg_prove
```

Expected for the money-flow suite: **24 passing** (`# ok` through 24, no `not ok`).

The suite is fully self-seeding and wrapped in `begin … rollback`, so it leaves
no residue and can be re-run freely.

### What the 24 assertions cover

- **Accrual routing** — `credit_inspector_earning_on_approval`: prepay →
  `available_balance`, net-terms → `pending_amount` (never touches available).
- **Accrual idempotency** — one `earning` txn per job; replay is a no-op.
- **Settlement** — `settle_client_payment`: pending → available, stamps
  `client_settled_at`, idempotent.
- **Manual payout request** — `request_withdrawal` reserves available →
  `pending_payouts`; `INSUFFICIENT_BALANCE`; `OPEN_REQUEST_EXISTS`;
  `client_op_id` replay creates exactly one row.
- **Admin mark paid** — `admin_mark_withdrawal_paid` debits `pending_payouts`;
  a non-admin caller is denied (`NOT_AUTHORIZED` / SQLSTATE 42501).

### Troubleshooting (most likely first-run failures)

These are environment/fixture issues, not logic bugs — paste the exact error and
I'll patch the seed block:

1. **`null value in column "…" of relation "profiles"`** — the live `profiles`
   table has a NOT-NULL column beyond `id/email/role` without a default. Tell me
   the column and I'll add it to the seed.
2. **`auth.users` insert error** — the local auth schema wants an extra NOT-NULL
   column; I'll widen the `insert into auth.users (…)` list.
3. **`function auth.uid() does not exist`** — run inside `supabase test db` (not
   raw `psql`), which loads the Supabase auth schema.

## Layer 4 — manual UI smoke checklist (staging)

Run on a seeded staging account once Layers 1–2 are green:

- [ ] **Client (prepay):** post a job → escrow shows under "Locked in escrow" on
      `/client/finance`; amount matches the job price.
- [ ] **Inspector:** after admin confirms the report, wallet "Available" rises by
      the agreed payout; "Request Payout" creates a Treasury queue row.
- [ ] **Admin (Treasury):** the request appears; "Mark as Paid" debits the
      balance; "Reject" returns the reserved funds.
- [ ] **Client (net-terms):** committed jobs draw down "Available to draw"; an
      invoiced job shows "due now".
- [ ] **Abuse:** a non-admin hitting an admin action (e.g. direct Treasury POST)
      is rejected; requesting a payout above balance is blocked in the UI.

## Stripe (manual-model verification)

Because payouts are 100% manual, no Stripe Connect payout should ever fire. Layer
3/`Stripe` work will (a) assert `create-stripe-payout` / `process-payout` are not
invoked by any code path and are undeployed/disabled, and (b) produce a
removal plan. If prepay funding is later found to use a Stripe capture webhook,
we add `stripe trigger` + signature/idempotency tests against staging.
