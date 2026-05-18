// ════════════════════════════════════════════════════════════════════════════
//  src/features/compliance/agreements/strict_liability_v1.ts
//
//  CCI Strict-Liability Agreement — Version 1.0.
//
//  The text below is the canonical English agreement that every
//  Compliance-Certified Inspector must accept before their application
//  proceeds to admin review. Treat this file as a versioned legal
//  document: do NOT edit the text in place after release — instead,
//  create `strict_liability_v2.ts` with a new VERSION constant, then
//  add it to the resolver in `src/features/compliance/lib/signature.ts`.
//
//  How signatures bind to text:
//    1. `AGREEMENT_TEXT` is the exact UTF-8 string the inspector sees.
//    2. `AGREEMENT_TEXT_SHA256` is the sha256 hex of that string.
//    3. The signature payload (see `signature.ts`) embeds VERSION +
//       AGREEMENT_TEXT_SHA256, so the bound text is provable forever.
//    4. The platform stores `strict_liability_agreement_version` on
//       `inspector_credentials` so old signatures can always be
//       resolved back to the exact text they covered.
// ════════════════════════════════════════════════════════════════════════════

export const VERSION = '1.0' as const;

// ─────────────────────────────────────────────────────────────
//  Consent checkboxes — each is part of the signature payload.
//  Adding/removing keys is a BREAKING CHANGE that requires a new
//  agreement version. Wording can be tightened only if the new
//  wording is logically narrower than the old one.
// ─────────────────────────────────────────────────────────────
export const CONSENTS = [
  {
    key: 'truthful_capture',
    label:
      'I will personally inspect every site I am dispatched to and capture all evidence with my own device, without staging, alteration, or substitution.',
  },
  {
    key: 'personal_liability',
    label:
      'I accept personal civil and, where applicable, criminal liability for any material misrepresentation, falsified evidence, or fraudulent statement in any inspection I sign.',
  },
  {
    key: 'indemnification',
    label:
      'I will indemnify and hold harmless NEXPEC, its affiliates, and every commissioning buyer from any claim, loss, fine, or damages arising from my breach of this agreement.',
  },
  {
    key: 'third_party_verification',
    label:
      'I authorize NEXPEC to verify my identity, my credentials, and my professional history with government registries, prior employers, and accredited training bodies.',
  },
  {
    key: 'evidence_use',
    label:
      'I understand that my captures may be presented in regulatory, civil, or criminal proceedings, and I waive any objection to their use for those purposes.',
  },
  {
    key: 'confidentiality',
    label:
      'I will keep confidential all non-public information I learn about any subject entity in the course of an inspection, except where disclosure is compelled by law.',
  },
] as const;

export type ConsentKey = typeof CONSENTS[number]['key'];

