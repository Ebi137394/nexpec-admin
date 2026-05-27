# NEXPEC — Master Capabilities Catalog

*Tier-1 Investor & Enterprise-Buyer Edition*

---

## Executive Brief

NEXPEC is the first vertically-integrated marketplace for inspection services in which every transaction — from the moment a buyer drafts a job, to the moment a regulator opens an evidence pack — is bound under a single cryptographically verifiable chain of custody.

We are not a field-service platform with compliance bolted on. We are not a procurement suite with a marketplace bolted on. We are not a GRC tool with payments bolted on. We are a category-creating platform whose data model was designed, from the first migration, to satisfy SOX 404, ISO 19011 audit-trail expectations, and external-auditor verification *without requiring trust in our infrastructure*.

The platform is live in production across three surfaces: a Next.js 14 web application (83 pages), a React Native + Expo mobile application (223 screens), and a Supabase Postgres backend (95 migrations, 26 Edge Functions). Web and mobile share one source of truth (the `@nexpec/shared-core` package) — making cross-platform drift structurally impossible.

This document enumerates every capability shipped to production, organized into 20 capability domains. Section 19 articulates the strategic moat. Section 20 is the production-status matrix.

---

## Table of Contents

1. [Cryptographic Trust & Compliance Stack](#1-cryptographic-trust--compliance-stack)
2. [Procurement Control Plane (SOX 404)](#2-procurement-control-plane-sox-404)
3. [Financial & FX Engine](#3-financial--fx-engine)
4. [Multi-Tenant Enterprise Architecture](#4-multi-tenant-enterprise-architecture)
5. [Field Execution & Offline-Capable Mobile Stack](#5-field-execution--offline-capable-mobile-stack)
6. [Marketplace Mechanics & Two-Sided Liquidity](#6-marketplace-mechanics--two-sided-liquidity)
7. [Contract & Document Lifecycle](#7-contract--document-lifecycle)
8. [Real-Time Notification Fabric](#8-real-time-notification-fabric)
9. [Edge Function Infrastructure](#9-edge-function-infrastructure)
10. [External Integration Surface](#10-external-integration-surface)
11. [Identity, Access & Verification](#11-identity-access--verification)
12. [Dispute Resolution & Quality Assurance](#12-dispute-resolution--quality-assurance)
13. [Web Application Surface](#13-web-application-surface)
14. [Mobile Application Surface](#14-mobile-application-surface)
15. [Cross-Platform Synchronization](#15-cross-platform-synchronization)
16. [Data Integrity & Engineering Posture](#16-data-integrity--engineering-posture)
17. [Anomaly Detection & Risk Surveillance](#17-anomaly-detection--risk-surveillance)
18. [Operational Excellence](#18-operational-excellence)
19. [Strategic Moats & Defensible Position](#19-strategic-moats--defensible-position)
20. [Production Status Matrix](#20-production-status-matrix)

---

## 1. Cryptographic Trust & Compliance Stack

The strategic core of the platform. Five interlocking systems that produce regulator-grade evidence without requiring trust in NEXPEC.

### 1.1 Provable Inspection Engine (PIE)

**Cryptographic chain-of-custody from photo capture to evidence pack.**

- `inspection_captures.capture_sha256` and `prev_capture_sha256` — per-photo SHA-256 chain forming a hash-linked sequence at the artifact level.
- `pi_report_seals` — sidecar table storing one seal per inspection report. Idempotent re-seal semantics; uniqueness enforced at the schema layer.
- `pi_canonical_json()` — deterministic JSON canonicaliser in PL/pgSQL with object-key lexicographic sorting and byte-equivalent output to the web client's algorithm.
- `pi_seal_inspection_report(report_id)` — server-side RPC that re-walks the photo chain, validates every link, composes captures-root + items-root + report-meta-root, then composes the anchor `root_sha256` over those three sub-roots in lexicographic order. Inspector-signed.
- `pi_countersign_inspection_report(report_id)` — client-side counter-signature against the same root, producing a second binding signature.
- `pi_fetch_report_seal(report_id)` — read-only RPC with explicit three-tier authorization (super_admin / inspector / job client).
- **Chain-break transparency** — if any per-photo prev-hash mismatches, the seal still completes but `chain_verified=false` is recorded with `chain_break_at_capture_id` pointing to the failure. Truth-telling over silent failure.
- **Algorithm versioning** via `algorithm` column (`sha256/canonical-json/v1`) so future cryptographic evolutions remain backwards-verifiable.

### 1.2 Compliance Evidence Locker (CEL)

**Deterministic, third-party-verifiable bundle of every artifact in a job's lifecycle.**

- `assemble_evidence_pack(job_id)` returns a single JSONB document with eight artifact groups:
  - Job snapshot (`jobs`)
  - Parties (client + inspector profile snapshots)
  - Department + cost-center snapshot
  - All contract revisions with signature evidence (typed name, IP, timestamps)
  - Approval request + per-approver decisions
  - All invoices with line-item detail
  - Scoped audit events (subject-matched + metadata-matched + related-subject union)
  - Inspection seals (PIE Sprint 2 wiring — root hashes embedded in pack)
- **Byte-identical determinism** — every subquery uses explicit `ORDER BY` clauses; timestamps cast to ISO 8601; no `now()` / `gen_random_uuid()` / `auth.uid()` inside the artifact payload. Two consecutive calls against unchanged data produce identical JSONB.
- **Three-tier authorization gate** (`can_assemble_evidence_for(job_id, user_id)`) — Platform Owner universal; job parties (client / inspector) on their own jobs; Enterprise Admins (`owner`, `procurement_admin`) on the department's parent org.
- **Audit-of-audit emission** — every successful assembly writes its own `compliance.evidence_pack.assembled` event with a correlation_id that round-trips into the customer's pack envelope.

### 1.3 Public Verifier — the No-Trust Endpoint

**An unauthenticated public web page where third-party auditors recompute every hash in their browser using SubtleCrypto.**

- Pure client-side: SubtleCrypto + the published canonical-JSON algorithm.
- Source code for the canonicaliser displayed inline on the page so auditors can independently re-implement.
- URL-claim banner (`/verify?seal_id=X&hash=Y`) surfaces the asserted seal ID and root hash above the drop zone; auditor compares URL claim against the recomputed root from the dropped pack.
- Zero server roundtrip, zero database access. Explicitly designed so sceptical auditors never need to trust NEXPEC's infrastructure.
- Suspense-wrapped client component preserves the page's `force-static` cache profile.

### 1.4 Compliance Command Center

**Real-time anomaly surveillance over the audit trail, surfaced via a posture summary and six anomaly detectors.**

- `compliance_posture_summary(org_id)` — single RPC returning overall posture with risk indicators.
- Six dedicated detectors:
  - `detect_band_evasion_pattern` — repeated near-threshold submissions designed to fly under approval bands.
  - `detect_rubber_stamping` — approvers with abnormally low rejection rates or sub-second decision latency.
  - `detect_concentration_risk` — single-counterparty exposure exceeding policy thresholds.
  - `detect_quarter_end_clustering` — spending spikes immediately before fiscal close.
  - `detect_off_hours_decisions` — approval activity outside business hours.
  - `detect_silent_overrides` — Platform-Owner bypasses surfaced to compliance leadership but never to tenants.
- Web surface at `/client/compliance` with hero posture card and live anomaly feed.

### 1.5 Immutable Audit Trail

**Single append-only source of truth for every state-changing action.**

- `audit_events` table with 14 standard columns: id, created_at, event_type, severity (info/warning/critical), actor_id, actor_role, actor_label, subject_table, subject_id, job_id, summary, delta (JSONB), metadata (JSONB), correlation_id.
- Six dedicated indexes: subject, actor, job timeline, critical-severity-only, event-type, correlation.
- Every audit row emitted by an RPC or trigger — never written from application code directly.
- Defensive: emission wrapped in EXCEPTION handlers so audit failure never blocks the underlying business write.

---

## 2. Procurement Control Plane (SOX 404)

**Schema-enforced procurement governance that cannot be bypassed by application code.**

### 2.1 Approval Policies

- `approval_policies` table with currency-aware band thresholds, departmentally scoped, mutually-exclusive band-overlap validated by `tg_approval_policies_no_overlap` constraint trigger.
- Policy editor UI on web at `/client/budget/policies` with inline band creation, currency-native rendering, and policy-coverage gap warnings.

### 2.2 Schema-Enforced Segregation of Duties

- `tg_approval_decisions_enforce_sod` — CONSTRAINT TRIGGER on `approval_decisions` that refuses any decision row where `decided_by = approval_request.requested_by`.
- SoD is enforced at three depths: (a) schema trigger, (b) RPC layer in `submit_job_approval`, (c) UI filtering server-side in `fetch_my_pending_approvals`.
- Explicit opt-out via `requires_sod=false` on the approval request, set at policy-definition time (not at decision time) so opt-outs surface in audit-of-audit checks.

### 2.3 Department Budget Envelopes

- `department_budgets` table with period-based envelopes (monthly / quarterly / annual), currency-native amounts, multi-currency rollup support.
- `check_department_budget(department_id, amount_cents, currency)` — pre-flight inquiry returning has_budget, would_exceed, available_cents.
- `fetch_department_budget_rollup` + `fetch_department_spend_summary` — per-currency grouping with synthetic "Unattributed" bucket and currency-conversion overlay for display.
- Envelope editor UI on web at `/client/budget/envelopes`.

### 2.4 Approval Request Lifecycle

- `approval_requests` table with snapshotted policy fields at request time — subsequent policy edits never retroactively change what was required.
- One active request per job (UNIQUE constraint); supersession requires explicit cancellation.
- Quorum logic via `min_approvers_required` + `required_approver_roles[]`, enforced inside `submit_job_approval` with atomic terminal-state transition.
- `cancel_job_approval` for clean withdrawal; `open_job_approval_request` for explicit initiation.
- `evaluate_job_for_approval` — debounced pre-flight inquiry used by the post-new-job form on both web and mobile to surface the approval verdict live, before submission.

### 2.5 Approval Decision Engine

- `approval_decisions` table with `decider_role_at_time` snapshot (preserves audit context even if seat role later changes).
- UNIQUE constraint on `(approval_request_id, decided_by)` makes double-approval mathematically impossible.
- Terminal-state propagation: any rejection short-circuits the request; approval quorum releases the gate; idle requests retain pending state.

### 2.6 Mobile Parity

- Mobile approver dashboard (`ApprovalsScreen`) consuming `fetch_my_pending_approvals`.
- Mobile decision sheet (`ApprovalDecisionSheet`) calling `submit_job_approval` directly.
- Live approval-gate preview banner (`useEvaluateApproval`) on the mobile job-post form with 450ms debounce, matching the web preview.

---

## 3. Financial & FX Engine

### 3.1 Multi-Currency Core

- `public.currency_code` ENUM with nine ISO-4217 codes (USD, EUR, GBP, AED, CAD, AUD, SGD, CHF, JPY).
- `fx_rates` time-series store with USD-pivot derivation, unique `(base, quote, effective_date)` constraint, self-pair identity check, source attribution (manual / openexchangerates / identity).
- `convert_cents(amount, from, to, as_of)` — date-aware conversion with two-hop USD pivot fallback. Returns NULL deliberately when no path exists rather than silently substituting zero, preventing hidden data gaps from polluting dashboards.
- Per-org `organizations.base_currency` setting drives display projection on every dashboard without ever mutating underlying native invoice amounts.

### 3.2 Live FX Cron

- `pg_cron` daily schedule at 06:05 UTC.
- `cron_kickoff_fx_refresh` → `pg_net.http_post` → `/functions/v1/refresh-fx-rates` Edge Function.
- Edge Function fetches OpenExchangeRates `latest.json` (base=USD), derives every directed pair across all nine currencies via USD-pivot arithmetic, upserts via `cron_upsert_fx_rate` (service-role-only).
- `fx_refresh_runs` bookkeeping table records every tick with started_at, completed_at, succeeded, rates_upserted, error_message, http_status.
- Admin-only RLS on the bookkeeping table.

### 3.3 Cost-Center Attribution

- `jobs.department_id` and `invoices.department_id` columns.
- `tg_invoice_inherit_department` trigger — invoices inherit the job's department at insertion time and snapshot the cost center.
- `reassign_invoice_department` RPC for finance overrides, with full audit emission.
- Web reassign dialog mounted on both `/admin/invoices/[id]` and `/client/invoices/[id]`.

### 3.4 Stripe Payment Infrastructure

- Eight dedicated Edge Functions for payments:
  - `create-payment-intent` — buyer escrow loading
  - `create-setup-intent` — saved payment methods
  - `create-stripe-connect-link` — inspector onboarding
  - `create-stripe-payout` — payout initiation
  - `create-wallet-deposit-intent` — wallet funding
  - `stripe-connect-redirect` — Connect OAuth return handler
  - `stripe-connect-webhook` — Connect account event sync
  - `stripe-payments-webhook` — payment + payout event sync
- `sync-stripe-connect-status` + `sync-payment-method` for state reconciliation.
- `release-payment` for escrow release on completed jobs.
- `process-payout` for payout queue processing.
- Webhook claim pattern via `complete_stripe_webhook_event` for idempotent event handling.
- `jobs.platform_spread_cents` tracking platform fee per job.

### 3.5 Invoicing Infrastructure

- `invoices` table with invoice_number, client + inspector amounts, platform fee, total, currency, status, issued_at, due_date, approved_at, disputed_at, paid_at, voided_at, line_items_json.
- Department + cost-center snapshot persisted per invoice.
- `get_budget_by_inspector` RPC for inspector-side financial dashboard.

### 3.6 Payout Engine

- `payout_status` lifecycle on jobs (`unpaid → pending → paid`).
- `admin_mark_payout_processed` RPC for manual reconciliation.
- `payout_marked_by`, `payout_paid_at`, `payout_reference`, `payout_notes` columns for full provenance.

---

## 4. Multi-Tenant Enterprise Architecture

### 4.1 Organisation & Department Hierarchy

- `organizations` table with kind (`enterprise` / `agency`), slug, base_currency.
- `org_members` table with `org_member_role` ENUM (`owner`, `procurement_admin`, `project_lead`, `viewer`).
- `departments` table with recursive parent-child structure, cost-center attribution, member counts, full audit emission.
- Six mutation RPCs: `create_department`, `rename_department`, `move_department` (cycle-safe with explicit cycle detection), `delete_department`, `assign_department_member`, `unassign_department_member`.

### 4.2 Department Tree

- `fetch_department_tree(org_id)` — depth-annotated recursive CTE returning the flat, ordered tree for indented display.
- `can_manage_org_structure(org_id, user_id)` — predicate combining super_admin universal access with elevated org-member roles.
- Used identically by web admin tree, web client tree, and mobile department picker.

### 4.3 Row-Level Security Posture

- Every tenant-scoped table has RLS enabled with explicit policies for: super_admin universal access; party-on-record access; elevated-role org-member access.
- `is_member_of_org(org_id)` — SECURITY DEFINER helper that bypasses RLS to resolve membership without recursion (resolved a critical 42P17 infinite-recursion class of bug at the policy layer).

### 4.4 Active Org Switcher (Omnichannel)

- `profiles.active_org_id` as the single database-backed source of truth across web and mobile. No cookies, no localStorage, no client-side sync.
- `set_active_org`, `clear_active_org`, `fetch_my_org_memberships` RPCs consumed identically by both surfaces.
- Mobile `OrgSwitcher` + `OrgSwitcherSheet` + `OrgSwitcherTrigger` + `useOrgMemberships`.
- Web `OrgSwitcher` integrated into shared `Header` component.

### 4.5 Singular Platform Owner Doctrine

- Exactly one absolute Platform Owner identity (`profiles.role = 'super_admin'`). Not a tier, not a group.
- Customer-facing UI strictly forbidden from exposing the literal string `super_admin`; canonical labels are "NEXPEC Admin" or "NEXPEC System". Audited end-to-end.
- Admin layout (`/admin/*`) strictly excludes tenant-org context; header chip falls back to static "NEXPEC · Platform" label.
- Whitepaper formalising the doctrine present in the repo for future contributors.

---

## 5. Field Execution & Offline-Capable Mobile Stack

### 5.1 Capture Pipeline

- `inspection_captures` table — the field-execution data layer with 24 columns:
  - Identity: id, job_id, requirement_id, inspector_id
  - Classification: kind (USER-DEFINED enum), sort_index
  - Storage: storage_path, mime_type, file_size_bytes
  - Geospatial: gps_lat, gps_lng, gps_accuracy_m, gps_pin (PostGIS), captured_at
  - Device attestation: device_attestation_token, device_platform
  - **Cryptographic chain**: capture_sha256, prev_capture_sha256
  - ML enrichment: face_detected_count, face_liveness_score
  - Free-form: text_payload, signature_payload (JSONB)
  - Server validation: server_validation_status (compliance_capture_validation ENUM), server_flags_json, server_validated_at
  - EXIF: exif_json
- `inspection_evidence_requirements` per template — per-job evidence requirements that drive the capture UI.

### 5.2 Structured Inspection Records

- `inspection_reports` — top-level report with status state machine, technical/financial approval pairs, publication flag, client-approved flag, signed-docs URLs.
- `inspection_items` — structured findings per report (description, status, photo_url, notes, location).
- `report_templates` — JSONB schema definitions for inspection forms with header/footer template support.
- `inspection_scope_templates` — scope contracts attached to jobs.
- `handle_inspection_report_state_machine`, `handle_report_submission`, `handle_report_status_change` — three triggers governing the state lifecycle.

### 5.3 Mobile Inspector Workspace

- Inspector dashboard, super-dashboard, my-jobs, submit-findings, submit-report, negotiations, earnings, wallet, certificate wallet, withdrawals, disputes, notifications, profile verification, legal verification, CCI compliance application.
- **PIE seal screen** (Sprint 1) at `/inspector/seal-report` — single leaf with `Seal & Sign` action and read-only sealed display.

### 5.4 Mobile Native Module Coverage

Installed and available (no new dependencies added in PIE):
- `expo-camera` + `expo-image-picker` + `expo-image-manipulator` — photo capture & editing
- `expo-location` — GPS + accuracy radius
- `expo-file-system` — large-file handling
- `expo-crypto` — on-device SHA-256
- `expo-secure-store` — credential storage
- `expo-sqlite` — local persistence
- `expo-local-authentication` — biometric unlock
- `expo-haptics` — tactile feedback
- `expo-notifications` — Expo push
- `expo-print` — PDF rendering
- `expo-sharing` — share-sheet
- `expo-clipboard` — copy
- `expo-sms`, `expo-calendar`, `expo-sensors`, `expo-screen-orientation`, `expo-blur`, `expo-linear-gradient`, `expo-document-picker`, `expo-apple-authentication`, `expo-web-browser`, `expo-av` — full Expo SDK coverage.

### 5.5 Mobile Theme System

- Locked tokens: background `#020420`, primary `#7C3AED`, primary-dark `#5B21B6`, card `#0F172A`, card border `#1E293B`, text primary `#F1F5F9`, text muted `#94A3B8`, success `#10B981`, warning `#F59E0B`, danger `#EF4444`.
- NativeWind (Tailwind for React Native) + StyleSheet hybrid pattern.
- Premium dark/violet visual language across every surface.

### 5.6 Mobile Library Stack

- `@gorhom/bottom-sheet` v5 — premium gesture-driven sheets.
- `react-native-signature-canvas` — digital signature capture.
- `react-native-maps` + `react-native-map-clustering` + `react-native-map-link` — premium mapping with clustering for high-density inspector markers.
- `react-native-gifted-charts` — premium native chart rendering.
- `react-native-gifted-chat` — premium chat surface.
- `react-native-pdf` — embedded PDF rendering for contracts and reports.
- `react-native-keyboard-controller` — premium keyboard UX.
- `react-native-reanimated` — 60 FPS animations on the UI thread.
- `react-native-blob-util` — efficient binary handling for photo uploads.
- `lottie-react-native` — premium motion graphics.
- `lucide-react-native` — consistent iconography across the app.
- `@tanstack/react-query` + `@tanstack/query-async-storage-persister` — offline-friendly data layer.

---

## 6. Marketplace Mechanics & Two-Sided Liquidity

### 6.1 Job Lifecycle

- `jobs` table with 60+ columns covering: title, description, status, moderation status, urgency, job type, location (textual + geocoded + PostGIS geog), pricing (price, budget min/max, client price, inspector payout, platform spread, currency), scheduling, contract attachment, escrow status, payout status, calendar sync, sponsorship offering, remote-acceptance flag.
- Status state machine: `pending_approval → open → assigned → in_progress → completed` (with `cancelled` and `pending_approval` as additional terminal-aware states).
- `guard_jobs_status_transition` — central transition guard.
- `tg_jobs_notifications_v2`, `tg_notify_jobs` — lifecycle notification fanout.

### 6.2 Geospatial Matching

- PostGIS geog columns on jobs and inspector profiles.
- `discover_jobs(inspector_id, lat, lng, radius_km, city_query, limit, offset)` — primary discovery RPC.
- `inspectors_near_job(job_id, max_km, limit)` — buyer-side suggestion engine.
- `jobs_near_inspector(inspector_id, max_km, limit)` — inspector-side feed.
- `notify_inspectors_about_existing_job` + `notify_inspectors_on_job_approved` — proactive inspector dispatch.

### 6.3 Inspector Discovery & Reputation

- `get_marketplace_inspectors(...)` — primary buyer-side directory with rating, verification, availability, location, NDT methods, sort options.
- `search_inspectors(...)` — full-text search variant.
- `get_top_inspectors(limit, min_jobs, min_rating)` — leaderboard.
- `get_inspector_reputation(inspector_id)` — aggregate scorecard.
- `refresh_inspector_reputation()` — background recomputation.
- `set_inspector_daily_limit(user_id, new_limit)` — admin governance.

### 6.4 Application Flow

- `job_applications` table with cover_letter, proposed_price_cents, last_viewed_by_client, status.
- `has_applied_to_job(job_id)` — predicate for UI gating.
- `inspector_respond_to_counter(application_id, decision, note)` — counter-offer flow.
- `increment_job_applications_count` trigger keeps a denormalized counter for fast list rendering.

### 6.5 Assignment & Hiring

- `assign_job_contractor(job_id, contractor_id)` — admin assignment RPC.
- `invite_inspector_to_job(job_id, inspector_id, message)` — direct invitation.
- `inspector_start_job(job_id)` — inspector-initiated transition to `in_progress`.
- `approve_job_and_pay(job_id, inspector_id, amount)` — combined completion + payment release.
- `handle_job_acceptance`, `handle_job_cancellation`, `handle_job_completion` — three lifecycle triggers.

---

## 7. Contract & Document Lifecycle

### 7.1 Contract Generation

- `contracts` and `job_contracts` tables with contract_text, document_url, external_link, custom_contract_url.
- `generate_contract_for_job(job_id)` — primary generation RPC.
- `admin_generate_job_contract(application_id, client_price_cents, inspector_payout_cents, contract_text_md, custom_contract_url)` — admin override path.
- `get_template_for_job(job_id)` — template resolution.
- `generate-contract` Edge Function for server-side PDF generation.

### 7.2 Digital Signing

- `client_sign_job_contract(contract_id, typed_name, ip)` and `inspector_sign_job_contract(contract_id, typed_name, ip)` — both-party signing with typed-name + IP capture.
- Signature timestamps (`client_signed_at`, `contractor_signed_at`, `inspector_signed_at`) preserved per party.
- `react-native-signature-canvas` for in-app signature pad capture on mobile.
- Contract status state machine drives downstream payment + dispatch.

### 7.3 Document Storage

22 dedicated Supabase Storage buckets:
- `avatars` (public) · `branding_assets` · `certificates` · `certification-files` (public) · `certifications` · `chat_attachments` · `client_documents` · `compliance` · `contracts` · `dispute-evidence` · `documents` · `flash-report-attachments` · `inspection_photos` · `inspection-photos` · `inspection-reports` · `inspector_certificates` · `inspector-docs` · `job-documents` · `receipts` · `report-images` · `resumes`.

### 7.4 Branding & White-Label

- Per-tenant branding settings page on web at `/client/branding-settings` and mobile equivalent.
- `branding_assets` bucket for tenant logos and palette overrides.

---

## 8. Real-Time Notification Fabric

### 8.1 In-App Notification Layer

- `notifications` table with recipient_id, kind, title, body, link_href, job_id, is_read, created_at, read_at — plus the email-queue overlay (email_required, email_dispatched_at, email_attempts, email_send_error, email_template_kind, email_template_data).
- `notify_safe(recipient, kind, title, body, link, job_id)` — defensive notification helper that never raises on failure.
- `notify_admins(...)` — broadcast variant for Platform Owner dispatch.
- `enqueue_notification(...)` — unified helper that pushes both the in-app row AND the email-queue stamp in a single call.
- `profiles.unread_notifications_count` denormalized counter maintained automatically.

### 8.2 Event-Driven Trigger Network

Five dedicated AFTER-INSERT or AFTER-UPDATE triggers fan out notifications across the platform:

- `tg_notify_approval_requested` — pings every eligible approver (filtered by SoD and snapshotted `required_approver_roles[]`).
- `tg_notify_approval_decided` — per-decision ping to the requester.
- `tg_notify_approval_finalised` — terminal-state announcement (timing-safe split, fires on the request status update, never on the per-decision insert).
- `tg_notify_evidence_pack_assembled` — pings the pack assembler and broadcasts to compliance leadership.
- `tg_notify_inspection_report_sealed` — pings the client with a deep link to the countersign action when a PIE seal lands.

Plus the legacy comprehensive trigger network covering: messages, jobs (status, hiring, moderation, escrow, payout), job applications, reviews, disputes, contract assignments, transactions.

### 8.3 Email Queue & Dispatch

- `claim_pending_notification_emails(limit)` — atomic `FOR UPDATE SKIP LOCKED` claim semantics preventing double-send under concurrent dispatchers.
- `mark_notification_email_sent(notification_id, provider_id)` and `mark_notification_email_failed(notification_id, error)` — service-role-only outcome RPCs.
- `dispatch-notification-emails` Edge Function with Resend integration, idempotency keys, structured Resend tags, retry-with-park semantics (5-attempt cap).
- Five dedicated HTML+text templates: `approval.requested`, `approval.decided.approved`, `approval.decided.rejected`, `evidence_pack.assembled`, `inspection_report.sealed_awaiting_countersign`. Plus a generic fallback.
- All templates render in the locked NEXPEC dark/purple visual language.
- `pg_cron` drains the queue every 5 minutes with cheap empty-queue short-circuit.

### 8.4 Push Notifications

- Expo push token registration via `usePushNotifications` hook.
- `push_tokens` table with device, platform, last-seen tracking.
- `notify-job-event` Edge Function delivers Expo push with `DeviceNotRegistered` cleanup.

### 8.5 Realtime Publication

- Supabase Realtime publication on: `notifications`, `pi_report_seals`, plus all standard publication tables.
- Mobile and web both subscribe via supabase-js channel API for sub-second UI updates.

### 8.6 Notification Preferences

- Per-user notification settings surface at `/notification-settings`.
- Channel-by-channel toggles for in-app vs email vs push.

---

## 9. Edge Function Infrastructure

**26 Edge Functions in production** spanning payments, communications, compliance, scheduled jobs, and verification.

### 9.1 Payments & Stripe (10 functions)

- `create-payment-intent`, `create-setup-intent`, `create-stripe-connect-link`, `create-stripe-payout`, `create-wallet-deposit-intent`, `stripe-connect-redirect`, `stripe-connect-webhook`, `stripe-payments-webhook`, `sync-payment-method`, `sync-stripe-connect-status`, `process-payout`, `release-payment`.

### 9.2 Communications (3 functions)

- `dispatch-notification-emails` (Resend + 5 templates).
- `notify-job-event` (Expo push fanout).
- `notify-job-assigned` (assignment-specific path).
- `send-consent-receipt` (legal NDA PDF + Resend).

### 9.3 Compliance & Verification (5 functions)

- `verify-affidavit`, `verify-contractor` — KYC + credential verification.
- `generate-vca` — variance change authorization document.
- `generate-dispute-report` — dispute resolution PDF.
- `critical-alert-monitor` — incident-triggered webhook for `inspection_events` with `result='fail'` or `type='incident'`.

### 9.4 Scheduled Jobs (1 function)

- `refresh-fx-rates` — daily OpenExchangeRates fetch + N×N pair upsert.

### 9.5 Document Generation (2 functions)

- `generate-contract` — server-side contract PDF.
- `handle-dispute` — dispute lifecycle handler.

### 9.6 Operational (2 functions)

- `assign-inspector-to-job` — admin assignment with side-effects.
- `backfill-country-of-residence` — one-off data migration utility.

### 9.7 Cron & Orchestration

- `pg_cron` with two scheduled jobs:
  - `nexpec-fx-refresh-daily` at 06:05 UTC.
  - `nexpec-email-dispatch-5min` every 5 minutes (with queue-empty short-circuit).
- `pg_net.http_post` for asynchronous in-database HTTP dispatch.
- Shared cron secret via DB runtime setting `app.settings.cron_secret` + matching Edge Function env var.

---

## 10. External Integration Surface

### 10.1 Stripe (Primary Payment Rails)

- Stripe Payments + Stripe Connect Express.
- `@stripe/stripe-react-native` for mobile checkout flows.
- Webhook event claim pattern via `complete_stripe_webhook_event` ensuring exactly-once event processing under retry.
- Platform-spread accounting via `jobs.platform_spread_cents`.
- Escrow lifecycle: `escrow_status` column with `pending → held → released → disputed → refunded` states.

### 10.2 Resend (Transactional Email)

- All transactional email routed through `dispatch-notification-emails` Edge Function.
- Idempotency-Key header set to the notification UUID — Resend de-duplicates within 24 hours.
- Structured tag propagation (kind, template) for downstream analytics.
- Custom X-NEXPEC-* headers for diagnostic correlation.
- Five purpose-built templates plus generic fallback.

### 10.3 OpenExchangeRates (FX Rates)

- Daily 06:05 UTC pull via cron-triggered Edge Function.
- USD-pivot N×N derivation across all nine supported currencies.
- Bookkeeping in `fx_refresh_runs` (started_at, completed_at, succeeded, rates_upserted, error_message, http_status).

### 10.4 Expo Push (Mobile Notifications)

- Native Expo push token registration.
- `DeviceNotRegistered` cleanup via `notify-job-event` Edge Function.
- Token rotation handled automatically by `usePushNotifications`.

### 10.5 Apple Authentication

- `expo-apple-authentication` integrated for Sign In with Apple on iOS.

### 10.6 Map Providers

- `react-native-maps` (Apple Maps on iOS, Google Maps on Android).
- `react-native-map-clustering` for high-density inspector visualization.
- `react-native-map-link` for deep linking to native turn-by-turn navigation.

### 10.7 Supabase Platform

- Auth (email + OAuth + Apple).
- Postgres (with pgcrypto, pg_cron, pg_net extensions enabled).
- Storage (22 buckets).
- Edge Functions (Deno runtime).
- Realtime (logical replication on notifications + seals).

---

## 11. Identity, Access & Verification

### 11.1 Authentication Flow

- Email + password.
- Sign in with Apple (iOS).
- OAuth providers via Supabase Auth.
- Magic-link fallback.
- `expo-secure-store` for credential persistence on mobile.
- `expo-local-authentication` for biometric unlock.

### 11.2 Role System

- `profiles.role` with values: `super_admin`, `admin`, `client`, `inspector`, `agency`, `senior`.
- `handle_new_user_role` trigger applies role on profile creation.
- `apply_onboarding_role_rpc` for explicit role-assumption flows.
- Role-based route grouping in Expo Router: `(admin)`, `(super-admin)`, `(client)`, `(inspector)`, `(agency)`, `(senior)`, `(organization)`, `(tabs)`, `(modals)`, `(auth)`, `(shared)`.

### 11.3 Profile System

- Identity (full_name, email, avatar_url).
- Contact (phone, country, city).
- Credential summary (NDT methods, certifications).
- Reputation snapshot (rating, total_jobs, badge tier).
- Verification status (`is_verified`, `kyc_status`).
- Active org context (`active_org_id`).
- Counters (`unread_notifications_count`).

### 11.4 Inspector Verification (CCI)

- `cci_applications` table with submission, review, decision lifecycle.
- `admin_review_credential_rpc` — Platform Owner credential review.
- Inspector certificate wallet at `/inspector/wallet/cert-wallet`.
- `inspector_certificates` bucket for credential file storage.
- `inspector_certificates` table with expiration tracking and `touch_inspector_certificates_updated_at` trigger.

### 11.5 Legal Consent Capture

- `legal_consents` table with consent type, policy version, signed_at, IP, user-agent.
- `send-consent-receipt` Edge Function generates a PDF receipt and emails it via Resend.
- `consent_audit_logs` for chain-of-custody on the consent flow itself.

### 11.6 Onboarding

- Choose-role onboarding flow at `/(auth)/choose-role`.
- Sign-up via `/(auth)/sign-up`.
- Sign-in via `/(auth)/sign-in`.
- Web-portal redirect for desktop-only flows.

---

## 12. Dispute Resolution & Quality Assurance

### 12.1 Dispute Lifecycle

- `disputes` table with opener, opener_kind (client/inspector), reason, reason_category, evidence_urls[], status, resolution_outcome, resolution_notes.
- `flag_job_dispute(job_id, reason, reason_category, evidence_urls)` — RPC for opening.
- `admin_resolve_dispute_rpc` — Platform Owner resolution with structured outcomes.
- `resolve_job_dispute(dispute_id, outcome, resolution_notes)` — finalisation RPC.
- `handle-dispute` Edge Function for dispute-side effects (notification fanout, escrow pause).
- `generate-dispute-report` Edge Function for PDF resolution document.

### 12.2 Evidence Collection

- `dispute-evidence` Storage bucket for uploaded artifacts.
- Both parties can attach evidence URLs to the dispute record.

### 12.3 Flash Reports (Critical Incidents)

- `flash_reports` table with category, severity, location_text, occurred_at.
- `flash_report_create`, `flash_report_add_attachment`, `flash_report_transition` RPCs.
- `flash-report-attachments` bucket for incident photos and documents.
- `critical-alert-monitor` Edge Function fires automated alerts on `result='fail'` or `type='incident'`.

### 12.4 Bidirectional Reviews

- `reviews` table with reviewer_id, reviewee_id, direction (`client_to_inspector` / `inspector_to_client`), rating, public/private split, private_admin_note.
- `submit_review(job_id, reviewee_id, rating, comment, is_public, private_admin_note)` RPC.
- `mark_report_viewed(report_id)` for engagement tracking.
- `can_review_job(job_id)` — predicate gating review submission to completed jobs.

### 12.5 Moderation Queue

- `jobs.moderation_status` with `pending_review → approved → rejected → flagged` states.
- `admin_review_job(job_id, decision, notes)` — admin moderation RPC.
- Web moderation queues at `/admin/job-moderation` and `/admin/reviews-moderation`.
- Mobile equivalents under `(admin)/job-moderation` and `(admin)/reviews-moderation`.

---

## 13. Web Application Surface

**83 dedicated pages** organised by role and capability.

### 13.1 Public Surfaces

- `/` — marketing landing.
- `/verify` — public evidence-pack verifier (no-auth).
- `/cert/[slug]` — public certificate verification.

### 13.2 Authentication

- `/sign-in`, `/sign-up`, `/choose-role`, `/use-web-portal`.

### 13.3 Admin / Platform Owner

- Dashboard, audit-trail, financial (6 sub-pages: shared, active-jobs, clients, inspectors, pending-payouts, pipeline), users, verification, communications, compliance-templates, CCI applications, disputes, job-moderation, jobs, live-radar, notifications, payouts, pending-assignments, pending-hires, reviews-moderation, support-chat, support-inbox.

### 13.4 Client (Enterprise Buyer)

- Index, dashboard, branding-settings, approve, create-job, create, disputes.
- Finance suite: budget, compliance, invoices, index (4 sub-pages).
- Network, explore, project (per-project workspace), job detail.
- Structure (department + member tree).

### 13.5 Inspector

- Dashboard, super-dashboard, my-jobs.
- Submit-findings, submit-report.
- Earnings, wallet, withdraw, cert-wallet.
- Negotiations, notifications, disputes.
- Legal verification, CCI compliance application, profile verification.

### 13.6 Agency

- Create-job, jobs/[id] (agency-mode views).

### 13.7 Shared & Modals

- Agency-job-details, applicant detail, job-details.
- Modal: assistant (in-app helper).

### 13.8 Web Library Stack

- Next.js 14 (App Router, React Server Components).
- React 18.
- Tailwind CSS with custom premium dark/violet theme (`bg-ink-950`, `text-violet-glow`, `tracking-industrial`, etc.).
- Lucide React for iconography.
- Recharts for data visualization.
- Premium "industrial" typographic system with monospaced labels for technical surfaces.

### 13.9 Web Component Domains (16)

`admin` · `auth` · `client` · `compliance` · `forms` · `inspector` · `invoices` · `jobs` · `marketing` · `messaging` · `notifications` · `orgs` · `procurement` · `reviews` · `ui` · `vault`.

---

## 14. Mobile Application Surface

**223 screens** organised across 9 role groups.

### 14.1 Role Groups

- `(admin)` — 26 screens (dashboards, financial, moderation, support, verification).
- `(super-admin)` — 23 screens (Platform Owner mirror with elevated privileges).
- `(client)` — 14 screens (enterprise buyer flows).
- `(inspector)` — 13 screens (inspector workspace).
- `(agency)` — 3 screens (agency operations).
- `(senior)` — 3 screens (senior-reviewer flows).
- `(organization)` — organisation surfaces.
- `(tabs)` — 14 tabbed screens (universal home).
- `(auth)` — 5 onboarding screens.
- `(modals)` — modal sheets.
- `(shared)` — surfaces accessible across roles.

### 14.2 Stand-Alone Screens (50+)

Map browsing, job detail, post-new-job, contract viewer, contract editor, message threads, find-jobs, my-jobs, browse-jobs-map, post-compliance-job, profile suite (certifications, document, edit, experience, help, language, legal, payments, rates, security, skills, terms), reviews submit, support-chat, payment-screen, notification-settings, supabase-test, debug, diagnostics.

### 14.3 Mobile Component Domains (15)

`audit` · `client` · `dashboard` · `DynamicForm` · `frontier` · `inspector` · `jobs` · `legal` · `LegalConsent` · `orgs` · `procurement` · `reviews` · `shared` · `signature` · `ui`.

### 14.4 Mobile Special Surfaces

- **Dynamic forms** (`DynamicForm`) — schema-driven form rendering from `report_templates.schema_json`.
- **Frontier components** — premium UI primitives for inspector workspace.
- **Signature pad** — full-screen signature capture with retry, undo, clear.
- **Legal consent** — NDA capture with PDF receipt + Resend email delivery.

---

## 15. Cross-Platform Synchronization

### 15.1 The `@nexpec/shared-core` Package

A single source-of-truth package consumed by both web and mobile. Nine schema modules:

- `organizations.ts` — org member roles, memberships, set-active-org, base currency, evaluate-job-for-approval, open/cancel/submit job approval, set department budget, set approval policy, approval evaluation, budget check result, pending approval row, compliance posture summary, compliance anomaly, compliance detector metadata, assemble-evidence-pack inputs, evidence-pack envelope/manifest/pack types.
- `jobs.ts` — job schemas.
- `compliance.ts` — compliance schemas.
- `credentials.ts` — credential schemas.
- `disputes.ts` — dispute schemas.
- `moderation.ts` — moderation schemas.
- `payouts.ts` — payout schemas.
- `settings.ts` — settings schemas.
- `index.ts` — barrel export.

### 15.2 Zod Validation

- Every cross-platform input is a Zod schema in `shared-core`.
- Web and mobile both import the same Zod schema for client-side validation.
- Server-side RPC inputs match the same shape.
- Cross-platform drift is structurally impossible.

### 15.3 Identical RPC Contracts

- Every cross-platform RPC is defined once in SQL.
- Web Server Actions and mobile React Native call the same RPCs via the same supabase-js client.
- Parameter naming convention (`p_*` prefix) maintained universally.

### 15.4 Identical Visual Language

- Locked tokens (`#020420` / `#7C3AED`) used by both surfaces.
- Component naming consistent across surfaces (`OrgSwitcher`, `DepartmentPicker`, `ApprovalsScreen`, `EvidencePackButton`, `SealClaimBanner`).

### 15.5 Monorepo Discipline

- Yarn workspaces with `apps/*` and `packages/*` topology.
- Turborepo for build orchestration (`turbo:dev`, `turbo:build`, `turbo:typecheck`).
- Workspace-level typecheck via `yarn workspaces run typecheck`.

---

## 16. Data Integrity & Engineering Posture

### 16.1 Schema Discipline

- **95 migrations** in `supabase/migrations/`, all timestamped, all idempotent, all wrapped in `BEGIN; ... COMMIT;`.
- Every CREATE statement uses `IF NOT EXISTS` for tables, indexes, policies.
- Every function uses `CREATE OR REPLACE`.
- Migration history is forward-only; no destructive reversions.

### 16.2 SECURITY DEFINER Discipline

- Every SECURITY DEFINER function explicitly declares `SET search_path = public, pg_temp` (or `public, extensions, pg_temp` where pgcrypto is needed).
- This is mandatory doctrine — no exceptions.
- Prevents schema-pollution attacks and search-path-based privilege escalation.

### 16.3 RPC-Only Mutation Posture

- Every business-state mutation goes through a SECURITY DEFINER RPC.
- Direct table INSERT/UPDATE/DELETE is blocked via REVOKE.
- RLS policies are read-only on most tenant-scoped tables (UPDATE/DELETE policies only where business-justified).
- This makes the surface area of "what can change the database" small and auditable.

### 16.4 Defensive Trigger Pattern

- Every trigger body wrapped in `EXCEPTION WHEN OTHERS THEN RAISE NOTICE ... RETURN NEW;`.
- Notification or audit failure never blocks the underlying business write.
- The audit trail is more important than the ping, but the ping is more important than nothing.

### 16.5 Idempotency Contracts

- Every "create" RPC checks for existing rows first and returns them unchanged if found.
- Every "claim" RPC uses `FOR UPDATE SKIP LOCKED` to prevent double-processing under concurrency.
- Every "settle" RPC uses unique constraints to make double-processing mathematically impossible.

### 16.6 Constraint Triggers for Critical Invariants

- `tg_approval_decisions_enforce_sod` — schema-level Segregation of Duties.
- `tg_approval_policies_no_overlap` — schema-level band-overlap prevention.
- `fx_rates_self_is_one` CHECK constraint — schema-level identity-pair enforcement.
- `pi_report_seals_client_sig_pair` and `pi_report_seals_break_pair` — schema-level signature-coherence and chain-break-coherence invariants.

### 16.7 ENUMs Over Free Text

- `currency_code` ENUM (9 values).
- `org_member_role` ENUM (4 values).
- `compliance_capture_validation` ENUM (validation states).
- Plus several others. ENUM-driven CHECK constraints prevent typos from polluting the data.

---

## 17. Anomaly Detection & Risk Surveillance

### 17.1 The Six Detectors

Each returns a JSONB row with `detector_id`, `severity`, `affected_rows`, and `evidence` fields. Run in sequence via `compliance_posture_summary(org_id)`.

- **Band Evasion Pattern (`detect_band_evasion_pattern`)** — surfaces requesters whose submission amounts cluster suspiciously close to (but just under) approval-band thresholds.
- **Rubber-Stamping (`detect_rubber_stamping`)** — surfaces approvers whose decision latency falls below a reasonable-deliberation floor or whose rejection rate is statistically anomalous compared to peer approvers.
- **Concentration Risk (`detect_concentration_risk`)** — surfaces single-counterparty exposure that exceeds policy thresholds within a rolling window.
- **Quarter-End Clustering (`detect_quarter_end_clustering`)** — surfaces spending spikes in the final business days of a fiscal quarter, the classic indicator of budget-flush behaviour.
- **Off-Hours Decisions (`detect_off_hours_decisions`)** — surfaces approval activity outside business hours, a common indicator of automated rubber-stamping or compromised credentials.
- **Silent Overrides (`detect_silent_overrides`)** — surfaces Platform-Owner bypasses to compliance leadership, preserving the audit-of-audit invariant.

### 17.2 The Posture Summary

- Top-level numerical posture score (0–100).
- Per-detector severity rollup (critical / warning / info).
- Evidence drill-down per finding.
- 90-day rolling window with comparison to prior-period baseline.

### 17.3 The Compliance Command Center

- Web surface at `/client/compliance`.
- Hero card with posture score + delta from prior period.
- Anomaly feed with per-finding drill-down.
- Evidence-pack button on every job for one-click pack generation.

---

## 18. Operational Excellence

### 18.1 Audit-of-Audit

- Every action by every party, including the Platform Owner, lands in `audit_events`.
- The Platform Owner cannot silently override compliance controls — the override is itself an audit event surfaced by the `detect_silent_overrides` detector.
- This is the audit-of-audit invariant.

### 18.2 Realtime Observability

- Supabase Realtime publication on `notifications` + `pi_report_seals` + all standard tables.
- Sub-second UI propagation across web and mobile.
- No polling, no client-side reconciliation logic.

### 18.3 Cron Bookkeeping

- `fx_refresh_runs` records every FX-cron tick with full provenance.
- Admin-only RLS so the Platform Owner can verify scheduled-job health without exposing it tenant-side.

### 18.4 Edge Function Retry Semantics

- `dispatch-notification-emails` retries up to 5 attempts before parking a row.
- `claim_pending_notification_emails` atomically bumps `email_attempts` on every claim.
- Resend `Idempotency-Key` header prevents accidental double-sends.

### 18.5 Webhook Idempotency

- `complete_stripe_webhook_event` makes Stripe webhook processing exactly-once safe under network retries.

### 18.6 Diagnostic Surfaces

- `/diagnostics`, `/debug`, `/supabase-test` for in-app health verification.
- Critical-alert-monitor Edge Function fires automated incident notifications.

---

## 19. Strategic Moats & Defensible Position

NEXPEC's defensibility rests on five compounding moats. Each one alone is meaningful. Together they form a category-defining position that legacy field-service, procurement, and GRC vendors cannot replicate without rebuilding their data model from scratch.

### Moat 1 — Cryptographic verifiability without trust

The public `/verify` endpoint allows third-party auditors to recompute every hash in our evidence packs *inside their own browser* using SubtleCrypto, against the published canonical-JSON algorithm. There is no server roundtrip. NEXPEC's servers are not involved. Competitors can build approval workflows. They cannot build *regulator-grade evidence packs that don't require trusting the platform vendor* because doing so requires deliberate engineering posture from day one: deterministic canonical JSON, per-artifact hashing, root composition, immutable audit emission, and a public verifier UI that explicitly does not call home. This is not a feature; it is an architectural commitment.

### Moat 2 — Schema-enforced Segregation of Duties

SOX 404 internal-controls requirements are enforced via a Postgres `CONSTRAINT TRIGGER` (`tg_approval_decisions_enforce_sod`). The application layer cannot bypass it. A malicious or buggy frontend deploy cannot bypass it. The database itself refuses to record a self-approval. Competitors enforce SoD in application code; we enforce it in the schema. This is the difference between a control and a *guarantee*.

### Moat 3 — Cross-platform parity by construction

Web and mobile share the `@nexpec/shared-core` package — every Zod schema lives once, every RPC contract lives once. New surfaces (a future admin desktop tool, a future regulator portal) inherit the same contracts for free. Competitors building separate web and mobile codebases face perpetual drift; we face perpetual consistency.

### Moat 4 — Audit-of-audit capability

Every action by every party — including the Platform Owner — lands in the immutable `audit_events` table. The `detect_silent_overrides` anomaly detector surfaces Platform-Owner bypasses to compliance leadership. This is not theoretical; it is shipped. Customers can verify that *we* are being audit-honest about *our* admin actions on their tenant.

### Moat 5 — Provable inspection from photo to PDF

Competitors store inspection photos as opaque file URLs. NEXPEC hashes each photo at capture (`inspection_captures.capture_sha256`), chains the hashes (`prev_capture_sha256`), anchors them under a report root (`pi_report_seals.captures_root_sha256`), signs that root as the inspector (`inspector_signature_sha256`), accepts a client countersignature against the same root (`client_signature_sha256`), and writes the whole chain into a tamper-evident evidence pack that re-verifies in a browser without us in the room. This is the provable-inspection chain. It does not exist anywhere else.

### Category Position

NEXPEC sits at the intersection of three vendor categories that have historically been served separately:

- **Field-service marketplaces** (ServiceTitan, Jobber, BlueFolder) — operationally rich, compliance-thin.
- **Procurement / sourcing platforms** (Coupa, Ariba, Ivalua) — financially rigorous, marketplace-thin.
- **GRC / audit tooling** (AuditBoard, Workiva, Hyperproof) — compliance-rich, transactionally inert.

Each of these vendors has tried to extend into adjacent categories. None has shipped *cryptographic chain-of-custody from the field photo to the regulator's verifier* because doing so requires a unified data model, and you cannot bolt SHA-256 anchoring onto a vendor architecture that treats inspection artifacts as opaque file URLs.

NEXPEC built the unified data model first. Every other capability composes on top of it.

---

## 20. Production Status Matrix

| Capability Domain | System | Status |
|---|---|---|
| **Cryptographic Trust** | Provable Inspection Engine — seal + countersign | LIVE |
| | Compliance Evidence Locker — 8-artifact deterministic bundle | LIVE |
| | Public /verify endpoint with URL-claim banner | LIVE |
| | Compliance Command Center (6 detectors) | LIVE |
| | Immutable audit_events trail | LIVE |
| **Procurement Control Plane** | Approval policies + bands + non-overlap | LIVE |
| | Schema-enforced SoD (constraint trigger) | LIVE |
| | Department budget envelopes | LIVE |
| | Approval engine + quorum + SoD | LIVE |
| | Mobile approver dashboard + live preview | LIVE |
| **Financial & FX Engine** | Multi-currency core (9 ISO-4217) | LIVE |
| | Live FX cron (OpenExchangeRates) | LIVE |
| | Cost-center attribution + invoice inheritance | LIVE |
| | Stripe payments + Connect + escrow + payouts | LIVE |
| | Invoicing infrastructure | LIVE |
| **Multi-Tenant Architecture** | Org + department hierarchy | LIVE |
| | Active org switcher (omnichannel via DB column) | LIVE |
| | RLS with non-recursive helper | LIVE |
| | Singular Platform Owner doctrine | LIVE |
| **Field Execution** | Photo-level SHA-256 chain | LIVE |
| | Structured inspection records | LIVE |
| | Mobile inspector workspace | LIVE |
| | PIE seal screen | LIVE |
| **Marketplace Mechanics** | Job lifecycle state machine | LIVE |
| | Geospatial matching (PostGIS) | LIVE |
| | Inspector discovery + reputation | LIVE |
| | Application + counter-offer flow | LIVE |
| **Contracts & Documents** | Contract generation + both-party signing | LIVE |
| | 22 dedicated storage buckets | LIVE |
| | Branding settings | LIVE |
| **Notification Fabric** | 5 event-driven triggers | LIVE |
| | Email queue + Resend dispatch | LIVE |
| | 5 dedicated HTML templates | LIVE |
| | Expo push fanout | LIVE |
| | Realtime publication | LIVE |
| **Edge Functions** | 26 functions in production | LIVE |
| | pg_cron + pg_net orchestration | LIVE |
| **External Integrations** | Stripe (payments + Connect) | LIVE |
| | Resend (email) | LIVE |
| | OpenExchangeRates (FX) | LIVE |
| | Expo Push (mobile) | LIVE |
| **Identity & Access** | Multi-provider auth | LIVE |
| | 6-role system | LIVE |
| | Inspector verification (CCI) | LIVE |
| | Legal consent capture | LIVE |
| **Disputes & Quality** | Dispute lifecycle | LIVE |
| | Flash reports (incidents) | LIVE |
| | Bidirectional reviews | LIVE |
| | Moderation queues | LIVE |
| **Web Application** | 83 pages across all roles | LIVE |
| **Mobile Application** | 223 screens across 9 role groups | LIVE |
| **Cross-Platform Sync** | @nexpec/shared-core (9 schema modules) | LIVE |
| | Monorepo with Turborepo | LIVE |
| **Engineering Posture** | 95 migrations (idempotent, transactional) | LIVE |
| | SECURITY DEFINER discipline | LIVE |
| | RPC-only mutation posture | LIVE |
| | Defensive trigger pattern | LIVE |
| **Anomaly Detection** | 6 detectors + posture summary | LIVE |
| **Operational Excellence** | Audit-of-audit | LIVE |
| | Realtime observability | LIVE |
| | Cron bookkeeping | LIVE |
| | Edge function retry semantics | LIVE |

---

## Closing Statement

NEXPEC is not a checklist of features. It is an architectural commitment to a category that does not yet exist: **provable enterprise inspection**. Every feature in this catalog exists in service of one thesis — that procurement spend on field inspections should produce evidence a regulator accepts *without our involvement in the room*.

The 95 migrations, the 26 Edge Functions, the 83 web pages, the 223 mobile screens, the cryptographic seal chain, the SOX-grade schema-enforced controls, the immutable audit trail, the no-trust public verifier — these are not independent features. They are layers of a single coherent commitment that compounds in defensibility every quarter we operate.

This is what we have built.

This is what we are taking to market.

---

*End of catalog. For technical deep dives, see `supabase/migrations/`, `apps/web/src/`, `app/`, `src/`, `packages/shared-core/`, and `supabase/functions/`.*
