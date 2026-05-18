---
id: ADDENDUM-CN-001
title: NEXPEC Country Addendum — People's Republic of China
version: 1.0
status: scaffold-only (high friction)
checkpoint: 5
effective_date: NOT-FOR-ACTIVATION
language: en
jurisdiction: CN
operator: NEXPEC Technologies (Montréal, Québec, Canada)
incorporated_into: ADDENDUM-FRAMEWORK-001
self_signable: false
needs_local_counsel: true
priority_market: true
activation_gating: signup_blocked
counsel_scope:
  - PIPL Article 38 cross-border transfer security assessment (CAC)
  - PRC Foreign Investment Negative List applicability to industrial-inspection facilitation
  - CSL critical-information-infrastructure determination
  - PRC corporate-structure recommendation (WFOE / VIE / Representative Office)
  - Mandatory PI Protection Officer threshold
business_actions_required:
  - DO NOT ACTIVATE this market without completed local-counsel engagement
  - Maintain platform-side signup blocking for CN residents (enforced by src/legal/marketGating.ts)
---

# People's Republic of China — Country Addendum (SCAFFOLD ONLY)

> **⚠️ Activation status: NOT-FOR-ACTIVATION.** This Addendum is a **scaffold** only. The PRC regulatory environment for foreign-operated marketplaces serving Chinese users carries material legal and operational risk that NEXPEC has determined cannot be borne until completed engagement with PRC-qualified counsel. **Until this Addendum is moved to status: active by NEXPEC management, NEXPEC does not knowingly serve PRC-resident users or PRC-performed Jobs.** **Signup-time gating is enforced by `src/legal/marketGating.ts` — account creation for users declaring mainland-China residence is blocked at the signup screen.** Existing CN-resident accounts (if any pre-date this gating) are escalated to NEXPEC management for individual review.

## 1. Trigger (Once Activated)
On activation, this Addendum would apply whenever any of the following is true: the user is resident in mainland China; the user is a business registered in mainland China; or the Job is performed in mainland China. **Hong Kong SAR and Macau SAR are out of scope** of this Addendum and are governed separately.

## 2. Data Protection — PIPL + CSL + DSL (HIGH FRICTION)
The PRC's three-pillar data regime carries the following obligations that NEXPEC would need to satisfy before activation:
- **PIPL.** Compliance with the **Personal Information Protection Law** ("**PIPL**"), including: explicit and separate consent for each processing purpose; sensitive-personal-information consent; **cross-border transfer security assessments** under PIPL Article 38, which require **Cyberspace Administration of China (CAC)** clearance for transfers above specified thresholds; designation of a **PI Protection Officer** where the operator processes personal information of more than 1 million PRC subjects.
- **CSL.** Compliance with the **Cybersecurity Law** ("**CSL**"), including potential **critical-information-infrastructure** ("**CII**") determinations that trigger data-localization and security-review obligations.
- **DSL.** Compliance with the **Data Security Law** ("**DSL**") classification of "important data" and the corresponding cross-border restrictions.

**Practical impact.** Onboarding a single mainland-China user could trigger PIPL Article 38 compliance, and onboarding above 1 million users would trigger a mandatory PIPC and a mandatory annual filing. The CAC security-assessment cycle is long and uncertain. NEXPEC will not accept this risk profile until local-counsel readiness is confirmed.

## 3. Foreign Investment Negative List
Industrial-inspection services and related digital marketplaces may fall within categories subject to the **Special Administrative Measures (Negative List) for Foreign Investment Access**, requiring a PRC-domiciled operating entity (WFOE) and, in some categories, restrictions on foreign ownership. **NEXPEC has not made a foreign-investment determination**; counsel engagement is required before activation.

## 4. Consumer Protection
On activation, NEXPEC would comply with the **PRC Consumer Rights Protection Law** and related e-commerce rules under the **PRC E-Commerce Law**. Pre-contract disclosures, statutory cooling-off periods, and refund rules would apply.

## 5. Language
Simplified Chinese (简体中文) would be mandatory for consumer-facing legal documents and platform UI for PRC-resident users on activation.

## 6. Tax — VAT
PRC VAT (6% for services) administration would apply on activation; mechanism depends on the chosen PRC operating structure (WFOE, Representative Office, or cross-border under simplified rules).

## 7. Dispute Resolution — Forum Considerations
On activation, PRC courts of the user's domicile may assume mandatory jurisdiction over PRC-performance-related claims notwithstanding TOS-001 §10. Enforcement of Quebec / Canadian judgments against PRC-resident defendants is **unreliable**; this is a load-bearing reason for the scaffold-only status.

## 8. Industry-Specific
On activation, PRC industrial-inspection regimes (e.g., **SAMR**, **MEM**) and sector-specific certifications would apply; Inspector responsibility under INSP-AGR-001 §2 would extend without modification.

## 9. Maintenance & Activation Procedure
This scaffold is reviewed annually by NEXPEC management. Activation requires:
1. Completed engagement with PRC-qualified counsel;
2. Decision on PRC operating structure (WFOE, Representative Office, or cross-border-only);
3. CAC cross-border-transfer security assessment commencement (if applicable);
4. Simplified Chinese translation of the consumer-facing legal pack;
5. Status update from `scaffold-only` to `active` in this file's metadata and the trigger-logic table in ADDENDUM-FRAMEWORK-001 §6.

— End of ADDENDUM-CN-001 v1.0 (SCAFFOLD-ONLY) —
