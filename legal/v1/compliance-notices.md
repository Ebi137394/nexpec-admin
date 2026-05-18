---
id: COMPLIANCE-NOTICES-001
title: NEXPEC Compliance Notices
version: 1.0
status: draft
checkpoint: 5
effective_date: TBD
language: en
operator: NEXPEC Technologies (Montréal, Québec, Canada)
surface: Profile → Legal & Compliance → Compliance Notices
related: [PRIV-001, ADDENDUM-FRAMEWORK-001, DPA-001]
content_freshness: dynamic (re-render on app focus)
---

# NEXPEC — Compliance Notices

> **Plain-English summary.** This is the standing public-facing surface that tells users where their data goes, who else touches it, what jurisdictions we recognize, what languages we're translated into, and where the regulators are. It's referenced by the master legal stack and updated as our operating reality changes — not by re-papering the master docs, but by editing this page.

This document is also the **content + structure spec** for the `/profile/legal` → "Compliance Notices" sub-page that was scaffolded as "Coming soon" at Checkpoint 4. When the user is ready to wire it, the sub-page renders five collapsible sections in the order below. Each section has both a public-text version (for the in-app viewer) and a structured-data version (for the future `subprocessors` and `country_status` tables).

---

## 1. Data-Residency Disclosure

**Spec for the sub-page card.** Shows the user where each category of data sits, the current legal-transfer mechanism in place, and the date of the last review.

**Public-facing text (v1):**

NEXPEC operates globally via **Supabase on AWS**. Data is hosted across multiple AWS regions and is not committed to a specific localized region for v1 unless an Enterprise Order Form (ORDER-FORM-001) expressly so provides.

| Data Category | Primary Region (v1) | Backup Region (v1) | Transfer Mechanism Out of Source Jurisdiction |
|---|---|---|---|
| Account & Verification Data | `us-east-1` (AWS N. Virginia) | `ca-central-1` (AWS Montréal) | EU SCCs · UK IDTA · PIPEDA contractual safeguards · Law 25 Article 17 |
| Job Data & Inspector Output | `us-east-1` | `ca-central-1` | same |
| Payment Data | held by Stripe | n/a | Stripe's own data-transfer regime |
| Logs & Telemetry | `us-east-1` | `ca-central-1` | same |

**Last review:** `[TBD]`. Recurring review cadence: every six months and on each material subprocessor change.

---

## 2. Subprocessor List

**Spec for the sub-page card.** Renders the current subprocessor list with name, purpose, region, transfer mechanism, and a "data effective" date. New-subprocessor additions trigger a 15-business-day Customer-objection window for Organizations (ORG-AGR-001 §5 / DPA-001 §5).

**Public-facing list (v1):**

| Subprocessor | Purpose | Hosting Region(s) | Transfer Mechanism | Effective From |
|---|---|---|---|---|
| **Stripe, Inc.** | Payment processing, escrow custody, payout, currency conversion, tax invoicing | USA + global | Stripe's published transfer regime | v1 effective date |
| **Supabase, Inc.** | Database, authentication, file storage, edge functions | AWS multi-region | EU SCCs + processor agreement | v1 effective date |
| **Amazon Web Services (AWS)** | Underlying compute, storage, network for Supabase | AWS multi-region | AWS DPA + SCCs | v1 effective date |
| **Email delivery provider** | Transactional emails | `[TBD per vendor selection]` | SCCs or PIPEDA contractual | TBD |
| **SMS delivery provider** | OTP and transactional SMS | `[TBD per vendor selection]` | SCCs or PIPEDA contractual | TBD |
| **Crash & analytics provider** | Crash reporting, anonymized usage analytics | `[TBD per vendor selection]` | SCCs or PIPEDA contractual | TBD |
| **Customer support tooling** | In-app support tickets | `[TBD per vendor selection]` | SCCs or PIPEDA contractual | TBD |

Customers may subscribe to subprocessor change notifications by configuring **Notifications → Legal Updates** in their account.

---

## 3. Bill 96 — French-Translation Status

**Spec for the sub-page card.** A live status table of each master-stack document's French-translation status, surfaced for Québec-resident users on every visit.

**Public-facing text (v1):**

Under the **Charter of the French Language** (R.S.Q. c. C-11), as amended by Bill 96, NEXPEC offers French-language versions of consumer-facing legal documents to Québec-resident users. Status:

