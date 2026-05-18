---
id: ADDENDUM-JP-001
title: NEXPEC Country Addendum — Japan
version: 1.0
status: draft
checkpoint: 5
effective_date: TBD
language: en
jurisdiction: JP
operator: NEXPEC Technologies (Montréal, Québec, Canada)
incorporated_into: ADDENDUM-FRAMEWORK-001
self_signable: true
needs_local_counsel: false
priority_market: true
---

# Japan — Country Addendum

> **Plain-English summary.** This is the Japan overlay on the NEXPEC legal stack. Japan's privacy law (APPI) and the Subcontracting Act require explicit overlay for our platform model. Stripe handles Japanese Consumption Tax via its tax infrastructure once thresholds are met.

## 1. Trigger
This Addendum applies whenever any of the following is true: the user is resident in Japan; the user is a business registered in Japan; or the Job is performed in Japan.

## 2. Consumer Protection — Consumer Contract Act + SCTA
For Job Contracts where the Client is an individual consumer (not a business) resident in Japan, the **Consumer Contract Act** (消費者契約法) applies. Specifically:
- Clauses purporting to wholly exempt NEXPEC from liability for intentional or grossly negligent acts are unenforceable under Article 8 of the Consumer Contract Act; the liability cap in TOS-001 §9 is read down to comply where applicable.
- The **Specified Commercial Transactions Act** (特定商取引法) applies where the Job qualifies as a regulated transaction; mandatory disclosures are surfaced at the Job-confirmation step.

## 3. Subcontracting Act (Sitauke-hou) — Reservation
The **Act against Delay in Payment of Subcontract Proceeds, Etc. to Subcontractors** (下請代金支払遅延等防止法) regulates certain consignment relationships in Japan. NEXPEC and the user each represent that the platform-mediated Job Contract is a **direct contract between Client and Inspector (or Agency)** and is not a "consignment" by NEXPEC under the Subcontracting Act. In the event a competent authority determines the Act applies, NEXPEC's role is limited to that of a neutral technology intermediary and the obligations of the Act flow between Client/Inspector as the principal parties.

## 4. Data Protection — APPI
For personal information of Japan-resident individuals:
- **APPI compliance.** NEXPEC complies with the **Act on the Protection of Personal Information** (個人情報の保護に関する法律), including the 2022 amendments concerning cross-border transfer disclosure.
- **Cross-border transfer.** NEXPEC discloses, prior to obtaining APPI-required consent, that personal information will be transferred to **Canada** and to subprocessors located outside Japan. Canada is recognized by the **Personal Information Protection Commission of Japan (PPC)** as a jurisdiction with personal-information protection comparable to APPI; transfers proceed on that basis.
- **Data subject rights.** Japan-resident users may exercise rights of disclosure, correction, suspension of use, deletion, and complaint via privacy@nexpec.com or directly to the PPC.

## 5. Language
**Japanese-language** versions of consumer-facing legal documents (TOS-001, PRIV-001, and the applicable Tier-2 Role Agreement) are provided for Japan-resident consumer users. The user's accepted-language version controls in any conflict.

## 6. Tax — Japanese Consumption Tax (JCT)
Stripe administers Japanese Consumption Tax registration, invoicing, and remittance via Stripe Tax once Stripe-side thresholds are met. The **10% PFT Fee** to Japan-established Inspectors and Agencies is subject to JCT reverse charge for B2B cross-border services where Stripe Tax so determines. Inspectors operating in Japan are independently responsible for their own JCT registration if required (Japan's general threshold is ¥10M annual taxable sales).

## 7. Dispute Resolution — Consumer-Jurisdiction Carve-out
TOS-001 §10 governs disputes (mandatory 30-day mediation → exclusive Montréal courts), **except** that under Japan's Code of Civil Procedure (民事訴訟法) Article 3-4, an action by a Japan-resident consumer may be brought in the **District Court of Tokyo** or in the court of the consumer's place of domicile. The mandatory 30-day mediation step still applies as a procedural prerequisite where local mandatory law permits.

## 8. Industry-Specific
For Jobs performed in Japan, Inspectors are responsible for their own certifications under the **High Pressure Gas Safety Act**, the **Industrial Safety and Health Act**, the **Electricity Business Act**, and sector-specific regimes (e.g., **JOGMEC** for oil and gas, **NRA** for nuclear). NEXPEC does not verify Japan-sector-specific entitlement beyond the baseline document-validity check in TOS-001 §4.

— End of ADDENDUM-JP-001 v1.0 —
