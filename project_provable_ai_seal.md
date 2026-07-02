---
name: project-provable-ai-seal
description: Provable-AI masterstroke shipped — pi_seal v3 folds accepted AI detections into the seal root; verifier checks pack-manifest integrity (not PIE root)
metadata: 
  node_type: memory
  type: project
  originSessionId: 49b95114-7fa8-48bb-91e6-6eeb9c30c3df
---

The "Provable AI" binding shipped 2026-05-29 (migrations `20260708120000_provable_ai_seal_binding.sql` + `20260709120000_evidence_pack_ai_detections.sql`).

- `pi_seal_inspection_report` is now **algorithm `sha256/canonical-json/v3`**: a 5th root component `ai_root` (hash chain over HUMAN-ACCEPTED ai_detections, each bound to model slug+version+sha256) folded into the existing sorted root `sha256(sort([captures_root, items_root, report_meta, vendor_root, ai_root]) joined by '|')`. Added nullable columns `pi_report_seals.ai_root_sha256` + `ai_count`. Seal versions in the wild: v1 (3-comp), v2 (+vendor), v3 (+ai). Tamper with an accepted detection post-seal → ai_root → root mismatch.
- `assemble_evidence_pack` now emits a 10th artifact group `ai_detections` and surfaces `ai_root_sha256`/`ai_count` on the `inspection_seals` artifact.

KEY ARCHITECTURE FACT (non-obvious): the public web verifier **`EvidencePackVerifier`** verifies the **evidence-pack MANIFEST integrity** — per-artifact `sha256OfCanonical(artifact)` + root = `sha256OfCanonical(manifest.artifacts)` — it does **NOT** re-derive the PIE seal's `root_sha256` from its components. So changing pi_seal's root formula does **not** break `/verify`. The exporter `apps/web/src/lib/actions/evidenceLocker.ts` builds the manifest from a HARDCODED `ARTIFACT_NAMES` list — updated 2026-05-29 to append `inspection_seals`, `vendor_coordination`, `ai_detections` (older 7-entry packs still verify since the verifier uses the file's own manifest).
- Added (2026-05-29) an independent "PROVABLE-AI · SEAL ROOT RE-DERIVATION" panel to EvidencePackVerifier: recomputes each seal's root from its component hashes + the pack's vendor docs (avoids the numeric-confidence canonicalization landmine by using the stored ai_root, not recomputing it). It's informational — a match shows green; a mismatch degrades to neutral and NEVER flips the manifest VERIFIED/TAMPERED verdict. Web tsc not run in-sandbox; confirm via `pnpm typecheck`. See [[project-ai-strategy]].
