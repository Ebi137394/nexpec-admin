# Phase 4 (expanded) — Unified Inspection Intelligence: Visual **and** Document

**Status: masterplan (architecture).** Expands `PHASE_4_MASTERPLAN.md` from "visual captures only" to a single pipeline that also ingests, understands, and **trust-binds uploaded documents** — the inspector's offline-written report (PDF / Word / text) and the client's custom template/sample it must conform to. Still **$0 recurring API · in-house GPU · self-hosted models**. Code follows after the recon checklist at the foot.

---

## 1. The problem

Real inspections are document-heavy. A client hands over a **custom template / standard / sample report**; the inspector writes a comprehensive report **offline** (PDF/Word/structured text) in that format and uploads it. If the AI only sees photos, it's blind to the actual findings — forcing an admin to manually parse, verify, and extract every report. That is the exact manual bottleneck the trust spine is supposed to eliminate. Document intelligence has to be **autonomous** (no per-report admin step) and **provable** (the verdict lives inside the seal).

## 2. Core principle — one pipeline, two modalities, one trust-binding

Don't build a second AI system. **Generalize Phase 4's pipeline** from "captures" to "artifacts":

```
        ┌─ visual_capture (inspection_captures)  ─► TFLite defect detection
artifact ┤
        └─ document (inspection_reports / client_documents) ─► doc intelligence
                                                              │
                                                              ├─ embedded images ──► (back into) visual detection
                                                              └─ text + structure ─► extraction · NLP · conformance
        ▼ (both modalities converge)
  idempotent record  (pi_record_ai_detection │ pi_record_doc_validation)
        ▼
  assemble_evidence_pack  ── NEW 'document_intelligence' artifact group
        ▼
  pi_report_seals.root  ── the EvidencePackVerifier already hashes manifest.artifacts
                           GENERICALLY, so a new group binds into the seal with ZERO
                           verifier changes. ← the key enabler.
```

The same queue, the same in-house worker, the same **signed-model + canonical-hash + idempotent-write** discipline as the visual plan — extended with a `kind`.

## 3. The $0, in-house document stack (all self-hosted, all signed)

Every model/tool is registered in `ml_model_registry`, **Ed25519-signed**, and verified before load with the *same `@noble` verifier the device uses* (lifted into `shared-core/ml`). No paid API anywhere.

| Stage | In-house tool ($0) | Output |
|---|---|---|
| PDF parse (text+layout+images) | PyMuPDF / pdfminer | text blocks, coordinates, embedded images |
| Word parse | python-docx / mammoth | text, headings, tables |
| Scanned/raster OCR | Tesseract | text from image-only PDFs/scans |
| Embedded images | → **reuse the visual TFLite pipeline** | defect detections on photos inside the report |
| Semantic embeddings | local sentence-transformer (bge/e5/gte-small) | vectors for section matching, similarity, plagiarism |
| Structured extraction + reasoning | **self-hosted small/distilled LLM** (teacher/student) via vLLM/llama.cpp, **grammar-/JSON-schema-constrained decoding** | the report's content mapped into the template's schema, deterministically shaped |

The constrained-decoding detail matters: the LLM must emit **schema-valid JSON** (not prose), so the output is canonicalizable and hashable — bindable into the seal, not a vibe.

## 4. Template intelligence — "define the rubric once, validate forever"

The scalability answer is human-in-the-loop **once per template**, autonomous **per report**.

**4a. Two rubric sources, unified:**
- **Existing structured rubric** — the platform already has `inspection_scope_templates` + `inspection_evidence_requirements` (compliance mode). For compliance jobs, that IS the machine-readable rubric; document validation cross-checks against it directly.
- **Client custom template/sample (NEW)** — when a client uploads their own format (to the vault / `client_documents`), we ingest it into a structured **template spec** (sections, required fields + types/units, mandatory clauses, table shapes, signature/letterhead expectations). The spec is **auto-derived** by the extraction+LLM stack, then **client/admin-confirmed and locked** (a one-time review). Once locked, it's hashed (`spec_sha256`) and every inspector report for that client/job is judged against it with no further human step.

**4b. New `report_templates` table:** `(id, org_id/client_id, source_document_id → client_documents, name, template_spec jsonb, spec_sha256, is_locked, created_by, created_at)`. A job references `report_template_id` (or inherits the client's default). No custom template → fall back to the scope-template's `evidence_requirements`, or a generic completeness rubric for quality jobs.

## 5. The validation engine (per uploaded report, autonomous)

1. **Extract** text + structure + embedded images (stack above).
2. **Route embedded images** into the visual detection pipeline (unified).
3. **Structured extraction** — LLM fills the locked template spec from the report (schema-constrained → JSON).
4. **Conformance checks:**
   - *Completeness* — every required section/field present?
   - *Structural* — required sections/order/tables match the template?
   - *Semantic* — units/ranges/internal consistency (e.g., result=PASS but findings list critical defects → contradiction).
   - *Evidence cross-check* — does the report agree with the **actual captured evidence**? e.g., report claims "12 welds inspected" but only 7 `inspection_captures` exist, or claims coverage a required `inspection_evidence_requirement` has no capture for → flag. This is the unique value: the document is checked against the cryptographic capture chain, not in isolation.
   - *Authenticity / plagiarism* — embedding similarity vs the client's own sample (don't just resubmit the template) and vs the inspector's prior reports (copy-paste detection).
