---
id: ADDENDUM-FRAMEWORK-001
title: NEXPEC Country Addendum Framework
version: 1.0
status: draft
checkpoint: 3
effective_date: TBD
language: en
governing_law: QC-CCQ (framework itself)
operator: NEXPEC Technologies (Montréal, Québec, Canada)
incorporated_into: [TOS-001, INSP-AGR-001, AGN-AGR-001, CLI-AGR-001, ORG-AGR-001, JOB-TPL-001, ESCROW-001]
priority_markets: [CA, US, EU, UK, GCC, JP, KR, IN, CN]
---

# NEXPEC — Country Addendum Framework

> **Plain-English summary.** NEXPEC's master legal stack is governed by Québec law and Montréal courts. But because we operate worldwide, some countries have mandatory local laws that override our defaults — consumer-rights protections, employment-classification rules, data-protection requirements, language laws, tax registration. **Country Addenda** are short overlays that apply only when (a) the user's jurisdiction triggers them, or (b) the Job is performed in that jurisdiction. Each Addendum modifies only the minimum necessary to be enforceable locally. The rest of the master stack still applies.

## 1. Purpose
This Framework establishes how country-specific or region-specific legal overlays ("**Country Addenda**") attach to the NEXPEC legal stack (TOS-001, PRIV-001, AUP-001, the Tier-2 Role Agreements, JOB-TPL-001, and ESCROW-001) to comply with mandatory local law where Québec governing law alone would not be enforceable or would expose NEXPEC to disproportionate risk.

## 2. Precedence Rules
Where a Country Addendum applies, the precedence order is:

1. A signed **Order Form** under ORG-AGR-001 §7 (enterprise customers only) — controls only as expressly stated.
2. The applicable **Country Addendum** — controls only to the extent of mandatory local-law overlay.
3. The **Tier-3 Job Contract** (JOB-TPL-001) for scope, schedule, deliverables, and payout.
4. The applicable **Tier-2 Role Agreement** (Inspector / Agency / Client / Organization).
5. **TOS-001 / PRIV-001 / AUP-001** as the Tier-1 baseline.

Country Addenda do **not** displace any Tier-1 or Tier-2 protection unless mandatory local law strictly requires it. **Silence in an Addendum means the master stack governs.**

## 3. Trigger Logic
A Country Addendum is triggered when **any** of the following is true at the latest of account creation, role activation, or Job confirmation:

- The user is **resident or domiciled** in the Addendum's jurisdiction.
- The user is a **business legally registered** in the Addendum's jurisdiction.
- The **Job is performed** in the Addendum's jurisdiction.
- A **mandatory consumer-protection or data-protection law** of the Addendum's jurisdiction would otherwise be evaded by the master stack.

Trigger logic is implemented platform-side; the Job Contract records `jurisdiction.country_addendum_applied` at generation (JOB-TPL-001 schema).

## 4. Versioning, Language & Acceptance
Each Country Addendum carries its own `id`, `version`, and `effective_date` in YAML metadata, identical to the Tier-1 pattern. Material amendments are notified to affected users; continued use after the effective date constitutes acceptance — except where local consumer-protection law requires **explicit re-acceptance**, in which case the platform surfaces a click-through. Each Addendum is published in **English plus the local official language(s)** required for enforceability; in case of conflict between language versions of an Addendum, the version the user accepted controls.

## 5. Standard Overlay Categories
Every Country Addendum, regardless of jurisdiction, populates the following categories (omitting any that do not apply):

1. **Consumer-protection / B2C overlay** — where the local user is a consumer.
2. **Employment-classification specifics** — additional independent-contractor safeguards.
3. **Tax registration & indirect-tax (VAT/GST) treatment.**
4. **Language and translation requirements.**
5. **Data-protection overlay** — local rights, retention, breach notification, residency requirements.
6. **Dispute-resolution overlay** — mandatory arbitration, mandatory local courts, mandatory mediation.
7. **Payment-services overlay** — local money-transmission, anti-money-laundering, and sanctions-screening obligations.
8. **Industry / sector-specific overlay** — e.g., GCC industrial-licensing for inspectors.

