# NEXPEC — Data-Rights ToS / MSA Amendment Brief
### Securing machine-learning rights to the inspection data flywheel

**Date:** 2026-05-28 · **Status:** Counsel-ready brief (drafting starting point)

> **Not legal advice.** This brief states the *commercial intent* and a first-draft of clause language for your IP/tech + privacy counsel to formalize. Do not ship clauses to users without counsel review.

---

## 1. Why this is the gating action

The entire monetization thesis (`NEXPEC_AI_ASSET_OWNERSHIP_AND_SECURITY.md`) rests on a clean, **documented** right to train models on user-contributed inspection content. Two hard truths:
- You **cannot un-train** a model when a user later deletes their account — so the license must explicitly survive termination and cover derived parameters.
- **Retroactive rights are painful or impossible.** Acquirer/enterprise diligence *will* ask "do you have rights to your training data?" Close this **before** the flywheel scales.

You already operate a consent-management system (`CONSENT_MANAGEMENT_GUIDE.md`, `src/core/legal`, `send-consent-receipt`) — use it to record **versioned acceptance** of the new terms per user.

## 2. The rights NEXPEC needs (plain-English → for counsel to formalize)

- A **worldwide, perpetual, irrevocable, royalty-free, sublicensable license** to use *Submitted Content* (inspection reports, findings, photos/media, measurements, equipment/cert metadata) to **develop, train, fine-tune, evaluate, and improve** machine-learning models and derived products/services.
- The right to create and retain **aggregated, de-identified, and derivative datasets and model parameters**, which **survive account deletion and termination**.
- The right to retain model improvements **independent of any single user's data**.
- A license over **corrections, edits, and labels** (the human-sealed findings) as training signal.
- **Ownership stays with the user** for their raw content; NEXPEC takes a *license*, not ownership — cleaner and far more palatable to enterprise clients.

## 3. Draft language (starting point — counsel to finalize)

**(A) Inspector / individual ToS — "Machine Learning & Improvement License"**
> *"You retain ownership of content you submit ("Submitted Content"). You grant NEXPEC a worldwide, perpetual, irrevocable, royalty-free, sublicensable license to host, process, and use Submitted Content — including to develop, train, evaluate, and improve machine-learning models, algorithms, and derived products and services. NEXPEC may create aggregated and de-identified datasets and model parameters derived from Submitted Content; such derived assets are owned by NEXPEC and the rights granted in this section survive termination of your account. NEXPEC will not publish your raw Submitted Content except as required to deliver the service."*

**(B) Client / Enterprise MSA — ML rights + confidentiality reconciliation**
> *"Customer grants NEXPEC a license to use Customer Data to operate and improve the Services, including training machine-learning models, provided that any model made available to third parties is trained only on **aggregated and de-identified** features and that no third party can derive Customer's Confidential Information from it. NEXPEC will not use Customer's Confidential Information to train a model offered to a Customer-identified competitor except under a separately agreed, isolated **client-private model** engagement."*

## 4. Reconciling the B2B confidentiality tension (the CPO trap)

The enterprise client who loves "your data never leaves a third party" may still object to you training a *sellable* model on their defect data. Resolve by design:
- **Default shared model:** trained only on **aggregated / de-identified features** — no client's confidential raw data is exposed to or extractable by another.
- **Premium tier — client-private model instance:** their data trains *their* model, contractually firewalled. A revenue upsell *and* a trust feature.
- Put both in the MSA so procurement/security reviewers have explicit comfort language.

## 5. Privacy-law notes (GDPR / CCPA and successors)

- **Lawful basis + purpose specification** stated at collection; update the Privacy Policy and DPA.
- **De-identification standard** documented; train on de-identified data wherever possible.
- **Deletion vs. memorization:** disclose that trained model parameters are aggregated/derived and not reversible to an individual; minimize verbatim memorization of PII.
- **Sub-processor minimization is a selling point:** the $0 / on-device + self-hosted strategy means few or no AI sub-processors — surface this in the DPA as a differentiator.

## 6. Open questions for counsel

- Inspector/client **jurisdictions** and enforceability of "perpetual/irrevocable" (esp. EU).
- **Opt-in vs. bundled acceptance**; whether ML rights need separate affirmative consent.
- **Pre-existing data** already collected — re-consent vs. grandfather; can it be used for training before re-acceptance?

## 7. Action checklist

1. Counsel finalizes clauses from this brief.
2. Update **Inspector ToS**, **Client/Enterprise MSA**, **Privacy Policy**, **DPA**.
3. Ship a **versioned re-acceptance flow** for existing users (reuse onboarding + consent infra).
4. Record **consent version per user** in the consent ledger (immutable, auditable).

> *Reminder: not legal advice — counsel must review before anything reaches users.*
