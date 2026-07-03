# NEXPEC — Investor Feature Matrix

**The trust infrastructure for industrial inspection.**
A two-sided, admin-brokered marketplace connecting asset owners, EPCs, and agencies with certified industrial inspectors and vendors, wrapped in a payments, evidence, and compliance layer that no incumbent offers.

*Web portal (Next.js, Vercel edge) + native iOS/Android field app (Expo/React Native) on a single hardened Supabase/PostgreSQL backend. This document catalogs capabilities verified in the shipping codebase as of July 2026.*

---

## 1. The NEXPEC Trust Stack (platform-wide differentiators)

These invariants are enforced in the database layer itself, not just the UI. Every feature below inherits them.

| Capability | What it means commercially |
|---|---|
| **Brokered Deal Spine** | NEXPEC is a contractual party to every engagement (hub-and-spoke contract graph). Turnkey and direct deals flow through one auditable spine: contract-before-money, always. |
| **Structural Price Blindness** | Inspectors see only their payout; buyers see only their price. The platform spread is invisible to both sides by construction (row-level security + column allowlists + a CI scanner that fails any build that leaks a payout column to a buyer surface). Marketplace margin is architecturally protected. |
| **Report Quality Gate** | Field reports reach the client only after NEXPEC review and release. The gate is a database predicate, not a UI convention: an unreviewed report is unreadable by the buyer, even via deep link. |
| **Siloed Communications** | Client↔NEXPEC and Inspector↔NEXPEC conversation lanes with zero direct client↔inspector channel pre-engagement. Disintermediation is blocked at the RLS layer. |
| **Identity Protection (Anti-Poaching)** | Public and buyer-facing inspector profiles are pseudonymous by construction (NX-handles, trust sigils, zero PII emitted by the public views). Identity reveals are a monetized, contract-bound event. |
| **Admin-Controlled Treasury & Manual Payouts** | Client funds land on NEXPEC's internal double-entry treasury ledger (Stripe deposit rails with idempotent, replay-protected webhooks and server-trusted amounts). There is deliberately no automated payout: every inspector payment is individually reviewed and manually released by NEXPEC operators after report acceptance, with a full audit trail. Clients cannot mint balance; inspectors cannot self-assign work; money never moves without a human decision. |

---

## 2. For Clients, EPCs & Asset Owners (buy side)

| Feature | Description |
|---|---|
| **Guided Job Posting → Managed Dispatch** | Post inspection scopes with budgets; NEXPEC moderates, prices, and dispatches. Buyers never negotiate alone: admin counter-offer and blinded-shortlist flows built in. |
| **Blinded Talent Marketplace** | Browse a pseudonymized directory of verified inspectors (credential grade, ratings, coarse rate bands) with zero poaching surface. Invitation-to-job flows through the broker. |
| **Funds-Secured, Milestone-Aware Billing** | Prepay, net-terms, and advance structures held on NEXPEC's admin-controlled treasury ledger; releases are brokered manually after report acceptance. Milestone structures with deemed-acceptance windows for commercial work. |
| **Reviewed Report Delivery** | Every deliverable passes NEXPEC quality review before release; clients get a clean accept/revise loop with a full revision ledger. |
| **Real-Time Flash Reports (NCR)** | Critical field findings (non-conformance) escalate immediately through an identity-safe channel, with admin oversight on every raise. |
| **Dispute & Freeze Protection** | One-tap dispute filing freezes the job and its funds pending NEXPEC arbitration, with an evidence trail. |
| **Team Workspaces (B2B)** | Multi-seat organizations: role-scoped teammates see and manage the org's missions, with pseudonymous in-mission team chat. |
| **Finance Suite** | Budgets, envelopes, approval policies, invoices, and spend dashboards scoped per organization. |
| **Client Vault** | Private, access-controlled document storage with server-authorized signed URLs (no public buckets anywhere in the platform). |
| **VIP Named Disclosure** | Optional paid unlock of inspector identity, bound to a sealed non-circumvention rider and settled through a real payment rail (money-before-benefit, enforced server-side). |

