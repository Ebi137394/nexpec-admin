# NEXPEC — Professional Vendor Onboarding & Certification Suite
### Master-plan: bridging "simple mobile bidding" → "high-end industrial contract management"

---

## 0. The thesis

Industrial procurement doesn't run on text fields. It runs on **stamped, signed, dated paper** — ISO 17025 lab accreditations, ASME stamps, insurance certificates, NDA/MSA agreements, technical proposals on letterhead, vendor data books (VDRL). The company that wins this market is the one that lets a vendor keep working exactly the way they already do — *upload the official PDF* — while silently turning that PDF into a **cryptographically sealed, Bitcoin-notarized, machine-readable source-of-truth** bound to the right RFQ, contract, and identity.

NEXPEC is uniquely positioned because the expensive part already exists. We have a **Trust Spine** (`pi_canonical_json` + SHA-256 `pi_seal`, folded `doc_root`, and two-phase OpenTimestamps → `bitcoin_confirmed`). We have a `verification` jsonb on `supplier_profiles` annotated *"sealable cert evidence."* We have a PDF generator, a signature capture field, and a document-intelligence layer (`report_templates`, `doc_validations`, the in-house GPU worker). 

**The Suite is the assembly of these organs into one lifecycle.** No new trust infrastructure. No new screens. No added vendor friction.

---

## 1. Document Custody — making an external signed PDF the source of truth

The core abstraction is a **Document Custody Spine**: every official artifact a vendor uploads becomes an immutable, tamper-evident, timestamped object that other entities *point at* but never mutate. The original bytes are the legal artifact; everything else is a projection.

A document moves through six stages. Critically, only the first is synchronous — the vendor's phone never waits for the rest.

**1) Ingest (instant).** The raw file lands in a private, RLS-scoped Storage bucket (`vendor_documents`, mirroring the existing `certifications` / `compliance_documents` buckets). We never re-encode or "optimize" it — a stamped PDF must remain byte-identical to stay legally defensible. The upload returns immediately and enqueues the rest through the existing offline-outbox pattern.

**2) Seal (background).** Compute SHA-256 over the raw file bytes — the document **fingerprint**. Wrap it in canonical JSON metadata (`vendor_id`, `doc_type`, `filename`, `byte_size`, `sha256`, `issued_at`, and the entity it's bound to) and run it through `pi_seal`, folding the document hash into the same `doc_root` mechanism shipped in `seal_v4_doc_root_and_pack`. Any single byte changing downstream → different hash → broken seal. The PDF is now tamper-evident.

**3) Notarize (background, two-phase).** Submit the SHA-256 to OpenTimestamps using the exact two-phase flow already in `ots_confirmation`: anchor submits `pending`, a later pass upgrades to `bitcoin_confirmed`. This yields **independent, third-party proof the document existed and was unaltered as of time T** — the single most valuable property in a contract dispute, and something no competitor's "upload to S3" can claim. The UI shows the same status ladder we already use: `Sealing → Sealed → Notarized (pending → ✓ Bitcoin-anchored)`.

**4) Extract (background, in-house GPU — $0 API).** Route the PDF through the document-intelligence worker (`ai-analysis-worker`, OCR + field extraction on the in-house GPU, honoring the $0-recurring-cost constraint). Pull structured fields: issuing body, certificate number, **expiry date**, scope, accreditation standard, signatory. These populate `supplier_profiles.attributes` (`standards[]`, `certs[]`) and a `doc_validations` row **automatically** — the vendor uploads a certificate, NEXPEC reads it. Extraction is a *projection*; the PDF stays source-of-truth, and every extracted field links back to the sealed object so a reviewer can one-tap from "ISO 17025 ✓" to the actual stamped page.

**5) Verify & Certify.** Admin (or rule-based auto-approval for known issuers) confirms the extraction against the sealed image. On approval we stamp `supplier_profiles.verification.verified_at` (the field the schema was built for) and mint a **TrustSigil** — the same anonymized trust marker used on public surfaces. Expiry dates drive a **scheduled re-certification engine**: a recurring task flips a cert to `expiring_soon` / `expired` and notifies the vendor, so the Approved Vendor List never silently rots.

