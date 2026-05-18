---
id: ADDENDUM-KR-001
title: NEXPEC Country Addendum — South Korea
version: 1.0
status: draft
checkpoint: 5
effective_date: TBD
language: en
jurisdiction: KR
operator: NEXPEC Technologies (Montréal, Québec, Canada)
incorporated_into: ADDENDUM-FRAMEWORK-001
self_signable: partial
needs_local_counsel: true
priority_market: true
counsel_scope:
  - PIPA local-representative appointment confirmation
  - Korean Court's recent platform-worker classification jurisprudence
business_actions_required:
  - Appoint a PIPA local representative for foreign data controllers serving KR residents above PIPA thresholds (KRW 10B revenue or 1M users)
  - Korean-language translation of consumer-facing legal pack
---

# South Korea — Country Addendum

> **Plain-English summary.** This is the South Korea overlay on the NEXPEC legal stack. Korean privacy law (PIPA) requires a mandatory local representative for foreign data controllers above certain thresholds — this is a business action that must be completed before activating KR. Korean courts have also expanded platform-worker classification in recent jurisprudence; the independent-contractor framing is reaffirmed but flagged for ongoing monitoring.

## 1. Trigger
This Addendum applies whenever any of the following is true: the user is resident in South Korea; the user is a business registered in South Korea; or the Job is performed in South Korea.

## 2. Consumer Protection — Act on the Consumer Protection in Electronic Commerce
For Job Contracts where the Client is an individual consumer (not a business) resident in Korea:
- **Right of withdrawal.** Under the **Act on the Consumer Protection in Electronic Commerce**, the consumer has the right to withdraw within **seven (7) days** of acceptance, subject to the standard performance-commenced exception which is acknowledged at Job confirmation.
- **Mandatory disclosures.** Pre-contractual disclosures required by the Act (identity of seller, refund procedures, terms of cancellation) are presented at Job confirmation.
- **Korean Consumer Agency.** KR-resident consumers may file complaints with the **Korea Consumer Agency** (한국소비자원).

## 3. Data Protection — PIPA
For personal information of Korea-resident individuals:
- **PIPA compliance.** NEXPEC complies with the **Personal Information Protection Act** (개인정보 보호법) ("**PIPA**").
- **Consent regime.** PIPA requires **separate, explicit consent** for: collection of personal information; use of personal information beyond the purpose of collection; provision of personal information to third parties; and cross-border transfer of personal information. The platform surfaces a multi-checkbox consent flow at KR-resident account creation.
- **Cross-border transfer.** Cross-border transfer of KR-resident personal information requires the user's explicit consent under PIPA Article 28-8, supplemented by contractual safeguards equivalent to the EU SCCs.
- **Mandatory local representative.** Where NEXPEC's processing of KR-resident personal information exceeds the thresholds prescribed by PIPA Enforcement Decree Article 32 (KRW 10 billion annual revenue, or 1 million KR-resident users, in the preceding year), NEXPEC will appoint a **PIPA local representative** with a Korean place of business: **[TBD — appoint before KR market activation]**.
- **Data subject rights.** KR-resident users may exercise rights of access, correction, suspension of processing, deletion, and complaint via privacy@nexpec.com or directly to the **Personal Information Protection Commission** (개인정보보호위원회).

## 4. Worker-Classification — Reservation (Korean Platform Jurisprudence)
Korean courts have, in recent decisions, expanded the application of worker-status (근로자) rules to platform-mediated workers in certain industries (notably delivery and ride-share). Inspectors operating on the Platform are engaged on terms requiring **independent-contractor** status under INSP-AGR-001 §1. NEXPEC and the Inspector each represent that they do not intend, and do not consider, the relationship to give rise to worker status under Korean law. The classification-claim indemnity in INSP-AGR-001 §7 expressly extends to any determination of worker status notwithstanding this Agreement.

## 5. Language
**Korean-language** versions of consumer-facing legal documents (TOS-001, PRIV-001, AUP-001, and the applicable Tier-2 Role Agreement) are provided for KR-resident consumer users. The user's accepted-language version controls in any conflict.

## 6. Tax — K-VAT
Stripe administers Korean VAT (10%) registration, invoicing, and remittance via Stripe Tax. Withholding tax obligations on payments to foreign Inspectors are administered by the Client where applicable under Korean tax law. Inspectors operating in Korea are independently responsible for their own VAT and income-tax reporting per INSP-AGR-001 §2.

## 7. Dispute Resolution — Consumer-Jurisdiction Carve-out
TOS-001 §10 governs disputes (mandatory 30-day mediation → exclusive Montréal courts), **except** that an action by a KR-resident consumer may be brought in **Korean courts** of the consumer's domicile per Korean conflict-of-laws rules (the Conflict of Laws Act, 국제사법). The mandatory 30-day mediation step still applies as a procedural prerequisite where local mandatory law permits.

## 8. Industry-Specific
For Jobs performed in Korea, Inspectors are responsible for their own certifications under **KOSHA**, **KGS**, **KEPIC**, and sector-specific regulators (e.g., **MOTIE** for energy, **MOLIT** for construction-related inspection). NEXPEC does **not** verify Korea-sector-specific entitlement beyond the baseline document-validity check in TOS-001 §4.

— End of ADDENDUM-KR-001 v1.0 —
