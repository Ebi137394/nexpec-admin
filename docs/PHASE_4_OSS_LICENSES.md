# Phase 4 — $0 / Open-Source License Attestation

The mandate: the entire AI pipeline is **strictly $0 recurring** and **commercially safe**. "$0 to run" is necessary but **not sufficient** — some free tools are copyleft/restricted and hostile to a proprietary SaaS. This pins the stack to **permissive licenses only (MIT / Apache-2.0 / BSD)** and is enforced by a CI guard (`.github/workflows/security-guards.yml` → "no paid AI/cloud SDKs in the worker/edge").

## Approved stack (permissive, self-hosted, $0)

| Stage | Tool | License | Verdict |
|---|---|---|---|
| Visual inference | onnxruntime | MIT | ✅ |
| Visual (on-device) | TFLite / react-native-fast-tflite | Apache-2.0 / MIT | ✅ |
| PDF text + layout | **pdfminer.six** | MIT | ✅ |
| PDF (alt) | pypdf | BSD-3-Clause | ✅ |
| PDF tables | pdfplumber | MIT | ✅ |
| Word (.docx) | mammoth | BSD-2-Clause | ✅ |
| Word (.docx, alt) | python-docx | MIT | ✅ |
| OCR | Tesseract (+ pytesseract) | Apache-2.0 | ✅ |
| Embeddings runtime | sentence-transformers | Apache-2.0 | ✅ |
| Embedding model | bge-small-en / e5-small | MIT | ✅ |
| Embedding model (alt) | gte-small | Apache-2.0 | ✅ |
| LLM serving | llama.cpp / vLLM | MIT / Apache-2.0 | ✅ |
| LLM weights | Qwen2.5 / Mistral-(Apache) / Phi | Apache-2.0 / MIT | ✅ |
| Constrained decoding | outlines / llama.cpp GBNF | Apache-2.0 / MIT | ✅ |
| Crypto (verify) | node:crypto / @noble/ed25519 | core / MIT | ✅ |

## Explicitly REJECTED (free to run, but license-hostile to a commercial SaaS)

| Tool | License | Why rejected |
|---|---|---|
| **PyMuPDF / MuPDF** | **AGPL-3.0** | Copyleft + network-use clause → can force source disclosure for a SaaS. Use pdfminer.six (MIT) / pypdf (BSD) instead. |
| **Llama 3.x weights** | Llama Community License | Not OSI; usage restrictions + >700M-MAU clause. Not "license-free." Use Apache-2.0/MIT weights. |
| Tesseract `tessdata_best` (some traineddata) | mixed | Use the Apache-2.0 `tessdata`/`tessdata_fast` sets. |
| Any hosted API (OpenAI / Anthropic / Google / AWS Textract / Azure / Cohere / Replicate / HF Inference) | — | Recurring cost AND data egress. Banned by the CI `$0` guard. |

## Enforcement
- **CI guard** fails the build if any paid-AI/cloud SDK string appears under `scripts/worker/` or `supabase/functions/`.
- **`model_artifacts.license`** column already exists (20260704, commented "must be Apache-2.0 / MIT / BSD for distributables") — register every model with its license; reject non-permissive at publish time.
- The registry's **teacher/student guard** keeps the crown-jewel teacher un-distributed; only signed, permissively-licensed **student** artifacts are ever published/run.

**Net:** every model, parser, OCR, embedding, and LLM in the pipeline is OSI-permissive, self-hosted on the in-house GPU, and metered nowhere. $0 recurring, with absolute certainty.
