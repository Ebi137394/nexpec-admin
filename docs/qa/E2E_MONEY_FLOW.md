# E2E Money-Flow Runner (Phase 5)

`scripts/qa/e2e-money-flow.mjs` proves the **full money stack above the database
layer**. pgTAP (`supabase/tests/*`) already locks the DB layer — RLS, constraints,
and RPC bodies in isolation. This runner closes the gap: it signs in as **real
Supabase auth users** (real JWT → real `auth.uid()`) and drives the canonical
manual-payout chain exactly as the web and mobile clients do.

## What it exercises

```
credit_inspector_earning_on_approval   (admin session: accrue earning)
  -> settle_client_payment             (net_terms: pending -> available)
    -> request_withdrawal              (INSPECTOR session: reserve available -> pending_payouts)
      -> admin_mark_withdrawal_paid     (ADMIN session: Treasury "Mark as Paid")
```

Plus the **supplier** branch (halalas ledger) and the security envelope.

### Assertions (happy path)

- Prepay earning clears straight to `available_balance`; idempotent on replay.
- Net-terms earning accrues to `pending_amount` and does **not** touch `available`
  until `settle_client_payment` moves it across.
- `request_withdrawal` reserves `available_balance -> pending_payouts`.
- `admin_mark_withdrawal_paid` drains `pending_payouts`, bumps `total_spent`,
  flips the request row to `paid`; idempotent on replay.
- Supplier branch: `available_balance_halalas -> pending_halalas -> 0` after payout.

### Assertions (security — the reason this exists)

- **Anon blocked** — `request_withdrawal` as an unauthenticated client raises
  `28000 NOT_AUTHENTICATED` (the broad `GRANT … TO anon` on the RPC is inert
  because the body checks `auth.uid()`).
- **Non-admin cannot pay** — `admin_mark_withdrawal_paid` as the inspector raises
  `42501`.
- **No mint-money** — a direct `UPDATE wallets` from the inspector session is inert
  (no UPDATE policy → 0 rows; balance unchanged).
- **Insufficient balance** — over-withdraw raises `P0001 INSUFFICIENT_BALANCE`.
- **One open request** — a second concurrent request raises `OPEN_REQUEST_EXISTS`.

100% manual payouts — there is no Stripe / automated rail anywhere in this path,
by design. The runner proves the only way money moves is through these
`SECURITY DEFINER` RPCs.

## Running it

Point it at **staging** (never prod). Pull the staging keys from the Supabase
dashboard (Project Settings → API).

```bash
export SUPABASE_URL="https://<staging-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<staging service_role key>"
export SUPABASE_ANON_KEY="<staging anon key>"

npm run qa:e2e:money
# or: node scripts/qa/e2e-money-flow.mjs
```

Exit code `0` = all green, `1` = one or more assertions failed, `2` = setup/fatal.

### Flags & guards

- `--keep` — leave the seeded throwaway users/rows in place for debugging
  (default behavior deletes them in a `finally` block).
- **Prod guard** — the runner refuses to start if `SUPABASE_URL` contains the
  production project ref (`sxqpjxhslzzcdrdctatm`). Override only with
  `ALLOW_PROD=1`, which is not recommended (it creates and deletes users).

## Notes

- Test users are tagged `e2e_<role>_<runId>@nexpec.test` and removed on exit, so
  repeated runs don't accumulate state.
- Uses the `service_role` key only for seeding and balance read-back; every
  money-moving call goes through a **real user session** so RLS and the RPC auth
  checks are genuinely on the path.
- Follow-up tracked separately: the legacy `request_withdrawal(p_amount numeric,
  p_bank_details jsonb)` overload is also `GRANT … TO anon`; confirm its body
  guards `auth.uid()` or drop the overload + grant.
