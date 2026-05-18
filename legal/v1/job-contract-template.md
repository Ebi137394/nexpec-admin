---
id: JOB-TPL-001
title: NEXPEC Job Contract Template
version: 1.0
status: draft
checkpoint: 3
effective_date: TBD
language: en
governing_law: QC-CCQ (subject to Country Addendum override)
operator: NEXPEC Technologies (Montréal, Québec, Canada) — facilitator only, not a party
parties: Client and Inspector (or Agency on behalf of Roster Inspector)
incorporates: [TOS-001, PRIV-001, AUP-001, INSP-AGR-001, CLI-AGR-001, ESCROW-001]
also_applies_if: [AGN-AGR-001, ORG-AGR-001]
schema: ./job-contract-template.schema.json
binding_mechanism: Electronic acceptance through the NEXPEC platform (Client "Confirm Hire" + Inspector "Accept Job")
---

# NEXPEC — Job Contract (Auto-Generated Template)

> **Plain-English summary.** This is the contract between you (the Client) and the Inspector (or the Agency that employs them) for one specific Job. It is generated automatically when the Client confirms a hire on NEXPEC, with the parties and Job details filled in from the platform. NEXPEC is **not a party** — we are the platform that hosts the contract and holds the escrow. The bigger documents you accepted at signup still apply on top.

This Job Contract is generated automatically from variable inputs (see the JSON schema referenced in the metadata block) and is **electronically accepted** by both Parties through the NEXPEC platform at confirmation of hire. It is the **Tier-3 per-Job agreement** and incorporates by reference TOS-001, PRIV-001, AUP-001, INSP-AGR-001, CLI-AGR-001, ESCROW-001, and — where applicable — AGN-AGR-001 (where an Agency is involved) and ORG-AGR-001 (where the Client is an Organization Seat).

**Conflict rule.** In case of conflict between this Job Contract and any incorporated document, the **incorporated document controls** — **except** as to scope, schedule, deliverables, payout, and per-Job jurisdiction, which are governed by this Job Contract.

## 1. Parties
- **Client:** `{{parties.client.legal_name}}`, of `{{parties.client.country}}` (account ID `{{parties.client.id}}`).
- **Inspector:** `{{parties.inspector.legal_name}}`, of `{{parties.inspector.country}}` (account ID `{{parties.inspector.id}}`).
- **Agency** *(if applicable)*: `{{parties.agency.legal_name}}`, of `{{parties.agency.country}}` (account ID `{{parties.agency.id}}`), engaging the Inspector as a Roster Inspector under AGN-AGR-001 — the **Agency, not the Inspector, is the Inspector counterparty** for purposes of this Job Contract.

**NEXPEC Technologies is not a party to this Job Contract** and is named only as platform operator, escrow facilitator, and dispute coordinator.

## 2. Scope of Work
- **Title:** `{{scope.title}}`
- **Description:** `{{scope.description}}`
- **Specialty / Discipline:** `{{scope.specialty}}`
- **Deliverables:** `{{scope.deliverables}}` (typically: written inspection report, photographs, findings, recommendations, and certifications referenced).
- **Required Certifications:** `{{scope.certifications_required}}`
- **Site Location:** `{{scope.location.address}}`, `{{scope.location.country}}` (geo: `{{scope.location.lat}}`, `{{scope.location.lng}}`).

## 3. Schedule
- **Scheduled Start Date:** `{{schedule.scheduled_date}}`
- **Estimated Duration:** `{{schedule.estimated_duration_days}}` day(s)
- **Urgency:** `{{schedule.urgency}}`

The Inspector will perform the Job at the scheduled date and, on completion, mark the Job complete and upload deliverables through the platform.

## 4. Compensation

The compensation model for this Job is **`{{compensation.model}}`** — one of three: **fixed** (single lump-sum), **milestone** (sequenced or scheduled payouts), or **recurring** (periodic billing for ongoing engagements). The 10% NEXPEC Platform Facilitation & Technology Fee is **withheld at source at each funding/release event** across all three models.

### 4.1 Fixed model — single lump-sum (default)
Applies where `compensation.model = 'fixed'`.

- **Currency:** `{{compensation.currency}}`
- **Gross Contract Value:** `{{compensation.gross_amount_minor}}` (in minor units of the stated currency)
- **NEXPEC PFT Fee (10%, withheld at source):** `{{compensation.pft_fee_minor}}`
- **Net Payout to Inspector / Agency:** `{{compensation.net_payout_minor}}`
- **Rate Type:** `{{compensation.rate_type}}`

Funding is held in **Stripe Connect Express** escrow upfront per ESCROW-001 §2.1; release follows the triggers in ESCROW-001 §3.

### 4.2 Milestone model — sequenced / scheduled payouts
Applies where `compensation.model = 'milestone'`. Each milestone is funded and released **independently**; a disputed milestone does not pause release of already-accepted milestones.

- **Currency:** `{{compensation.currency}}`
- **Total Contract Value:** sum of milestone gross amounts (platform-computed; itemized below)
- **Milestones:** `{{compensation.milestones}}` — each entry carries: `milestone_id`, `title`, `sequence`, `gross_amount_minor`, `pft_fee_minor` (10% of milestone gross), `net_payout_minor`, `trigger` (one of `client_acceptance` / `scheduled_date` / `inspector_marks_complete`), optional `scheduled_date`, `deliverables`, and `status`.

