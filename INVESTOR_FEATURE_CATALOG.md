# NEXPEC — Comprehensive Feature Catalog

*The provable inspection platform for the enterprise.*

---

## Executive summary

NEXPEC is a vertically-integrated marketplace for inspection services with an enterprise compliance stack built into the core data model — not bolted on. We don't compete with generic field-service platforms or generic procurement tools. We compete with the legacy combination of *spreadsheet + email + PDF + manual audit prep* that Fortune 500 procurement and compliance teams use today to manage external inspections.

What makes NEXPEC defensible is not any single feature. It's that we are the only marketplace where every dollar spent, every photo captured, every approval granted, and every signature recorded sits inside a single cryptographically anchored chain of custody — and where a regulator can verify that chain *without ever trusting NEXPEC's infrastructure*.

This catalog enumerates what we have shipped to production, organized by capability domain. Every feature listed below is live in the codebase and verifiable against the migration history under `supabase/migrations/`.

---

## 1. The Trust Stack — our differentiated core

Five interlocking systems that together form a regulator-grade compliance perimeter around every inspection.

### 1.1 Procurement Control Plane (PCP)

A schema-enforced procurement governance layer that satisfies SOX 404 internal-controls requirements at the database layer rather than the application layer. Procurement controls written into Postgres constraints cannot be bypassed by a malicious frontend or a faulty deploy.

- **Approval policies** with band thresholds, currency-aware, scoped per department.
- **Approval requests** snapshotted at submission so subsequent policy edits do not retroactively change what was required (audit-integrity invariant).
- **Approval decisions** with a *constraint trigger* enforcing Segregation of Duties: the request poster mathematically cannot approve their own request. This is enforced at the schema layer — not the application layer.
- **Department budgets** with currency-native commit / paid / remaining rollups, automatic budget-exceedance warnings on the post-new-job form.
- **Quorum logic** with explicit `min_approvers_required` and `required_approver_roles[]`, computed inside an idempotent RPC that mathematically cannot double-approve.
- **Mobile parity**: live approval-gate preview on the post-new-job form via debounced server evaluation. Approvers receive push and email; they decide from a mobile dashboard with the same cryptographic guarantees as web.

### 1.2 Provable Inspection Engine (PIE)

Cryptographic chain-of-custody from the moment an inspector lifts a phone, all the way to a third-party regulator opening an evidence pack. Built on top of an existing per-photo SHA-256 chain (`inspection_captures.capture_sha256` + `prev_capture_sha256`), layering a report-level Merkle-style seal that binds every photo, every finding, the report metadata, and inspector identity under a single anchor hash.

- **Per-photo SHA-256 with chain linkage** — already in place pre-PIE; PIE leverages and elevates it.
- **`pi_report_seals` sidecar table** — one row per sealed inspection report, idempotent (re-sealing returns the existing seal).
- **`pi_canonical_json()`** — deterministic JSON canonicaliser in PL/pgSQL with byte-identical output to the web client's algorithm.
- **`pi_seal_inspection_report(report_id)`** — verifies the photo chain, computes captures-root + items-root + report-meta-root, composes the anchor hash, signs as the inspector.
- **`pi_countersign_inspection_report(report_id)`** — client co-signs against the same root; produces a second binding signature.
- **Mobile leaf screen** at `/inspector/seal-report?report_id=X` — isolated, deep-link reachable, locked dark/purple visual language, zero new native dependencies.
- **Visible chain-break reporting** — if any photo's prev-hash doesn't match the previous photo's hash, we don't silently fail. We seal with `chain_verified=false` and surface the break to the auditor.

### 1.3 Compliance Evidence Locker (CEL)

A single SQL RPC that assembles a deterministic, third-party-verifiable bundle of every artifact in a job's lifecycle: job snapshot, parties, attributed department, contracts (with signature evidence), approval requests + per-approver decisions, invoices, scoped audit events, and now the inspection seals from PIE. The bundle is byte-identical across consecutive calls against unchanged data — making it suitable for SHA-256 anchoring and downstream cryptographic verification.

- **Eight artifact groups**: job · parties · department · contracts · approvals · invoices · audit_events · inspection_seals.
- **Three-tier authorization gate**: Platform Owner universal; job parties (client + inspector) on their own job; Enterprise Admins (org `owner` or `procurement_admin`) on the org owning the attributed department. Other roles denied.
- **Every assembly logged** as a `compliance.evidence_pack.assembled` audit event with the actor, role, and a correlation id that round-trips into the customer's pack envelope. The audit trail is itself auditable.

### 1.4 Public Verifier — the no-trust endpoint

