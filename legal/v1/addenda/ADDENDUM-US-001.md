---
id: ADDENDUM-US-001
title: NEXPEC Country Addendum — United States
version: 1.0
status: draft
checkpoint: 5
effective_date: TBD
language: en
jurisdiction: US
operator: NEXPEC Technologies (Montréal, Québec, Canada)
incorporated_into: ADDENDUM-FRAMEWORK-001
self_signable: partial
needs_local_counsel: true
priority_market: true
counsel_scope:
  - State-specific arbitration enforceability (esp. CA, MA, NY)
  - State independent-contractor classification overlays (esp. CA ABC test)
  - State-specific industrial-inspector licensing
business_actions_required:
  - Decide on JAMS vs AAA for arbitration provider where adopted
  - Register privacy notices required by CA / VA / CO / CT / UT
---

# United States — Country Addendum

> **Plain-English summary.** This is the US overlay on the NEXPEC legal stack. The US is multi-state, so this Addendum handles the federal baseline plus the leading state privacy regimes (CCPA/CPRA, VCDPA, CPA, CTDPA, UCPA). Two areas need US counsel before activation: state-specific arbitration enforceability and the California ABC independent-contractor test.

## 1. Trigger
This Addendum applies whenever any of the following is true: the user is resident in the United States; the user is a business registered in any US state; or the Job is performed in the United States.

## 2. Consumer Privacy — Multi-State (CCPA / CPRA / VCDPA / CPA / CTDPA / UCPA)
For US-resident consumers (defined per each state's threshold):
- **No sale; no cross-context behavioural advertising.** NEXPEC does not sell personal information, does not share for cross-context behavioural advertising, and does not engage in targeted advertising as those terms are defined under the **CCPA/CPRA** (California), **VCDPA** (Virginia), **CPA** (Colorado), **CTDPA** (Connecticut), or **UCPA** (Utah).
- **Consumer rights.** Subject to state-by-state threshold qualifications, US-state consumers may request to **know, delete, correct, port, and limit the use of sensitive personal information**, and may opt out of automated decision-making that produces legal or similarly significant effects. Submit requests to privacy@nexpec.com.
- **Authorized agents.** California consumers may submit requests through an authorized agent under CCPA/CPRA §1798.140(d).
- **Sensitive personal information.** NEXPEC processes the following categories of sensitive PI as defined by state law where applicable: government identifiers (uploaded by Inspectors for credential verification), precise geolocation (for geo-matching with consent), and financial information (collected by Stripe, not stored by NEXPEC).

## 3. Independent-Contractor Classification — California ABC Test (Reservation)
For Inspectors performing Jobs in California or otherwise subject to California Labor Code §2775, NEXPEC and the Inspector each represent that:
- Inspector is free from the control and direction of the **hiring entity** (the Client) in connection with performance of the work, both under the contract and in fact;
- Inspector performs work outside the usual course of **NEXPEC's** business (NEXPEC's business is operating a software marketplace, not performing inspections); and
- Inspector is customarily engaged in an independently established trade, occupation, or business of the same nature.

**Reservation.** Where a court or agency determines that the California ABC test or any equivalent state test re-characterizes the Inspector as an employee of the Client, NEXPEC remains a **neutral technology intermediary** and is not the hiring entity. The classification-claim indemnity in INSP-AGR-001 §7 and AGN-AGR-001 §9 expressly survives such determination.

## 4. Dispute Resolution — Class-Action Waiver + Arbitration Option
**For US-resident users**, in addition to TOS-001 §10:
- **Class-action waiver.** Each user waives the right to participate in any **class action** against NEXPEC arising out of or relating to use of the Platform, to the maximum extent permitted by law.
- **Mass-action and consolidated-arbitration waiver.** Each user further waives the right to participate in any **mass-action, multi-claimant, collective, or consolidated arbitration** proceeding against NEXPEC, including without limitation any coordinated filing of materially similar individual arbitration demands by multiple users represented by common or coordinated counsel. NEXPEC, in its sole discretion, may **consolidate such proceedings into a single batched arbitration** with reasonable procedural efficiencies (common-question consolidation, sequenced bellwether resolution, shared arbitrator panels). To the maximum extent permitted by law, this Mass-Action Waiver is **severable** from the Class-Action Waiver above: if either is held unenforceable, the other survives.
- **Optional binding arbitration.** Either party may elect to resolve any non-IP, non-equitable-relief dispute by **binding individual arbitration** administered by a recognized national arbitration provider (e.g., JAMS or AAA), seated in **Montréal, Québec** or in the place of the user's residence (user's election). The mandatory 30-day mediation step in TOS-001 §10 applies as a procedural prerequisite.
- **Small-claims carve-out.** Either party retains the right to bring an individual claim in the small-claims court of the user's home state for amounts within that court's jurisdiction without first arbitrating.

**Counsel-pending.** Where state law (e.g., California, Massachusetts, New York, New Jersey) renders the Class-Action Waiver, the Mass-Action Waiver, or the arbitration election partially or wholly unenforceable, those provisions are read down to the maximum extent permitted; the remainder of the §10 dispute pathway controls. The severability rule above ensures that invalidation of any one waiver does not invalidate the others.

## 5. Language
English. Spanish translation available on request; no statutory mandate.

## 6. Tax
Stripe administers US sales-and-use-tax registration, 1099-NEC reporting (for Inspectors), and 1099-K reporting (for marketplace payments) via Stripe Tax where applicable thresholds are met. Inspectors are independently responsible for their own federal and state income-tax reporting under INSP-AGR-001 §2.

## 7. Payment Services — No MSB Status
NEXPEC is not a **money services business** within the meaning of FinCEN's regulations (31 CFR §1010.100(ff)). Payment facilitation, escrow custody, and payout are provided by **Stripe** under Stripe's own US-state money-transmitter licences. AML/sanctions screening is administered by Stripe.

## 8. Industry-Specific — State Licensing
For Jobs performed in the US, Inspectors are responsible for their own certifications under **OSHA**, **API**, **ASME**, **AWS**, **NACE**, and state-specific industrial regulators (e.g., Texas RRC, California BSEE, Louisiana DENR). State-specific industrial-inspector licensing varies; **NEXPEC does not verify state-specific licensing beyond the baseline document-validity check** in TOS-001 §4.

— End of ADDENDUM-US-001 v1.0 —
