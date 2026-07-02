---
name: project_supplier_agreement_gate
description: Supplier Agreement (supplier_contracts) is a brokered two-party e-sign that GATES every supplier fund release
metadata: 
  node_type: memory
  type: project
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

Suppliers now have a formal signed agreement, awarded-bid → signed → executed, BEFORE any money moves. Mirror of the inspector/client `job_contracts` flow but **two-party (Supplier ↔ NEXPEC), never Supplier ↔ Client** — per the Golden Rules / anti-poaching ([[project_golden_rules]], [[project_public_anonymization]]).

**Backend:** `supabase/migrations/20260801123500_supplier_contracts.sql`
- Table `supplier_contracts`: `quote_id` UNIQUE (→ supplier_quotes), rfq_id, job_id, supplier_id, amount_cents (the supplier's OWN awarded quote value — price-blind safe), status CHECK(draft|pending_supplier_signature|pending_admin_countersignature|executed|voided), supplier/admin signed_at/name/ip, `content_sha256` seal, executed_at. RLS: supplier SELECT own OR nx_is_admin; service_role ALL; **mutations only via RPC**.
- RPCs (SECURITY DEFINER): `admin_generate_supplier_contract(p_quote_id,p_contract_text_md?,p_custom_contract_url?)` (requires quote status='accepted'; voids prior; default brokered template), `supplier_sign_contract(p_contract_id,p_typed_name,p_ip?)`, `admin_countersign_supplier_contract(...)` → status='executed' + `content_sha256` = sha256 over id|quote|supplier|amount|supplier_name|supplier_signed_at|admin_name|now|text (uses extensions.digest, search_path includes extensions).
- **THE GATE:** `release_supplier_contract` was REDEFINED here to add `IF NOT EXISTS (… supplier_contracts WHERE quote_id=… AND status='executed') THEN RAISE 'CONTRACT_NOT_EXECUTED'`. No executed agreement ⇒ no wallet credit. Contract-before-money is enforced in SQL, not just UI. Re-defining it kept the original signature `(uuid,int,text)` + over-release proof + credit_supplier_earnings call.

**Why:** we shipped supplier payouts/releases ([[project_outbox_routing_guardrail]] era) without the legal/contract piece; ebi flagged it as a missing business+legal step before code freeze.

**How to apply:** any new supplier-payment path MUST go through `release_supplier_contract` (or replicate the executed-agreement check). Never surface supplier contracts to clients. Helper `_supplier_quote_cents(jsonb)` tolerates amount_cents|amount|price_cents quote shapes.

**UI (web):** data `apps/web/src/lib/data/supplierContracts.ts`, actions `…/lib/actions/supplierContracts.ts`; supplier pages `/suppliers/contracts` (list) + `/suppliers/contracts/[id]` (view+e-sign); sidebar "Agreements" link; admin generate/countersign + release-gate baked into `components/admin/SupplierReleaseRow.tsx` on `/admin/supplier-payouts` (fetchAdminSupplierContractsByQuote). **UI (mobile):** hook `src/hooks/useSupplierContracts.ts`; screens `app/suppliers/contracts/index.tsx` + `[id].tsx` (realtime on supplier_contracts); entry = "Agreements" action on supplier-dashboard. Web tsc 0 errors; mobile only the pre-existing supabase.ts storage errors ([[reference_nexpec_schema_gotchas]]).