| Document | French Translation | Source Doc Hash | Translation Status |
|---|---|---|---|
| TOS-001 v1.0 | not yet published | `[hash]` | **Pending** — commission with Québec-qualified counsel; ETA `[TBD]` |
| PRIV-001 v1.0 | not yet published | `[hash]` | **Pending** — same |
| AUP-001 v1.0 | not yet published | `[hash]` | **Pending** — same |
| INSP-AGR-001 v1.0 | not yet published | `[hash]` | **Pending** — same |
| AGN-AGR-001 v1.0 | not yet published | `[hash]` | **Pending** — same |
| CLI-AGR-001 v1.0 | not yet published | `[hash]` | **Pending** — same |
| ORG-AGR-001 v1.0 | not yet published | `[hash]` | **Pending** — same |
| JOB-TPL-001 v1.0 | not yet published | `[hash]` | **Pending** — same |
| ESCROW-001 v1.0 | not yet published | `[hash]` | **Pending** — same |
| ADDENDUM-FRAMEWORK-001 v1.0 | not yet published | `[hash]` | **Pending** — same |

Until the French versions are published, Québec users may rely on the English version they accepted; in case of conflict between language versions when the French is published, the version accepted by the user controls (per TOS-001 §12).

---

## 4. Country-Addendum Status

**Spec for the sub-page card.** Mirrors the priority-market table in ADDENDUM-FRAMEWORK-001 §6 with a live status indicator for each market.

**Public-facing text (v1):**

| Code | Jurisdiction | Status | Active File | Activated On |
|---|---|---|---|---|
| `CA` | Canada (federal + Québec + ROC) | **active (self-signed)** | ADDENDUM-CA-001 v1.0 | `[TBD]` |
| `EU` | European Union / EEA | **draft → pending EU Rep appointment** | ADDENDUM-EU-001 v1.0 | not yet activated |
| `UK` | United Kingdom | **draft → pending UK Rep appointment** | ADDENDUM-UK-001 v1.0 | not yet activated |
| `US` | United States (multi-state) | **draft → pending US counsel sign-off** | ADDENDUM-US-001 v1.0 | not yet activated |
| `GCC` | KSA, UAE, Qatar | **draft → pending Arabic translation + KSA NDMO registration** | ADDENDUM-GCC-001 v1.0 | not yet activated |
| `JP` | Japan | **draft → pending Japanese translation** | ADDENDUM-JP-001 v1.0 | not yet activated |
| `KR` | South Korea | **draft → pending PIPA local rep + Korean translation** | ADDENDUM-KR-001 v1.0 | not yet activated |
| `IN` | India | **draft → pending grievance-officer appointment + Stripe Tax IN setup** | ADDENDUM-IN-001 v1.0 | not yet activated |
| `CN` | China | **scaffold-only — high friction** | ADDENDUM-CN-001 v1.0 | NOT-FOR-ACTIVATION |

Status transitions are gated by ADDENDUM-FRAMEWORK-001 §8 maintenance procedure: local-counsel review → publication in required language(s) → platform-side flag flip.

---

## 5. Regulatory IDs & Contacts

**Spec for the sub-page card.** Names, addresses, contact methods, and registration IDs for the regulators and the data-protection officer.

**Public-facing text (v1):**

- **Operator:** NEXPEC Technologies, Montréal, Québec, Canada.
- **Privacy contact / DPO function:** privacy@nexpec.com.
- **Grievance / abuse:** abuse@nexpec.com.
- **Legal notices:** legal@nexpec.com.
- **EU Article 27 Representative:** `[TBD — appoint before EU activation]`.
- **UK GDPR Article 27 Representative:** `[TBD — appoint before UK activation]`.
- **PIPA Korean local representative:** `[TBD — appoint before KR activation]`.
- **India Grievance Officer (IT Rules 2021):** `[TBD — appoint before IN activation]`.
- **KSA NDMO controller registration:** `[TBD before GCC-KSA activation]`.

---

## Page-Structure Spec for the In-App Sub-Page

When wired (post-Checkpoint-5 approval), the `/profile/legal` "Compliance Notices" card expands to a sub-page at `/profile/legal/compliance-notices` rendering the five sections above as collapsible cards in this order:

1. Data-Residency Disclosure
2. Subprocessor List (with diff highlight if changed within last 30 days)
3. Bill 96 French-Translation Status (auto-surfaced for Québec users)
4. Country-Addendum Status (filterable by status)
5. Regulatory IDs & Contacts (with mailto: links)

The sub-page is **registry-backed but content-dynamic**: it pulls the current subprocessor list and country-status table from a separate Supabase `legal_compliance_state` table (out of scope for Checkpoint 5 draft — wiring is a Checkpoint-4-style follow-up once you green-light the content above), with a fallback to the v1 content statically inlined here.

— End of COMPLIANCE-NOTICES-001 v1.0 (Content + Structure Spec) —
