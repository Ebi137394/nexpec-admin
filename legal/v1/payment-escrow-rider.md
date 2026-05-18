---
id: ESCROW-001
title: NEXPEC Payment & Escrow Rider
version: 1.0
status: draft
checkpoint: 3
effective_date: TBD
language: en
governing_law: QC-CCQ (subject to Country Addendum override)
operator: NEXPEC Technologies (Montréal, Québec, Canada) — not a money services business
payment_facilitator: Stripe, Inc. (Stripe Connect Express)
incorporates: [TOS-001, CLI-AGR-001, INSP-AGR-001, AGN-AGR-001, JOB-TPL-001]
related: [PRIV-001, AUP-001]
---

# NEXPEC — Payment & Escrow Rider

> **Plain-English summary.** Here's how the money works. You (the Client) pay the gross Job price upfront into a Stripe-managed escrow. When the Inspector finishes and delivers, you have a short window to accept; if you don't accept or dispute within that window, the funds release automatically. If something goes wrong, NEXPEC can hold the funds while it's worked out. NEXPEC is **not a bank** — Stripe is the licensed entity that handles the actual money under its own rules.

This **Payment & Escrow Rider** governs payment, escrow, release, dispute holds, refunds, and chargebacks for every Job Contract on the NEXPEC platform. It is incorporated into TOS-001, CLI-AGR-001, INSP-AGR-001, AGN-AGR-001, and every Job Contract generated under JOB-TPL-001.

## 1. Payment Facilitator
Payment processing, escrow custody, currency conversion, and payout are provided by **Stripe, Inc.** and its affiliates ("**Stripe**") through Stripe Connect Express, under Stripe's terms (stripe.com/legal), which apply directly between you and Stripe. **NEXPEC is not a money services business, bank, payment institution, or licensed remitter.** NEXPEC issues release instructions to Stripe in accordance with this Rider and the applicable Job Contract.

## 2. Funding

Funding mechanics depend on the **compensation model** defined in the Job Contract (JOB-TPL-001 §4). The 10% PFT Fee is withheld at source at every funding/release event across all three models.

### 2.1 Fixed model — single upfront deposit
Where `compensation.model = 'fixed'`: at confirmation of hire, the Client funds the **full gross Contract Value** (inclusive of the 10% PFT Fee) into Stripe-held escrow. **Work does not commence, and the Inspector is not obligated to commence, until funding is confirmed by Stripe.**

### 2.2 Milestone model — staged funding
Where `compensation.model = 'milestone'`: at confirmation of hire, the Client funds **at minimum the first milestone's gross amount** into Stripe-held escrow. Each subsequent milestone must be funded **at least seven (7) days before its scheduled date or before the prior milestone's release, whichever is later**. NEXPEC sends **Day-7 and Day-3 funding-due reminders** to the Client before each milestone-funding obligation; failure to fund a milestone by its due date is a **Client default** under §5.2, permitting the Inspector to suspend further performance.

The Client may, at its option, elect to **fund all milestones in a single upfront deposit**; in that case, each milestone's funds are held in escrow and released per §3.5 as the milestone is accepted. Long-term projects (6-month / 12-month) typically use staged funding rather than upfront-all to avoid extended escrow exposure for the Client.

### 2.3 Recurring model — rolling forward-funding
Where `compensation.model = 'recurring'`: at confirmation of hire, the Client funds the first **N periods ahead** into Stripe-held escrow, where N = `compensation.recurring.funded_periods_ahead` (default 1). Throughout the engagement, the Client must **maintain N periods of forward funding at all times**. NEXPEC sends **Day-7 and Day-3 top-up reminders** to the Client before each forward-funding obligation; failure to top up by the due date is a **Client default** under §5.3, permitting the Inspector to suspend performance.

## 3. Release Triggers

Release triggers apply **per disbursement-unit**: the whole contract for `fixed`, per-milestone for `milestone`, per-period for `recurring`. Escrowed funds for each disbursement-unit release on the **first** of the following events:

