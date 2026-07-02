---
name: reference-finance-suite-drift
description: "Finance-suite prod-only objects now versioned (budget RPCs, invoices, fin_visible_client_ids) + the invoices TRUNCATE/anon security fix"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

The client finance suite had DB objects that lived ONLY in production (drift acknowledged in migration 20260529120000's header). Now version-controlled:

- **20260801138000** — the 4 budget RPCs `get_budget_summary` / `get_budget_monthly` / `get_budget_by_inspector` / `get_budget_recent_activity` (SECURITY DEFINER, STABLE, search_path public/pg_temp), captured verbatim. Grants hardened: REVOKE PUBLIC/anon → GRANT authenticated + service_role.
- **20260801139000** — `public.invoices` (30 cols, 8 FKs, checks, 6 indexes, RLS+3 policies, 2 triggers) + `public.fin_visible_client_ids(uuid)` verbatim.

**SECURITY FIX (real exposure):** live grants gave `anon` + `authenticated` **TRUNCATE** on `public.invoices` — and TRUNCATE bypasses RLS, so any authenticated user could wipe the table. Migration 139000 REVOKEs ALL from anon/PUBLIC, REVOKEs TRUNCATE/REFERENCES/TRIGGER from authenticated (keeps RLS-gated SELECT/INSERT/UPDATE/DELETE; writes still admin-only via `invoices_write_admin_only`), service_role stays full. RLS itself was already enabled + correct.

`fin_visible_client_ids(uuid)` logic (the budget/invoice read-gate, no cross-org leak): admin/super_admin → all client/enterprise/agency; agency/enterprise w/ org → same organization_id; client → self; inspector/unknown → empty.

ACTION: migrations 138000 + 139000 still need `supabase db push` — pushing applies the grant hardening to prod (CREATE OR REPLACE / CREATE TABLE IF NOT EXISTS are no-ops there). Both are idempotent + self-tested.

STILL DRIFTED (next): the trigger fn `tg_invoice_inherit_department()` and `_touch_updated_at()` are guarded in 139000; if not already versioned, version them so fresh `db reset` recreates the invoices triggers. Related: [[project_money_flow]].
