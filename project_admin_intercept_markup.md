---
name: project_admin_intercept_markup
description: "Procurement quotes are admin-intercepted & marked up; the client never sees the supplier's raw price (RLS-enforced)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

Closed a launch-blocking flaw: the Client (RFQ owner) could SELECT raw `supplier_quotes` (policy `quote_client_view`) and call `award_quote` directly — seeing the supplier's raw price and bypassing NEXPEC's markup. Now brokered, mirroring [[project_golden_rules]] price-blindness (like job_contracts).

**Migration `supabase/migrations/20260801123600_admin_intercept_markup.sql`:**
- `supplier_quotes` gained `client_price_cents`, `presented_at`, `presented_by`, `admin_note`; status CHECK extended with `'presented'`. Raw price stays in `quote.amount_cents` (supplier truth / payout basis — feeds [[project_supplier_agreement_gate]] + release_supplier_contract; unchanged).
- **DROP POLICY `quote_client_view`** → the client has ZERO RLS path to `supplier_quotes` (only supplier-own + admin + service_role remain). Direct client query returns 0 rows.
- **`rfq_client_offers_view`** is the ONLY client-readable surface: projects `client_price_cents AS price_cents` + lead_time + `supplier_handle = 'NX-'||upper(left(encode(digest(supplier_id,'sha256'),'hex'),6))` (one-way hash — anti-poaching). NEVER selects quote/amount/supplier_id. Filtered to status IN (presented,accepted,declined) AND client_price_cents NOT NULL AND (rfq owner OR admin). REVOKE from public, GRANT to authenticated.
- **`admin_present_quote(p_quote_id, p_client_price_cents, p_admin_note)`** — admin-only, enforces price ≥ supplier cost, sets status='presented' + price, notifies client.
- **`award_quote` re-gated**: client may only accept a quote that is `presented` AND has `client_price_cents` (admin can award on behalf). Spawn trigger unchanged downstream. Backfill: historical `accepted` rows get client_price = raw cost.
- State machine: submitted → (admin) presented → (client) accepted → job spawn; declined/withdrawn.

**Two prices:** supplier raw `amount_cents` (payout) vs `client_price_cents` (what client pays); margin = spread, admin-only.

**UI (web + mobile, identical client logic):**
- Web data `apps/web/src/lib/data/marketplace.ts`: `fetchClientOffers` (view), `fetchMyQuote` (supplier own), `fetchAdminRfqs`/`fetchAdminRfqQuotes` (admin raw + names), `presentQuote`; `fetchRfqDetail` kept back-compat for `suppliers/opportunities/[id]`.
- Web admin: `apps/web/src/app/admin/rfqs/page.tsx` (queue) + `[id]/page.tsx` (markup console w/ live margin calc + Present); sidebar "RFQs & Procurement" → `/admin/rfqs`.
- Web client: `(marketplace)/rfqs/[id]/page.tsx` role-aware — owner sees offers only (price + NX handle, accept presented); supplier sees own bid + submit.
- Mobile: `src/hooks/useSupplierEcosystem.ts` `useRfqDetail` now role-aware → `{ rfq, offers, myQuote, isOwner }`; `app/rfqs/[id].tsx` offer-only for client.

**How to apply:** never surface a raw supplier quote to a client; any new client RFQ surface MUST read `rfq_client_offers_view`; awards only via `award_quote` (presented gate). Mobile admin markup screen NOT built (admin uses web console). Verified web tsc 0 + lint clean; mobile changed files clean. Commits `23dd8ad` (DB) + `50eddf0` (UI) — ahead of origin, ebi must `git push origin main` ([[feedback_patch_delivery_workflow]] — sandbox can't push).