**6) Bind.** A sealed document attaches to one or more entities, and the binding is *inside* the canonical JSON so the seal covers **what the document is and what it's attached to**:
- to the **Vendor profile** → qualification dossier (ISO, accreditation, insurance, financials, signed NDA/MSA)
- to a **Quote** → the stamped technical proposal / priced offer (inherits quote RLS — price-blind, supplier-vs-supplier isolated)
- to a **Contract** → the executed agreement (see §4)
- to a **Job** (the auto-spawned source/FAT inspection) → vendor data book / mill certs for the inspector to verify on-site

This is the bridge made concrete: the vendor taps "upload" on a phone (simple mobile bidding), and behind that tap the artifact is hashed, sealed, Bitcoin-timestamped, OCR'd, and contractually bound (high-end industrial contract management).

---

## 2. Terminology — "Vendor" as the unified surface, `supplier_*` as the frozen data token

Today the codebase says `supplier_*` everywhere (`supplier_profiles`, `supplier_rfqs`, `supplier_quotes`, role `supplier`) while the business instinct reaches for "Vendor." Resolve it with one architectural rule: **decouple the display label from the data token.**

**Recommendation: unify the UI on "Vendor."** It carries the correct industrial pedigree — the **Approved Vendor List (AVL)**, **Vendor Qualification**, **Vendor Document Requirements List (VDRL)** are the literal industry terms for the suite we're building, and "Vendor" is the broader umbrella that correctly spans labs, calibration houses, material testing, equipment, logistics, and training (where "Supplier" skews toward goods only). The capability taxonomy you already seeded (`supplier_capability_catalog`: NDT Lab, Calibration Lab, Material Testing…) becomes the **sub-type** under the single "Vendor" noun.

**Implementation rule (the "architect" move): never let a cosmetic noun trigger a schema migration.** The DB tokens `supplier_*` and role `supplier` are frozen, internal, and never user-visible. The UI renders a single i18n constant — `t('vendor')` — everywhere a human reads it (onboarding, directory, certification, contracts). One source of truth for the label; zero churn to tables, RLS, RPCs, or seals. If you ever rebrand again, it's a one-key change, not a 200-file rename.

(If you prefer "Supplier" for brand reasons, the same pattern applies — the point is *one* canonical UI noun + capability sub-types, decoupled from the data layer.)

---

## 3. Enterprise-grade *and* fast — the five principles

Enterprise document management is usually slow because it makes the user wait for processing. NEXPEC inverts that.

**Async, non-blocking by default.** Upload = store bytes + enqueue, then return. Sealing, notarization, and OCR run in background workers (offline-outbox + `ai-analysis-worker`). The vendor sees optimistic status chips climb the trust ladder; they never block on the highest tier. This is the same two-phase discipline that makes OTS feel instant.

**Progressive trust.** A document is *usable the moment it's uploaded* and *gains* trust over seconds-to-hours: `Uploaded → Sealed → Notarized → Verified → AVL-Approved`. Bidding isn't gated on Bitcoin confirmation; qualification *level* is. High assurance without a turnstile.

**Zero-UI substrate.** Documents render through generic, reused components — a new `DocumentField` for `DynamicForm` (upload / preview / sign, alongside the existing `SignatureField`), a sealed-document **card** in the generic lists, and the status **chip** primitive. No bespoke screens, consistent with the discipline that shipped the whole Marketplace without a custom layout.

**Edge for verification, in-house GPU for intelligence.** Seal/signature verification is pure and cheap → an edge function (the existing seal-verifier pattern). OCR/extraction is heavy → the in-house GPU with teacher/student distillation, preserving the $0-API rule. Verification can even run client-side for instant "✓ seal intact" feedback.

