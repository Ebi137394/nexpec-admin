---
name: project-contract-engine
description: "The brokered-deal contract engine epic — MSA, milestone escrow, inspector routing, VIP disclosure, commercial revisions (migrations 127000–129000)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 037bb54c-3737-4da7-bef6-ca32e278f20d
---

The contract engine on the brokered-deal spine ([[project_brokered_deal]]), built + shipped this epic. All on `deals`/`agreements` (versioned, `supersedes_id`, SHA-256 sealed), price-blind by construction, web + mobile 1:1, admin orchestration web-only / counterparty flows on both.

Migrations (idempotent, additive; deploy via `supabase db push` — each ends in a `DO $$ … RAISE NOTICE 'OK'` self-test that aborts on failure):
- **127000** MSA-grade templates (Quebec law + ADRIC Montreal arbitration), HYBRID milestone escrow (30% deposit on sign + 70% at FAT-readiness; 30/30/30+10 retention disbursement schedule `deal_payment_schedule`), deemed-acceptance (10 business days) + substantive NCR (`deal_nonconformances`), warranty pass-through, force majeure. `fund_deal_balance`, `raise_nonconformance`.
- **127500** Inspector routing engine: `_brokered_score_inspectors` (matcher on `supplier_rfqs.spec` vs `profiles.specialty_slugs/certifications`), shared `_brokered_create_engagement`, `admin_auto_match_inspector` + `admin_match_preview` (algorithmic), `deal_inspector_candidates` + `client_inspector_shortlist_view` (blinded A/B/C) + `admin_offer_inspector_shortlist` + `client_select_inspector`. `deals.inspector_routing` records the governing method.
- **128000** Named-Disclosure VIP (Layer E): `disclosure_amendment` agreement kind + `vip_disclosure_fee` money-leg; `request_named_disclosure` presents a sealed rider; signing it (sign_agreement branch) collects the fee, sets tier=named, stamps `inspector_engagement_meta.identity_revealed_at` → `client_assigned_inspector_view` reveals the name early. **Tiered Administrative Amendment Fee** (by client price): Base <$10k $100 · Standard $10k–$100k 1% · Enterprise $100k–$1M $350 · Elite >$1M $500.
- **129000** Commercial Revision Ledger: `deal_revisions` (case) + `deal_revision_events` (immutable sealed timeline). `request_price_revision` (reason code + ≥20-char justification), `admin_counter_revision`, `admin_decide_revision` (accept→apply/reject), `respond_to_counter` (accept→apply/reject/counter-back), `withdraw_revision`; `_apply_revision` supersedes the leg with a new EXECUTED version on mutual consent (docket consent = execution consent). Not a chat — a formal arbitration docket. Adjacent older loops are different domains: app-payout negotiation (`admin_counter_application`), Bridge `bridge_*_schedule`, report-revision event `job.client_requested_revision`.

**DEPLOY: 127000–129000 all LIVE on prod.** `supabase db push` on 2026-06-06 reported "Remote database is up to date" (129000 recorded → self-tests passed → objects exist). 129000's earlier `_revision_log` 6→7-arg GRANT/REVOKE mismatch (`(uuid,uuid,text,text,bigint,text,text)`) was fixed (`c10c7ab`) before apply. Runbook: `docs/launch/resilient-shell-and-revision-ledger.md`.

Shared UI (both `apps/web/src/components/contracts/` and `src/components/contracts/`): `InspectorTrust.tsx` (CredentialCertificate A/B, NeutralityBadge C, VipDisclosureGate E) + `CommercialRevision.tsx` (RevisionLedger + party panel; web also `AdminRevisionsPanel`). Mounted on the client deal view (`deals/[id]/sign`), the supplier/inspector agreement view (web `SpineAgreementSign` / mobile `contracts/agreement/[id]`), and admin `DealControlPanel`.

GOTCHA (hit twice): `CREATE OR REPLACE FUNCTION` with a NEW arity creates a second OVERLOAD, not a replace → "function … is not unique". When widening a function's args you MUST `DROP FUNCTION IF EXISTS` the old signature first (or drop all overloads via pg_proc). Bit `admin_assign_inspector` (3→4) and `_brokered_disclosure_amendment_md` (3→4). Also: run migrations whole (db push / full file), never piecemeal in the SQL editor.

EAS: project `a8faa2b1-c912-4c5e-9ef3-620425d67272` bound as a committed fallback in `app.config.js` (`extra.eas.projectId` + `updates.url`). Mobile OTA needs `expo-updates` (not yet installed) + a build that includes it; first release ships via `eas build` not `eas update`.