A public `/verify` page reachable without authentication, where third-party auditors (PwC, EY, Deloitte, KPMG, regulators) drag-drop a customer's evidence pack and recompute every hash inside their browser using `SubtleCrypto`. Nothing leaves the auditor's machine. NEXPEC's servers are not involved. The algorithm is the proof — not our reputation.

- **Client-side canonical JSON + SHA-256** — same algorithm as server-side, with the source code displayed inline on the page so auditors can independently re-implement.
- **URL-claim banner** — `/verify?seal_id=X&hash=Y` surfaces the asserted seal id and root hash above the verifier. Auditor compares the URL claim against the recomputed root from the dropped pack. If they match, the link is authentic. If they don't, the pack has been modified or the link's claim is wrong.
- **No server roundtrip, no database access** — explicitly designed so a sceptical auditor never needs to trust us.

### 1.5 Compliance Command Center

A real-time anomaly detection layer over the audit trail, with six dedicated detectors surfaced via a posture summary RPC and rendered on the `/client/compliance` page.

- **Band evasion pattern** — repeated near-threshold submissions designed to fly under approval bands.
- **Rubber-stamping** — approvers with abnormally low rejection rates or sub-second decision latency.
- **Concentration risk** — single-counterparty exposure exceeding policy limits.
- **Quarter-end clustering** — anomalous spending right before fiscal close.
- **Off-hours decisions** — approval activity outside business hours.
- **Silent overrides** — Platform Owner bypasses that should remain visible to compliance leadership but never to tenants.

---

## 2. Enterprise Backbone — table stakes, executed correctly

### 2.1 Multi-tenant organisation + department hierarchy

- Recursive department tree with cycle-safe `move`, hard-deny on self-parent, cost-center attribution.
- Schema-level RLS with a SECURITY DEFINER helper (`is_member_of_org`) that resolved a critical infinite-recursion class of bug (42P17) at the policy layer.
- Six mutation RPCs (`create / rename / move / delete / assign-member / unassign-member`), each with role-gated authorization and full audit emission.
- Cost-center inheritance from job → invoice via `tg_invoice_inherit_department` trigger so finance always sees the canonical attribution even after a reassignment.

### 2.2 Multi-currency, live FX

- Nine supported ISO-4217 currencies (USD, EUR, GBP, AED, CAD, AUD, SGD, CHF, JPY).
- `fx_rates` time-series store with USD-pivot derivation and date-aware fallback.
- `convert_cents(amount, from, to, as_of)` — returns NULL deliberately when no path exists rather than silently substituting zero (which would hide data gaps in dashboards).
- Per-org `base_currency` setting drives every dashboard's display projection without ever mutating the underlying native invoice amount.
- **Live daily refresh** via `pg_cron` (06:05 UTC) → `pg_net` → `refresh-fx-rates` Edge Function → OpenExchangeRates API → `cron_upsert_fx_rate` with full N×N pair derivation and bookkeeping via `fx_refresh_runs`.

### 2.3 Real-time notification fanout + transactional email

- `notifications` table extended with an email-queue overlay (`email_required`, `email_template_kind`, `email_template_data`, `email_attempts`, `email_dispatched_at`, `email_send_error`).
- Four event-driven triggers fan out in-app + email notifications: approval requested, approval decided per-decision, approval finalised at terminal state (with timing-safe split), evidence pack assembled, inspection report sealed (PIE Sprint 2).
- `claim_pending_notification_emails(limit)` — atomic, `FOR UPDATE SKIP LOCKED` claim semantics — prevents double-send under concurrent dispatchers.
- `dispatch-notification-emails` Edge Function with Resend integration, five dedicated HTML+text templates in the locked NEXPEC dark/purple visual language, retry semantics (parks after 5 attempts), idempotency keys, and structured Resend tagging.
- `pg_cron` drain every 5 minutes with cheap-empty-queue short-circuit so we don't burn invocations during quiet periods.

### 2.4 Active org switcher (omnichannel)

- `profiles.active_org_id` as the single source of truth across web and mobile. No cookies, no localStorage, no client-side sync state.
- `set_active_org / clear_active_org / fetch_my_org_memberships` RPCs consumed identically by web and mobile.
- Mobile `OrgSwitcher` + `OrgSwitcherSheet` + `useOrgMemberships` mirror the web `OrgSwitcher` component with byte-equivalent data shapes from the shared `@nexpec/shared-core` zod schemas.

### 2.5 Singular Platform Owner doctrine

- Exactly **one** absolute Platform Owner identity (`profiles.role = 'super_admin'`) for the entire system. Not a tier, not a group.
- Customer-facing UI surfaces never expose the literal string `super_admin`; the canonical labels are "NEXPEC Admin" or "NEXPEC System". Audited end-to-end across chat, notifications, public profile, audit panels.
- Admin layout strictly excludes tenant-org context — the `/admin/*` surface is platform-scope only, never tenant-scope. Header chip falls back to a static "NEXPEC · Platform" label.