**Idempotency & dedup via the hash.** The SHA-256 *is* the natural idempotency key (same discipline as the outbox client-id). Re-uploading an identical file dedupes to the same sealed object; a "new version" is a new hash linked to the prior one, giving you a full **document version chain** for free.

---

## 4. The Co-Execution chain — where bidding becomes contract management

Two lanes converge on the same sealed custody, covering both directions of real-world paperwork:

**Vendor-originated (upload + seal).** The vendor's document already carries their wet stamp/signature (a proposal on letterhead, an ISO cert). We do **not** re-sign it — we seal + notarize it as-is. Their stamp is the authority; our seal proves it hasn't changed since they gave it to us.

**NEXPEC-originated (generate + sign in-app).** For agreements NEXPEC produces (`generate-contract` via pdf-lib; WPS/ITP via `tool-document`), we capture an in-app signature (`SignatureField` → expo-crypto), embed it into the PDF, and seal the result.

The bridge to high-end contract management is the **execution manifest**: a contract generated by NEXPEC → vendor signs (draws in-app *or* uploads a counter-signed copy) → client/admin counter-signs → the final PDF carries a signature manifest (who signed, role, timestamp, and the document hash *at each stage*), the whole chain OTS-anchored. The result is a fully provable, append-only **co-execution record** — admin-brokered, price-blind, and siloed exactly like the rest of the platform. That is enterprise contract lifecycle management, expressed entirely in primitives you already shipped.

---

## 5. Data architecture (reuse-first)

Net-new is deliberately tiny:

- **`vendor_documents`** — the custody table: `id`, `vendor_id`, `doc_type` (enum: `iso_cert | accreditation | insurance | financial | nda | msa | technical_proposal | mill_cert | other`), `storage_path`, `sha256`, `seal_id` (→ Trust Spine), `ots_status`, `extracted` jsonb, `expires_at`, `status`, `superseded_by` (version chain), plus a polymorphic binding (`bound_type`, `bound_id` → vendor/quote/contract/job).
- **`supplier_profiles.verification`** — *already exists*, already "sealable cert evidence." It becomes the qualification summary (which doc_types are verified + current).
- **Reuse** `pi_seal` / `doc_root`, `ots_confirmation`, `doc_validations`, the storage-RLS pattern, and the offline-outbox.

Governance lives in RLS that *inherits* the binding's visibility: a vendor sees only their own documents; a client sees documents bound to quotes on their own RFQ (price-blind, never competitor docs); admin (god-mode) brokers all. **Anti-poaching golden rule preserved**: custody is private; only the *TrustSigil* + verified badge are ever public — no PII, no letterhead, no signatory leaks to anonymized surfaces.

---

## 6. Build order (phased, shippable in slices)

1. **Custody core** — `vendor_documents` + `DocumentField` + ingest→seal→notarize pipeline (reuses Trust Spine + OTS). Vendors can upload & seal qualification docs; status ladder visible.
2. **Qualification dossier (AVL)** — doc-type matrix on the vendor profile, `verification.verified_at` stamping, TrustSigil, admin review queue card.
3. **Intelligence** — in-house OCR auto-extraction → `doc_validations` + auto-populate `attributes`; one-tap from field to sealed page.
4. **Expiry engine** — scheduled re-certification reminders; `expiring_soon`/`expired` lifecycle.
5. **Co-execution** — bind documents to quotes/contracts; signature manifest + OTS-anchored execution chain.
6. **Terminology unification** — single `t('vendor')` label sweep (UI only; tokens frozen).

---

## 7. Why this wins

A competitor stores a PDF in a bucket. NEXPEC takes the same one-tap upload and returns a **Bitcoin-notarized, tamper-evident, machine-read, contractually-bound** artifact — qualification that's provable to an auditor years later, on infrastructure that costs $0 in recurring API fees because the trust spine and the GPU are already ours. The vendor's experience stays "mobile-simple." The platform's guarantee becomes "industrial-grade." That gap *is* the moat.