## 3. For Independent Inspectors (supply side)

| Feature | Description |
|---|---|
| **Offline-First Field App** | Purpose-built native app: capture, reports, expenses, and signatures work with zero connectivity. A transactional outbox with intelligent conflict/error classification syncs safely when the field crew regains signal — no double-writes, no silent loss. |
| **On-Device Private AI (AI Co-Inspector)** | Corrosion/defect detection runs on-device (TFLite) with cryptographically signed models. Client imagery never has to leave the phone for AI assistance: privacy as a feature, zero API cost at the margin. |
| **Provable Evidence (Cryptographic Seals)** | Inspection evidence packs are Ed25519-sealed on device, bind the AI model's identity into the seal, and are anchored to the Bitcoin blockchain via OpenTimestamps. Any party can verify a report's integrity years later, offline, via the public verification portal. |
| **Guaranteed, Transparent Payouts** | Admin-set payout visible up front; earnings wallet with pending/available balances, statements, YTD views, and self-serve withdrawal requests. Contract-before-money in SQL. |
| **Career Passport** | Verified credential wallet (certifications with expiry tracking), equipment & calibration registry, work-history résumé, ratings, and an A–F credential-transparency grade: a portable professional identity. |
| **Compliance Center** | Guided CCI applications, document verification workflows, jurisdiction-aware requirements (specialty taxonomy + jurisdictional phase mapping). |
| **Job Discovery** | Feed + map-based discovery of dispatched work with payout-only economics, applications, and admin-brokered negotiation. |
| **Tax Center** | In-platform tax profile with an encrypted PII vault (pgcrypto, key held server-side in a dedicated edge function); tax-info-before-money payout gating. |
| **Biometric & Hardened Auth** | Biometric unlock, TOTP two-factor with step-up enforcement (AAL2 gate), PKCE OAuth (Apple/Google/LinkedIn), secure session handling. |

## 4. For Agencies & Enterprise Organizations

| Feature | Description |
|---|---|
| **Agency Command Center** | Dedicated portal: pooled inspector rosters, aggregate marketplace pools, multi-mission dashboards, org-scoped work orders. |
| **Org Structure & Governance** | Organizations, member roles, budget envelopes, approval policies, and admin-managed seats: enterprise controls without enterprise onboarding friction. |
| **Ghost-Mode Team Chat** | Private agency-team threads per mission that even NEXPEC staff cannot browse: integrity oversight exists only as a zero-trace, super-admin-gated read (a deliberate, documented trust design). |
| **White-Label Surface** | Custom branding settings for client-facing outputs. |
| **MSA / Contract Engine** | Template-driven master service agreements (multi-jurisdiction), tiered administrative amendment fees, and a sealed Commercial Revision Ledger (arbitration-grade docket). |

## 5. For Vendors & Suppliers

| Feature | Description |
|---|---|
| **RFQ → Quote → Award Pipeline** | Structured procurement: buyers raise RFQs, suppliers quote, NEXPEC brokers the award. |
| **Admin Intercept & Markup** | Suppliers never see the buyer's price; buyers only ever see NEXPEC's presented offer. Margin capture is built into the data model (offer views, not raw quotes). |
| **Two-Party Digital Contracting** | Supplier↔NEXPEC e-sign agreements with content hashing (SHA-256 seal); funds release requires an executed contract, enforced in SQL. |
| **Brokered Release Ledger** | Every payment release against an awarded quote is recorded with over-release protection; supplier earnings wallet with full statement history. |
| **Vendor Certification Bridge** | Capability-token onboarding flow (out-of-band, hash-secured) for vendor document intake without account friction. |

## 6. NEXPEC Mission Control (the operating moat)

