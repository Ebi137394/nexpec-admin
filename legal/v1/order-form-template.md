---
id: ORDER-FORM-001
title: NEXPEC Enterprise Order Form (Template)
version: 1.0
status: draft
checkpoint: 5
effective_date: TBD
language: en
governing_law: QC-CCQ (subject to override in §8)
operator: NEXPEC Technologies (Montréal, Québec, Canada)
incorporates_into: [ORG-AGR-001]
related: [DPA-001, TOS-001, CLI-AGR-001, ESCROW-001]
template_type: fill-in-the-blank
---

# NEXPEC — Enterprise Order Form

> **Plain-English summary.** This Order Form is the fill-in-the-blank exhibit that goes alongside the Organization Agreement (ORG-AGR-001) when an enterprise customer needs custom commercial terms — discounted PFT Fees, net-invoice payment, dedicated SLA, data residency, alternative dispute forum. It overrides the Master Stack only in the specific dimensions filled out here.

**This Order Form is incorporated into the Organization Agreement (ORG-AGR-001).** It modifies the Master Stack **only** to the extent expressly stated below and **only** as between NEXPEC and the Customer named in §0.

---

## §0. Order Form Identification

| Field | Value |
|---|---|
| **Order Form Number** | `OF-________` |
| **Customer Legal Name** | `____________________________` |
| **Customer Address** | `____________________________` |
| **Customer Tax / Registration #** | `____________________________` |
| **Customer Primary Contact** | `____________________________` |
| **NEXPEC Entity** | NEXPEC Technologies, Montréal, Québec, Canada |
| **Effective Date** | `__________` |
| **Initial Term** | `____ months` |
| **Auto-Renewal Term** | `____ months (or "none")` |

---

## §1. Seats & Users
- **Provisioned Seats:** `_____` (admin, manager, requester, viewer roles per ORG-AGR-001 §2).
- **Additional Seats (overage rate):** `$ ____ per Seat per month`.
- **SSO requirement (yes/no):** `____`.
- **Domain bindings (email domains automatically enrolled):** `____________________________`.

---

## §2. PFT Fee (overrides ORG-AGR-001 §7 / TOS-001 §3 baseline of 10%)

| Tier | Annual Contract Value (gross) | Effective PFT Fee Rate |
|---|---|---|
| Tier 1 | $0 – $250K | `____ %` (default 10%) |
| Tier 2 | $250K – $1M | `____ %` |
| Tier 3 | $1M – $5M | `____ %` |
| Tier 4 | $5M+ | `____ %` (negotiated) |

**True-up cadence:** `quarterly / annually / none`.

---

## §3. Payment Terms (overrides ESCROW-001 §2 funding default)

- **Funding method:** `card on file / ACH / wire / purchase-order with net invoicing`.
- **Net invoice terms (if applicable):** `Net ____ days`.
- **Currency of invoicing:** `CAD / USD / EUR / GBP / AED / SAR / other: ______`.
- **Credit limit (if PO/net-invoice):** `$ ______`.
- **Late-payment treatment:** late charges per TOS-001 §3 + ESCROW-001; **no riba / interest where Sharia-overlay jurisdiction applies** (see ADDENDUM-GCC-001 §4).

---

## §4. Service Levels (overrides ORG-AGR-001 §6 "as available" default)

| Metric | Target | Credit (if missed) |
|---|---|---|
| **Platform uptime** | `____ %` measured monthly | `____ % of monthly fee per dropped half-percent` |
| **P1 incident response time** | `____ hours` business / `____ hours` after-hours | `____` |
| **P2 incident response time** | `____ business hours` | `____` |
| **Standard support response** | `____ business hours` | n/a |
| **Dedicated Customer Success contact** | `yes / no` | n/a |

Maintenance windows excluded from uptime calc: **`______`** (typically Sat 02:00–04:00 Montréal time).

---

## §5. Data Residency (overrides PRIV-001 §6 default of "no localized residency")

| Data Class | Residency Commitment |
|---|---|
| **Account & Verification Data** | `Canada / EU / USA / no commitment` |
| **Job Data & Inspector Output** | `Canada / EU / USA / no commitment` |
| **Backups** | `same region as primary / Canada` |

The Data Processing Addendum (DPA-001) is incorporated as **Schedule A** to this Order Form.

---

## §6. Reserved Capacity & Priority

- **Reserved Inspector capacity:** `____ Inspector-days / month` in `[region]`.
- **Priority matching:** `yes / no` — Customer's Jobs are surfaced to qualified Inspectors `____ hours` before general Inspectors.
- **White-label / co-brand:** `yes / no` — details in Schedule D if yes.

---

## §7. Custom Commercial Terms

`__________________________________________________________`
`__________________________________________________________`
`__________________________________________________________`

(For example: minimum commitment, volume rebate, escalation cap, prepayment discount, multi-year discount, ramp schedule.)

---

## §8. Governing Law & Forum (overrides TOS-001 §10 only as between NEXPEC and Customer)

- **Governing law:** `Quebec, Canada (default) / Delaware, USA / England & Wales / Singapore / DIFC (UAE) / other: ______`.
- **Forum / dispute mechanism:**
    - **Court:** `Exclusive courts of [city, state/country]: ______`; or
    - **Arbitration:** `[JAMS / AAA / LCIA / ICC / DIFC-LCIA / ADGM / SCCA] seated in [city, country]: ______`, conducted in `[English / French / other: ______]`, before `[one (1) / three (3)]` arbitrator(s).
- **Mandatory 30-day mediation step under TOS-001 §10:** `applies / waived for this Customer's commercial disputes only`.
- **No part of this §8 prejudices the local mandatory rights of the Customer's individual end-users.**

---

## §9. Signatures

**Customer:**
- Name: `_____________________________`
- Title: `_____________________________`
- Signature: `_____________________________`
- Date: `_____________________________`

**NEXPEC Technologies:**
- Name: `_____________________________`
- Title: `_____________________________`
- Signature: `_____________________________`
- Date: `_____________________________`

---

## Schedules
- **Schedule A —** Data Processing Addendum (DPA-001 v1.0)
- **Schedule B —** Current Subprocessor List (link: nexpec.com/legal/subprocessors)
- **Schedule C —** Security Measures (TOMs) (link: nexpec.com/legal/security)
- **Schedule D —** White-Label / Co-Brand Specification *(if §6 applies)*

— End of ORDER-FORM-001 v1.0 (Template) —
