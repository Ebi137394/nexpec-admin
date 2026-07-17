// ════════════════════════════════════════════════════════════════════════════
//  src/legal/bodies.ts
//
//  Source-of-truth markdown bodies for the v1 NEXPEC legal stack.
//  Mirrored from /legal/v1/*.md — keep them in sync by regenerating from the
//  canonical files when amending. The registry.ts metadata pins each body to
//  an (id, version) tuple and the Supabase legal_documents row.
// ════════════════════════════════════════════════════════════════════════════

import type { LegalDocumentId } from './types';

export const LEGAL_BODIES: Record<LegalDocumentId, string> = {
  // ─────────── TOS-001 v1.0 ───────────
  'TOS-001': `# NEXPEC — Master Platform Terms of Service

> **Plain-English summary.** NEXPEC is a marketplace that helps Clients find Inspectors and helps Inspectors find work. We are not an employer, not an inspection firm, not an insurer. The actual inspection contract is between the Client and the Inspector — we just run the platform that connects them and we hold the payment on payout hold while the work happens. We charge a 10% Platform Facilitation and Technology Fee on the contract value for running the software, the matching, and the payout hold. By using NEXPEC, you agree to the terms below.

**Operator:** NEXPEC Technologies, Montréal, Québec, Canada.
**Contact:** legal@nexpec.com.
**Effective:** the date you accept these Terms by creating or continuing to use a NEXPEC account.

## 1. The Arrangement
NEXPEC operates an online marketplace (the "Platform") connecting Clients seeking industrial inspection services with independent Inspectors and Agencies offering them. NEXPEC is a **neutral technology intermediary**. NEXPEC does not perform inspections, employ Inspectors, supervise field work, control how services are delivered, or warrant inspection quality, accuracy, or compliance with any code or standard. The contractual relationship for any inspection — each, a "Job Contract" — is solely between the Client and the Inspector (or the Agency engaging the Inspector).

## 2. Account & Eligibility
You must be at least 18 years old and legally able to contract in your jurisdiction. You must keep your account information accurate and your credentials secure. You accept these Terms once at signup and, upon activating a role (Inspector, Agency, Client, or Organization), the applicable Tier-2 Role Agreement governing that role. You are responsible for all activity on your account.

## 3. Platform Fees
NEXPEC charges a flat **ten percent (10%) Platform Facilitation and Technology Fee** (the "**PFT Fee**") on the gross value of each Job Contract. The PFT Fee compensates NEXPEC for software access, matching, payout hold facilitation via Stripe Connect, in-app communications, dispute support, and platform infrastructure. The PFT Fee is **not** a deduction from the Inspector's labour, **not** consideration paid to NEXPEC for inspection services, and **not** a placement or staffing fee. Fees and net payouts are itemized in each Job Contract.

## 4. Vetting Disclosure
NEXPEC performs only a **baseline administrative check** on Inspector-uploaded certificates and documents — namely, validity and expiration. NEXPEC does not interview, examine, audit, or warrant the competence, skill, judgment, training, or work product of any Inspector or Agency. The Client is solely responsible for reviewing each Inspector's submitted credentials, experience, and CV, and for making the final hiring decision. NEXPEC's administrative check is provided "as is" as a convenience and creates no warranty or duty of care to any party.

## 5. No Warranty on User Output
Inspection reports, photos, findings, recommendations, certifications referenced, and all other content produced by Inspectors or Agencies through the Platform ("User Output") are the product of independent third parties. NEXPEC makes no representation as to their accuracy, completeness, fitness for any particular purpose, or compliance with any law, code, or industry standard. Users rely on User Output at their own risk.

## 6. No Employment Relationship
Nothing in these Terms or any feature of the Platform creates an employment, agency, joint venture, partnership, or franchise relationship between NEXPEC and any Inspector, Agency, Client, or Organization. Inspectors are independent contractors of the Client (or Agency) that engages them. Each user is solely responsible for its own tax, insurance, social-charge, immigration, work-authorization, and benefits obligations.

## 7. Payments & Payout
Payment processing is provided by **Stripe, Inc.** and its affiliates under Stripe's own terms, which apply directly between you and Stripe. NEXPEC is not a money services business, bank, payment institution, or licensed remitter. NEXPEC instructs Stripe to release held funds in accordance with the Job Contract and the Payment & Payout Rider (PAYOUT-001). Currency conversion, payout timing, and chargeback handling follow Stripe's published rules.

## 8. Indemnity
You will defend, indemnify, and hold harmless NEXPEC and its affiliates, officers, directors, and personnel from and against any claim, loss, liability, or expense (including reasonable legal fees) arising out of or relating to (a) your use of the Platform, (b) any User Output you generate, publish, or rely on, (c) your breach of these Terms, any Role Agreement, or any Job Contract, or (d) your violation of any applicable law.

## 9. Liability Cap
**To the maximum extent permitted by law, NEXPEC's aggregate liability** to any user under or in connection with the Platform, in any rolling twelve-month period, is capped at the greater of (i) the total PFT Fees paid by that user to NEXPEC during that period, or (ii) **CAD $500**. NEXPEC is not liable for indirect, incidental, special, consequential, punitive, or exemplary damages, including lost profits, lost data, business interruption, or loss of reputation, even if advised of the possibility.

## 10. Governing Law & Dispute Resolution
These Terms are governed by the laws of the Province of Québec, Canada (including the Civil Code of Québec), without regard to conflict-of-laws principles. **Step 1 — Mandatory Internal Resolution:** any dispute must first be submitted in writing to NEXPEC support and parties must negotiate in good faith for at least **thirty (30) days**, with NEXPEC offering mediation assistance. **Step 2 — Forum:** any dispute not resolved under Step 1 is subject to the **exclusive jurisdiction of the courts of the judicial district of Montréal, Québec**. Organizations may negotiate an alternative governing law and forum in their Organization Agreement; that negotiation does not displace Step 1.

## 11. Suspension & Termination
NEXPEC may suspend or terminate any account — with or without notice — for breach of these Terms, breach of the Acceptable Use Policy (AUP-001), breach of any Role Agreement, applicable law, or to protect the integrity of the Platform, and without liability and without prejudice to PFT Fees already accrued. Sections 3, 5–10, and 12 survive termination.

## 12. Changes, Notices & Language
NEXPEC may amend these Terms by posting an updated version and notifying users in-app or by email. Continued use after the effective date constitutes acceptance. A French version of these Terms is maintained in compliance with the Charter of the French Language (Bill 96); in case of conflict between language versions, the version you accepted controls.

— End of TOS-001 v1.0 —`,

  // ─────────── PRIV-001 v1.0 ───────────
  'PRIV-001': `# NEXPEC — Privacy Policy

> **Plain-English summary.** NEXPEC collects only what we need to run the platform: your account info, your role data, what you do on the platform, and (if you're being paid) the info Stripe needs to pay you. We do not sell your data. We share it only with the people who need it to do their job — the Client who hired you, the Inspector you hired, and our service providers (Stripe, Supabase, etc.). Our servers are hosted globally; we use legally recognized transfer mechanisms (like Standard Contractual Clauses) to protect data crossing borders. You can ask to see, correct, or delete your data at any time.

## 1. Who We Are
NEXPEC Technologies ("**NEXPEC**," "**we**," "**us**"), Montréal, Québec, Canada. Privacy contact: **privacy@nexpec.com**.

## 2. Data We Collect
- **Account Data:** name, email, phone, role, language preference, profile photo, password hash.
- **Verification Data:** uploaded certificates, government IDs, insurance documents, and their metadata (issuer, validity, expiration).
- **Job Data:** Job posts, applications, in-app messages, inspection reports, photos, locations, ratings, timestamps.
- **Payment Data:** banking and tax information collected by **Stripe**. NEXPEC does not store full payment credentials.
- **Device & Usage Data:** IP address, device type, operating system, app version, logs, crash reports, approximate location (for geo-matching).
- **Communications:** in-app chat, support tickets, voluntary feedback.

## 3. Why We Collect It (Lawful Bases)
We process personal data on the following bases, as applicable to your jurisdiction:
- **Performance of a contract** — to operate your account and your Job Contracts.
- **Compliance with legal obligations** — tax, anti-fraud, anti-money-laundering, and recordkeeping rules.
- **Legitimate interests** — platform security, fraud prevention, service quality, analytics.
- **Consent** — for precise location, optional marketing, and other purposes that require it under your local law (which you may withdraw at any time).

## 4. Controller vs. Processor
- **Account Data and Verification Data:** NEXPEC is the **controller**.
- **Job Output** (reports, photos, findings, ratings): NEXPEC is a **processor** acting on behalf of the Client or Inspector who created the content; that user remains the controller of their work product.
- **Payment Data:** Stripe is the controller; NEXPEC receives only the metadata necessary to reconcile transactions and remit the PFT Fee.

## 5. Sharing
We share personal data with:
1. **Other Platform users** where the workflow requires it (for example, the Client sees the Inspector they hire and vice versa).
2. **Service providers under written contract** — **Stripe** (payments), **Supabase / AWS** (hosting and database), email and SMS delivery providers, analytics providers, customer-support tooling, and security vendors. These providers are bound to use the data only for the purposes we direct.
3. **Law enforcement and regulators** where legally compelled or where we believe disclosure is necessary to prevent imminent harm.
4. **Successors** in a merger, acquisition, or asset sale, subject to this Policy.

We **do not sell personal data**, and we do not engage in "cross-context behavioural advertising" or "sharing for advertising" as those terms are defined under the CCPA/CPRA.

## 6. International Transfers
NEXPEC operates globally. Data is hosted via **Supabase on AWS** infrastructure across multiple regions. For v1 of the Platform we do not offer guaranteed localized data residency. International transfers rely on legally recognized mechanisms, including the **EU Standard Contractual Clauses (SCCs)** under GDPR Article 46, the **UK International Data Transfer Addendum**, equivalent transfer instruments accepted in Switzerland, Brazil, and the GCC where applicable, and contractual safeguards consistent with **PIPEDA** and **Québec's Law 25**. A list of subprocessors and the transfer mechanism in place for each is published at **nexpec.com/legal/subprocessors** and updated as it changes.

## 7. Your Rights
Subject to your jurisdiction's privacy law, you may request **access, correction, deletion, portability, restriction, and objection** in respect of your personal data; **withdraw consent** at any time; and **lodge a complaint** with the supervisory authority of your jurisdiction — including:
- **Commission d'accès à l'information du Québec** (Law 25);
- **Office of the Privacy Commissioner of Canada** (PIPEDA);
- an **EU or UK supervisory authority** (GDPR / UK GDPR);
- the **California Privacy Protection Agency** or your state Attorney General (CCPA/CPRA);
- your local data-protection authority elsewhere.

Submit requests to **privacy@nexpec.com**. We respond within **30 days** where reasonably feasible.

## 8. Retention
- **Account Data:** for the life of your account and for **seven (7) years** after closure to satisfy tax, audit, and statutory recordkeeping.
- **Job Data:** at least **seven (7) years** after the Job is closed, to support dispute, audit, regulatory, and litigation-hold requirements.
- **Logs and security telemetry:** **twelve (12) months**.
- **Backups:** rolling **thirty (30) days**.

## 9. Security
We use encryption in transit (TLS 1.2 or higher) and at rest, role-based access controls, audited Supabase Row-Level Security policies, secret rotation, and an incident-response process. No system is perfectly secure; we will notify affected users and, where required, the applicable regulators of any qualifying personal-data breach in the timelines mandated by the applicable law.

## 10. Children
The Platform is not directed at, and we do not knowingly collect personal data from, persons under **18**. If you believe a minor has provided us data, contact privacy@nexpec.com and we will delete it.

## 11. Changes & Language
We update this Policy as needed. Material changes are notified in-app or by email and take effect on the new posted effective date. A **French version** of this Policy is maintained in compliance with the Charter of the French Language (Bill 96); in case of conflict between language versions, the version you accepted controls.

— End of PRIV-001 v1.0 —`,

  // ─────────── AUP-001 v1.0 ───────────
  'AUP-001': `# NEXPEC — Acceptable Use Policy

> **Plain-English summary.** Use NEXPEC honestly. Don't lie about who you are, don't fake credentials, don't fabricate reports, don't try to take deals off-platform to dodge fees, and don't abuse other users. If you break these rules, we may suspend or terminate your account without warning — and we don't owe you anything for it.

This **Acceptable Use Policy** ("**AUP**") governs all use of the NEXPEC platform by all users — Inspectors, Agencies, Clients, Organizations, and visitors — and is incorporated by reference into the **Master Platform Terms of Service** (TOS-001).

## 1. General Prohibitions
You must not:

1. **Misrepresent identity or credentials** — your name, qualifications, certifications, licences, insurance coverage, affiliations, or right to act on behalf of any organization.
2. **Use the Platform for unlawful purposes** — including money laundering, sanctions evasion, fraud, bribery, tax evasion, trafficking, or harassment.
3. **Post or transmit prohibited content** — defamatory, threatening, harassing, discriminatory, or hateful material; content that violates third-party intellectual property, privacy, or confidentiality rights; sexually explicit material; or content that depicts or facilitates real-world violence.
4. **Interfere with or attack the Platform** — including unauthorized access attempts, reverse engineering, denial-of-service, exploitation of vulnerabilities (other than through a written responsible-disclosure program), or interference with another user's account.
5. **Scrape, harvest, or automate beyond published APIs** — including bulk extraction of user data, ratings, certificates, or job listings by any means other than the official APIs NEXPEC makes available.
6. **Circumvent technical controls** — security, rate limits, paywalls, geographic restrictions, or moderation systems.
7. **Impersonate NEXPEC personnel or other users**, or use NEXPEC's branding without written permission.
8. **Upload malware** — viruses, worms, ransomware, spyware, or any code intended to damage, disable, or surveil systems or users.

## 2. Inspector & Agency-Specific Prohibitions
Inspectors and Agencies must not:

1. **Submit forged, expired, altered, or fraudulent** certificates, government IDs, insurance documents, or training records.
2. **Fabricate, falsify, or backdate** inspection reports, photos, GPS locations, findings, recommendations, or timestamps.
3. **Accept a Job Contract** knowing they lack the qualifications, training, equipment, insurance, or physical capacity to perform it safely and competently.
4. **Subcontract a Job** to an unverified third party without prior disclosure to and written consent of the Client.
5. **Make safety, compliance, or regulatory representations** they know to be unsupported by the evidence on site.
6. **Discriminate** against Clients on prohibited grounds under the laws applicable to their work.
7. **Misuse Client confidential information** received in connection with a Job, including site plans, schematics, or operational data.

## 3. Client-Specific Prohibitions
Clients must not:

1. **Post Jobs they do not have lawful authority** to procure.
2. **Engage in Circumvention** — that is, attempt to engage an Inspector or Agency off-platform after a Platform-mediated introduction with the intent to avoid the PFT Fee. **Where Circumvention is established**, NEXPEC is entitled to claim the **10% PFT Fee on the off-platform contract value as liquidated damages**, plus reasonable collection costs and legal fees, and may terminate the offending account.
3. **Coerce, pressure, or retaliate** against an Inspector for honest findings, for refusing to falsify a report, or for raising a safety concern.
4. **Misrepresent site conditions, hazards, scope, or access** at the time of posting or during a Job.
5. **Withhold or delay payout release** in bad faith or in retaliation for honest findings.

## 4. Off-Platform Communication & Solicitation
Direct contact details — personal phone numbers, personal email addresses, social-media handles, or third-party messengers — must **not** be exchanged through Platform messaging during the matching, application, or active-Job phases, except where the Platform itself surfaces those details as part of the workflow. Soliciting any user to leave the Platform for the same scope of work is a Circumvention violation and is treated under Section 3(2).

## 5. Reviews & Ratings
Ratings and reviews must reflect honest, first-hand experience. The following are prohibited: manipulating, buying, selling, exchanging, or coordinating reviews; threatening or extorting a counterparty over a review; posting reviews as a non-party to the Job; and retaliating against a user for an honest negative review.

## 6. Reporting & Enforcement
Suspected violations of this AUP, the Terms, or any Role Agreement should be reported to **abuse@nexpec.com**. NEXPEC may, in its sole discretion and **without liability**:

1. remove or restrict content;
2. limit, suspend, or terminate the account;
3. **withhold held funds during investigation** as permitted by the Payment & Payout Rider (PAYOUT-001);
4. report the conduct to law enforcement or other regulators;
5. claim PFT Fees, liquidated damages, and recovery of costs as provided in this AUP and the Terms;
6. cooperate with civil discovery and litigation-hold requests.

Repeat or severe violations result in permanent termination and a ban on creating new accounts.

## 7. No Waiver; Survival
NEXPEC's failure to enforce any provision of this AUP is not a waiver of any future enforcement. This AUP **survives account termination** as to acts and omissions occurring while the account was active, and as to financial remedies available to NEXPEC.

— End of AUP-001 v1.0 —`,

  // ─────────── INSP-AGR-001 v1.0 ───────────
  'INSP-AGR-001': `# NEXPEC — Inspector Agreement

> **Plain-English summary.** You are an independent contractor — not a NEXPEC employee. You decide where, when, and how you work, and you carry your own insurance, training, taxes, equipment, and PPE. NEXPEC just runs the platform. The Client hires you and you deliver honest inspections directly to them. We hold the payment on payout hold during the Job and release it under the Job Contract.

This **Inspector Agreement** layers on top of the Master Terms of Service (TOS-001), the Privacy Policy (PRIV-001), and the Acceptable Use Policy (AUP-001).

## 1. Independent Contractor Status
You are an **independent contractor**. You are **not** an employee, agent, servant, partner, or joint venturer of NEXPEC or any Client; **not** engaged in the ordinary course of NEXPEC's business — which is operating a software platform, not performing inspections.

You determine **where, when, and how** you perform inspection services. You supply your own tools, equipment, software, transportation, and personal protective equipment. You set your own hours of availability. You are free to perform inspections off-platform. NEXPEC exercises no operational control over the methods, sequence, or details of your work. **Nothing in this Agreement, the Platform's user-experience design, NEXPEC's matching algorithms, or NEXPEC's communications creates an employment relationship between you and NEXPEC.**

## 2. Your Responsibilities
You are solely responsible for:
1. **Credentials & training** — maintaining valid certifications, licences, and continuing-education requirements applicable to your work and to each Job's jurisdiction.
2. **Insurance** — maintaining commercial general liability, professional liability (errors & omissions), and any other coverage required by law or by the Client, in amounts appropriate to your work.
3. **Taxes & social charges** — collecting, remitting, and reporting all income, sales/value-added, payroll-equivalent, and social-charge taxes applicable to your earnings.
4. **Site safety & PPE** — bringing and using appropriate PPE, refusing unsafe work, and complying with applicable occupational-health-and-safety law on every site.
5. **Work authorization & immigration** — ensuring you are legally permitted to perform inspection work in each jurisdiction where you accept a Job.
6. **Equipment & tools** — providing all instruments, software, vehicles, and consumables required by the Job.
7. **Subcontracting** — disclosing in advance and obtaining Client consent if you intend to delegate any portion of the work.

## 3. Performance Standards & No NEXPEC Warranty
You will perform each Job with the skill, care, and judgment ordinarily exercised by qualified inspectors in your field. Your inspection reports must reflect honest, evidence-based findings. **NEXPEC does not warrant, supervise, audit for quality, or stand behind your work.** Your work product is yours; the Client relies on it directly. You will not falsify, fabricate, backdate, or omit material findings.

## 4. Compensation, Stripe & the PFT Fee
You receive compensation as defined in each Job Contract, paid via **Stripe Connect Express** under Stripe's own terms. NEXPEC withholds the **10% Platform Facilitation & Technology Fee** at source from the gross Job value before releasing your net payout. The PFT Fee is consideration for software access, matching, payout hold facilitation, and Platform infrastructure — not consideration for inspection services and not a deduction from your labour earnings. Currency conversion, payout timing, and chargeback handling follow Stripe's published rules. Taxes on your earnings are your responsibility.

## 5. Intellectual Property in Inspector Work Product
You own the copyright in inspection reports, photos, and findings you produce ("**Inspector Work Product**"), subject to the following non-exclusive licences:
- **To the Client** — a perpetual, worldwide, royalty-free licence to use the Inspector Work Product for that Job's purposes, including disclosure to the Client's auditors, regulators, insurers, and counsel.
- **To NEXPEC** — a processor-scope licence to host, store, transmit, back up, and surface the Inspector Work Product within the Platform, solely for operation of your account, dispute resolution, regulatory recordkeeping, and Platform security.

NEXPEC does **not** acquire ownership of, or any commercial-exploitation right in, your Inspector Work Product.

## 6. Confidentiality
Site information, plans, schematics, operational data, and personnel information you receive from a Client are **Client Confidential Information**. You will not use or disclose it outside the Job's purposes, except as legally compelled.

## 7. Risk Allocation, Indemnity & Hold-Harmless
You will defend, indemnify, and hold harmless NEXPEC, its affiliates, officers, and personnel from any claim, loss, or expense (including reasonable legal fees) arising out of or relating to (a) your performance or non-performance of any Job, (b) your Inspector Work Product, (c) bodily injury, property damage, or environmental incident occurring during your work, (d) your breach of this Agreement, the AUP, or applicable law, and (e) any classification claim asserting that you are, or were, an employee of NEXPEC.

## 8. Suspension & Termination
NEXPEC may suspend or terminate your access for breach of this Agreement, TOS-001, the AUP, or applicable law, without liability and without prejudice to fees already accrued. You may end your participation at any time, subject to completing all active Jobs in good faith.

## 9. Disputes & Survival
TOS-001 §10 governs disputes — mandatory 30-day mediation through NEXPEC support, then exclusive Montréal courts. Sections 1, 5, 6, 7, and 9 survive termination.

— End of INSP-AGR-001 v1.0 —`,

  // ─────────── AGN-AGR-001 v1.0 ───────────
  'AGN-AGR-001': `# NEXPEC — Agency Agreement

> **Plain-English summary.** Your Agency manages a roster of Inspectors. You are responsible for everyone on that roster — vetting them, training them, insuring them, paying them, and standing behind their work. NEXPEC does not vet your Inspectors and is not their employer. When one of your Inspectors works a Job, the contract is between the Client and your Agency. If a roster Inspector misbehaves on the Platform, that's on you.

This **Agency Agreement** layers on top of TOS-001, PRIV-001, and AUP-001.

## 1. Status & Posture
Your entity ("**Agency**") is an independent business. Each individual you onboard to the Platform under your account ("**Roster Inspector**") is, vis-à-vis NEXPEC, a member of your Agency's workforce — **not** a NEXPEC employee, agent, or contractor. NEXPEC is a neutral technology intermediary and has no employment, agency, supervisory, or franchise relationship with the Agency or any Roster Inspector.

## 2. Your Roster — Your Responsibility
You — and not NEXPEC — are responsible for:
1. **Recruiting, onboarding, and KYC** of each Roster Inspector;
2. **Verifying credentials, training, references, work authorization, and right-to-work** in each jurisdiction the Roster Inspector will operate;
3. **Insuring** your Agency and, as applicable to your jurisdiction, your Roster Inspectors;
4. **Paying** your Roster Inspectors and **remitting** any payroll, tax, social-charge, and statutory benefit owed to them under the laws of their workplace;
5. **Training** your Roster Inspectors on platform conduct, safety, the AUP, and the Inspector Agreement, which each Roster Inspector must individually accept on first login;
6. **Suspending or removing** any Roster Inspector who fails to comply with NEXPEC policy or applicable law.

NEXPEC's baseline administrative check on uploaded certificates does **not** substitute for your due diligence.

## 3. Authority, Acceptance & Binding the Roster
You represent and warrant that the personnel who operate your Agency account have legal authority to bind the Agency. When the Agency accepts a Job on the Platform, it does so for itself; **the Agency, not the Roster Inspector, is the Inspector counterparty to the Client under the Job Contract**. Internal allocation between Agency and Roster Inspector is a private matter of the Agency in which NEXPEC has no role.

## 4. Insurance & Certifications
The Agency shall at all times maintain (a) commercial general liability insurance, (b) professional liability insurance covering errors and omissions in inspection services, and (c) any further coverage required by law or by a specific Client for a given Job. The Agency shall ensure each Roster Inspector meets the certification and licensing requirements applicable to each Job they perform and that their documents on the Platform are current.

## 5. Compensation Flow
For each Job performed by a Roster Inspector, the gross payment held in **Stripe Connect Express** payout hold is released to the **Agency** account, less the **10% Platform Facilitation & Technology Fee** withheld at source. The Agency is solely responsible for paying, taxing, and reporting the Roster Inspector's share in accordance with applicable law.

## 6. Vicarious Liability
The Agency is **fully responsible** for the acts, omissions, work product, and Platform conduct of each Roster Inspector while operating under the Agency account, as if those acts had been performed by the Agency itself. This includes — without limitation — falsified credentials, fabricated or backdated reports, AUP violations, off-platform circumvention, breach of Client confidentiality, and bodily injury or property damage caused on a Client site.

## 7. KYC, Anti-Fraud & AUP Flowdown
The Agency shall: (a) implement reasonable internal controls against identity fraud, certificate forgery, and report falsification within its Roster; (b) cooperate with NEXPEC's audit, anti-fraud, and dispute processes; (c) **flow down the AUP and the Inspector Agreement obligations contractually** to each Roster Inspector; and (d) promptly notify NEXPEC of any Roster Inspector terminated by the Agency for cause.

## 8. Audit Cooperation
On reasonable notice, the Agency shall provide NEXPEC with documentary evidence of Roster Inspector credentials, insurance, and work authorization referenced in a Job, where reasonably necessary to address a complaint, dispute, regulatory inquiry, or AUP investigation.

## 9. Indemnity
The Agency will defend, indemnify, and hold harmless NEXPEC, its affiliates, officers, and personnel from any claim, loss, or expense arising out of or relating to (a) any act or omission of any Roster Inspector while operating under the Agency account, (b) the Agency's breach of this Agreement, the AUP, or applicable employment, tax, immigration, or safety law, (c) any classification claim asserting that NEXPEC is the employer of any Roster Inspector, and (d) bodily injury, property damage, or environmental incident on a Client site associated with a Roster Inspector.

## 10. Suspension & Termination
NEXPEC may suspend or terminate the Agency account — and the Platform access of any or all Roster Inspectors — for systemic or material breach. Roster-wide suspension does not preclude NEXPEC from collecting PFT Fees accrued on completed Jobs.

## 11. Disputes & Survival
TOS-001 §10 governs disputes (mediation → exclusive Montréal courts). Sections 2, 5, 6, 7, 9, and 11 survive termination.

— End of AGN-AGR-001 v1.0 —`,

  // ─────────── CLI-AGR-001 v1.0 (with sector expansion) ───────────
  'CLI-AGR-001': `# NEXPEC — Client Agreement

> **Plain-English summary.** You hire Inspectors directly through NEXPEC's platform — we just make the match. You decide who to hire, you accept responsibility for that decision, and you understand that NEXPEC does **not** warrant the Inspector's work. You are responsible for site safety. You pay through payout hold, and we release funds when the Job is delivered. You cannot withhold payment to punish an Inspector for an honest unfavourable finding.

This **Client Agreement** layers on top of TOS-001, PRIV-001, and AUP-001.

## 1. The Engagement
You ("**Client**") engage Inspectors and Agencies **directly** through the Platform. NEXPEC is a neutral technology intermediary; NEXPEC is **not** a party to the Job Contract between you and the Inspector or Agency, **not** your engineering consultant, **not** your inspection contractor, **not** your project manager, and **not** your safety officer.

## 2. Hiring & Your Due Diligence
You are **solely responsible** for selecting the Inspector or Agency for each Job. NEXPEC's baseline administrative check on uploaded certificates — validity and expiration only — is provided as a convenience and **does not substitute** for your own evaluation. Before hiring, you will review the Inspector's CV, certifications, experience, ratings, and any references reasonably available, and you will form your own judgment of fitness for the Job. **By confirming a hire on the Platform, you accept full responsibility for that selection.**

## 3. No Warranty on Inspector Output
NEXPEC makes **no representation, warranty, condition, or guarantee** — express, implied, statutory, or otherwise — concerning the Inspector or Agency's:
- skill, competence, training, judgment, integrity, or honesty;
- compliance with any code, standard, regulation, or industry practice;
- credentials beyond the document-validity check described in TOS-001 §4;
- accuracy, completeness, fitness-for-purpose, or reliability of any inspection report, finding, photograph, certification reference, recommendation, measurement, or other deliverable (collectively, "**Inspector Output**").

Inspector Output is the work product of an independent third party. **You rely on Inspector Output at your own risk.** To the maximum extent permitted by law, NEXPEC expressly disclaims all implied warranties of merchantability, fitness for a particular purpose, and non-infringement with respect to Inspector Output. **You will not rely on the existence of the Platform, its rating system, its matching, or its administrative checks as a substitute for independent verification** of Inspector Output where the consequences of error are material. This non-reliance obligation applies with **particular force** to decisions made in **Oil & Gas / Energy, Civil & Heavy Construction, Marine & Offshore, Aerospace, and Manufacturing** contexts — including, without limitation, decisions concerning structural integrity, pressure-system safety, equipment certification, environmental compliance, regulatory filings, insurance claims, asset sales, and financing transactions.

## 4. Site Safety, Access & Hazard Disclosure
You represent and warrant that, for each Job: (a) you have the lawful right to procure the inspection and to grant Inspector access to the site; (b) you have **disclosed all material hazards** known or reasonably knowable to you — including chemical, electrical, structural, atmospheric, biological, radiological, and security hazards; (c) you will provide safe access and necessary cooperation; and (d) you will comply with applicable occupational-health-and-safety law as the controlling party of the site. **Responsibility for site conditions and on-site safety rests with you, not with NEXPEC.**

## 5. Payment, Payout & PFT Fee
You will fund the Job's gross price into Stripe Connect Express payout hold as required by the Platform before work commences. The **10% Platform Facilitation & Technology Fee** is withheld at source by NEXPEC and is **non-refundable** once the Inspector has commenced performance, except as expressly stated in the Payment & Payout Rider (PAYOUT-001). Payout Hold release is governed by the Job Contract and PAYOUT-001.

## 6. Honest-Findings Protection
You **may not** withhold, delay, or seek refund of held payment in retaliation for an Inspector's honest unfavourable findings, refusal to falsify a report, or escalation of a safety concern. Any such withholding is **bad-faith withholding** under the AUP, may be overridden by NEXPEC in the dispute pathway, and exposes you to the indemnities in Section 8.

## 7. Confidentiality & Data
The inspection report and findings are produced for your use under the licence granted by the Inspector. Site information you disclose to the Inspector, and personal data of your personnel transmitted through the Platform, are processed by NEXPEC per the Privacy Policy.

## 8. Indemnity
You will defend, indemnify, and hold harmless NEXPEC, its affiliates, officers, and personnel from any claim, loss, or expense arising out of or relating to (a) your selection or supervision of any Inspector or Agency, (b) your reliance on Inspector Output, (c) site conditions, access, or hazards within your control, (d) third-party claims arising on or from your site or from work you procured, and (e) your breach of this Agreement, the AUP, or applicable law.

## 9. Term, Disputes & Survival
Either party may terminate Platform access subject to completing or closing open Jobs in good faith. TOS-001 §10 governs disputes (mediation → exclusive Montréal courts). Sections 3, 4, 5, 6, 8, and 9 survive termination.

— End of CLI-AGR-001 v1.0 —`,

  // ─────────── ORG-AGR-001 v1.0 ───────────
  'ORG-AGR-001': `# NEXPEC — Organization Agreement

> **Plain-English summary.** Your Organization holds an enterprise account on NEXPEC. You operate multiple seats — an Admin manages them — and you are responsible for everything your sub-users do. The Client Agreement applies, plus this Organization Agreement, which adds enterprise terms: data processing, audit rights, custom commercial arrangements set out in a separate Order Form, and (optionally) a negotiated dispute forum.

This **Organization Agreement** layers on top of TOS-001, PRIV-001, AUP-001, **and the Client Agreement (CLI-AGR-001)**. Where this Agreement and CLI-AGR-001 conflict, this Agreement controls. Where this Agreement and a signed Order Form conflict, the Order Form controls only to the extent it expressly so states.

## 1. Relationship & Layered Documents
Your entity ("**Organization**") is an enterprise Client. **CLI-AGR-001 applies in full** to every Job posted under any Seat of the Organization. This Agreement adds enterprise-specific terms. A "**Seat**" is a single sub-user account provisioned under the Organization, with a role (admin, manager, requester, viewer) defined by the Organization's Admin.

## 2. Admin Powers & Seat Management
The Organization designates one or more individuals as **Organization Admin**. The Organization Admin may:
1. create, suspend, and revoke Seats;
2. assign roles and permission scopes to Seats;
3. view and export Job records, Inspector Output, and audit logs across all Seats;
4. accept this Agreement, related Order Forms, and policy amendments on behalf of the Organization.

**The Organization is bound** by the actions of any Organization Admin and any Seat acting within its provisioned scope.

## 3. Sub-User Responsibility
The Organization is **fully responsible** for the acts, omissions, and Platform conduct of every Seat operating under its account — including unauthorized acts within the apparent scope of the Seat's provisioned permissions. Disabling a Seat does not release the Organization from liability for acts performed by that Seat while it was active.

## 4. Data Processing
For data the Organization or its Seats upload to the Platform in connection with their role as Client, the Organization is the **controller** and NEXPEC is the **processor**, processing only on the Organization's documented instructions and as further set out in the Privacy Policy. Where required by GDPR Article 28, UK GDPR, Québec Law 25, PIPEDA, or other applicable law, this Agreement, the Privacy Policy, and any signed **Data Processing Addendum** together form the controller–processor agreement.

## 5. Audit Rights
On reasonable advance notice and **not more than once per twelve (12) months** — except in case of a security incident or regulatory inquiry, where this cap does not apply — the Organization may request:
1. export of its Seat activity logs and Job records;
2. NEXPEC's then-current SOC-style summary report or equivalent control documentation;
3. the current subprocessor list and transfer-mechanism status.

NEXPEC may redact information relating to other customers and to NEXPEC's own confidential trade secrets.

## 6. Service Levels
NEXPEC will use commercially reasonable efforts to operate the Platform with high availability and to respond to support requests promptly. Specific uptime targets, response-time tiers, escalation paths, and credits — if any — are stated only in a **signed Order Form**. Absent an Order Form, the Platform is provided on an "as available" basis under the Master Terms.

## 7. Custom Commercial Terms (Order Form)
The Organization and NEXPEC may execute one or more **Order Forms** modifying:
1. **PFT Fee** — volume discounts or tiered pricing;
2. **Payment terms** — net invoicing instead of card on file, purchase-order workflow, or multi-currency invoicing;
3. **Reserved capacity** — committed Inspector availability, priority matching, dedicated support;
4. **Data-residency commitments** — where NEXPEC offers them in a given region;
5. **Service levels** — uptime, response-time, credits;
6. **Governing law and forum** under §10.

**An Order Form modifies the Master Terms only to the extent expressly stated and only as between NEXPEC and that Organization.**

## 8. Confidentiality
Each party will protect the other's confidential information using at least reasonable care and will use it only for the purposes of this Agreement. The Organization's Job records, Inspector Output collected, audit findings, internal pricing, and Order Form contents are the Organization's confidential information. NEXPEC's technical, security, and operational documentation provided under §5 is NEXPEC's confidential information.

## 9. Insurance & Indemnity
The Organization will maintain commercial general liability insurance appropriate to its operations and, where applicable, environmental and professional indemnity coverage relevant to the inspections it procures. The Organization will defend, indemnify, and hold harmless NEXPEC on the terms of CLI-AGR-001 §8, **broadened to cover acts and omissions of every Seat**.

## 10. Term, Disputes & Survival
This Agreement is effective on acceptance and continues for so long as the Organization holds any active Seat. Disputes follow TOS-001 §10 (mandatory 30-day mediation → exclusive Montréal courts) **unless an Order Form expressly nominates a different governing law and forum**, in which case the Order Form controls as between the Organization and NEXPEC only. Sections 3, 4, 5, 8, 9, and 10 survive termination.

— End of ORG-AGR-001 v1.0 —`,

  // ─────────── JOB-TPL-001 v1.0 ───────────
  'JOB-TPL-001': `# NEXPEC — Job Contract (Auto-Generated Template)

> **Plain-English summary.** This is the contract between you (the Client) and the Inspector (or the Agency that employs them) for one specific Job. It is generated automatically when the Client confirms a hire on NEXPEC, with the parties and Job details filled in from the platform. NEXPEC is **not a party** — we are the platform that hosts the contract and holds the payout hold.

This Job Contract is generated automatically from variable inputs (see the JSON schema referenced in the metadata block) and is **electronically accepted** by both Parties through the NEXPEC platform at confirmation of hire. It is the **Tier-3 per-Job agreement** and incorporates by reference TOS-001, PRIV-001, AUP-001, INSP-AGR-001, CLI-AGR-001, PAYOUT-001, and — where applicable — AGN-AGR-001 (where an Agency is involved) and ORG-AGR-001 (where the Client is an Organization Seat).

**Conflict rule.** In case of conflict between this Job Contract and any incorporated document, the **incorporated document controls** — **except** as to scope, schedule, deliverables, payout, and per-Job jurisdiction, which are governed by this Job Contract.

## 1. Parties
- **Client:** \`{{parties.client.legal_name}}\`, of \`{{parties.client.country}}\` (account ID \`{{parties.client.id}}\`).
- **Inspector:** \`{{parties.inspector.legal_name}}\`, of \`{{parties.inspector.country}}\` (account ID \`{{parties.inspector.id}}\`).
- **Agency** *(if applicable)*: \`{{parties.agency.legal_name}}\`, of \`{{parties.agency.country}}\` (account ID \`{{parties.agency.id}}\`), engaging the Inspector as a Roster Inspector — the **Agency, not the Inspector, is the Inspector counterparty** for purposes of this Job Contract.

**NEXPEC Technologies is not a party to this Job Contract** and is named only as platform operator, payout hold facilitator, and dispute coordinator.

## 2. Scope of Work
- **Title:** \`{{scope.title}}\`
- **Description:** \`{{scope.description}}\`
- **Specialty / Discipline:** \`{{scope.specialty}}\`
- **Deliverables:** \`{{scope.deliverables}}\`
- **Required Certifications:** \`{{scope.certifications_required}}\`
- **Site Location:** \`{{scope.location.address}}\`, \`{{scope.location.country}}\`.

## 3. Schedule
- **Scheduled Start Date:** \`{{schedule.scheduled_date}}\`
- **Estimated Duration:** \`{{schedule.estimated_duration_days}}\` day(s)
- **Urgency:** \`{{schedule.urgency}}\`

## 4. Compensation

The compensation model for this Job is **\`{{compensation.model}}\`** — one of three: **fixed** (single lump-sum), **milestone** (sequenced or scheduled payouts), or **recurring** (periodic billing for ongoing engagements). The 10% NEXPEC Platform Facilitation & Technology Fee is **withheld at source at each funding/release event** across all three models.

### 4.1 Fixed model — single lump-sum (default)
Applies where \`compensation.model = 'fixed'\`.

- **Currency:** \`{{compensation.currency}}\`
- **Gross Contract Value:** \`{{compensation.gross_amount_minor}}\` (in minor units of the stated currency)
- **NEXPEC PFT Fee (10%, withheld at source):** \`{{compensation.pft_fee_minor}}\`
- **Net Payout to Inspector / Agency:** \`{{compensation.net_payout_minor}}\`
- **Rate Type:** \`{{compensation.rate_type}}\`

Funding is held in **Stripe Connect Express** payout hold upfront per PAYOUT-001 §2.1; release follows the triggers in PAYOUT-001 §3.

### 4.2 Milestone model — sequenced / scheduled payouts
Applies where \`compensation.model = 'milestone'\`. Each milestone is funded and released **independently**; a disputed milestone does not pause release of already-accepted milestones.

- **Currency:** \`{{compensation.currency}}\`
- **Total Contract Value:** sum of milestone gross amounts (platform-computed; itemized below)
- **Milestones:** \`{{compensation.milestones}}\` — each entry carries: \`milestone_id\`, \`title\`, \`sequence\`, \`gross_amount_minor\`, \`pft_fee_minor\` (10% of milestone gross), \`net_payout_minor\`, \`trigger\` (one of \`client_acceptance\` / \`scheduled_date\` / \`inspector_marks_complete\`), optional \`scheduled_date\`, \`deliverables\`, and \`status\`.

Each milestone has its own 7-day acceptance review window, with mandatory Day-3 and Day-5 reminders, per PAYOUT-001 §3.5. Funding rules — per-milestone or upfront-deposit-with-staged-release — are governed by PAYOUT-001 §2.2. Mid-contract cancellation, default for non-funding, and partial release are governed by PAYOUT-001 §5.2.

### 4.3 Recurring model — periodic billing for ongoing engagements
Applies where \`compensation.model = 'recurring'\`. Typical use: 6-month or 12-month inspection retainers, monthly compliance auditing, ongoing turnaround-readiness inspections.

- **Currency:** \`{{compensation.currency}}\`
- **Period:** \`{{compensation.recurring.period}}\` (weekly | biweekly | monthly | quarterly)
- **Gross per Period:** \`{{compensation.recurring.period_amount_minor}}\`
- **NEXPEC PFT Fee per Period (10%, withheld at source):** \`{{compensation.recurring.pft_fee_per_period_minor}}\`
- **Net Payout per Period to Inspector / Agency:** \`{{compensation.recurring.net_payout_per_period_minor}}\`
- **Total Periods:** \`{{compensation.recurring.total_periods}}\` *(null = open-ended; terminable by notice)*
- **First Period Start:** \`{{compensation.recurring.first_period_start}}\`
- **Funded Periods Ahead:** \`{{compensation.recurring.funded_periods_ahead}}\` — Client maintains this many periods in **rolling payout hold** at all times. Mandatory Day-7 and Day-3 top-up reminders.
- **Termination Notice:** \`{{compensation.recurring.termination_notice_days}}\` days

Each period auto-releases at period close + 7 days, with mandatory Day-3 and Day-5 reminders during the review window, per PAYOUT-001 §3.6. Termination semantics — notice, default-for-non-funding, prorated final period — are governed by PAYOUT-001 §5.3.

### 4.4 Cross-model rules
- The **10% PFT Fee** is applied uniformly across all three models, withheld at source at each funding/release event. It is not waived for milestone or recurring contracts.
- All amounts are expressed in **minor currency units** (e.g., cents, halalas) of the stated \`compensation.currency\`.
- The Job Contract records the resolved model and its specific amounts at contract generation; subsequent amendments to scope, schedule, or compensation require both Parties' written acceptance through the Platform.
- A **disputed milestone or period does not pause release** of milestones or periods already accepted. The dispute is scoped narrowly to the specific disbursement-unit in question; the rest of the contract continues.

Payment for all three models is held in **Stripe Connect Express** payout hold. NEXPEC is not a money services business (TOS-001 §7); Stripe is the licensed payment facilitator.

## 5. Inspector Status & Standards
The Inspector (or Agency) performs the Job as an **independent contractor** under INSP-AGR-001 (and AGN-AGR-001 where applicable). NEXPEC does not warrant the Inspector's work product. The Inspector will perform with the skill and care of a qualified inspector and will not falsify, fabricate, or backdate findings.

## 6. Client Obligations
The Client performs its obligations under CLI-AGR-001 — including site safety, hazard disclosure, lawful authority, payment funding, the honest-findings protection, and the no-warranty-on-Inspector-Output acknowledgement.

## 7. Deliverables & Acceptance
On the Inspector marking the Job complete and uploading deliverables through the platform, the Client has **\`{{acceptance.review_window_days}}\` calendar day(s)** to either (a) accept the delivery, triggering payout release, or (b) raise a dispute as provided in PAYOUT-001 §4. If neither action is taken within that window, **the held funds auto-release** under PAYOUT-001 §3(c) after mandatory Day-3 and Day-5 reminders.

## 8. Confidentiality
The Inspector treats Client site information as Client Confidential Information. The Client treats the Inspector's proprietary methodology and any non-deliverable trade secrets as Inspector Confidential Information.

## 9. Cancellation & Dispute
- **Cancellation before commencement:** per PAYOUT-001 §5 (refund less Stripe processing fees).
- **Cancellation after commencement:** per PAYOUT-001 §5.
- **Disputes:** TOS-001 §10 — mandatory 30-day mediation through NEXPEC support, then exclusive Montréal courts — **unless** a Country Addendum applicable to either Party's jurisdiction mandates a different forum.

## 10. Governing Law, Language & Electronic Acceptance
This Job Contract is governed by **\`{{jurisdiction.governing_law}}\`**. The language of execution is \`{{language}}\`. Both Parties acknowledge that **acceptance through the NEXPEC platform** — by the Client clicking "Confirm Hire" and the Inspector (or Agency) clicking "Accept Job" — constitutes a binding electronic signature.

— End of JOB-TPL-001 v1.0 —`,

  // ─────────── PAYOUT-001 v1.0 (with Day-3 / Day-5 reminder cadence) ───────────
  'PAYOUT-001': `# NEXPEC — Payment & Payout Rider

> **Plain-English summary.** Here's how the money works. You (the Client) pay the gross Job price upfront into a a Stripe-managed payout hold. When the Inspector finishes and delivers, you have a short window to accept. We send automated reminders on Day 3 and Day 5 to make sure you don't miss it. If you don't act by Day 7, funds release automatically. If something goes wrong, NEXPEC can hold the funds while it's worked out. NEXPEC is **not a bank** — Stripe is the licensed entity that handles the actual money under its own rules.

This **Payment & Payout Rider** governs payment, payout hold, release, dispute holds, refunds, and chargebacks for every Job Contract on the NEXPEC platform. It is incorporated into TOS-001, CLI-AGR-001, INSP-AGR-001, AGN-AGR-001, and every Job Contract generated under JOB-TPL-001.

## 1. Payment Facilitator
Payment processing, payout-hold custody, currency conversion, and payout are provided by **Stripe, Inc.** and its affiliates ("**Stripe**") through Stripe Connect Express, under Stripe's terms (stripe.com/legal), which apply directly between you and Stripe. **NEXPEC is not a money services business, bank, payment institution, or licensed remitter.** NEXPEC issues release instructions to Stripe in accordance with this Rider and the applicable Job Contract.

## 2. Funding

Funding mechanics depend on the **compensation model** defined in the Job Contract (JOB-TPL-001 §4). The 10% PFT Fee is withheld at source at every funding/release event across all three models.

### 2.1 Fixed model — single upfront deposit
Where \`compensation.model = 'fixed'\`: at confirmation of hire, the Client funds the **full gross Contract Value** (inclusive of the 10% PFT Fee) into a Stripe-managed payout hold. **Work does not commence, and the Inspector is not obligated to commence, until funding is confirmed by Stripe.**

### 2.2 Milestone model — staged funding
Where \`compensation.model = 'milestone'\`: at confirmation of hire, the Client funds **at minimum the first milestone's gross amount** into a Stripe-managed payout hold. Each subsequent milestone must be funded **at least seven (7) days before its scheduled date or before the prior milestone's release, whichever is later**. NEXPEC sends **Day-7 and Day-3 funding-due reminders** to the Client before each milestone-funding obligation; failure to fund a milestone by its due date is a **Client default** under §5.2, permitting the Inspector to suspend further performance.

The Client may, at its option, elect to **fund all milestones in a single upfront deposit**; in that case, each milestone's funds are held on payout hold and released per §3.5 as the milestone is accepted. Long-term projects (6-month / 12-month) typically use staged funding rather than upfront-all to avoid extended payout-hold exposure for the Client.

### 2.3 Recurring model — rolling forward-funding
Where \`compensation.model = 'recurring'\`: at confirmation of hire, the Client funds the first **N periods ahead** into a Stripe-managed payout hold, where N = \`compensation.recurring.funded_periods_ahead\` (default 1). Throughout the engagement, the Client must **maintain N periods of forward funding at all times**. NEXPEC sends **Day-7 and Day-3 top-up reminders** to the Client before each forward-funding obligation; failure to top up by the due date is a **Client default** under §5.3, permitting the Inspector to suspend performance.

## 3. Release Triggers

Release triggers apply **per disbursement-unit**: the whole contract for \`fixed\`, per-milestone for \`milestone\`, per-period for \`recurring\`. Held funds for each disbursement-unit release on the **first** of the following events:

1. **Client acceptance.** Client clicks "Accept Delivery" (for \`fixed\` / \`milestone\`) or the period closes without dispute (for \`recurring\`) within the seven-day review window.
2. **Mediated resolution.** A dispute is resolved through NEXPEC's mandatory mediation step (TOS-001 §10), issuing a release instruction. Mediated resolutions may direct **partial release** (e.g., 60% of the disbursement-unit's gross + adjustment).
3. **Auto-acceptance.** The Client takes neither acceptance nor dispute action within the review window. NEXPEC will send **automated written reminders to the Client on Day 3 and Day 5** of the review window, each prompting the Client to accept or file a dispute. If, by the close of **Day 7**, the Client has neither accepted nor disputed, NEXPEC instructs auto-release of the disbursement-unit's full gross (less the PFT Fee) on Day 7. The dual-reminder cadence is a mandatory consumer-protection safeguard and survives any shortening of the review window by Order Form.
4. **Court or arbitral award** from the forum named in TOS-001 §10 or any controlling Country Addendum or Order Form.

On release, Stripe transmits the net payout to the Inspector or Agency (as applicable) per Stripe Connect Express payout schedules, and NEXPEC's 10% **Platform Facilitation & Technology Fee** is settled to NEXPEC for the disbursement-unit released.

### 3.5 Milestone-specific release rules
- The 7-day acceptance window for each milestone starts when the Inspector marks the milestone complete and uploads deliverables (unless the milestone's \`trigger\` field is \`scheduled_date\` or \`client_acceptance\`, in which case the window starts at that event).
- A **disputed milestone does not pause release** of milestones already accepted. The dispute is scoped narrowly to the specific milestone.
- **Already-released milestones cannot be clawed back** except by court order, mediated written settlement, or proven fraud under AUP-001 §2.
- Milestones may be **partially released** by mediated resolution; the unreleased balance returns to payout hold pending settlement or further proceedings.
- The 10% PFT Fee is computed and withheld on each milestone's gross at the time of that milestone's release.

### 3.6 Recurring-specific release rules
- Each period auto-releases at **period close + 7 days**, with mandatory **Day-3 and Day-5 reminders** during the review window. The Day-3/Day-5 reminder cadence applies per period and is not waivable by Order Form.
- A **disputed period does not pause release** of prior periods already released, nor does it suspend funding obligations for future periods (see §5.3 for default-for-non-funding rules).
- The 10% PFT Fee is computed and withheld per period at release; the Inspector's payout schedule continues uninterrupted absent dispute.
- For open-ended engagements (where \`recurring.total_periods\` is null), release continues period-by-period until terminated by notice under §5.3.

## 4. Dispute Hold
If either Party files a dispute through the platform within the review window, **NEXPEC may instruct Stripe to hold the held funds** until: (a) the Parties settle in writing, (b) NEXPEC's mediation step concludes, or (c) a competent court or arbitrator orders disposition. **NEXPEC is not liable for interest or loss of opportunity caused by a good-faith dispute hold.**

## 5. Cancellation, Termination & Refunds

Cancellation rules differ per compensation model. The 10% PFT Fee is **retained on performed value** in all cases, and **waived** only where the Inspector is wholly at fault for non-performance.

### 5.1 Fixed model
- **Client cancels before Inspector commences work:** full refund of the Contract Value to the Client, less any Stripe processing fees Stripe will not return.
- **Client cancels after Inspector commences but before delivery:** refund of the amount above the value of work performed, less the PFT Fee on the **performed** value and less any Stripe fees.
- **Inspector cancels or fails to perform:** full refund of Contract Value to the Client, less Stripe fees; NEXPEC waives the PFT Fee where the Inspector is wholly at fault.

### 5.2 Milestone model
- **Client cancels before commencement of any milestone:** that milestone's funded amount is refunded less Stripe fees. **Downstream unfunded milestones simply do not fund** — no refund liability for them.
- **Client cancels mid-milestone (Inspector has commenced):** refund of milestone amount above performed value; PFT Fee on performed value retained. Allocation in dispute follows §4.
- **Inspector cancels mid-contract:** completed and accepted milestones remain released; any in-progress milestone is allocated per work performed; downstream unfunded milestones lapse.
- **Default for Client non-funding:** if the Client fails to fund the next milestone by its due date despite the Day-7 and Day-3 reminders, the Inspector may, after a **further seven (7) calendar days**, **terminate the contract**. Completed and accepted milestones remain released; any in-progress milestone is allocated per work performed; downstream unfunded milestones lapse.

### 5.3 Recurring model
- **Termination by notice.** Either Party may terminate by giving written notice through the Platform for the period specified in \`compensation.recurring.termination_notice_days\` (default **30 days**). Periods funded and falling within the notice window are honored and run to completion under their normal release rules; periods funded beyond the notice window are refunded less Stripe fees.
- **Default for Client non-funding.** If the Client fails to maintain forward funding despite the Day-7 and Day-3 reminders, the Inspector may, after a **further seven (7) calendar days**, **terminate the engagement immediately**. Completed periods remain released; the in-progress period is **prorated to the termination date** (the Inspector receives net payout for the days actually performed in the in-progress period, less PFT Fee on that prorated value).
- **Inspector cancels.** Completed periods remain released; the in-progress period is prorated to the cancellation date; forward-funded but un-performed periods are refunded to the Client less Stripe fees. NEXPEC may waive the PFT Fee on the prorated in-progress period where the Inspector is wholly at fault.
- **Open-ended engagements.** Where \`recurring.total_periods\` is null, the engagement continues indefinitely until terminated by notice. Both Parties' notice rights are equal.

## 6. Currency Conversion
Where the Client funds in one currency and the Inspector is paid in another, Stripe's then-current foreign-exchange rate and conversion fees apply. **NEXPEC does not set, control, or warrant the FX rate.**

## 7. Chargebacks & Reversals
The Client agrees **not to initiate a chargeback or payment reversal as a substitute** for the dispute pathway in §4 and TOS-001 §10. If the Client initiates a chargeback in breach of this Rider, NEXPEC may (a) reverse-debit the Client's account, (b) suspend the Client's account, (c) recover collection costs and reasonable legal fees, and (d) treat the chargeback as **bad-faith withholding** under CLI-AGR-001 §6.

## 8. Fees
- **NEXPEC PFT Fee:** 10% of Contract Value, **withheld at source**, payable to NEXPEC.
- **Stripe processing & FX fees:** as set out in Stripe's terms; passed through to the responsible Party.
- **No additional NEXPEC fees** apply to a standard Job, except as expressly set out in a signed Order Form.

## 9. Payout Timing
Inspector and Agency payouts follow **Stripe Connect Express** payout schedules, which depend on the recipient's jurisdiction, payout method, and Stripe's risk posture. **NEXPEC is not liable for Stripe-side delays.**

## 10. Tax
Tax obligations are the responsibility of each Party. **VAT/GST registration, indirect-tax invoicing, and withholding obligations are administered through Stripe's tax infrastructure** where Stripe supports the relevant jurisdiction. NEXPEC issues no tax invoices on behalf of any Party.

## 11. Termination Effects on Payout Hold
Termination of any user's Platform access does **not** affect funds already on payout hold for active Jobs; those funds remain governed by §3 and §4 until released or refunded.

— End of PAYOUT-001 v1.0 —`,

  // ─────────── ADDENDUM-FRAMEWORK-001 v1.0 ───────────
  'ADDENDUM-FRAMEWORK-001': `# NEXPEC — Country Addendum Framework

> **Plain-English summary.** NEXPEC's master legal stack is governed by Québec law and Montréal courts. But because we operate worldwide, some countries have mandatory local laws that override our defaults — consumer-rights protections, employment-classification rules, data-protection requirements, language laws, tax registration. **Country Addenda** are short overlays that apply only when (a) the user's jurisdiction triggers them, or (b) the Job is performed in that jurisdiction. Each Addendum modifies only the minimum necessary to be enforceable locally. The rest of the master stack still applies.

## 1. Purpose
This Framework establishes how country-specific or region-specific legal overlays ("**Country Addenda**") attach to the NEXPEC legal stack to comply with mandatory local law where Québec governing law alone would not be enforceable or would expose NEXPEC to disproportionate risk.

## 2. Precedence Rules
Where a Country Addendum applies, the precedence order is:

1. A signed **Order Form** under ORG-AGR-001 §7 (enterprise customers only) — controls only as expressly stated.
2. The applicable **Country Addendum** — controls only to the extent of mandatory local-law overlay.
3. The **Tier-3 Job Contract** (JOB-TPL-001) for scope, schedule, deliverables, and payout.
4. The applicable **Tier-2 Role Agreement** (Inspector / Agency / Client / Organization).
5. **TOS-001 / PRIV-001 / AUP-001** as the Tier-1 baseline.

**Silence in an Addendum means the master stack governs.**

## 3. Trigger Logic
A Country Addendum is triggered when **any** of the following is true at the latest of account creation, role activation, or Job confirmation:

- The user is **resident or domiciled** in the Addendum's jurisdiction.
- The user is a **business legally registered** in the Addendum's jurisdiction.
- The **Job is performed** in the Addendum's jurisdiction.
- A **mandatory consumer-protection or data-protection law** of the Addendum's jurisdiction would otherwise be evaded by the master stack.

## 4. Versioning, Language & Acceptance
Each Country Addendum carries its own id, version, and effective_date. Material amendments are notified to affected users; continued use after the effective date constitutes acceptance — except where local consumer-protection law requires **explicit re-acceptance**. Each Addendum is published in **English plus the local official language(s)** required for enforceability.

## 5. Standard Overlay Categories
Every Country Addendum, regardless of jurisdiction, populates the following categories (omitting any that do not apply):

1. **Consumer-protection / B2C overlay** — where the local user is a consumer.
2. **Employment-classification specifics** — additional independent-contractor safeguards.
3. **Tax registration & indirect-tax (VAT/GST) treatment.**
4. **Language and translation requirements.**
5. **Data-protection overlay** — local rights, retention, breach notification, residency requirements.
6. **Dispute-resolution overlay** — mandatory arbitration, mandatory local courts, mandatory mediation.
7. **Payment-services overlay** — local money-transmission, AML, and sanctions-screening obligations.
8. **Industry / sector-specific overlay** — e.g., GCC industrial-licensing for inspectors.

## 6. Priority-Market Scaffolds (v1)

**CA — Canada (federal + Québec + ROC).** *Scaffold.* Law 25 (QC privacy), PIPEDA, Bill 96 (French-version availability), Québec consumer-protection law for B2C, CASL for marketing.

**US — United States (multi-state).** *Scaffold.* Mandatory-arbitration carve-out (JAMS/AAA), state privacy laws (CCPA/CPRA, VCDPA, CPA), state independent-contractor tests (e.g., CA ABC test), state payment-bond requirements.

**EU — European Union / EEA.** *Scaffold.* GDPR (Art. 28 controller-processor mirror, Art. 46 SCC reaffirmation), EU Platform-to-Business Regulation 2019/1150, country-level consumer rights (Directive 2011/83/EU), e-invoicing where required.

**UK — United Kingdom.** *Scaffold (separate from EU per post-Brexit divergence).* UK GDPR + IDTA in lieu of SCCs; UK Consumer Rights Act for B2C; sector-specific industrial-regulator overlays.

**GCC — KSA, UAE, Qatar.** *Scaffold.* Arabic-language version (KSA practice), UAE Federal Data Protection Law (No. 45 of 2021), Qatar PDPPL, KSA PDPL, industrial-licensing for inspectors, anti-corruption representations, Sharia overlay for interest / late-payment.

**JP — Japan.** *Scaffold.* APPI, JCT (consumption tax) registration, Subcontracting Act considerations.

**KR — South Korea.** *Scaffold.* PIPA, Korean Consumer Protection Act, mandatory local representative for foreign data controllers above thresholds, K-VAT registration.

**IN — India.** *Scaffold.* DPDP Act 2023, GST registration for Indian-paid Inspectors, IT Act 2000 intermediary safe-harbour, sector-specific BIS / Workplace Safety rules.

**CN — China.** *Scaffold — high friction.* PIPL cross-border transfer assessments, mandatory data residency for certain categories, CSL, Foreign Investment List restrictions on certain industrial-inspection activities. Recommendation: limit CN serviceability pending local-counsel readiness.

## 7. Conflict-of-Laws Rules
- The **master stack's governing law (Québec)** controls except where an applicable Country Addendum's mandatory-law overlay applies.
- If **two Country Addenda** apply: the Addendum tied to the **performance jurisdiction** controls performance-related overlays; the Addendum tied to the **payor's jurisdiction** controls payment / tax overlays.
- An **Order Form** under ORG-AGR-001 may override an Addendum only as between NEXPEC and that Organization, and **never to the prejudice of the Inspector's or Agency's local mandatory rights**.

## 8. Maintenance
NEXPEC maintains the priority-market scaffolds and updates statuses as Country Addenda are drafted, reviewed by local counsel, and activated. Each activation requires (a) local-counsel review, (b) publication in English plus local official language(s), and (c) a platform-side flag flip enabling the trigger logic in §3.

— End of ADDENDUM-FRAMEWORK-001 v1.0 —`,

  // ═══════════════════════════════════════════════════════════════════════
  //  CHECKPOINT 5 ADDITIONS — Country Addenda + DPA + Order Form
  // ═══════════════════════════════════════════════════════════════════════

  // ─────────── ADDENDUM-CA-001 v1.0 ───────────
  'ADDENDUM-CA-001': `# Canada — Country Addendum

> **Plain-English summary.** This is the Canada overlay on the NEXPEC legal stack. Because NEXPEC is based in Montréal, Québec, most of the master stack already aligns with Canadian law. This Addendum adds the things specifically required for Canadian users and Canadian-performed Jobs — Bill 96 French availability, Law 25 and PIPEDA privacy rights, Québec consumer-protection forum carve-out for B2C, and CASL marketing-comms compliance.

## 1. Trigger
This Addendum applies whenever any of the following is true: the user is resident in Canada or registered as a business in Canada; or the Job is performed in Canada.

## 2. Consumer Protection (B2C overlay — Québec)
For Job Contracts where the Client is an individual consumer (not a business) resident in Québec, the **Consumer Protection Act (Québec)** ("CPA") applies notwithstanding TOS-001 §10. The consumer retains all non-waivable CPA rights — including the right to file complaints with the **Office de la protection du consommateur** — and may bring an action before the **Court of Québec, Division of Small Claims** for amounts within its jurisdiction without first completing the mandatory mediation step in TOS-001 §10.

## 3. Data Protection — Law 25 + PIPEDA
For personal information processed in connection with Québec users, **Loi 25** applies in addition to PRIV-001. For all other Canadian users, **PIPEDA** applies.
- **Privacy Officer.** privacy@nexpec.com — the contact for both PIPEDA and Law 25 inquiries.
- **Cross-border transfer.** Under Law 25 §17, NEXPEC has assessed the data-protection regime of Stripe (USA) and Supabase / AWS and concluded that contractual safeguards provide protection equivalent to that required under Law 25.
- **Data-portability.** Québec users may request data portability beginning on Law 25's portability effective date.
- **Right to de-indexing.** Québec users may request de-indexing of inaccurate, incomplete, or equivocal personal information.

## 4. Language — Bill 96
NEXPEC complies with the **Charter of the French Language** (R.S.Q. c. C-11), as amended by Bill 96. Québec-resident users are offered French-language versions of all consumer-facing legal documents. Where the user accepts the French version, the French version controls in any conflict.

## 5. Marketing & Anti-Spam — CASL
NEXPEC complies with **Canada's Anti-Spam Legislation**. Commercial electronic messages require consent, identify the sender, and provide an unsubscribe mechanism.

## 6. Tax Treatment
Stripe administers GST/HST and QST registration, invoicing, and remittance via Stripe Tax where Canadian thresholds are met. Inspectors are independently responsible for their own CRA business-number registration and tax reporting.

## 7. Dispute Resolution — Carve-out
TOS-001 §10 governs (mandatory mediation → exclusive Montréal courts). For Québec B2C disputes, §2 operates as a mandatory carve-out.

## 8. Industry-Specific
For Jobs performed in Canada, Inspectors are responsible for their own provincial certifications (CSA, TSSA, PTCB) and OHS compliance.

— End of ADDENDUM-CA-001 v1.0 —`,

  // ─────────── ADDENDUM-EU-001 v1.0 ───────────
  'ADDENDUM-EU-001': `# European Union / EEA — Country Addendum

> **Plain-English summary.** This is the EU/EEA overlay. NEXPEC operates from Canada, so cross-border-transfer mechanics, GDPR Article 28 controller-processor rules, EU consumer-jurisdiction rules, and the Platform-to-Business Regulation all need explicit overlay. NEXPEC must also appoint an Article 27 EU Representative before activating the EU market.

## 1. Trigger
This Addendum applies whenever the user is resident in an EU/EEA Member State; the user is a business established in an EU/EEA Member State; or the Job is performed in an EU/EEA Member State.

## 2. Consumer Protection — Right of Withdrawal
For Job Contracts where the Client is an EU/EEA consumer, the **Consumer Rights Directive (2011/83/EU)** applies. The consumer has a **fourteen (14) day right of withdrawal**, expressly waived at confirmation of hire only where the Inspector commences performance before expiry of the withdrawal period and the consumer has been so informed (CRD Article 16(a)).

## 3. Data Protection — GDPR Article 28 + International Transfers
- **Controller-processor structure.** Where NEXPEC processes personal data on behalf of an Organization or Client under their Job-related instructions, NEXPEC acts as a processor within the meaning of **Article 28 GDPR**. The Data Processing Addendum (DPA-001) constitutes the Article 28 agreement.
- **International transfer.** Transfers from EU/EEA to NEXPEC (Canada) and to subprocessors are made under the **EU Standard Contractual Clauses (SCCs) Module Two — Controller to Processor** (Commission Implementing Decision (EU) 2021/914), incorporated by reference.
- **Article 27 EU Representative.** [TBD — appoint before EU market activation].
- **Data subject rights.** Exercisable via privacy@nexpec.com.

## 4. Platform-to-Business Regulation (Reg. 2019/1150)
- **Ranking parameters** published at nexpec.com/legal/ranking.
- **Statement of reasons** before any restriction, suspension, or termination of an EU-established business user.
- **Internal complaint-handling** at complaints@nexpec.com.

## 5. Language
English. Member-State official-language versions provided where mandatory local consumer-protection law so requires.

## 6. Tax — VAT
Stripe administers VAT via Stripe Tax (OSS/IOSS where applicable). Reverse-charge applies to the 10% PFT Fee charged to EU-established business users where Stripe Tax so determines.

## 7. Dispute Resolution — Consumer-Jurisdiction Carve-out
TOS-001 §10 governs, **except** that an EU/EEA consumer may bring proceedings against NEXPEC in their Member State of domicile (Brussels I bis Article 18), and NEXPEC may bring proceedings against an EU consumer only in the consumer's Member State.

## 8. Industry-Specific
EU industrial-inspection regimes (PED 2014/68/EU, ATEX 2014/34/EU) impose certification on Inspectors directly; INSP-AGR-001 §2 applies without modification.

— End of ADDENDUM-EU-001 v1.0 —`,

  // ─────────── ADDENDUM-UK-001 v1.0 ───────────
  'ADDENDUM-UK-001': `# United Kingdom — Country Addendum

> **Plain-English summary.** Post-Brexit the UK diverged from EU GDPR in important ways — most notably, transfers out of the UK use the **IDTA** rather than the EU SCCs. UK consumer-protection rules and the UK "worker" classification risk also require explicit overlay. NEXPEC must appoint a UK GDPR Article 27 Representative before activating the UK market.

## 1. Trigger
This Addendum applies whenever the user is resident in the UK; the user is a business registered in the UK; or the Job is performed in the UK.

## 2. Consumer Protection — Consumer Rights Act 2015
The **Consumer Rights Act 2015** applies to UK consumer Job Contracts. The Inspector — not NEXPEC — provides the service; NEXPEC does not assume CRA 2015 §49 service obligations. Nothing in TOS-001, CLI-AGR-001, or this Addendum excludes any non-excludable UK statutory right.

## 3. Worker-Classification Risk (UK-Specific)
The UK recognizes an intermediate **"worker"** category between employee and self-employed (Employment Rights Act 1996 §230(3)(b)). Inspectors are engaged on terms requiring independent-contractor status under INSP-AGR-001 §1. **In the event that a court determines worker status applies notwithstanding this Agreement, the indemnity in INSP-AGR-001 §7 expressly extends to that determination and to any consequential entitlement (minimum wage, holiday pay, working-time, statutory rests).** No part of the 10% PFT Fee constitutes wages.

## 4. Data Protection — UK GDPR + IDTA
- **UK GDPR.** Article 28 controller-processor obligations mirror the EU framework and are governed by DPA-001.
- **International transfer mechanism.** Transfers from the UK to NEXPEC (Canada) and to subprocessors are made under the **UK International Data Transfer Agreement (IDTA, February 2022)** and/or the **UK Addendum to the EU SCCs**.
- **Article 27 UK Representative.** [TBD — appoint before UK market activation].
- **ICO contact.** UK users may complain to the Information Commissioner's Office.

## 5. Language
English.

## 6. Tax — VAT (UK)
Stripe administers UK VAT via Stripe Tax. Reverse-charge applies to the 10% PFT Fee charged to UK-established business users where Stripe Tax so determines.

## 7. Dispute Resolution — Consumer-Jurisdiction Carve-out
TOS-001 §10 governs, **except** that a UK consumer retains the right to bring proceedings in their UK domicile per the retained consumer-jurisdiction rules.

## 8. Industry-Specific — HSE & Sector Regulators
Inspectors are responsible for their own certifications under HSE, the Offshore Installations regime where applicable, and sector-specific bodies (ONR for nuclear, HSE COMAH for major-hazard sites).

— End of ADDENDUM-UK-001 v1.0 —`,

  // ─────────── ADDENDUM-US-001 v1.0 (with mass-action waiver) ───────────
  'ADDENDUM-US-001': `# United States — Country Addendum

> **Plain-English summary.** This is the US overlay. The US is multi-state, so this Addendum handles the federal baseline plus the leading state privacy regimes. Two areas need US counsel before activation: state-specific arbitration enforceability and the California ABC independent-contractor test.

## 1. Trigger
This Addendum applies whenever the user is resident in the United States; the user is a business registered in any US state; or the Job is performed in the United States.

## 2. Consumer Privacy — Multi-State
For US-resident consumers (per each state's threshold):
- **No sale; no cross-context behavioural advertising.** NEXPEC does not sell personal information, does not share for cross-context behavioural advertising, and does not engage in targeted advertising as defined under **CCPA/CPRA**, **VCDPA**, **CPA**, **CTDPA**, or **UCPA**.
- **Consumer rights.** Subject to state thresholds, US consumers may request to **know, delete, correct, port, and limit the use of sensitive personal information**. Submit requests to privacy@nexpec.com.
- **Authorized agents.** California consumers may submit through an authorized agent under CCPA/CPRA §1798.140(d).
- **Sensitive personal information.** NEXPEC processes government identifiers (Inspector credentials), precise geolocation (with consent), and financial information (collected by Stripe, not stored by NEXPEC).

## 3. Independent-Contractor Classification — California ABC Test (Reservation)
For Inspectors performing Jobs in California, NEXPEC and the Inspector each represent: (a) Inspector is free from control of the hiring entity (the Client) under contract and in fact; (b) Inspector performs work outside the usual course of **NEXPEC's** business (operating software, not inspecting); (c) Inspector is customarily engaged in an independently established trade. The classification-claim indemnity in INSP-AGR-001 §7 and AGN-AGR-001 §9 survives any contrary determination.

## 4. Dispute Resolution — Class-Action + Mass-Action Waiver + Arbitration Option
**For US-resident users**, in addition to TOS-001 §10:
- **Class-action waiver.** Each user waives the right to participate in any **class action** against NEXPEC arising out of or relating to use of the Platform, to the maximum extent permitted by law.
- **Mass-action and consolidated-arbitration waiver.** Each user further waives the right to participate in any **mass-action, multi-claimant, collective, or consolidated arbitration** proceeding against NEXPEC, including without limitation any coordinated filing of materially similar individual arbitration demands by multiple users represented by common or coordinated counsel. NEXPEC, in its sole discretion, may **consolidate such proceedings into a single batched arbitration** with reasonable procedural efficiencies (common-question consolidation, sequenced bellwether resolution, shared arbitrator panels). To the maximum extent permitted by law, this Mass-Action Waiver is **severable** from the Class-Action Waiver: if either is held unenforceable, the other survives.
- **Optional binding arbitration.** Either party may elect binding individual arbitration administered by JAMS or AAA, seated in Montréal, Québec or in the place of the user's residence. The TOS-001 §10 mediation step applies as a prerequisite.
- **Small-claims carve-out.** Either party retains the right to bring an individual claim in the user's home-state small-claims court.

**Counsel-pending.** Where state law (CA, MA, NY, NJ) renders any waiver or election partially or wholly unenforceable, those provisions are read down to the maximum extent permitted; the remainder of §10 controls. The severability rule above ensures invalidation of one waiver does not invalidate the others.

## 5. Language
English. Spanish on request; no statutory mandate.

## 6. Tax
Stripe administers sales-and-use tax, 1099-NEC (Inspectors), and 1099-K (marketplace) via Stripe Tax.

## 7. Payment Services — No MSB Status
NEXPEC is not a **money services business** within FinCEN's regulations (31 CFR §1010.100(ff)). Stripe holds the state money-transmitter licences; AML/sanctions screening is administered by Stripe.

## 8. Industry-Specific — State Licensing
Inspectors are responsible for OSHA, API, ASME, AWS, NACE, and state-specific industrial regulators (TX RRC, CA BSEE, LA DENR). NEXPEC does not verify state-specific licensing.

— End of ADDENDUM-US-001 v1.0 —`,

  // ─────────── ADDENDUM-GCC-001 v1.0 ───────────
  'ADDENDUM-GCC-001': `# GCC — Country Addendum (KSA, UAE, Qatar)

> **Plain-English summary.** This is the GCC overlay covering Saudi Arabia, the UAE, and Qatar. Arabic translation of the consumer-facing legal pack and KSA NDMO controller registration are required business actions before any GCC market activation.

## 1. Trigger
This Addendum applies whenever the user is resident in, or registered as a business in, KSA, UAE, or Qatar; or the Job is performed in any of those three jurisdictions.

## 2. Data Protection — Three Regimes
- **KSA.** Compliance with the **Personal Data Protection Law** (Royal Decree M/19) and the **NDMO**. Cross-border transfer under PDPL Article 29 with contractual safeguards equivalent to the EU SCCs.
- **UAE.** Compliance with **Federal Decree-Law No. (45) of 2021** on Personal Data.
- **Qatar.** Compliance with **Law No. 13 of 2016** (PDPPL).
- Subprocessor list at nexpec.com/legal/subprocessors.

## 3. Language — Arabic
For KSA-resident consumers, an Arabic version of the consumer-facing legal pack is provided. For UAE and Qatar, Arabic on request; in conflict, the executed Arabic version controls.

## 4. Sharia Overlay — Late-Payment Interest & Penalties
NEXPEC does **not** charge late-payment interest, **riba**, or compound penalties. The 10% PFT Fee is a fixed platform-facilitation-and-technology fee — not consideration for the use of money. Refunds operate on a return-of-principal basis under PAYOUT-001 §5.

## 5. Employment & Visa
- **Independent contractor status reaffirmed.** NEXPEC does not sponsor any Inspector's visa.
- **Kafala / sponsorship.** Inspectors operating under sponsored-employment regimes are responsible for their own visa and labour-permit compliance with their sponsor.

## 6. Tax — VAT
- **KSA.** ZATCA-administered VAT (15%) via Stripe Tax.
- **UAE.** FTA VAT (5%) via Stripe Tax.
- **Qatar.** No VAT currently.

## 7. Dispute Resolution — GCC Carve-out (Optional)
TOS-001 §10 governs. **For business users only**, the parties may by mutual written agreement substitute arbitration before DIFC-LCIA, ADGM Arbitration Centre, or SCCA. No GCC arbitration substitution against an individual consumer.

## 8. Industry-Specific
Inspectors are responsible for ADNOC, PDO, SABIC, Saudi Aramco, Saudi HSCE, Qatar Energy, and Qatar Petroleum entitlements; NEXPEC does not verify GCC sector-specific entitlement.

## 9. Anti-Corruption Representation
Each user warrants compliance with UAE Federal Decree-Law No. 31 of 2021, KSA Anti-Bribery Law, US FCPA, and UK Bribery Act in connection with any Job performed in or paid from the GCC.

— End of ADDENDUM-GCC-001 v1.0 —`,

  // ─────────── ADDENDUM-JP-001 v1.0 ───────────
  'ADDENDUM-JP-001': `# Japan — Country Addendum

> **Plain-English summary.** This is the Japan overlay. APPI and the Subcontracting Act require explicit overlay for the platform model.

## 1. Trigger
This Addendum applies whenever the user is resident in, or registered in, Japan; or the Job is performed in Japan.

## 2. Consumer Protection — Consumer Contract Act + SCTA
The **Consumer Contract Act** (消費者契約法) applies. Clauses purporting to wholly exempt NEXPEC from liability for intentional or grossly negligent acts are unenforceable under Article 8; the liability cap in TOS-001 §9 is read down to comply.

## 3. Subcontracting Act — Reservation
The platform-mediated Job Contract is a direct contract between Client and Inspector and is not a consignment by NEXPEC under the **Subcontracting Act** (下請代金支払遅延等防止法). In the event a competent authority determines the Act applies, NEXPEC's role remains that of a neutral technology intermediary.

## 4. Data Protection — APPI
- Compliance with the **Act on the Protection of Personal Information** (APPI).
- Cross-border transfer disclosure: personal information will be transferred to Canada. Canada is recognized by the PPC as a jurisdiction with comparable protection; transfers proceed on that basis.
- Data subject rights exercisable via privacy@nexpec.com or directly to the PPC.

## 5. Language
**Japanese-language** versions of consumer-facing legal documents are provided for Japan-resident consumer users.

## 6. Tax — Japanese Consumption Tax (JCT)
Stripe administers JCT registration via Stripe Tax (¥10M annual threshold). The 10% PFT Fee to Japan-established Inspectors and Agencies is subject to JCT reverse-charge for B2B cross-border services where Stripe Tax so determines.

## 7. Dispute Resolution — Consumer-Jurisdiction Carve-out
TOS-001 §10 governs, **except** that under Japan's Code of Civil Procedure Article 3-4, an action by a Japan-resident consumer may be brought in the District Court of Tokyo or the consumer's place of domicile.

## 8. Industry-Specific
Inspectors are responsible for certifications under the High Pressure Gas Safety Act, the Industrial Safety and Health Act, the Electricity Business Act, JOGMEC, and NRA.

— End of ADDENDUM-JP-001 v1.0 —`,

  // ─────────── ADDENDUM-KR-001 v1.0 ───────────
  'ADDENDUM-KR-001': `# South Korea — Country Addendum

> **Plain-English summary.** Korean privacy law (PIPA) requires a mandatory local representative for foreign data controllers above certain thresholds — this is a business action that must be completed before activating KR. Korean courts have also expanded platform-worker classification in recent jurisprudence.

## 1. Trigger
This Addendum applies whenever the user is resident in, or registered in, South Korea; or the Job is performed in South Korea.

## 2. Consumer Protection
For KR-resident consumers, under the **Act on the Consumer Protection in Electronic Commerce**, the consumer has the right to withdraw within **seven (7) days** of acceptance, subject to the standard performance-commenced exception. The **Korea Consumer Agency** (한국소비자원) handles complaints.

## 3. Data Protection — PIPA
- **PIPA compliance.** NEXPEC complies with the **Personal Information Protection Act** (개인정보 보호법).
- **Consent regime.** PIPA requires separate, explicit consent for collection, purpose-shift, third-party provision, and cross-border transfer. The platform surfaces a multi-checkbox consent flow at KR account creation.
- **Cross-border transfer.** Requires explicit consent under PIPA Article 28-8, supplemented by contractual safeguards equivalent to the EU SCCs.
- **Mandatory local representative.** Where processing exceeds PIPA Enforcement Decree Article 32 thresholds (KRW 10B annual revenue, or 1M KR users), NEXPEC will appoint a PIPA local representative: [TBD — appoint before KR market activation].

## 4. Worker-Classification — Reservation (Korean Platform Jurisprudence)
Korean courts have recently expanded worker-status rules to platform-mediated workers. Inspectors are engaged on terms requiring independent-contractor status under INSP-AGR-001 §1. The classification-claim indemnity in INSP-AGR-001 §7 expressly extends to any determination of worker status notwithstanding this Agreement.

## 5. Language
**Korean-language** versions of consumer-facing legal documents are provided for KR-resident consumer users.

## 6. Tax — K-VAT
Stripe administers Korean VAT (10%) via Stripe Tax. Withholding obligations on payments to foreign Inspectors are administered by the Client where applicable.

## 7. Dispute Resolution — Consumer-Jurisdiction Carve-out
TOS-001 §10 governs, **except** that an action by a KR-resident consumer may be brought in Korean courts of the consumer's domicile per the Conflict of Laws Act (국제사법).

## 8. Industry-Specific
Inspectors are responsible for KOSHA, KGS, KEPIC, MOTIE, and MOLIT entitlements; NEXPEC does not verify Korea sector-specific entitlement.

— End of ADDENDUM-KR-001 v1.0 —`,

  // ─────────── ADDENDUM-IN-001 v1.0 ───────────
  'ADDENDUM-IN-001': `# India — Country Addendum

> **Plain-English summary.** India's DPDP Act 2023 is in roll-out; GST registration via Stripe Tax is required for Indian-paid Inspectors; the IT Act 2000 intermediary safe-harbour requires platform-side procedures.

## 1. Trigger
This Addendum applies whenever the user is resident in, or registered in, India; or the Job is performed in India.

## 2. Consumer Protection — Consumer Protection Act 2019
NEXPEC complies with the **Consumer Protection (E-Commerce) Rules, 2020**, including the grievance-officer requirement, redressal timelines (acknowledge within 48 hours, resolve within one month), and mandatory disclosures. **India Grievance Officer**: grievance@nexpec.com — designated officer [TBD before IN market activation].

## 3. Data Protection — DPDP Act 2023
- **DPDP compliance.** NEXPEC complies with the **Digital Personal Data Protection Act, 2023** and implementing rules as they come into effect.
- **Notice & consent.** Notice in clear and plain language; consent via the platform consent flow.
- **Cross-border transfer.** Permitted except to countries notified by the Central Government as restricted.
- **Child data.** Verifiable parental consent required for under-18 data; platform not directed at minors.
- **Rights.** Access, correction, completion, updating, erasure, and nomination — via privacy@nexpec.com.

## 4. IT Act 2000 — Intermediary Safe-Harbour
NEXPEC qualifies as an **intermediary** under Section 2(1)(w) of the **Information Technology Act, 2000** and complies with the Section 79 safe-harbour conditions and the **IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021**: published terms and privacy, designated Grievance Officer, compliance with takedown directions within prescribed timelines.

## 5. Language
English. Hindi translations on request; no statutory mandate.

## 6. Tax — GST + OIDAR
Stripe administers Indian GST (CGST+SGST or IGST) via Stripe Tax India. For B2C cross-border digital services, **OIDAR** registration may be required where Stripe-side thresholds are met.

## 7. Payment Services — RBI
Stripe complies with RBI guidelines on payment aggregators and auto-debit mandates. NEXPEC is not a payment aggregator.

## 8. Dispute Resolution — Consumer-Jurisdiction Carve-out
TOS-001 §10 governs, **except** that an India-resident consumer may file with the District Consumer Disputes Redressal Commission of the consumer's domicile under the Consumer Protection Act 2019, and may bring claims in the competent court at the consumer's residence per CPA Section 17.

## 9. Industry-Specific
Inspectors are responsible for BIS, PESO, DGMS, AERB, and Factories Act 1948 entitlements; NEXPEC does not verify India sector-specific entitlement.

— End of ADDENDUM-IN-001 v1.0 —`,

  // ─────────── ADDENDUM-CN-001 v1.0 (signup-blocked) ───────────
  'ADDENDUM-CN-001': `# People's Republic of China — Country Addendum (SCAFFOLD ONLY)

> **⚠️ Activation status: NOT-FOR-ACTIVATION.** This Addendum is a **scaffold** only. The PRC regulatory environment for foreign-operated marketplaces serving Chinese users carries material legal and operational risk that NEXPEC has determined cannot be borne until completed engagement with PRC-qualified counsel. **Until this Addendum is moved to status: active, NEXPEC does not knowingly serve PRC-resident users or PRC-performed Jobs.** **Signup-time gating is enforced by \`src/legal/marketGating.ts\` — account creation for users declaring mainland-China residence is blocked at the signup screen.**

## 1. Trigger (Once Activated)
On activation, this Addendum would apply whenever the user is resident in mainland China; the user is a business registered in mainland China; or the Job is performed in mainland China. **Hong Kong SAR and Macau SAR are out of scope** and are governed separately.

## 2. Data Protection — PIPL + CSL + DSL (HIGH FRICTION)
- **PIPL.** Cross-border transfer security assessments under PIPL Article 38 require **CAC** clearance for transfers above specified thresholds; designation of a PI Protection Officer where the operator processes data of more than 1 million PRC subjects.
- **CSL.** Critical-information-infrastructure determinations could trigger data-localization and security-review obligations.
- **DSL.** Important-data classification could trigger cross-border restrictions.

**Practical impact.** Onboarding a single mainland-China user could trigger PIPL Article 38 compliance. The CAC security-assessment cycle is long and uncertain. NEXPEC will not accept this risk profile until local-counsel readiness is confirmed.

## 3. Foreign Investment Negative List
Industrial-inspection services may fall within categories subject to the **Special Administrative Measures (Negative List) for Foreign Investment Access**, requiring a PRC-domiciled operating entity (WFOE) and, in some categories, ownership restrictions.

## 4. Consumer Protection
On activation, NEXPEC would comply with the **PRC Consumer Rights Protection Law** and **PRC E-Commerce Law**.

## 5. Language
Simplified Chinese mandatory for consumer-facing materials on activation.

## 6. Tax — VAT
PRC VAT (6% for services) administration applies on activation; mechanism depends on the chosen operating structure.

## 7. Dispute Resolution — Forum
PRC courts may assume mandatory jurisdiction. Enforcement of Quebec / Canadian judgments against PRC defendants is **unreliable** — this is a load-bearing reason for the scaffold-only status.

## 8. Industry-Specific
On activation, PRC regimes (SAMR, MEM) apply.

## 9. Maintenance & Activation Procedure
Activation requires: (1) PRC-qualified counsel engagement; (2) PRC operating-structure decision; (3) CAC security-assessment commencement (if applicable); (4) Simplified Chinese translation; (5) status update from scaffold-only to active in this file's metadata and in ADDENDUM-FRAMEWORK-001 §6; (6) removal of CN from the SIGNUP_BLOCKED_COUNTRIES list in src/legal/marketGating.ts.

— End of ADDENDUM-CN-001 v1.0 (SCAFFOLD-ONLY) —`,

  // ─────────── DPA-001 v1.0 (with 60-day deletion window) ───────────
  'DPA-001': `# NEXPEC — Data Processing Addendum

> **Plain-English summary.** This DPA is the controller-processor contract between your Organization (the Controller) and NEXPEC (the Processor). It's required by GDPR Article 28, UK GDPR, Québec Law 25, and other major privacy laws. The Organization Agreement (ORG-AGR-001 §4) hooks this DPA into the master stack.

## 1. Parties, Subject Matter & Duration
This DPA is entered into between the Customer ("**Controller**") that accepted ORG-AGR-001 and **NEXPEC Technologies** ("**Processor**"), of Montréal, Québec, Canada. It applies to processing of personal data of identified or identifiable individuals ("**Personal Data**") that the Controller transmits to or has processed through the Platform. In force for so long as ORG-AGR-001 is in force, plus the post-termination retention period in §10.

## 2. Nature, Purpose & Scope of Processing
NEXPEC processes Personal Data only to: (1) provide the Platform services described in TOS-001 and ORG-AGR-001; (2) facilitate Jobs (matching, contract generation, payout hold, communications, audit); (3) comply with applicable laws and reasonable Controller instructions; (4) exercise legitimate interests in Platform security, fraud prevention, and improvement (limited to anonymized/aggregated use). Categories of data, Data Subjects, and operations are in **Annex A**.

## 3. Controller / Processor Roles
The Controller determines the purposes and means of processing of data uploaded by its Seats and warrants lawful basis. **NEXPEC is the Processor** for that data, processing only on documented instructions. Where NEXPEC is independently the Controller of certain data (account credentials, fraud signals, security telemetry), PRIV-001 governs.

## 4. Processor Obligations
NEXPEC will: (1) process only on documented instructions; (2) ensure personnel are bound by confidentiality; (3) implement appropriate **technical and organizational measures** per **Annex B**; (4) assist with **Data Subject rights requests**; (5) assist with security, breach notification, DPIA, and prior-consultation obligations; (6) at Controller's choice, **delete or return** data after end of services (see §10); (7) make available info to demonstrate compliance and allow audits per ORG-AGR-001 §5.

## 5. Subprocessors
- **General authorization.** Controller authorizes NEXPEC to engage Subprocessors with no-less-protective obligations.
- **List.** Published at nexpec.com/legal/subprocessors and notified in-app on material changes.
- **Objection window.** 15 business days from notification of a new Subprocessor; if objection unresolved, Controller may terminate the affected service with pro-rated refund.

## 6. International Transfers
For EU/EEA transfers, **EU SCCs Module Two — Controller to Processor** (Commission Implementing Decision (EU) 2021/914) incorporated by reference, completed by **Annex C**. For UK transfers, **UK IDTA (February 2022)** or UK Addendum to the EU SCCs as applicable. For Canada / Québec, contractual safeguards consistent with **Law 25 §17** and **PIPEDA**. Transfer Impact Assessment at nexpec.com/legal/transfer-impact-assessment.

## 7. Data Subject Rights
NEXPEC will provide reasonable assistance to enable Controller responses to Data Subject requests (access, rectification, erasure, restriction, portability, objection, withdrawal of consent). Where a Data Subject submits directly to NEXPEC, NEXPEC will redirect to Controller and notify Controller without undue delay.

## 8. Personal Data Breach
NEXPEC will notify Controller **without undue delay and in any event within 48 hours** of becoming aware of a Personal Data Breach affecting Personal Data processed for Controller, with the information required by applicable law.

## 9. Audits
On terms of **ORG-AGR-001 §5**: reasonable advance notice, not more than once per twelve months absent a security incident or regulatory inquiry. Conducted in a manner that does not unduly disrupt operations or compromise other customers' confidentiality.

## 10. Term, Deletion & Return
On termination of ORG-AGR-001, NEXPEC will, at Controller's documented election, **delete** or **return** all Personal Data processed on behalf of Controller, subject to retention required by applicable law (tax, audit, litigation-hold obligations described in PRIV-001 §8). The Controller's election must be received within **sixty (60) days** of termination; absent timely election, NEXPEC will delete on its standard retention schedule. The 60-day election window is intended to accommodate enterprise compliance cycles (vendor offboarding reviews, security exit audits, regulatory archival certifications) without indefinite storage exposure for NEXPEC.

## 11. Liability
The liability cap and exclusions in TOS-001 §9 and ORG-AGR-001 §9 apply, subject to mandatory data-protection law that overrides contractual liability.

## 12. Order of Precedence
(1) signed Order Form expressly modifying this DPA; (2) this DPA; (3) PRIV-001; (4) ORG-AGR-001; (5) TOS-001.

## 13. Governing Law
Laws of Québec, Canada, except where mandatory data-protection law of the Controller's jurisdiction requires otherwise.

---

## Annex A — Categories
**Data Subjects:** Controller personnel and Seats; Inspector and Agency users matched with Controller's Jobs; on-site personnel in Inspector Output.
**Personal Data:** Identification and contact; professional credentials; Job-related communications; geolocation; reports and findings; ratings; device, log, security telemetry.
**Purposes:** Job matching, contract generation, payout hold facilitation, communications, dispute support, audit, security, statutory recordkeeping.

## Annex B — TOMs
TLS 1.2+ in transit, AES-256 at rest, Supabase RLS, RBAC, audited admin actions, secret rotation, SSO, least privilege, formal incident-response, vendor risk reviews. Current TOMs at nexpec.com/legal/security.

## Annex C — SCCs Docking
**Module Two — Controller to Processor.** Data exporter: Controller. Data importer: NEXPEC. Competent supervisory authority: Member State of Controller. Annexes I.A, I.B, II, III completed by reference to Annexes A and B of this DPA and the Subprocessor list.

— End of DPA-001 v1.0 —`,

  // ─────────── ORDER-FORM-001 v1.0 (Template) ───────────
  'ORDER-FORM-001': `# NEXPEC — Enterprise Order Form

> **Plain-English summary.** This Order Form is the fill-in-the-blank exhibit that goes alongside ORG-AGR-001 when an enterprise customer needs custom commercial terms — discounted PFT Fees, net-invoice payment, dedicated SLA, data residency, alternative dispute forum. It overrides the Master Stack only in the specific dimensions filled out here.

**This Order Form is incorporated into ORG-AGR-001.** It modifies the Master Stack only to the extent expressly stated below and only as between NEXPEC and the Customer named in §0.

## §0. Order Form Identification
- **Order Form Number:** OF-________
- **Customer Legal Name:** ____________________________
- **Customer Address:** ____________________________
- **Customer Tax / Registration #:** ____________________________
- **Customer Primary Contact:** ____________________________
- **NEXPEC Entity:** NEXPEC Technologies, Montréal, Québec, Canada
- **Effective Date:** __________
- **Initial Term:** ____ months
- **Auto-Renewal Term:** ____ months (or "none")

## §1. Seats & Users
- **Provisioned Seats:** _____ (admin, manager, requester, viewer roles).
- **Additional Seats overage rate:** $ ____ per Seat per month.
- **SSO requirement:** ____.
- **Domain bindings:** ____________________________.

## §2. PFT Fee (overrides ORG-AGR-001 §7 / TOS-001 §3 baseline of 10%)
| Tier | Annual Contract Value (gross) | Effective PFT Fee Rate |
|---|---|---|
| Tier 1 | $0 – $250K | ____ % (default 10%) |
| Tier 2 | $250K – $1M | ____ % |
| Tier 3 | $1M – $5M | ____ % |
| Tier 4 | $5M+ | ____ % |

**True-up cadence:** quarterly / annually / none.

## §3. Payment Terms (overrides PAYOUT-001 §2 default)
- **Funding method:** card / ACH / wire / purchase-order with net invoicing.
- **Net invoice terms:** Net ____ days.
- **Currency:** CAD / USD / EUR / GBP / AED / SAR / other: ______.
- **Credit limit (if PO/net):** $ ______.
- **Late-payment treatment:** per TOS-001 §3 + PAYOUT-001; no riba/interest under ADDENDUM-GCC-001 §4.

## §4. Service Levels (overrides ORG-AGR-001 §6 "as available" default)
- **Platform uptime:** ____ % monthly.
- **P1 response time:** ____ hours business / ____ hours after-hours.
- **P2 response time:** ____ business hours.
- **Standard support response:** ____ business hours.
- **Dedicated Customer Success contact:** yes / no.

Maintenance windows excluded: ______.

## §5. Data Residency (overrides PRIV-001 §6 default of "no localized residency")
- **Account & Verification Data:** Canada / EU / USA / no commitment.
- **Job Data & Inspector Output:** Canada / EU / USA / no commitment.
- **Backups:** same region as primary / Canada.

DPA-001 is **Schedule A**.

## §6. Reserved Capacity & Priority
- **Reserved Inspector capacity:** ____ Inspector-days / month in [region].
- **Priority matching:** yes / no — Customer's Jobs surfaced ____ hours before general Inspectors.
- **White-label / co-brand:** yes / no — details in Schedule D if yes.

## §7. Custom Commercial Terms
__________________________________________________________
__________________________________________________________

## §8. Governing Law & Forum (overrides TOS-001 §10 only as between NEXPEC and Customer)
- **Governing law:** Quebec (default) / Delaware / England & Wales / Singapore / DIFC / other: ______.
- **Forum:** Exclusive courts of [city, state/country]: ______; OR Arbitration [JAMS / AAA / LCIA / ICC / DIFC-LCIA / ADGM / SCCA] seated in [city, country] ______, conducted in [language], before [one / three] arbitrator(s).
- **Mandatory 30-day mediation step under TOS-001 §10:** applies / waived for Customer's commercial disputes only.
- **No part of this §8 prejudices the local mandatory rights of the Customer's individual end-users.**

## §9. Signatures
**Customer:** Name __________ Title __________ Signature __________ Date __________
**NEXPEC Technologies:** Name __________ Title __________ Signature __________ Date __________

## Schedules
- **Schedule A —** Data Processing Addendum (DPA-001 v1.0)
- **Schedule B —** Current Subprocessor List (link: nexpec.com/legal/subprocessors)
- **Schedule C —** Security Measures (TOMs) (link: nexpec.com/legal/security)
- **Schedule D —** White-Label / Co-Brand Specification *(if §6 applies)*

— End of ORDER-FORM-001 v1.0 (Template) —`,
};