---

## 3. Marketplace Mechanics — the operational two-sided platform

These are existing capabilities the Trust Stack composes on top of, leveraged rather than reinvented.

### 3.1 Inspector marketplace

- Geospatial matching: `discover_jobs`, `inspectors_near_job`, `jobs_near_inspector` with PostGIS geog support.
- Search and ranking: `search_inspectors`, `get_marketplace_inspectors`, `get_top_inspectors` with rating, specialty, and verification filters.
- Inspector reputation engine with refresh function (`refresh_inspector_reputation`), daily-limit governance, badge surfacing, verification gating.

### 3.2 Job lifecycle + execution

- Full state machine with status-transition guard (`guard_jobs_status_transition`).
- Application flow: submit, view, withdraw, client counter, inspector respond, accept, reject — every transition triggers notifications.
- Inspector lifecycle: `inspector_start_job`, `submit_inspection_report`, structured `inspection_items` per report, `inspection_captures` with per-photo metadata (EXIF, GPS, accuracy, device attestation, face detection, liveness score).
- Approve/dispute/cancel paths each emit audit events; PCP intercepts dispatch when approval is gated.

### 3.3 Contracts + payments

- Contract generation with admin-side template, both-party digital signing (typed-name + IP capture), document URL + custom-contract URL support.
- Escrow-aware payment intent + setup intent flows via Stripe.
- Inspector payouts via Stripe Connect with status-sync webhook and manual `admin_mark_payout_processed` override.
- Platform spread tracking in `jobs.platform_spread_cents`, full audit emission per transaction.

### 3.4 Disputes + reviews

- Dispute opening, evidence URL attachment, admin resolution with structured outcomes (`admin_resolve_dispute_rpc`).
- Both-direction reviews (client↔inspector) with rating, public/private split, admin moderation queue.
- Flash report system for incident-style critical alerts with multi-attachment support and explicit state machine.

### 3.5 Compliance & verification onboarding

- CCI compliance applications with admin review flow.
- Inspector certifications + credential review (`admin_review_credential_rpc`).
- Legal consent capture with PDF receipt generation, Resend-delivered receipt email, and downstream audit log.

---

## 4. Field Operations Layer — the Provable Inspection Engine in production

The mobile inspector workspace, anchored on a stable base of capture infrastructure.

- **Photo capture with per-image SHA-256 chain** — every `inspection_capture` row carries `capture_sha256` + `prev_capture_sha256`, forming a Merkle-style chain. PIE Sprint 1 audits this chain at seal time.
- **EXIF + GPS + device attestation** — `inspection_captures` already stores GPS lat/lng + accuracy radius, device platform, device attestation token, face detection count, face liveness score, and a server-validation enum. PIE binds all of this into the seal.
- **Structured findings** via `inspection_items` (description, status, location, photo URL) — sealed into the items_root alongside captures.
- **Inspector mobile workspace**: dashboard, my-jobs, submit-findings, submit-report, negotiations, earnings, wallet, certificate wallet, withdrawals, disputes, notifications, profile verification, legal verification, CCI application.
- **Cross-platform parity**: shared `@nexpec/shared-core` zod schemas, identical RPC contracts, byte-equivalent behaviour between web and mobile dashboards.

---

## 5. The Platform Spine — engineering posture

### 5.1 Doctrine

- Every SECURITY DEFINER function declares `SET search_path = public, pg_temp` (or `, extensions, pg_temp` where pgcrypto is needed).
- Every mutation is RPC-only — direct table INSERT/UPDATE/DELETE blocked via REVOKE plus read-only RLS policies.
- Every audit-emitting RPC writes to `public.audit_events` with `event_type`, `severity`, `actor_id`, `actor_role`, `actor_label`, `subject_table`, `subject_id`, `summary`, `delta`, `metadata`, and `correlation_id`. Idempotent. Immutable.
- Defensive triggers — every trigger function body wrapped in `EXCEPTION WHEN OTHERS`, with notifications never able to block the underlying business write.

### 5.2 Observability

- `audit_events` is the immutable single source of truth — every state-changing action emits a row.
- Realtime publication via `supabase_realtime` on notifications, approval requests, decisions, seals — so the UI updates without polling.
- `fx_refresh_runs` bookkeeping for FX cron health, surfaced to Platform Owner via admin-only RLS.

### 5.3 Cross-platform architecture

- **Web**: Next.js 14 App Router, React Server Components, Tailwind, premium dark/violet visual language.
- **Mobile**: React Native + Expo Router 4, NativeWind, `@gorhom/bottom-sheet` v5, locked tokens (`#020420` background, `#7C3AED` primary).
- **Shared**: `@nexpec/shared-core` package — every zod schema lives once, consumed by both surfaces. Cross-platform drift is structurally impossible.
- **Backend**: Supabase Postgres + Auth + Storage + Edge Functions + Realtime + pg_cron + pg_net.