Each milestone has its own 7-day acceptance review window, with mandatory Day-3 and Day-5 reminders, per ESCROW-001 §3.5. Funding rules — per-milestone or upfront-deposit-with-staged-release — are governed by ESCROW-001 §2.2. Mid-contract cancellation, default for non-funding, and partial release are governed by ESCROW-001 §5.2.

### 4.3 Recurring model — periodic billing for ongoing engagements
Applies where `compensation.model = 'recurring'`. Typical use: 6-month or 12-month inspection retainers, monthly compliance auditing, ongoing turnaround-readiness inspections.

- **Currency:** `{{compensation.currency}}`
- **Period:** `{{compensation.recurring.period}}` (weekly | biweekly | monthly | quarterly)
- **Gross per Period:** `{{compensation.recurring.period_amount_minor}}`
- **NEXPEC PFT Fee per Period (10%, withheld at source):** `{{compensation.recurring.pft_fee_per_period_minor}}`
- **Net Payout per Period to Inspector / Agency:** `{{compensation.recurring.net_payout_per_period_minor}}`
- **Total Periods:** `{{compensation.recurring.total_periods}}` *(null = open-ended; terminable by notice)*
- **First Period Start:** `{{compensation.recurring.first_period_start}}`
- **Funded Periods Ahead:** `{{compensation.recurring.funded_periods_ahead}}` — Client maintains this many periods in **rolling escrow** at all times. Mandatory Day-7 and Day-3 top-up reminders.
- **Termination Notice:** `{{compensation.recurring.termination_notice_days}}` days

Each period auto-releases at period close + 7 days, with mandatory Day-3 and Day-5 reminders during the review window, per ESCROW-001 §3.6. Termination semantics — notice, default-for-non-funding, prorated final period — are governed by ESCROW-001 §5.3.

### 4.4 Cross-model rules
- The **10% PFT Fee** is applied uniformly across all three models, withheld at source at each funding/release event. It is not waived for milestone or recurring contracts.
- All amounts are expressed in **minor currency units** (e.g., cents, halalas) of the stated `compensation.currency`.
- The Job Contract records the resolved model and its specific amounts at contract generation; subsequent amendments to scope, schedule, or compensation require both Parties' written acceptance through the Platform.
- A **disputed milestone or period does not pause release** of milestones or periods already accepted. The dispute is scoped narrowly to the specific disbursement-unit in question; the rest of the contract continues.

Payment for all three models is held in **Stripe Connect Express** escrow. NEXPEC is not a money services business (TOS-001 §7); Stripe is the licensed payment facilitator.

## 5. Inspector Status & Standards
The Inspector (or Agency) performs the Job as an **independent contractor** under INSP-AGR-001 (and AGN-AGR-001 where applicable). NEXPEC does not warrant the Inspector's work product. The Inspector will perform with the skill and care of a qualified inspector in the relevant discipline and will not falsify, fabricate, or backdate findings.

## 6. Client Obligations
The Client performs its obligations under CLI-AGR-001 — including site safety, hazard disclosure, lawful authority, payment funding, the honest-findings protection (CLI-AGR-001 §6), and the no-warranty-on-Inspector-Output acknowledgement (CLI-AGR-001 §3).

## 7. Deliverables & Acceptance
On the Inspector marking the Job complete and uploading deliverables through the platform, the Client has **`{{acceptance.review_window_days}}` calendar day(s)** to either (a) accept the delivery, triggering escrow release, or (b) raise a dispute as provided in ESCROW-001 §4. If neither action is taken within that window, **escrow auto-releases** under ESCROW-001 §3(c).

## 8. Confidentiality
The Inspector treats Client site information, plans, schematics, and personnel data as Client Confidential Information (INSP-AGR-001 §6). The Client treats the Inspector's proprietary methodology and any non-deliverable trade secrets as Inspector Confidential Information.

## 9. Cancellation & Dispute
- **Cancellation before commencement:** per ESCROW-001 §5 (refund less Stripe processing fees).
- **Cancellation after commencement:** per ESCROW-001 §5 (allocation in dispute follows §4).
- **Disputes:** TOS-001 §10 — mandatory 30-day mediation through NEXPEC support, then exclusive Montréal courts — **unless** a Country Addendum applicable to either Party's jurisdiction (`{{jurisdiction.country_addendum_applied}}`) mandates a different forum, in which case that Addendum's mandatory-law overlay controls.

## 10. Governing Law, Language & Electronic Acceptance
This Job Contract is governed by **`{{jurisdiction.governing_law}}`**. The language of execution is `{{language}}`; a translation may be provided as a courtesy but the executed language controls. Both Parties acknowledge that **acceptance through the NEXPEC platform** — by the Client clicking "Confirm Hire" and the Inspector (or Agency) clicking "Accept Job" — constitutes a binding electronic signature.

---

**Generated by NEXPEC at:** `{{generated_at}}` · **Contract ID:** `{{contract_id}}` · **Linked Job ID:** `{{job_id}}` · **Template version:** `1.0`

— End of JOB-TPL-001 v1.0 —