## 6. Priority-Market Scaffolds (v1)

| Code | Jurisdiction | Status | Anticipated Overlays | Local-Counsel Engagement | Active File |
|---|---|---|---|---|---|
| `CA` | Canada (federal + Québec + ROC) | **scaffold** | Law 25 (QC privacy), PIPEDA, **Bill 96** (French-version availability), Québec consumer-protection law for B2C, CASL for marketing | confirmed (QC) | TBD |
| `US` | United States (multi-state) | **scaffold** | Mandatory-**arbitration** carve-out consideration (JAMS / AAA), state privacy laws (CCPA/CPRA, VCDPA, CPA, others), state independent-contractor tests (e.g., CA ABC test), state payment-bond requirements where applicable | pending | TBD |
| `EU` | European Union / EEA | **scaffold** | GDPR (Art. 28 controller-processor mirror, Art. 46 SCC reaffirmation), EU Platform-to-Business Regulation 2019/1150, country-level consumer rights (Directive 2011/83/EU), e-invoicing where required | pending | TBD |
| `UK` | United Kingdom *(paired with EU; flag for separate scaffold pending your decision)* | **scaffold** | UK GDPR + **IDTA** in lieu of SCCs; UK Consumer Rights Act for B2C; sector-specific industrial-regulator overlays | pending | TBD |
| `GCC` | KSA, UAE, Qatar (region group) | **scaffold** | Arabic-language version (KSA practice), UAE Federal Data Protection Law (No. 45 of 2021), Qatar PDPPL, KSA PDPL, sector-specific industrial-licensing for inspectors, anti-corruption representations, Sharia-overlay considerations for interest / late-payment treatment | pending | TBD |
| `JP` | Japan | **scaffold** | APPI (Act on the Protection of Personal Information), JCT (consumption tax) registration, Subcontracting Act considerations if Inspector relationships re-characterized | pending | TBD |
| `KR` | South Korea | **scaffold** | PIPA (Personal Information Protection Act), Korean Consumer Protection Act, mandatory **local representative** for foreign data controllers above thresholds, K-VAT registration | pending | TBD |
| `IN` | India | **scaffold** | DPDP Act 2023 (data protection), **GST registration** for Indian-paid Inspectors, IT Act 2000 intermediary safe-harbour conditions, sector-specific BIS / Workplace Safety rules | pending | TBD |
| `CN` | China | **scaffold — high friction** | PIPL — cross-border transfer assessments, **mandatory data residency** for certain categories, CSL, Foreign Investment List restrictions on certain industrial-inspection activities. **Recommendation:** limit CN serviceability pending local-counsel readiness | not engaged | TBD |

**Status legend.** `scaffold` = framework in place, prose to be drafted with local counsel before market activation. `active` = drafted, reviewed by local counsel, published. `high friction` = market may require gating or v2 deferral.

## 7. Conflict-of-Laws Rules
- The **master stack's governing law (Québec)** controls except where an applicable Country Addendum's mandatory-law overlay applies — and then only to the extent of that overlay.
- If **two Country Addenda** apply to the same Job (e.g., Client in EU, Inspector in GCC): the Addendum tied to the **performance jurisdiction** controls performance-related overlays, and the Addendum tied to the **payor's jurisdiction** controls payment / tax overlays.
- An **Order Form** under ORG-AGR-001 may override an Addendum only as between NEXPEC and that Organization, and **never to the prejudice of the Inspector's or Agency's local mandatory rights**.

## 8. Maintenance
NEXPEC maintains the priority-market table in §6 and updates statuses as Country Addenda are drafted, reviewed by local counsel, and activated. Each activation requires (a) local-counsel review, (b) publication in English plus local official language(s), and (c) a platform-side flag flip enabling the trigger logic in §3. Until activation, the master stack governs in the affected jurisdiction.

— End of ADDENDUM-FRAMEWORK-001 v1.0 —