### 5.4 Edge Functions in production

- `refresh-fx-rates` — daily OpenExchangeRates fetch + N×N pair upsert.
- `dispatch-notification-emails` — Resend integration with five HTML+text templates, idempotency keys, retry semantics.
- `notify-job-event`, `critical-alert-monitor`, `send-consent-receipt`, `handle-dispute`, `generate-contract`, `generate-dispute-report`, `generate-vca`, `verify-affidavit`, `verify-contractor`, `assign-inspector-to-job`, `backfill-country-of-residence`, `create-payment-intent`, `create-setup-intent`, `create-stripe-connect-link`, `create-stripe-payout`, `create-wallet-deposit-intent`, `process-payout`, `release-payment`, `stripe-connect-redirect`, `stripe-connect-webhook`, `stripe-payments-webhook`, `sync-payment-method`, `sync-stripe-connect-status`, `notify-job-assigned`. Twenty-five functions live in production.

---

## 6. Competitive moats

1. **Cryptographic verifiability without trust** — the public `/verify` page is the strategic moat. Competitors can build approval flows. They cannot build *regulator-grade evidence packs that don't require trusting the platform vendor*, because that requires a deliberate engineering posture from day one: deterministic canonical JSON, per-artifact hashing, root composition, immutable audit emission, and a public verifier UI that explicitly does not call home.

2. **Schema-enforced SoD** — competitors enforce Segregation of Duties in application code. NEXPEC enforces it via a Postgres `CONSTRAINT TRIGGER`. The application cannot bypass it. A malicious or buggy frontend deploy cannot bypass it. The database itself refuses to record a self-approval.

3. **Cross-platform parity by construction** — shared-core zod schemas guarantee web and mobile cannot drift. New surfaces (a future admin desktop tool, a future regulator portal) inherit the same contracts for free.

4. **Audit-of-audit capability** — every action by every party, including the Platform Owner, lands in `audit_events`. The Platform Owner cannot silently override compliance controls — the override is itself an auditable event surfaced by the Compliance Command Center's "silent overrides" detector.

5. **Provable inspection from photo to PDF** — competitors store photos as URLs. NEXPEC hashes each photo at capture, chains the hashes, anchors them under a report root, signs that root as the inspector, accepts a client countersignature against the same root, and writes the whole chain into a tamper-evident evidence pack that re-verifies in a browser without us in the room.

---

## 7. What is live in production today

| System | Status |
| --- | --- |
| Multi-tenant org + departments | Live |
| Cost-center attribution + invoice inheritance | Live |
| Multi-currency + live FX cron | Live |
| Procurement Control Plane (policies, budgets, approvals, SoD) | Live |
| Active org switcher (web + mobile) | Live |
| Compliance Evidence Locker (assemble_evidence_pack) | Live |
| Public /verify endpoint | Live |
| Compliance Command Center (6 detectors) | Live |
| Real-time notification fanout (approvals, decisions, seals, evidence packs) | Live |
| Transactional email layer (Resend + 5 templates) | Live |
| Provable Inspection Engine (seal + countersign + mobile screen) | Live |
| CEL → seal wiring (inspection_seals artifact in pack) | Live |
| Seal-driven countersign email to clients | Live |
| /verify URL-claim banner for mobile-issued links | Live |

Every row above is verifiable against `supabase/migrations/`, `apps/web/src/`, `app/`, `src/components/`, and `supabase/functions/` on disk.

---

## 8. Strategic position

NEXPEC sits at the intersection of three categories that have historically been served by separate vendors:

- **Field service marketplaces** (ServiceTitan, Jobber, BlueFolder) — operationally rich, compliance-thin.
- **Procurement / sourcing platforms** (Coupa, Ariba, Ivalua) — financially rigorous, marketplace-thin.
- **GRC / audit tooling** (AuditBoard, Workiva, Hyperproof) — compliance-rich, transactionally inert.

Each of these vendors has tried to extend into adjacent categories. None of them have shipped *cryptographic chain-of-custody from the field photo to the regulator's verifier* because doing so requires a unified data model — you cannot bolt SHA-256 anchoring onto a vendor architecture that treats inspection artifacts as opaque file URLs.

NEXPEC built the unified data model first. Every other capability composes on top of it. The result is the only platform where a chief compliance officer at a Fortune 500 buyer can hand a regulator one URL and one hash, and the regulator can verify the entire audit trail in their browser without ever creating an account.

That is the defensible thesis.

---

*End of catalog. For technical architecture details, see `docs/` and the migration history under `supabase/migrations/`.*
