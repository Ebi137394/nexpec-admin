# NEXPEC AI Co-Inspector — Corrosion Detector Blueprint

### The first real on-device "student" model, built on the Phase A.5 runtime

**Date:** 2026-05-29 · **Status:** Architecture scope (no app code changed yet) · **Author:** Lead Architect

---

## 0. Thesis

The corrosion detector is the proof that the Phase A.5 trust-spine pays off: a real, useful vision model that runs **100% on the inspector's device**, costs **$0 per inference**, is **cryptographically signed** and verified before it loads, and feeds the **human-sealed evidence chain** rather than bypassing it. It is *assistive* — it drafts; the inspector confirms and seals. That single design choice is simultaneously our liability shield, our auditability story, and our data flywheel.

Three laws restated for this feature:
- **$0 API:** inference is local (Skia + TFLite/ONNX). The photo never leaves the device *for inference* (it already goes to Supabase Storage as part of the inspection). No metered third party, ever.
- **Pure on-device:** the model is a distilled, quantized **student**; the full **teacher** stays on the in-house GPU and never ships.
- **Zero UI/UX breakage:** every new surface is additive, behind `ML_RUNTIME_ENABLED` + a per-feature flag, and self-hides when the model/dev-build/device-tier isn't available. The existing capture → submit → seal flow is untouched.

---

## 1. Where it plugs into what we already have

| Existing primitive | Role for corrosion |
|---|---|
| `ModelKind = 'vision_defect'` (shared-core/ml/types) | The registry kind for this model |
| `model_artifacts` registry + `ml_resolve_models` RPC | Resolves `slug='corrosion-detector'` for the device |
| Runtime `getModelRuntime()` + `useModel('vision_defect', { slug })` | Resolve → signed-URL download → SHA-256 → **Ed25519 verify** → cache → load |
| `InferenceBackend` (src/core/ml/backends) | The one missing piece — a **vision backend** to register (currently Noop) |
| `register-model.mjs` (signed publish) | Publishes the student, signed with your Ed25519 key |
| `inspection_captures` (per-photo SHA-256 chain, EXIF/GPS) | The image the model analyzes; already part of the sealed chain |
| `inspection_items` (structured findings) | Where a *human-confirmed* AI suggestion lands |
| `pi_seal_inspection_report` + `assemble_evidence_pack` | The seal that binds human-confirmed findings → provable, AI-assisted record |
| Capture flow: `app/(inspector)/compliance/job/[id]/capture.tsx`, `src/features/compliance/lib/capture.ts` | The screen where the additive "AI Co-Inspector" card attaches |

Nothing above changes shape. We add: one inference backend, one model artifact, one additive UI card, and one additive (nullable) DB column.

---

## 2. The hard problem, solved: image → tensor on React Native

You have `expo-camera` (capture) and `expo-image-manipulator` (resize), but **no way to get raw RGB pixels into a Float32 tensor** — the classic RN on-device-vision gap. Two viable stacks:

| Stack | Preprocess (image→pixels) | Inference | Notes |
|---|---|---|---|
| **A — recommended** | `@shopify/react-native-skia` decodes any image URI → `readPixels()` → RGBA bytes | `react-native-fast-tflite` (JSI, GPU delegate) **or** `onnxruntime-react-native` | Mature, full control; Skia is widely used and $0; fits our `InferenceBackend` cleanly |
| **B — fast-track** | `react-native-executorch` handles decode/resize/normalize internally for vision models | ExecuTorch (.pte) | Less glue code; newer lib; ExecuTorch export path |

**Recommendation: Stack A** — Skia for preprocessing + **react-native-fast-tflite** for inference (GPU-accelerated, battle-tested, easy TFLite export from PyTorch/TF). ONNX Runtime is the drop-in alternate if we prefer ONNX export. All three libraries are open-source, $0, and add **no API dependency** — they only require a **development build** (which we already established is mandatory for native modules anyway).

New native deps (dev build): `@shopify/react-native-skia`, `react-native-fast-tflite`. That's it.

---

## 3. The model (v1 → v3)

**Start simple and robust; quantify more over time.**

**v1 — Tile classification + heatmap.** A MobileNetV3-Small / EfficientNet-Lite0 backbone with a corrosion head. Run on the full image for a top-level verdict, and optionally on a 3×3 tile grid to produce a coarse **corrosion heatmap** + per-region severity — without needing a full segmentation model yet. Output a recognized grade.
- Backbone license check (our allowlist = Apache/MIT/BSD): torchvision MobileNetV3 = **BSD-3**; TF EfficientNet-Lite = **Apache-2.0**. ✓
- Size: int8-quantized ≈ **2–5 MB**; inference ≈ **20–60 ms** on mid/high devices.

