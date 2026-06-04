# NEXPEC — Forensic Codebase Audit

**Generated:** 2026-06-01 · **Repo:** `/Users/ebrahimfeyzi/Desktop/nexpec` · **Branch state:** live working tree
**Scope:** Whole monorepo — web (`apps/web`), mobile (root `app/`, `src/`, `components/`), shared (`packages/shared-core`), backend (`supabase/migrations`, `supabase/functions`).

---

## 0. Methodology & caveats

This audit was produced by (a) exact mechanical enumeration of the tree (file/route/table/RPC/bucket counts via `find`/`grep`/Python over the source), and (b) four parallel forensic module deep-dives that read the actual source and recorded `file:line` evidence. Counts are ground-truth as of the scan. Where a feature's status is inferred (active / in-dev / orphaned), it is inferred from wiring — whether a route, nav entry, RPC, or data fetch actually reaches it — and labelled as inferred. "Evidence" columns cite real paths. This is a due-diligence-style inventory: every module is enumerated and critical paths are sampled and traced; it is not a line-by-line read of all 1,290 source files.

---

## 1. Executive summary

NEXPEC is a **two-sided, admin-brokered industrial-inspection marketplace** with a regulator-grade compliance layer and a cryptographic "provable inspection" trust spine. It ships as a **Next.js 15 web app** and an **Expo / React Native mobile app** over a **single Supabase (Postgres + RLS + Edge Functions + Storage) backend**, with a pure-TypeScript `shared-core` contract layer between them.

The platform is **large and mature**: ~2,000 source files, **91 web pages**, **243 mobile screen files**, **~73 domain tables**, **~150 callable RPCs**, **28 edge functions**, **23 storage buckets**, **140 migrations**. The core marketplace loop (post → bid/dispatch → blind-priced contract → dual e-sign → inspection report → admin review → seal → payout) is **fully implemented and wired on both platforms**. Money handling was hardened after a real client-mintable-balance exploit (now closed: ledger is server-write-only). The public marketplace was just made **pseudonymous by construction** (anti-poaching) at the data layer.

The principal risks are **(1) surface area vs. enforcement consistency** — a handful of advanced subsystems (CCI credential issuance, coordination-bridge UI, AI co-inspector inference, multi-currency FX, procurement approvals) are schema-complete but UI/pipeline-incomplete; **(2) routing fragmentation on mobile** (multiple paths per feature, three deprecated route groups); and **(3) deferred RLS/secret hardening items** explicitly tracked in migration comments. None of these block the core loop, but they are the honest edges of the system.

---

## 2. Project statistics (mechanical, exact)

| Metric | Count |
|---|---:|
| Total files (excl. node_modules/.git/.next/.expo/dist/Pods) | **2,004** |
| Total folders | 586 |
| TypeScript / TSX files | **1,290** |
| Web pages (`apps/web/src/app/**/page.tsx`) | **91** |
| Web route handlers (`route.ts`) | 4 |
| Web layouts | 6 |
| Web components (`.tsx`) | 121 |
| Web server actions (`lib/actions/*.ts`) | 54 |
| Web data fetchers (`lib/data/*.ts`) | 104 |
| Mobile screen files (`app/**/*.tsx`) | **243** |
| Mobile `src/` files (.ts/.tsx) | 455 |
| Mobile shared components | 23 |
| `shared-core` source files | 46 |
| DB migrations (`.sql`) | **140** |
| Domain tables (CREATE TABLE, deduped) | **~73** |
| DB functions/RPCs/triggers (CREATE FUNCTION, deduped) | **239** (~150 callable + ~89 trigger/helper) |
| DB views | 7 |
| Storage buckets | **23** |
| Edge functions | **28** |
| Root-level `.sql` scripts (ops/backfill) | 38 |
| `TODO/FIXME/HACK/@deprecated` markers (app+src+web) | 27 |

---

## 3. Architecture & tech stack