5. **Verdict** — a structured result: `{conformance_score, missing[], inconsistencies[], evidence_gaps[], similarity_flags[], confidence}`. **Advisory** — below threshold or low confidence ⇒ `flagged_for_review` into an admin queue; it accelerates/► trust, it does **not** auto-reject the inspector's pay (gating is a separate policy decision).

## 6. Trust binding (the crux — document-level provenance)

Hash everything and fold it into the seal so a regulator re-derives the whole chain offline:
- `report_file_sha256` (the uploaded PDF/Word — already the pattern on `bridge_documents`/reports)
- `extracted_sha256` (canonical JSON of the extraction)
- `template_sha256` (`report_templates.spec_sha256` — the exact rubric used)
- `result_sha256` (canonical verdict)
- model identity (`model_id` + signed-model digest) — **server-enforced model→validation binding**, mirroring `20260715`.

Recorded via a new idempotent RPC `pi_record_doc_validation(report_id, template_id, model_id, verdict, extracted_sha256, template_sha256, result_sha256, client_op_id)` (sibling of `pi_record_ai_detection`; `client_op_id = sha256(report_id|template_id|model_version)`). Then `assemble_evidence_pack` gains a `document_intelligence` artifact group (alongside `inspection_seals` / `vendor_coordination` / `ai_detections`); because the EvidencePackVerifier hashes `manifest.artifacts` generically, the verdict **enters the sealed root with no verifier change**. Net claim a regulator can verify: *"inspector uploaded report R (hash), validated against client template T (hash) by signed model M (digest), producing verdict V — and V is inside the Bitcoin-anchored seal."*

## 7. Unified queue + worker (extends Phase 4)

- `ai_analysis_queue(kind 'visual_capture'|'document', subject_id, model_kind, status, attempts, client_op_id)` — UNIQUE `(kind, subject_id, model_kind)` for idempotent enqueue. Triggers: `AFTER INSERT ON inspection_captures` (visual) and `ON inspection_reports` / report-document upload (document).
- The in-house worker drains with `FOR UPDATE SKIP LOCKED` (proven claim-ledger pattern), **routes by `kind`**, runs the right stack, verifies the signed model, records idempotently, binds. Failures park after N attempts → admin "AI review" queue (advisory, never blocks the inspection).

## 8. Security (untrusted files are an attack surface)

Uploaded PDFs/Office files are **hostile by default** (parser RCE, zip bombs, macro payloads). So: parse in a **sandboxed, network-isolated, resource-capped** worker (the in-house box), strict size/page/timeout limits, no macro execution, treat every byte as adversarial. Plus the existing disciplines: model signature verify before load; RLS-scoped storage; and **anti-poaching** — document *content* never touches public surfaces, only **hashes** are exposed on the verifiable passport (consistent with the pseudonymous-by-construction rule). PII inside reports stays under the report's RLS.

## 9. Data-model additions (Phase 4.2 build)
- `report_templates` (client custom rubric + locked `template_spec` + `spec_sha256`).
- `doc_validations` (sibling of `ai_detections`: report_id, template_id, model_id, verdict, *_sha256, conformance_score, flagged_for_review).
- `ai_analysis_queue` (unify visual + document) + `claim/complete/release` RPCs.
- `pi_record_doc_validation(...)` idempotent RPC + server-enforced model→validation binding.
- `assemble_evidence_pack` → add `document_intelligence` artifact group + `doc_root_sha256`/`doc_count` on the seal artifact (mirrors the ai_detections addition).
- `packages/shared-core/src/ml/` → extend with doc-model digest/verify + the template-spec + verdict zod schemas (shared device/server/worker).

## 10. Recon checklist (before code)
- Exact columns: `inspection_reports` (final_report_doc / signed_docs_url / attachments), `inspection_scope_templates` + `inspection_evidence_requirements`, `client_documents`.
- `assemble_evidence_pack` body + the seal-root derivation (where `ai_root_sha256` is folded) — to add `doc_root` identically.
- `packages/shared-core/src/ml/types.ts` (extend, don't duplicate) + `verifier.noble.ts`.
- Report-upload buckets (`inspection-reports` / `documents` / `job-documents`) + their RLS, for the worker's signed-URL download path.

## 11. Constraints honored
$0 recurring (PyMuPDF/Tesseract/sentence-transformers/self-hosted LLM on the in-house GPU); autonomous after a one-time template lock; every model signed + verified; idempotent at queue + write; **document validation cross-checked against the cryptographic capture chain**, not in a vacuum; verdict sealed + Bitcoin-anchored + regulator-re-derivable; untrusted parsing sandboxed; zero document content on public surfaces.
