---
name: project_money_perimeter_hardened
description: "Phase 4+5 money-flow hardening CLOSED — pgTAP 65/65, supplier_earnings + legacy-overload fixes on prod, E2E runner + CI gate"
metadata: 
  node_type: memory
  type: project
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

The escrow/payout money perimeter is fully hardened and regression-proofed (Phase 4 DB layer + Phase 5 stack layer). Builds on [[project_money_flow]] (100% manual payouts) and [[reference_finance_suite_drift]].

**Shipped to prod (migrations applied + pushed):**
- `20260801144000` — provisions `public.supplier_earnings` (two-bucket halalas ledger: available_balance_halalas/pending_halalas + total/ytd) with the same P0 lockdown as wallets (RLS self-or-admin SELECT, no anon, no client writes, no TRUNCATE; writes only via SECURITY DEFINER RPCs). It was absent on prod, breaking every supplier payout.
- `20260801145000` — DROPs the dead+insecure legacy `request_withdrawal(numeric, jsonb)` overload (wrote nonexistent `wallets.pending_withdrawal` → threw on every call; no search_path, no null-uid guard, anon-granted; zero live callers). Canonical `request_withdrawal(bigint,text,text,uuid)` is the only payout entry.

**Test matrix (run locally via `npx supabase test db`, NOT CI):** 65/65 green across 4 files — money_flow(24), rls_money_matrix(26), rls_audit_events(8), provable_ai_binding(7). The deny-matrix now asserts supplier_earnings (self-read/cross-tenant/UPDATE/TRUNCATE) + legacy-overload-gone/canonical-present.

**Stack-layer E2E:** `scripts/qa/e2e-money-flow.mjs` (`npm run qa:e2e:money`) drives credit→settle→request_withdrawal→admin_mark_withdrawal_paid via REAL auth sessions (inspector prepay+net_terms + supplier branch + idempotency + security negatives: anon 28000, non-admin 42501, insufficient P0001, OPEN_REQUEST_EXISTS, RLS-inert direct UPDATE). Hard prod-ref guard (refuses sxqpjxhslzzcdrdctatm unless ALLOW_PROD=1); throwaway e2e_* users cleaned up.

**CI:** `.github/workflows/staging-money-e2e.yml` runs the E2E nightly + on main + manual; skips when staging secrets absent. ACTION NEEDED: add repo Actions secrets STAGING_SUPABASE_URL / STAGING_SUPABASE_SERVICE_ROLE_KEY / STAGING_SUPABASE_ANON_KEY to activate.

Gotcha learned: local DB started from the squash baseline does NOT auto-replay new migrations — apply them with `psql ... -f <migration>` (or db reset) before `supabase test db`, else you get "relation does not exist" / stale Tests= counts. Also: zsh globs `(...)` in inline comments → keep test-run comments on their own line.