| Feature | Description |
|---|---|
| **God-Mode Admin Console** | Web-deep and mobile-capable: job moderation, dispatch with spread control, user verification, payout operations, treasury, disputes, reviews, org management, live radar, communications, and a full support helpdesk with rich-media chat. |
| **The Spread Cockpit** | Admin sets client price and inspector payout independently; platform spread is a first-class, GENERATED column with dashboards, never exposed to either side. |
| **Integrity Monitor** | Zero-trace oversight of team-internal threads (compliance-sensitive, deliberately auditable design decision). |
| **Redacted Audit Trail** | Every sensitive mutation lands in an audit event stream; pricing and identity fields are server-side redacted for non-admin consumers. |
| **Supplier & Marketplace Curation** | Feed curation console, coarse rate-band controls, demand/supply feed projections (trigger-refreshed tables, not expensive live views). |
| **Reconciliation & FX** | Ledger reconciliation worker, isolated FX subsystem, critical-alert monitor with fail-closed webhooks. |

## 7. Growth & Distribution Engine

| Feature | Description |
|---|---|
| **Teaser Marketplace (SEO Flywheel)** | Public, privacy-by-construction supply/demand feeds with per-item SEO pages, JobPosting/Organization JSON-LD, sitemaps, and RSS/JSON syndication feeds: organic acquisition with zero PII exposure. |
| **Public Verification Portal** | Anyone can verify a sealed inspection artifact (QR → passport page): every verified report is a trust advertisement. |
| **Marketing Site + Lead Capture** | Conversion-oriented landing with a working contact pipeline into the operator inbox. |
| **Internationalization** | Mobile app ships in 7 languages (EN/FR/ES/DE/ZH/AR/FA) including full RTL; web portal in 4 and expanding. |

## 8. Engineering & Security Posture (diligence-ready)

| Area | Evidence |
|---|---|
| **Database-first security** | 140+ RLS-governed tables with verified admin coverage; SECURITY DEFINER functions search-path-pinned fleet-wide; anonymous access revoked across sensitive surfaces; party-relationship gating on profile reads (bulk-harvest resistant). |
| **Money perimeter** | pgTAP-tested financial invariants (150+ assertions across money-flow, RLS matrix, and tax suites); idempotent wallet operations with a dedicated restore ledger; self-hire and role-escalation guards as database triggers. |
| **CI enforcement of business invariants** | Custom pipeline gates: price-blindness scanner, offline-outbox routing guard, DB-reference integrity checker, RLS admin-coverage checker, and a blocking type-check on the web portal. The golden rules cannot silently regress. |
| **Storage hygiene** | Zero public buckets for sensitive content; all document access flows through owner/party-authorized signed URLs minted by a server-side authorization oracle. |
| **Evidence integrity chain** | Device-held Ed25519 signing with a burned-and-rotated key ceremony, model→detection binding enforced server-side, Bitcoin-anchored timestamps with two-phase confirmation. |
| **Release discipline** | Single canonical baseline schema (prod-dump squash) + forward-only, self-testing migrations; a master release runbook with ordered, reversible phases; institutional memory maintained in-repo. |
| **Privacy & consent** | Consent management with receipts, GDPR-grade soft-delete/anonymization pipeline, encrypted tax PII vault, data-rights ToS framework, AI asset ownership policy. |

---

## 9. Platform Synchronization Snapshot

One backend, two synchronized clients, intentional specialization:

| Layer | Status |
|---|---|
| Shared data contract (jobs, applications, messaging, reports, flash reports, disputes, payouts, suppliers, teams) | **Verified identical tables/RPCs across web + mobile** |
| Mobile-native by design | Offline outbox, live capture, on-device AI, biometrics, push notifications |
| Web-native by design | SEO/teaser marketplace, syndication feeds, deep admin consoles, integration secrets |
| Auth parity | Email, social (PKCE), TOTP 2FA, and self-serve password recovery on **both** platforms |

---

*Prepared July 2026. Every line above corresponds to shipped code in the NEXPEC monorepo (verified during the July 2026 zero-defect certification sweep); roadmap items are explicitly absent from this document.*