**v2 — Semantic segmentation.** DeepLabV3+ (MobileNetV3 backbone) → pixel mask → **% area corroded** + per-region severity. Much better quantification for reports.

**v3 — Defect typing / detection.** A permissive detector (NanoDet-Apache / SSD-MobileNet) to classify *type*: uniform, pitting, crevice, galvanic, **CUI** (corrosion under insulation), coating breakdown.

**Severity → recognized standards** (credibility + defensibility): map model output to **ISO 4628-3 (Ri 0–Ri 5)** and **ASTM D610 (rust grade 10–0)**, with an AMPP/NACE cross-reference. The grade — not a raw probability — is what an inspector trusts and what a report cites.

---

## 4. Training & the data flywheel (teacher on the in-house GPU)

```
 public corrosion datasets ──┐                (bootstrap, license-checked)
                             ├─▶ TEACHER (full model, GPU box, never ships)
 your sealed inspection ─────┘        │  distill + int8 quantize (PTQ/QAT)
 photos + human findings             ▼
 (the flywheel labels) ◀──────  STUDENT (.tflite, 2–5 MB)
        ▲                              │  sign (Ed25519) + publish
        │  inspector confirms/corrects │
        └──────  AI card on capture ◀──┘  register-model.mjs → registry → device
```

- **Bootstrap labels:** permissively-licensed public corrosion datasets (verify each dataset's commercial license — flag for counsel, same discipline as base-model licensing) to pretrain while your proprietary set grows.
- **Proprietary labels:** your `inspection_captures` + the human findings give weak labels; a labeling pass sharpens them. This is the moat — nobody else has provenance-sealed corrosion imagery.
- **Active learning:** every inspector accept/edit/dismiss on the AI card is a new label → periodic retrain → publish `corrosion-detector` v2, v3… via the registry (capability-gated rollout, instant revoke).
- **Governance:** ship a **model card** per version (training data summary, metrics, intended use, limitations) — EU-AI-Act-ready and what enterprise security reviews will ask for.

---

## 5. Integration — additive, human-sealed, zero breakage

**Flow (v1, post-capture — no real-time needed, so no change to the capture mechanics):**

1. Inspector captures a photo (existing flow → `inspection_captures`, SHA-256 chained).
2. **Additive** "AI Co-Inspector" card appears on the capture-review surface (behind `ML_RUNTIME_ENABLED` + `EXPO_PUBLIC_ML_COINSPECTOR=1`). It calls `useModel('vision_defect', { slug: 'corrosion-detector' })` → runs inference on the just-captured image.
3. Card shows: **verdict** (corrosion likely/unlikely), **ISO/ASTM grade**, **confidence**, a **heatmap overlay**, and actions **"Add as finding"** / **"Dismiss"**.
4. On accept, it **pre-fills an `inspection_item`** the inspector edits and confirms. The human is the author; the AI only drafted.
5. The suggestion + `model_slug`, `model_version`, `confidence`, `severity`, `accepted_by_human` are recorded in an **additive nullable `inspection_items.ai_assist jsonb`** column → carried into `assemble_evidence_pack` and bound by the seal. Result: a **provably AI-assisted, human-verified** finding.

**Graceful degradation (the zero-breakage guarantee):** if the flag is off, the dev build lacks the native backend, the device is below `device_min_tier`, the model isn't resolved, or signature verification fails — the card simply **does not render**. The existing screen is byte-identical. No model load, no crash, no layout shift.

**Later (v2 UX):** a live viewfinder overlay via a vision-camera frame processor for real-time guidance. Explicitly deferred — v1 ships on still images with zero capture-flow changes.

---

## 6. Code sketches (illustrative — not wired this phase)

**6.1 Registry params for the model** (stored in `model_artifacts.params`, validated client-side):
```jsonc
{
  "input": { "width": 224, "height": 224, "layout": "NHWC",
             "normalize": { "mean": [0.485,0.456,0.406], "std": [0.229,0.224,0.225] } },
  "labels": ["clean","corrosion"],
  "severity": { "scale": "ISO-4628-3", "thresholds": { "Ri1":0.2,"Ri2":0.4,"Ri3":0.6,"Ri4":0.8,"Ri5":0.9 } },
  "tiling": { "grid": 3, "min_confidence": 0.55 },
  "decision_threshold": 0.6
}
```

**6.2 The vision backend** (implements the existing `InferenceBackend`; registered once at boot in the dev build):
```ts
// src/core/ml/backends/tfliteVision.ts  (Phase B.1)
import { loadTensorflowModel } from 'react-native-fast-tflite';
import { Skia } from '@shopify/react-native-skia';
import type { InferenceBackend, LoadedModel } from '../backends';

export const tfliteVisionBackend: InferenceBackend = {
  runtimes: ['tflite'],
  async load({ localUri, params }): Promise<LoadedModel> {
    const model = await loadTensorflowModel({ url: localUri });
    return {
      async run(input: unknown) {
        const { imageUri } = input as { imageUri: string };
        const tensor = await imageUriToTensor(imageUri, params); // Skia decode→resize→normalize
        const out = model.runSync([tensor]);
        return postprocess(out, params); // → { corrosion, grade, score, heatmap }
      },
      release() { /* model GC'd */ },
    };
  },
};
// registerInferenceBackend(tfliteVisionBackend) in app/_layout.tsx (dev build only)
```

**6.3 Publish the signed student:**
```bash
node scripts/ml/register-model.mjs --file ./corrosion-detector-int8.tflite \
  --kind vision_defect --slug corrosion-detector --version 1 \
  --runtime tflite --tier student --device-min-tier standard --os any \
  --license BSD-3-Clause \
  --sign ./nexpec_model_signing.pem --alg ed25519 --key-id model-v1 \
  --params "$(cat corrosion.params.json)"
```

**6.4 Additive DB column** (Phase B.3 migration, nullable → zero breakage):
```sql
ALTER TABLE public.inspection_items
  ADD COLUMN IF NOT EXISTS ai_assist jsonb;  -- {model_slug,model_version,confidence,severity,accepted_by_human}
```

**6.5 The UI card** (additive component; renders nothing when unavailable):
```tsx
const ai = useModel('vision_defect', { slug: 'corrosion-detector' });
if (!ai.enabled || ai.status === 'unavailable') return null; // zero-breakage default
// else: show verdict + grade + heatmap + "Add as finding"
```

---

## 7. Phased delivery (each phase additive, independently shippable)

| Phase | Scope | Exit criteria |
|---|---|---|
| **B.1 Vision backend** | Dev build + Skia + fast-tflite; implement & register `tfliteVisionBackend`; prove end-to-end on a real device with a **stock MobileNet** model via the pipeline screen | A real model resolves, verifies (Ed25519), and runs on-device |
| **B.2 Corrosion model v1** | Data labeling pipeline; train teacher on GPU; distill + int8 student; ISO/ASTM mapping; sign + publish `corrosion-detector` v1 | Published signed artifact; offline eval metrics meet bar |
| **B.3 UX integration** | Additive AI card on capture-review; `ai_assist` migration; suggestion → human confirm → `inspection_item` → seal | Card self-hides when unavailable; confirmed finding seals with AI metadata |
| **B.4 Flywheel** | Capture accept/edit/dismiss as labels; retrain loop; versioned re-publish | v2 model trained from in-app feedback |
| **B.5 Hardening + governance** | Device tiering, thresholds, false-positive review, eval harness, **model card**, self-hosted telemetry | Documented model card; tier-gated rollout; regression eval in CI |

Recommended next concrete step: **Phase B.1** — it de-risks everything (proves real on-device inference through the secure runtime) using a throwaway stock model, before we invest GPU time training corrosion weights.

---

## 8. Risks & mitigations

- **Pixel-extraction friction (RN):** solved by Skia `readPixels()`; fall back to react-native-executorch if needed.
- **Dataset/base-model licensing:** allowlist Apache/MIT/BSD; counsel-review every public dataset's commercial terms (same gate as model licensing).
- **False positives / safety:** assistive only, never auto-fail an asset; confidence thresholds; "AI suggestion — verify" labeling; human confirms and seals; the seal binds the *human* finding.
- **Device variance:** `device_min_tier` gating; low-tier devices hide the card; load session once.
- **Model drift:** the flywheel + an offline eval harness gated in CI; instant `revoke` kill-switch via the registry.
- **Dev-build requirement:** already mandatory for native modules; Expo Go stays usable for everything except native inference.
- **Liability / regulation:** human-sealed posture + model card + EU-AI-Act-aware documentation (per `NEXPEC_AI_ASSET_OWNERSHIP_AND_SECURITY.md`).

---

## 9. What this is NOT (scope guards)

- Not real-time video analysis in v1 (still-image post-capture only).
- Not an autonomous pass/fail — it never closes a finding without a human.
- Not a new capture flow — it rides the existing one.
- Not a teacher on-device — only the distilled student ships.

*Scope only. Each phase gets its own audit-first kickoff, per-feature commit, and verification before code lands.*
