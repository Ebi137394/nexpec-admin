---
name: reference_audit_trail_price_blindness
description: Audit trail must be price-blind for non-admins; redaction guard lives in src/lib/audit.ts + EventDetailSheet
metadata: 
  node_type: memory
  type: reference
  originSessionId: e7f049a2-95b3-4e16-b16b-9fc33e7f5b15
---

The mobile per-job **Activity & Audit Trail** (`src/core/audit/components/AuditTimeline.tsx` + `EventDetailSheet.tsx`, fed by `src/lib/audit.ts`) diffs **raw column changes**, so `job.price_updated` events leaked `platform_spread_cents` and `inspector_payout_cents` straight to the CLIENT — in the visual CHANGES diff AND the "Show raw payload" JSON. CODE-RED price-blindness / anti-poaching breach (found 2026-06-21).

**The guard (commit dc32e02):**
- `src/lib/audit.ts` → `isSensitivePricingField()` + `redactSensitivePricing()`. `fetchAuditEvents()` strips inspector-payout / platform-spread / margin / commission fields from `delta` + `metadata` for every caller with `asAdmin=false`, and DROPS events that become pricing-only. This is the single chokepoint (covers timeline rows, diff, raw payload).
- `EventDetailSheet` has a `privileged` prop (default false): filters sensitive diff keys + hides the raw-payload section entirely for non-privileged viewers.
- `AuditTimeline` passes `privileged={asAdmin}`.

**`asAdmin` is the privilege gate.** Only `app/(admin)/audit-trail.tsx` and `app/(admin)/jobs/[id].tsx` pass `asAdmin` (→ `audit_events` table). All buyer/inspector job-detail screens omit it (→ `audit_events_public`) and are now price-blind. Never pass `asAdmin` from a non-admin surface.

**Server-side defense-in-depth (DONE in code, pending deploy):** migration `20260801154000_audit_public_price_blind.sql` adds `public.audit_redact_pricing(jsonb)` (recursive key-stripper) and rebuilds the `audit_events_public` view to redact both `delta` and `metadata` (preserves the existing ip/ua/ai_label/admin_notes masking + security_invoker). Admins read `audit_events` directly so unaffected. NOT yet applied — needs `supabase db push`. After server redaction a price-only event arrives with an empty delta, so `redactSensitivePricing` also drops empty-diff pricing-category events (so no blank "Pricing updated" rows). Validated by Python port of the recursion (no live PG in sandbox).

**Web is clean:** the web audit delta viewer (`apps/web/src/lib/data/audit.ts`) is imported only by `admin/audit/page.tsx` — no client-facing audit diff exists on web. Relates to [[project_golden_rules]] (price-blindness) and [[project_public_anonymization]].

**Buyer contracts price-trace + GR2 CI guard (2026-06-23):** Traced a report that a Client saw inspector payouts on the Smart Contracts Hub (`app/contracts/index.tsx`). NOT a data leak — `client_job_contracts_view` has no inspector_payout column; `unified_contracts_view`'s inspector_engagement leg is row-gated to `inspector_id = auth.uid()`; `PipelineSection.tsx`'s inspector_payout selects are inspector-branch + `eq(inspector_id)` gated. The visible figure was the client's OWN `client_price_cents` shown beside the inspector's name — masked at the card by commit 5578f6d. To make the network-layer guarantee regression-proof, added `scripts/qa/check-price-blindness.mjs` (npm `qa:gr2`, commit f723d36): fails if any buyer-surface file (`app/(client|agency)`, `app/suppliers`, `src/screens/client`, client/agency/enterprise dashboards) names inspector_payout_cents / payout_amount_cents / platform_spread_cents / platform_margin_cents / contractor_payout_amount_cents on a NON-comment line. Strips block/JSX comments (false-positive fix); shared role-branched files intentionally out of scope; passes over 49 files. Negative-tested (catches a real injected select).