// ─────────────────────────────────────────────────────────────
//  Full agreement text. UTF-8, line-terminated by \n. Do NOT
//  reformat after release — the sha256 below is content-bound
//  and any whitespace change invalidates all prior signatures.
// ─────────────────────────────────────────────────────────────
export const AGREEMENT_TEXT = `NEXPEC COMPLIANCE-CERTIFIED INSPECTOR (CCI) STRICT-LIABILITY AGREEMENT
Version 1.0

This Strict-Liability Agreement ("Agreement") governs your participation as a Compliance-Certified Inspector ("CCI") on the NEXPEC platform. By signing this Agreement you are entering into a binding legal commitment. Read it carefully before accepting. If you do not accept any provision, do not sign — your application will not proceed.

1. THE ROLE
A CCI is engaged to physically attend a subject site, perform a defined inspection scope, and capture verifiable evidence that supports a Verified Compliance Affidavit ("VCA"). VCAs are relied upon by commercial buyers, regulators, and other third parties to make material decisions. The integrity of every VCA depends on the integrity of the underlying captures, which depends on the integrity of you, the inspector.

2. STANDARD OF CONDUCT
You undertake to conduct each inspection in good faith, with diligence, and to the standard of a reasonable professional in your field. You will:
  (a) attend every site personally and capture every piece of evidence with your own device, in real time, at the site;
  (b) follow the scope template's evidence checklist exactly as defined by NEXPEC, without omission or substitution;
  (c) record GPS, timestamp, and device metadata as captured by the NEXPEC mobile application, without tampering;
  (d) refuse to inspect any site where you have a conflict of interest, financial relationship, or family relationship with the subject entity, and disclose any such circumstance to NEXPEC immediately.

3. STRICT LIABILITY FOR MATERIAL FALSEHOODS
You accept strict personal liability for any material misrepresentation, falsified evidence, fabricated capture, staged photograph, post-hoc edit, or false statement of fact in any VCA you sign. "Strict liability" means liability without proof of intent — if the misrepresentation is material and you signed the affidavit, you are liable, regardless of whether you knew or should have known. This standard applies because buyers and regulators rely on VCAs in ways that cannot tolerate ordinary-negligence-grade error.

4. INDEMNIFICATION
You will indemnify, defend, and hold harmless NEXPEC, its affiliates, officers, employees, agents, and every commissioning buyer of an inspection you signed, from and against any and all claims, demands, losses, costs, damages, fines, penalties, and reasonable legal fees arising out of:
  (a) any breach of this Agreement by you;
  (b) any material misrepresentation, omission, or fraudulent statement in any VCA you signed; or
  (c) any tortious or unlawful conduct by you in connection with an inspection.

5. VERIFICATION AND BACKGROUND CHECKS
You authorize NEXPEC to verify your identity, your professional credentials, your employment history, and your standing with any relevant licensing or accreditation body, in any jurisdiction, at any time during the term of this Agreement and for a period of seven (7) years after termination. You will cooperate promptly and in good faith with any reasonable verification request.

6. EVIDENCE USE
All captures, documents, and statements you submit through NEXPEC may be:
  (a) included in the VCA delivered to the commissioning buyer;
  (b) presented in any civil, regulatory, or criminal proceeding involving the subject entity or you; and
  (c) retained by NEXPEC for the period required by law or by NEXPEC's data-retention policy, whichever is longer.
You waive any objection to the use of your captures for those purposes, provided that NEXPEC's use complies with applicable privacy and data-protection law.

7. CONFIDENTIALITY
You will keep confidential all non-public information you learn about a subject entity in the course of an inspection. You will not disclose, publish, sell, or otherwise use that information except (i) as required to complete the inspection, (ii) in response to a lawful order from a competent authority, or (iii) with the subject entity's prior written consent.

8. INDEPENDENT CONTRACTOR
You are an independent contractor, not an employee, partner, joint venturer, or agent of NEXPEC. Nothing in this Agreement creates an employment relationship. You are responsible for your own taxes, insurance, and regulatory compliance.

9. SUSPENSION AND TERMINATION
NEXPEC may suspend or terminate your CCI credential at any time, with or without cause, on written notice. Specific cause includes, but is not limited to: (a) any breach of this Agreement; (b) any conduct that NEXPEC, in its reasonable judgment, considers to compromise the integrity of the platform; (c) any criminal indictment for an offence involving dishonesty, fraud, or violence; or (d) the lapse, suspension, or revocation of any government-issued licence on which your CCI tier depends. Suspension or termination does not relieve you of any obligation incurred before the effective date.

10. INSURANCE
You represent that you carry, or will carry within thirty (30) days of approval, professional indemnity insurance adequate to your CCI tier, with a single-claim limit of not less than the equivalent of US$250,000 for CCI Basic, US$500,000 for CCI Advanced, and US$1,000,000 for CCI Lead. NEXPEC may require proof of coverage at any time.

11. GOVERNING LAW
This Agreement is governed by the laws of the jurisdiction specified in NEXPEC's terms of service in force at the time of signature. Any dispute arising out of or in connection with this Agreement that cannot be resolved by negotiation will be submitted to binding arbitration under the rules referenced in those terms of service.

12. SEVERABILITY
If any provision of this Agreement is held to be invalid, illegal, or unenforceable, the remaining provisions will continue in full force and effect, and the invalid provision will be deemed modified to the minimum extent necessary to make it valid and enforceable.

13. ENTIRE AGREEMENT
This Agreement, together with NEXPEC's terms of service and any tier-specific addenda, constitutes the entire agreement between you and NEXPEC concerning your CCI role. It supersedes any prior or contemporaneous understanding, written or oral.

14. ACKNOWLEDGEMENT
By signing below — by ticking each consent checkbox, typing your full legal name, and submitting your application — you acknowledge that you have read this Agreement in its entirety, that you understand its terms, and that you intend to be legally bound by it. The platform records your typed name, the agreement version, the cryptographic hash of the agreement text, your IP, your device, and the timestamp of signature; these records, together with the entire signature payload, will be used as proof of your assent.

— end of agreement —
`;

// ─────────────────────────────────────────────────────────────
//  Content hash. Computed at module load time from the canonical
//  UTF-8 bytes of AGREEMENT_TEXT. This is the hash that gets
//  embedded in the signature payload so the bound text is
//  cryptographically anchored to the signature forever.
//
//  NOTE: we cannot compute sha256 synchronously in React Native
//  without a heavy hashing lib. So we *do not* hash here. Instead,
//  the signature helper computes it lazily on first use, caches
//  it in memory, and the cached value is what enters the payload.
//  See `signature.ts > getAgreementTextSha256(VERSION)`.
// ─────────────────────────────────────────────────────────────

export const AGREEMENT_DOCUMENT = {
  version: VERSION,
  text: AGREEMENT_TEXT,
  consents: CONSENTS,
} as const;