1. **Client acceptance.** Client clicks "Accept Delivery" (for `fixed` / `milestone`) or the period closes without dispute (for `recurring`) within the seven-day review window.
2. **Mediated resolution.** A dispute is resolved through NEXPEC's mandatory mediation step (TOS-001 §10), issuing a release instruction. Mediated resolutions may direct **partial release** (e.g., 60% of the disbursement-unit's gross + adjustment).
3. **Auto-acceptance.** The Client takes neither acceptance nor dispute action within the review window. NEXPEC will send **automated written reminders to the Client on Day 3 and Day 5** of the review window, each prompting the Client to accept or file a dispute. If, by the close of **Day 7**, the Client has neither accepted nor disputed, NEXPEC instructs auto-release of the disbursement-unit's full gross (less the PFT Fee) on Day 7. The dual-reminder cadence is a mandatory consumer-protection safeguard and survives any shortening of the review window by Order Form.
4. **Court or arbitral award** from the forum named in TOS-001 §10 or any controlling Country Addendum or Order Form.

On release, Stripe transmits the net payout to the Inspector or Agency (as applicable) per Stripe Connect Express payout schedules, and NEXPEC's 10% **Platform Facilitation & Technology Fee** is settled to NEXPEC for the disbursement-unit released.

### 3.5 Milestone-specific release rules
- The 7-day acceptance window for each milestone starts when the Inspector marks the milestone complete and uploads deliverables (unless the milestone's `trigger` field is `scheduled_date` or `client_acceptance`, in which case the window starts at that event).
- A **disputed milestone does not pause release** of milestones already accepted. The dispute is scoped narrowly to the specific milestone.
- **Already-released milestones cannot be clawed back** except by court order, mediated written settlement, or proven fraud under AUP-001 §2.
- Milestones may be **partially released** by mediated resolution; the unreleased balance returns to escrow pending settlement or further proceedings.
- The 10% PFT Fee is computed and withheld on each milestone's gross at the time of that milestone's release.

### 3.6 Recurring-specific release rules
- Each period auto-releases at **period close + 7 days**, with mandatory **Day-3 and Day-5 reminders** during the review window. The Day-3/Day-5 reminder cadence applies per period and is not waivable by Order Form.
- A **disputed period does not pause release** of prior periods already released, nor does it suspend funding obligations for future periods (see §5.3 for default-for-non-funding rules).
- The 10% PFT Fee is computed and withheld per period at release; the Inspector's payout schedule continues uninterrupted absent dispute.
- For open-ended engagements (where `recurring.total_periods` is null), release continues period-by-period until terminated by notice under §5.3.

## 4. Dispute Hold
If either Party files a dispute through the platform within the review window, **NEXPEC may instruct Stripe to hold the escrowed funds** until: (a) the Parties settle in writing, (b) NEXPEC's mediation step concludes (TOS-001 §10), or (c) a competent court or arbitrator orders disposition. NEXPEC may also extend a dispute hold during an AUP investigation (AUP §6.3). **NEXPEC is not liable for interest or loss of opportunity caused by a good-faith dispute hold.**

## 5. Cancellation, Termination & Refunds

Cancellation rules differ per compensation model. The 10% PFT Fee is **retained on performed value** in all cases, and **waived** only where the Inspector is wholly at fault for non-performance.

### 5.1 Fixed model
- **Client cancels before Inspector commences work:** full refund of the Contract Value to the Client, less any Stripe processing fees Stripe will not return.
- **Client cancels after Inspector commences but before delivery:** refund of the amount above the value of work performed, less the PFT Fee on the **performed** value and less any Stripe fees. Allocation in dispute follows §4.
- **Inspector cancels or fails to perform:** full refund of Contract Value to the Client, less Stripe fees; NEXPEC waives the PFT Fee where the Inspector is wholly at fault; NEXPEC may pursue remedies under INSP-AGR-001 §7 or AGN-AGR-001 §9.

### 5.2 Milestone model
- **Client cancels before commencement of any milestone:** that milestone's funded amount is refunded less Stripe fees. **Downstream unfunded milestones simply do not fund** — no refund liability for them.
- **Client cancels mid-milestone (Inspector has commenced):** refund of milestone amount above performed value; PFT Fee on performed value retained. Allocation in dispute follows §4.
- **Inspector cancels mid-contract:** completed and accepted milestones remain released; any in-progress milestone is allocated per work performed; downstream unfunded milestones lapse.
- **Default for Client non-funding:** if the Client fails to fund the next milestone by its due date despite the Day-7 and Day-3 reminders, the Inspector may, after a **further seven (7) calendar days**, **terminate the contract**. Completed and accepted milestones remain released; any in-progress milestone is allocated per work performed; downstream unfunded milestones lapse.

### 5.3 Recurring model
- **Termination by notice.** Either Party may terminate by giving written notice through the Platform for the period specified in `compensation.recurring.termination_notice_days` (default **30 days**). Periods funded and falling within the notice window are honored and run to completion under their normal release rules; periods funded beyond the notice window are refunded less Stripe fees.
- **Default for Client non-funding.** If the Client fails to maintain forward funding despite the Day-7 and Day-3 reminders, the Inspector may, after a **further seven (7) calendar days**, **terminate the engagement immediately**. Completed periods remain released; the in-progress period is **prorated to the termination date** (the Inspector receives net payout for the days actually performed in the in-progress period, less PFT Fee on that prorated value).
- **Inspector cancels.** Completed periods remain released; the in-progress period is prorated to the cancellation date; forward-funded but un-performed periods are refunded to the Client less Stripe fees. NEXPEC may waive the PFT Fee on the prorated in-progress period where the Inspector is wholly at fault under INSP-AGR-001 §3.
- **Open-ended engagements.** Where `recurring.total_periods` is null, the engagement continues indefinitely until terminated by notice. Both Parties' notice rights are equal.

## 6. Currency Conversion
Where the Client funds in one currency and the Inspector is paid in another, Stripe's then-current foreign-exchange rate and conversion fees apply. **NEXPEC does not set, control, or warrant the FX rate.** The Job Contract states all amounts in the contract currency; Stripe handles conversion at release.

## 7. Chargebacks & Reversals
The Client agrees **not to initiate a chargeback or payment reversal as a substitute** for the dispute pathway in §4 and TOS-001 §10. If the Client initiates a chargeback in breach of this Rider, NEXPEC may (a) reverse-debit the Client's account, (b) suspend the Client's account, (c) recover collection costs and reasonable legal fees, and (d) treat the chargeback as **bad-faith withholding** under CLI-AGR-001 §6.

## 8. Fees
- **NEXPEC PFT Fee:** 10% of Contract Value, **withheld at source**, payable to NEXPEC for software access, matching, escrow facilitation, and Platform infrastructure (TOS-001 §3).
- **Stripe processing & FX fees:** as set out in Stripe's terms; passed through to the responsible Party.
- **No additional NEXPEC fees** apply to a standard Job, except as expressly set out in a signed Order Form (ORG-AGR-001 §7).

## 9. Payout Timing
Inspector and Agency payouts follow **Stripe Connect Express** payout schedules, which depend on the recipient's jurisdiction, payout method, and Stripe's risk posture. **NEXPEC is not liable for Stripe-side delays.**

## 10. Tax
Tax obligations on the Contract Value and on each Party's net receipts are the responsibility of that Party (INSP-AGR-001 §2.3, AGN-AGR-001 §5, CLI-AGR-001). **VAT/GST registration, indirect-tax invoicing, and withholding obligations are administered through Stripe's tax infrastructure** where Stripe supports the relevant jurisdiction. NEXPEC issues no tax invoices on behalf of any Party.

## 11. Termination Effects on Escrow
Termination of any user's Platform access does **not** affect funds already in escrow for active Jobs; those funds remain governed by §3 and §4 until released or refunded. NEXPEC may continue to enforce this Rider against terminated users in respect of accrued amounts.

— End of ESCROW-001 v1.0 —