**Topology.** npm workspaces monorepo. The **mobile app lives at the repo root** (Expo Router, React Native 0.76.9, React 18.3.1). **`apps/web`** is a **deliberately isolated** Next.js 15.5.18 + React 19 app (excluded from the workspace graph so it resolves its own React 19 and never forces the mobile app's React 18 — see §19). **`packages/shared-core`** is framework-free TypeScript (zod schemas, canonical-JSON, passport/seal contracts) consumed by both clients. The **backend is Supabase**: Postgres with Row-Level Security as the primary authorization plane, Edge Functions (Deno) for outbound integrations (Stripe, Resend email, Expo push, OpenTimestamps), and Storage for files.

**Authorization model.** Security is enforced **at the database**, not (only) in the UI: RLS policies + `SECURITY DEFINER` RPCs with inline auth checks are the source of truth. The web middleware and mobile auth-gate are convenience gates layered on top. This is the correct shape for a marketplace where the same Postgres is hit by two clients plus a public anon role.

**Offline-first mobile.** The mobile app has a full **SQLite outbox** (`src/core/offline`) that queues mutations (report save, photo upload, application, review, message, compliance capture, AI detection, flash report, withdrawal, expense) with `client_op_id` idempotency keys and conflict classification, draining on reconnect. The matching RPCs are idempotent server-side.

**Trust spine.** A cryptographic chain runs photo → `inspection_captures` (SHA-256 linked list) → `pi_report_seals` (canonical-JSON root hash, inspector + optional client signature) → `inspection_seal_anchors` (OpenTimestamps Bitcoin anchoring) → public `/passport/[sealId]` verification. This is the product's defensibility and is real code, not vapor.

---

## 4. Roles & RBAC

**Seven roles** (occurrence counts across migrations + web source show how central each is):

| Role | Refs | Meaning |
|---|---:|---|
| `super_admin` | 191 | Full platform owner. |
| `inspector` | 136 | Performs inspections, applies/bids, submits reports, gets paid. |
| `admin` | 125 | Platform operator. **God-mode rule: `admin` is being unified to equal `super_admin` everywhere** (web + mobile + RLS). |
| `client` | 96 | Buyer; posts jobs, approves reports/invoices. |
| `agency` | 71 | Multi-client buyer workspace (same RLS shape as client). |
| `enterprise` | 61 | Department hierarchy, budgets, approval workflows. Currently routes through client surfaces on mobile. |
| `unassigned` | 1 | Post-signup placeholder before onboarding role pick. |

**Enforcement layers:** (1) web `apps/web/src/middleware.ts` gates `/admin/*`, `/client/*`, `/inspector/*` by role with an `OWNER_EMAILS` failsafe; (2) mobile `app/_layout.tsx` AuthGate routes by role; (3) **RLS + `public.nx_is_admin()` helper** is the real gate (`role IN ('admin','super_admin')`). **Known gap (tracked):** a census found ~51 RLS checks + some mobile admin routing still test `super_admin` only and exclude `admin` — the god-mode unification is in progress, not finished.

---

## 5. Web application — full route inventory (91 pages)

`apps/web` uses the Next.js App Router. All portal routes are role-gated in `middleware.ts`. Status is active unless noted.

### Public / unauthenticated
`/` (landing) · `/contact` · `/inspectors` (anonymized directory) · `/p/[userId]` (anonymized Trust Card) · `/passport/[sealId]` (public seal verification) · `/verify` · `/bridge/[token]` (vendor portal) · `/orgs/accept/[token]` (org invite) · `/legal/terms` · `/legal/privacy` · `/legal/compliance-notices` · `/(auth)/sign-in` · `/(auth)/sign-up`

### Admin portal (`/admin/*`, 33 routes)
`dashboard` · `jobs` · `dispatch` · `users` · `users/[id]` · `users/specialties-bulk` · `orgs` · `orgs/[id]/structure` · `invoices` · `invoices/[id]` · `payouts` · `budget` · `disputes` · `reviews` · `contracts` · `messages` · `messages/[id]` · `documents` · `vault` · `vault/[id]` · `compliance` · `compliance/templates` · `compliance/templates/[id]` · `compliance/templates/new` · `domains` · `domains/[slug]/readiness` · `integrity` · `audit` · `diagnostics` · `settings`

### Client portal (`/client/*`, ~28 routes)
`dashboard` · `jobs` · `jobs/new` · `jobs/[id]` · `jobs/[id]/applications` · `jobs/[id]/clauses` · `jobs/[id]/release` · `jobs/[id]/review` · `contracts` · `contracts/job/[id]` · `invoices` · `invoices/[id]` · `finance` · `budget` · `budget/envelopes` · `budget/policies` · `approvals` · `compliance` · `reports` · `documents` · `vault` · `vault/[id]` · `team` · `structure` · `branding-settings` · `disputes` · `messages` · `messages/[id]` · `settings`

### Inspector portal (`/inspector/*`, ~18 routes)
`dashboard` · `jobs` · `jobs/[id]` · `jobs/[id]/apply` · `jobs/[id]/submit-report` · `jobs/[id]/review` · `contracts` · `contracts/job/[id]` · `assignments` · `calendar` · `calendar/feed.ics` (route handler) · `wallet` · `wallet/statement/[period]` (route handler) · `compliance` · `experience` · `negotiations` · `disputes` · `messages` · `messages/[id]` · `settings`

### Route handlers (non-page server endpoints, 4)
`auth/callback` (OAuth/session exchange) · `inspector/calendar/feed.ics` (iCal RFC-5545) · `inspector/wallet/statement/[period]` (PDF/CSV statement) · `client/finance/invoice/[jobId]` (price-blind invoice PDF). Plus `robots.ts` + `sitemap.ts`.

---

## 6. Mobile application — inventory (243 screen files, 11 route groups)

Expo Router with **11 route groups**: `(admin)`, `(client)`, `(inspector)`, `(tabs)`, `(auth)`, `(agency)`, `(modals)`, `(organization)`, `(senior)`, `(shared)`, `(super-admin)`.

**Status of the groups:**
- **Active & primary:** `(tabs)` (multi-role dashboards + jobs/finance/profile), `(admin)` (~37 screens: dashboard, jobs, users, financial hub + 5 sub-screens, payouts, disputes, verification, vault, audit-trail, live-radar, compliance-templates, cci-applications, org-management, integrity, diagnostics, settings, support-inbox/-chat), `(client)` (~30 screens), `(inspector)` (~22 screens), `(auth)` (4), `(modals)` (AI assistant), `(shared)` (cross-role job/applicant detail).
- **Deprecated / alias (kept for deep-link compat):** `(super-admin)` (pre-rename alias of `(admin)`; auth gate still accepts the old segment), `(senior)` (Phase-2.3 retirement stub).
- **Passthrough / scaffold:** `(agency)` (Slot passthrough, minimal), `(organization)` (greenfield scaffold, **zero child screens** — enterprise currently routes through `(client)`).

**Mobile-only infrastructure (no web equivalent):**
- **Offline outbox** — `src/core/offline/{db,outbox,sync,operations,hooks,auth,network}.ts` + dev `OutboxInspector.tsx`. Tables `offline_outbox`, `offline_conflicts` (local SQLite).
- **On-device ML** — `src/core/ml/**` (react-native-fast-tflite GPU inference for defect detection; **Ed25519 model-signature verification via @noble** rejects unsigned/tampered models; Skia preprocessing; voice-findings stub).
- **Push notifications + deep-link allow-list** — `src/core/notifications/hooks/usePushNotifications.ts` (Expo token → `push_tokens`; regex-whitelisted deep links).
- **Biometric auth** — `src/services/BiometricAuth.ts` (Face ID / fingerprint app-unlock).
- **Native calendar sync** — `src/services/CalendarSync.ts` (writes jobs to device calendar; complements web's iCal feed).
- **Hash-chained compliance capture** — `app/(inspector)/compliance/job/[id]/capture.tsx` (offline photo+GPS+text, SHA-256 chain).
- **Canonical realtime hook** — `src/core/realtime/useRealtimeSubscription.ts` (auto-resubscribe on socket drop, no silent stalls).

---

## 7. Web ↔ mobile parity matrix

The data/contract layer is platform-agnostic, so parity is a **UI sweep**, and most of it is done. Legend: ✅ both · 📱 mobile-only · 💻 web-only · ⚠️ partial/fragmented.

| Capability | Web | Mobile | Parity |
|---|---|---|---|
| Sign-in / sign-up / role pick | ✅ | ✅ | ✅ |
| Biometric app-unlock | — | 📱 | 📱 by design |
| Client dashboard / job CRUD | ✅ | ✅ | ✅ |
| Inspector apply / bid | ✅ | ✅ | ✅ |
| Blind-priced job contract + dual e-sign | ✅ | ✅ | ✅ |
| Submit inspection report | ✅ | ✅ (offline-safe) | ✅ |
| Compliance capture (hash-chained) | ⚠️ | 📱 (field capture) | 📱 capture is mobile |
| Wallet / withdraw / statement | ✅ | ✅ | ✅ |
| Calendar | ✅ (iCal feed) | 📱 (device sync) | ✅ complementary |
| Invoices / budgets / approvals | ✅ | ✅ | ✅ |
| Evidence vault | ✅ (admin+client) | ⚠️ admin yes, **client vault missing** | ⚠️ gap |
| Inspection-domain management (admin) | ✅ (`/admin/domains`) | **missing** | ⚠️ gap |
| Org / enterprise seat management | ✅ | scaffold only | ⚠️ gap |
| Live radar (admin map) | ⚠️ | 📱 (`(admin)/live-radar`) | ⚠️ |
| Inspector directory (buyer-facing) | ✅ (`/inspectors`) | 📱 (`/inspector-directory`) | ✅ |
| Public Trust Card / passport | ✅ | partial | ⚠️ |
| AI assistant overlay | — | 📱 (`(modals)/assistant`) | 📱 |

**Confirmed mobile parity gaps:** (1) client evidence vault, (2) admin domain management, (3) enterprise/organization seat screens. **Routing fragmentation** to clean up: multiple paths for the same feature (e.g., `/(tabs)/client-dashboard` vs `/(client)/`; three inspector home variants `(tabs)` / `(inspector)/dashboard` / `super-dashboard`; settings + messages + contracts each reachable via top-level *and* group routes).

---

## 8. Inspection module

The heart of the product. Two inspection types gate everything: **`quality`** (general, free-form report, no scope template) and **`compliance`** (regulator-grade, MUST have `scope_template_id`, structured evidence, credential-tier gated, publicly verifiable seal).

**Report submission.** `apps/web/src/app/inspector/jobs/[id]/submit-report/page.tsx` + `lib/actions/submitReport.ts`. Inspector picks result (pass/fail/partial), writes ≥50-char summary, uploads ≤6 photos to the private `inspection-photos` bucket (`{jobId}/{inspectorId}/{ts}-{i}.{ext}`), types an attestation name. Composes a versioned `FinalReportDoc` JSON and inserts into `inspection_reports`. Idempotent via `unique_report_per_job_inspector`. Writes an `audit_events` row (`job.report_submitted`). Inspector may set only `{status, photo_url, notes, final_report_doc, signed_docs_*}`; the approval columns (`technical_approved`, `financial_approved`, `is_published`, `is_client_approved`) are RLS/trigger-gated to admin/system — this is **Golden-Rule-6 (inspector → admin → client) enforced at the column level**.

**Approval ladder (inferred active from columns + flow):** report `pending` → admin technical review (`technical_approved`) → admin financial review (`financial_approved`) → publish (`is_published`, notifies client) → client sign-off (`is_client_approved`) → unlocks payout (subject to escrow guard).

**Trust primitives (schema-complete, mobile-capture live).** `inspection_captures` (migration `20260514100000_compliance_mode_foundation.sql:243-330`) is a per-media row with EXIF/GPS, device attestation, face-detection counts, and a **SHA-256 linked list** (`capture_sha256` → `prev_capture_sha256`) forming a tamper-evident chain. Field capture is implemented on mobile (`app/(inspector)/compliance/job/[id]/capture.tsx`).

**Provable seals.** `pi_report_seals` (`20260609120000_provable_inspection_seals.sql`) binds report metadata + captures-root + items-root into one `root_sha256` via canonical JSON (`pi_canonical_json`), signed by the inspector and optionally counter-signed by the client (`pi_countersign_inspection_report`). Sealing RPC `pi_seal_inspection_report`; reader `pi_fetch_report_seal`; idempotent.

**Anchoring.** `inspection_seal_anchors` + `record_seal_anchor` RPC + edge functions `anchor-inspection-seals` / `confirm-inspection-anchors` implement **two-phase OpenTimestamps**: submit pending → later upgrade to `bitcoin_confirmed`. Public verification via `get_inspection_passport(seal_id)` (anonymized — returns `inspector_id`, never a name) backing `/passport/[sealId]`.

**Flash reports / NCRs (active).** `flash_reports` + `flash_report_attachments` + RPCs `flash_report_create` / `flash_report_add_attachment` / `flash_report_transition`, offline-safe via `client_op_id`. Mobile UI: `app/jobs/[id]/flash-reports/{index,new,[reportId]}.tsx`.

**AI co-inspector (schema-complete, inference pipeline incomplete).** `ai_detections`, `model_artifacts`, `signing_keys`, RPCs `ml_register_model` / `ml_resolve_models` / `ml_set_model_status` / `pi_record_ai_detection` (idempotent). Detections are designed to bind into the seal/evidence pack. **Gap:** no production model weights are registered and there is no server inference pipeline; on-device TFLite exists on mobile but the end-to-end "model → detection → seal binding" is not yet running on real models.

**Orphaned / incomplete in this module:** `verification_affidavits` + `trust_certificates` (tables exist, no generation UI/RPC wired), `inspector_credentials` / CCI tiers (`is_active_cci` RPC + constraints exist; no admin issuance UI — though mobile `(admin)/cci-applications` and `(inspector)/compliance/cci-application` screens exist, so this is partially wired), `compliance_documents` (supplier pre-upload table, no UI), canvas signature (schema field `attestation.signaturePath` present, deferred — typed-name only today), `inspection_assets` + `asset_defect_observations` + `get_asset_timeline` (asset-history primitive, limited UI).

---

## 9. Contract module

Two distinct contract systems.

**(A) Standalone legal agreements.** `contracts` (kinds: msa/dpa/amendment/order_form/nda/other; inline-markdown / PDF-upload / external-URL) + `contract_assignments`. Admin creates (`lib/actions/contracts.ts:createContract`), assigns to a party (notifies them), party e-signs by typed name with **IP + user-agent capture** via `sign_contract` RPC (ESIGN/eIDAS-style evidence). Web: `/inspector/contracts`, `/client/contracts`, `/admin/contracts`. PDF served via 10-min signed URLs. Mobile: `app/contracts/*` incl. a real signature-pad modal.

**(B) Job contracts with blind pricing — the Golden-Rule money primitive.** `job_contracts` (migration `20260518370000_..._blind_pricing_..._v2.sql`) stores **both** `client_price_cents` and `inspector_payout_cents` once, then exposes them through **role-scoped views**: `client_job_contracts_view` (omits payout) and `inspector_job_contracts_view` (omits client price). Base-table RLS is admin-only; clients/inspectors can read only via their view. **Price-blindness is enforced at the SQL projection layer, not the UI.**

**Lifecycle (state machine, active).** Admin generates (`admin_generate_job_contract`, auto-voids any prior active contract → `status='pending_client_signature'`, notifies client) → client signs (`client_sign_job_contract`: job `open → assigned`, sets hired inspector, notifies inspector) → inspector signs (`inspector_sign_job_contract`: job `assigned → in_progress`, **copies pricing onto `jobs`**, `status='fully_executed'`, notifies all). Defensive dual-stage transition + a `tg_heal_contract_on_executed` / `heal_contract_to_active` self-healing trigger handle backfill/edge cases. Escrow guard `_enforce_escrow_pause` blocks completion/payout while a dispute pauses the job.

**Negotiation loop (active RPCs).** `admin_counter_application`, `inspector_respond_to_counter`, `admin_forward_application_to_client`, plus `admin_adjust_job_price` / `admin_set_job_pricing` — the admin-brokered counter-offer flow. Mobile `(inspector)/negotiations`.

**Coordination bridge (vendor document exchange) — partially wired.** A whole subsystem (`coordination_bridges`, `bridge_slots`, `bridge_documents`, `vendor_contacts` + ~20 `bridge_*` RPCs + `vendor-bridge-auth` edge function + web `/bridge/[token]`) lets an inspector request documents from an off-platform vendor via a hashed one-time token, **without** direct messaging. Notification triggers and the vendor portal route exist; deeper in-app inspector UI for managing bridges is thin. Status: **active backend, partial client UI.**

---

## 10. Financial module

**Ledger (hardened, server-write-only).** `wallets` (balance, available, escrow, earned, pending, agency_revenue…), `transactions` (typed: withdrawal/commission/payout/refund; `*_halalas` integer columns; `client_op_id` idempotency), `job_expenses`, `payments`, `inspector_earnings`. **RLS REVOKEs all client INSERT/UPDATE/DELETE** on `wallets`/`transactions`; balances change **only** through `SECURITY DEFINER` RPCs (`process_withdrawal` with row-lock + idempotency, `wallet_credit_topup`, `admin_mark_payout_processed`, `request_milestone_release`, `stripe_complete_job`). This closed a real shipped exploit where a client-side "+$5000" button and an AddFundsModal could mint balance (migration `20260719120000_financial_lockdown.sql`).

**Invoices & disputes.** Invoice state machine in `lib/actions/invoices.ts` (approve / dispute / mark-paid / void / adjudicate) with `disputes` + `file_dispute` / `admin_resolve_dispute` / `resolve_dispute` RPCs and a `generate-dispute-report` edge function. Price-blindness re-enforced on the client invoice PDF route (`client/finance/invoice/[jobId]/route.ts` selects only client-facing columns).

**Stripe integration (plumbing live, app integration partial).** Edge functions: `create-payment-intent`, `create-setup-intent`, `create-wallet-deposit-intent`, `create-stripe-connect-link`, `create-stripe-payout`, `process-payout`, `release-payment`, `sync-payment-method`, `sync-stripe-connect-status`, `stripe-connect-webhook`, `stripe-payments-webhook`, `stripe-connect-redirect`. Webhook idempotency via `stripe_webhook_events` + `claim/complete/release_stripe_webhook_event` RPCs. Mobile `payment-screen.tsx`. This is the largest integration surface and the area most worth a dedicated payments review before real money flows.

**Platform fee schedule (god-mode).** Single-row `platform_settings` (commission bps, stripe app-fee bps, dispute fee cents, payout bps). `public_get_fee_schedule()` (anon) + `admin_set_fee_schedule(...)` (now widened from super_admin to admin, migration `20260724120000`, with mandatory reason + before/after audit). Web `/admin/settings` + mobile `(admin)/settings`.

**Enterprise budgets & procurement (foundation live, workflows piloting).** `departments`/`department_members`/`department_budgets` + recursive rollup RPCs (`fetch_department_budget_rollup`, `fetch_department_spend_summary`, `check_department_budget`); `approval_policies`/`approval_requests`/`approval_decisions` + `evaluate_job_for_approval` / `submit_job_approval` / `set_approval_policy` (with separation-of-duties trigger `tg_approval_decisions_enforce_sod`). Optional per-org; enterprise orgs should make it mandatory.

**Multi-currency (schema-only).** `fx_rates`, `fx_refresh_runs`, `convert_cents`, `_resolve_display_currency`, `upsert_fx_rate`, `cron_upsert_fx_rate`, edge function `refresh-fx-rates`. Columns exist; UI currency selection + the FX cron are not confirmed live.

---

## 11. Chat & communications

**Three isolated pipelines — client↔inspector direct chat is structurally impossible** (Golden Rule). The `conversations` table has a `kind` enum + CHECK constraint (`20260518160000_conversations_and_messages_v2.sql`) allowing only `job_client_admin`, `job_inspector_admin`, or `help_support` — there is **no** `client_inspector` kind, so the database physically cannot hold a direct client↔inspector thread.

1. **Job-scoped admin chat** — `messages` (room_id = `job_id`, or `{job_id}-admin-{userId}` for isolated admin-support threads). Admin sees all; clients/inspectors see only their own. Core: `src/core/chat/{chat,chatService,messages}.ts` + RPCs `ensure_job_conversation`, `mark_conversation_read`, `notify_on_new_message`. Attachments → `chat_attachments` bucket (1-year signed URLs).
2. **Help/support helpdesk** — `support_messages` (1:1 user↔support), `ensure_help_support_conversation`. Mobile `app/support-chat.tsx` + admin `(admin)/support-inbox` / `support-chat/[user_id]`. Web `/admin/messages`.
3. **Coordination bridge** — vendor document exchange (see §9), deliberately *not* messaging.

**Realtime:** canonical `useRealtimeSubscription` with desync-refetch. Web admin communications: `/admin/messages`, `/admin/messages/[id]`.

---

## 12. Notifications

**Single funnel.** All notifications are created **only** via `SECURITY DEFINER` `nx_notify` / `notify_safe` / `enqueue_notification` (there is **no client INSERT policy** on `notifications`). `notify_admins` / `nx_notify_admins` / `notify_inspectors_*` fan out; `create_admin_notification` / `create_system_notification` for system events.

**Kinds (from `apps/web/src/lib/data/notifications.types.ts`):** message, job_moderated, application_status, assignment, report_submitted, report_approved, payout_released, review_received, contract_assigned, dispute_filed, dispute_update, document_uploaded, system — plus bridge/approval/evidence-pack kinds emitted by triggers.

**Delivery channels:**
- **In-app bell** — `notifications` table on the realtime publication; recipient-filtered subscription.
- **Email** — `notifications` carries an email-queue overlay (`email_required`, attempts, template kind/data); edge function `dispatch-notification-emails` drains every 5 min via Resend with retry/backoff, claim RPCs (`claim_pending_notification_emails`, `mark_notification_email_sent/_failed`). Templates incl. `approval.*`, `evidence_pack.assembled`, `coordination_bridge.invitation` (supports `override_to` for vendor email).
- **Push (mobile)** — edge function `notify-job-event` (pg_net webhook on `job_events`) resolves recipients, dedups, looks up `push_tokens`, POSTs to Expo, and **prunes dead tokens** on `DeviceNotRegistered`. Deep links are regex-allow-listed client-side.
- **SMS** — Expo SMS module present but **not integrated**.

**Trigger fabric:** ~20 `tg_notify_*` / `notify_on_*` triggers auto-emit on application/job/contract/dispute/message/review/transaction/approval/bridge/seal events.

**Settings gap (real):** a per-user notification-settings UI + helpers (`src/utils/notificationUtils.ts`) exist, but the edge-function dispatch paths **do not consistently consult** those preferences — so mutes can be silently ignored. Worth closing.

---

## 13. Maps & geolocation

**Primary map:** `app/map.tsx` (1,433 lines) — role-aware: inspectors see all `open` jobs (value-tiered markers), clients/agencies see only their own. `react-native-maps` + clustering, budget-tier marker styling, a snap bottom-sheet, and native turn-by-turn hand-off. Location capture/geocoding in `src/utils/locationCapture.ts` (`expo-location`, forward + reverse geocode). `haversine_km` RPC + `discover_jobs` for proximity. Admin `(admin)/live-radar` is a live job-activity map.

**Risk visualizations (client, web `src/roles/client`):** `RiskHeatmap.tsx` (findings weighted by severity → risk score per category) and `ComplianceHeatmap.tsx` (animated 4×4 risk grid). These are data heatmaps, not geographic.

**Not implemented:** live inspector GPS streaming / geofencing / "radar" tracking of people. `browse-jobs-map.tsx` is an **orphaned redirect** (dead).

**Coordinate-integrity gap:** `jobs.latitude/longitude` have no DB CHECK constraint; the map validates bounds at read time, but invalid coords could be stored.

---

## 14. File storage — 23 buckets

Hardened in `20260517140000_storage_rls_lockdown.sql` (per-bucket named RLS, server-side `file_size_limit` + `allowed_mime_types`).

**Public:** `avatars`, `branding_assets` (self-scoped writes).
**Private (RLS-gated):** `report-images`, `inspection-photos` **and** `inspection_photos` (naming drift — two buckets), `inspection-reports`, `documents`, `job-documents`, `chat_attachments`, `inspector-docs`, `inspector_certificates`, `inspector_credentials`, `certifications` **and** `certificates` (drift), `receipts`, `dispute-evidence`, `contracts`, `resumes`, `client_documents`, `compliance`, `bridge-documents`, `flash-report-attachments`, `ml-models` (admin-only).

**Observations:** (1) **bucket naming drift** — `inspection-photos`/`inspection_photos` and `certificates`/`certifications`/`inspector_certificates` overlap; consolidate to avoid split-brain reads. (2) Signed URLs are bearer tokens (1h–1y TTLs vary) — acceptable but the 1-year chat-attachment TTL is long. (3) Deferred (tracked in migration): job-party-scoped access + `SECURITY DEFINER` signed-URL minting + canonicalizing the `documents` path layout from `project_<jobid>/` to `<jobid>/<uid>/`.

---

## 15. Database schema — ~73 tables, 7 views

**Identity & legal:** `profiles`, `push_tokens`, `auth_recovery_codes`, `legal_documents`, `legal_consents`, `legal_document_acceptances`, `profile_work_auth_documents`, `country_codes`, `clauses`, `clause_acceptances`.
**Jobs & work:** `jobs`, `job_applications`, `job_clauses`, `job_contracts`, `job_expenses`, `work_sessions`.
**Inspection & compliance:** `inspection_assets`, `inspection_captures`, `inspection_domains`, `inspection_evidence_requirements`, `inspection_scope_templates`, `inspection_seal_anchors`, `asset_defect_observations`, `findings`, `reports`, `report_exports`, `flash_reports`, `flash_report_attachments`, `compliance_documents`, `verification_affidavits`, `trust_certificates`, `pi_report_seals`.
**Inspector profile:** `inspector_certificates`, `inspector_certifications`, `inspector_credentials`, `inspector_documents`, `inspector_domain_practice`, `inspector_earnings`, `inspector_equipment`, `inspector_work_experience`.
**Contracts:** `contracts`, `contract_assignments`.
**Financial:** `wallets`, `transactions`, `payments`, `disputes`, `fx_rates`, `fx_refresh_runs`, `stripe_webhook_events`, `platform_settings`.
**Org / enterprise:** `organizations`, `org_members`, `org_invitations`, `departments`, `department_members`, `department_budgets`, `approval_policies`, `approval_requests`, `approval_decisions`.
**Comms:** `conversations`, `messages`, `support_messages`, `notifications`.
**Coordination bridge:** `coordination_bridges`, `bridge_slots`, `bridge_documents`, `vendor_contacts`.
**Reviews:** `reviews`, `review_weights_config`.
**AI / ML:** `ai_detections`, `model_artifacts`, `signing_keys`.
**Audit / system:** `audit_events`, `client_error_events`, `contact_submissions`, `client_documents`.

**Views (7):** `inspectors_directory` (anonymized public), `client_job_contracts_view` + `inspector_job_contracts_view` (blind pricing), `reviews_public`, `audit_events_public`, `job_applications` (view), `inspector_profile_smoke_test` (test artifact — candidate for removal).

---

## 16. API / RPC / server-action surface

**239 Postgres functions** total: ~150 callable RPCs + ~89 trigger/helper functions (`tg_*`, `_*`, `notify_on_*`, `touch_*`, `update_*_updated_at`). Grouped callable highlights:

- **Auth/onboarding:** `apply_onboarding_role`, `handle_new_user`, `handle_new_inspector`, `sync_onboarding_metadata_to_profile`, `nx_is_admin`, recovery-code RPCs (`regenerate/consume_recovery_codes`).
- **Jobs/applications:** `admin_dispatch_job`, `admin_adjust_job_price`, `admin_set_job_pricing`, `admin_cancel_job`, `owner_cancel_job`, `invite_inspector_to_job`, `inspector_start_job`, `guard_jobs_status_transition`, `discover_jobs`, `can_review_job`.
- **Contracts/negotiation:** `admin_generate_job_contract`, `client_sign_job_contract`, `inspector_sign_job_contract`, `sign_contract`, `admin_counter_application`, `inspector_respond_to_counter`, `admin_forward_application_to_client`, `heal_contract_to_active`.
- **Financial:** `process_withdrawal`, `wallet_credit_topup`, `admin_mark_payout_processed`, `request_milestone_release`, `admin_set_fee_schedule`, `public_get_fee_schedule`, `file_dispute`, `admin_resolve_dispute`, `resolve_dispute`, Stripe webhook claim/complete/release, `stripe_complete_job`.
- **Org/enterprise/budgets:** `create_organization`, org-member RPCs, department CRUD, `fetch_department_budget_rollup`, `fetch_department_spend_summary`, `check_department_budget`, `evaluate_job_for_approval`, `submit_job_approval`, `set_approval_policy`, `set_org_base_currency`, `set_active_org`.
- **Provable-AI/trust:** `pi_seal_inspection_report`, `pi_countersign_inspection_report`, `pi_fetch_report_seal`, `pi_canonical_json`, `pi_record_ai_detection`, `record_seal_anchor`, `assemble_evidence_pack`, `can_assemble_evidence_for`, `get_inspection_passport`, `fetch_affidavit_by_verify_token`, `fetch_cert_by_slug`, `gen_verify_token`.
- **ML:** `ml_register_model`, `ml_resolve_models`, `ml_set_model_status`.
- **Coordination bridge:** ~20 `bridge_*` RPCs (create/rotate-token/invitation/document request-accept-reject/vendor schedule + site-access + arrival-signature).
- **Reviews/reputation:** `submit_review`, `moderate_review`, `compute_review_weight`, `recompute_reputation`.
- **Integrity analytics (notable):** `detect_rubber_stamping`, `detect_silent_overrides`, `detect_off_hours_decisions`, `detect_quarter_end_clustering`, `detect_concentration_risk`, `detect_band_evasion_pattern`, `detect_vendor_coordination_latency`, `inspector_integrity_analytics`, `compliance_posture_summary` — a real fraud/anomaly-detection suite (backs `/admin/integrity`).
- **Search/stats:** `global_search`, `public_stats`.

**Web server actions (54 files, ~120 actions)** in `apps/web/src/lib/actions/` — thin, Zod-validated wrappers over the RPCs (jobs, contracts, invoices, payouts, disputes, documents, evidence locker, org structure, procurement, moderation, settings, certifications, reviews, messaging). **Route handlers (4):** OAuth callback, iCal feed, wallet statement, price-blind invoice PDF.

---

## 17. Edge functions (28, Deno)

**Trust/anchoring:** `anchor-inspection-seals`, `confirm-inspection-anchors`, `generate-vca`, `verify-affidavit`, `send-consent-receipt`.
**Stripe (12):** `create-payment-intent`, `create-setup-intent`, `create-wallet-deposit-intent`, `create-stripe-connect-link`, `create-stripe-payout`, `process-payout`, `release-payment`, `sync-payment-method`, `sync-stripe-connect-status`, `stripe-connect-webhook`, `stripe-payments-webhook`, `stripe-connect-redirect`.
**Notifications:** `dispatch-notification-emails`, `notify-job-event`, `notify-job-assigned`, `critical-alert-monitor` (in-dev; has a test file).
**Contracts/disputes/vendor:** `generate-contract`, `generate-dispute-report`, `handle-dispute`, `vendor-bridge-auth`.
**Misc:** `refresh-fx-rates`, `backfill-country-of-residence`, `verify-contractor`.

**Anomaly:** `supabase/functions/assign-inspector-to-job.sql` is a **`.sql` file misplaced in the functions directory** (not a Deno function) — cleanup candidate. `critical-alert-monitor/webhook-config.sql` similarly sits beside a function.

---

## 18. Provable-AI / trust / compliance layer

This is the moat and it is largely real:
- **Capture chain** (`inspection_captures`, SHA-256 linked list, GPS + device attestation) → **report seal** (`pi_report_seals`, canonical-JSON root, inspector + client signatures) → **Bitcoin anchor** (`inspection_seal_anchors`, two-phase OpenTimestamps) → **public verification** (`get_inspection_passport` → `/passport/[sealId]`).
- **Canonical JSON** is shared between DB (`pi_canonical_json`) and `shared-core` so the device and server derive identical hashes; the device verifier uses **@noble** Ed25519 (a prior `.js`-import trap silently disabled it — now fixed, per project memory).
- **Evidence packs** (`assemble_evidence_pack`, `can_assemble_evidence_for`, edge `generate-vca`, `verify-affidavit`) bundle sealed evidence + affidavits with verify tokens.
- **Model integrity:** ML models must be signed; unsigned/tampered models are rejected on-device. Server-side model→detection binding is designed but the inference pipeline isn't producing real detections yet.

---

## 19. Security posture & risks

**Closed (verified in migrations):**
- **Client-mintable money** → `20260719120000` REVOKEs client writes on `wallets`/`transactions`; balance only via RPC. ✅
- **Mutable audit log** → `20260711120000` makes `audit_events` append-only (INSERT `WITH CHECK actor_id=auth.uid()`, REVOKE UPDATE/DELETE). ✅
- **Storage RLS chaos** → `20260517140000` replaced ad-hoc policies with named per-bucket RLS + MIME/size limits. ✅
- **SECURITY DEFINER search_path hijack** → `20260710120000` pins `search_path` on definer functions. ✅
- **Web React #31 dual-version crash** → `apps/web` fully isolated from the workspace so it resolves only React 19 (mobile keeps React 18). ✅
- **Public poaching surface** → `/p`, `/inspectors`, `/passport` made pseudonymous at the data layer (view `inspectors_directory` rewritten to emit zero PII, migration `20260727120000`; passport RPC returns `inspector_id` not name). ✅ *(code ships first, then apply 20260727 — ordering matters)*

**Open / in-progress:**
- **God-mode not fully unified** — ~51 RLS checks + some mobile admin routing still gate on `super_admin` only, excluding `admin`. (Tracked.)
- **`DEV_SSO_BYPASS`** referenced in several web files — must be provably dev-only before prod.
- **Notification preferences** not enforced at edge-function dispatch (mutes can be ignored).
- **Deferred RLS tightening** — `audit_events` SELECT is currently broad; `documents`/`job-documents` job-party scoping pending path canonicalization.
- **Stripe app-integration** is the largest unfinished/untested surface; needs a dedicated payments + webhook review before live funds.
- **Web build type/lint gates** historically toggled off to ship the landing page past ~37 pre-existing errors; the real gate is `npm run typecheck -w @nexpec/web` — confirm flags are back on.
- **Coordinate CHECK constraints** missing on `jobs` lat/lng.

---

## 20. Dead / incomplete / orphaned code

| Item | Location | Disposition |
|---|---|---|
| `browse-jobs-map.tsx` | mobile | Orphaned redirect — remove |
| `(senior)` group | mobile | Deprecated stub — remove after deprecation window |
| `(super-admin)` group | mobile | Alias of `(admin)` — consolidate |
| `(organization)` group | mobile | Greenfield scaffold, zero screens — build or drop |
| `(agency)` passthrough | mobile | Minimal — fold into client |
| `(tabs)/{dashboard,inspector-dashboard,job-details-example}` | mobile | Hidden `href:null` — example code |
| `assign-inspector-to-job.sql` | `supabase/functions/` | Misplaced `.sql` — move/remove |
| `inspector_profile_smoke_test` view | DB | Test artifact in prod schema |
| `verification_affidavits`, `trust_certificates` | DB | Schema without wired generation UI |
| `compliance_documents` | DB | Supplier upload table, no UI |
| Canvas signature path | inspection report | Deferred; typed-name only today |
| Multi-currency FX | DB + edge | Schema/plumbing only; no UI selection |
| AI inference pipeline | ml_* + ai_detections | Schema-complete; no real model registered |
| Bucket naming drift | storage | `inspection-photos`/`_photos`, `certificates`/`certifications` |
| 27 TODO/FIXME markers | app/src/web | Triage backlog |

---

## 21. Prioritized recommendations

1. **Finish the god-mode unification** — make every RLS check + mobile route treat `admin` ≡ `super_admin`; it's a one-rule invariant that's currently half-applied (security-relevant).
2. **Payments hardening pass** — dedicated review of the 12 Stripe edge functions + webhook idempotency + payout path before real money; add e2e tests.
3. **Prove `DEV_SSO_BYPASS` is dead in prod** and re-enable the web typecheck/lint gates.
4. **Close mobile parity gaps** — client evidence vault, admin domain management, enterprise/org seats; then **de-fragment routing** (one canonical path per feature; retire `(senior)`/`(super-admin)`/`(organization)`/`(agency)`).
5. **Enforce notification preferences** in the dispatch edge functions.
6. **Either ship or shelve the schema-only subsystems** (CCI issuance UI, coordination-bridge inspector UI, multi-currency, AI inference, affidavits/certificates) — each is carrying cost as dead weight until wired.
7. **Storage hygiene** — consolidate drifted buckets, finish job-party RLS + signed-URL minting, shorten the 1-year chat-attachment TTL.
8. **Data integrity** — add lat/lng CHECK constraints; drop the smoke-test view + misplaced `.sql` from prod surfaces.

---

*Appendix — evidence base: counts from `find`/`grep`/Python over the tree (2026-06-01); module findings from four parallel source-reading deep-dives with `file:line` citations (inspection/contract; chat/notifications/maps; financial/storage/security/API; mobile/parity). Status labels for unwired subsystems are inferred from call-graph reachability and noted as such.*
