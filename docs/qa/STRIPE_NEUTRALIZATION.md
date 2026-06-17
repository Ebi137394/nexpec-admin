# Stripe-neutralization audit (NX-STRIPE-004)

## Finding: the legacy Connect payout functions were NOT dead — they were live

The "100% manual payout, no Stripe Connect" model was **not** actually enforced.
Three edge functions contained real money-moving Stripe calls AND were invoked by
live UI:

| Edge function | Money call | Live invocation sites |
|---|---|---|
| `create-stripe-payout` | `stripe.transfers.create` + `stripe.payouts.create` | `app/(tabs)/finance.tsx` (mobile inspector withdraw) |
| `process-payout` | `stripe.transfers.create` | `app/(admin)/payouts.tsx`, `app/(inspector)/jobs/[id]/index.tsx` |
| `create-supplier-payout` | `stripe.transfers.create` + `stripe.payouts.create` | `apps/web/.../SupplierPayoutCard.tsx`, `apps/web/src/lib/data/marketplace.ts`, `src/hooks/useSupplierEcosystem.ts` |

Each was a **control bypass** around the admin "Mark as Paid" gate: those screens
fired automated Connect payouts directly, sidestepping `request_withdrawal` →
Treasury → `admin_mark_withdrawal_paid`.

Already-safe (no action): `release-payment` (501, NX-STRIPE-003);
`clientReport.ts` only *mentions* `process-payout` in comments (it writes an
`audit_events` signal, moves no money).

## Done: server-side kill-switch (authoritative)

All three functions now return **501 NOT_IMPLEMENTED + audit the attempt**
(`event_type='admin_tool.disabled_endpoint_hit'`), modeled on `release-payment`.
Money cannot move regardless of caller — even though the frontend still invokes
them today. **Deploy:**

```bash
supabase functions deploy create-stripe-payout
supabase functions deploy process-payout
supabase functions deploy create-supplier-payout
```

Verify in `/admin/audit` (or `audit_events`) that hits now log as disabled.

## Staged removal plan

**Stage 1 — repoint the frontend to the manual flow** (so users get the proper UX,
not a 501):
- `app/(tabs)/finance.tsx` — replace the `create-stripe-payout` withdraw with
  `request_withdrawal` (mirror the already-migrated `app/(inspector)/wallet`).
- `app/(admin)/payouts.tsx` — replace `process-payout` with `admin_mark_withdrawal_paid`
  (the Treasury action) — or just link to the web Treasury Control Tower.
- `app/(inspector)/jobs/[id]/index.tsx` — remove the `process-payout` trigger.
- `SupplierPayoutCard.tsx` + `marketplace.ts` + `useSupplierEcosystem.ts` —
  replace `create-supplier-payout` with `request_withdrawal` (supplier branch).
  Blocked on `supplier_earnings` (ghost table) — see below.

**Stage 2 — confirm no traffic.** After Stage 1 ships and one release cycle passes,
confirm zero `admin_tool.disabled_endpoint_hit` for these endpoints.

**Stage 3 — delete** the disabled functions + Connect onboarding/webhook that only
existed to support automated payouts:
`create-stripe-payout`, `process-payout`, `create-supplier-payout`,
`create-stripe-connect-link`, `stripe-connect-redirect`, `sync-stripe-connect-status`,
`stripe-connect-webhook` (`supabase functions delete <name>` + remove from repo).

## Still to assess (not money-egress, separate)

- `stripe-payments-webhook` / `create-payment-intent` / `create-setup-intent` /
  `sync-payment-method` — these are the **funding/ingress** side. Keep ONLY if
  prepay escrow is actually funded via Stripe capture; if funding is bank-transfer
  into the internal escrow ledger, neutralize these too. Needs product confirmation.
- `supplier_earnings` ghost table — the supplier payout/branch references a table
  that doesn't exist on prod. Provision it (or route suppliers through `wallets`)
  before re-enabling supplier payouts. Tracked separately.
