# NEXPEC — AI Integration Report (all trained models × both apps)

*Generated 2026‑07‑19. Scope: every trained, exported model discovered across the mounted project roots, integrated + verified as far as is possible without a live browser, physical device, or Supabase/Vercel credentials.*

---

## Phase 10 — Final Status Table

| Step | corrosion‑detector v2 (seg, 11‑cls, 1024) | wda‑fissure‑detector v1 (seg e2e, 5‑cls, 1024) | yolov9t‑weld‑detector v1 (det, 2‑cls, 640) | corrosion‑detector v1 (mobilenet placeholder) |
|---|---|---|---|---|
| Found | **PASS** `assets/` + ai‑dataset | **PASS** `assets/` + ai‑dataset | **PASS** `assets/` + ai‑dataset | **PASS** repo root |
| Metadata recovered | **PASS** full `model_info.json` (shapes, classes, sha, ultralytics 8.4.95) | **PASS** `…_tensors.json` flatbuffer dump ([1,300,38] + [1,32,256,256]) | **PASS** input 640, [1,6,8400] channels‑first; labels from `merge_config.json` | **PASS** signed record `corrosion-detector.v1.signed.json` |
| Labels verified | **PASS** 11 verbatim (idx=classId; `car` = non‑defect) | **PASS** 5 verbatim (`Welding line` = non‑defect) | **PASS** `["inclusion","pinhole"]` (scratch dropped — 28 boxes, unlearnable) | **PASS** (legacy classifier) |
| Decoder verified | **PASS** synthetic: raw channels‑first, box exact, mask area ✓ | **PASS** synthetic: e2e rows, explicit classId 3/5, area 0.1377 vs 0.1406 | **PASS** synthetic: NMS dedup, class split, xyxy exact | n/a (top‑K classifier path) |
| SHA‑256 pinned | **PASS** `21c98fd8…` | **PASS** `d0f086e0…` | **PASS** `4da2665f…` | **PASS** `7aad0c74…` (already registered+signed) |
| Shared registry (web+mobile, one file) | **PASS** `shared-core/ml/modelRegistry.ts` | **PASS** same | **PASS** same | superseded by v2 slug |
| Registered in DB | **BLOCKED** → run `scripts/ml/register-nexpec-models.sh` (needs `SUPABASE_SERVICE_ROLE_KEY`) | **BLOCKED** → same script | **BLOCKED** → same script | **PASS** (v1, 2026‑05‑30) |
| Hosted (web) | **PASS (staged)** `apps/web/public/models/`, SHA = pin; live‑domain check = post‑deploy | **PASS (staged)** same | **PASS (staged)** same | n/a |
| Web integrated | **PASS** selector + auto‑select + seg overlay + Accept/Reject + SHA‑verify + provenance | **PASS** (e2e parser path) | **PASS** (detect → boxes) | **PASS** (classifier fallback) |
| Web runtime tested | **BLOCKED** — needs a browser session (open `/inspector/ai-coinspector`, Analyse a photo per model) | **BLOCKED** — same | **BLOCKED** — same | previously verified |
| Mobile integrated | **PASS** registry‑driven engine, single‑resident slot | **PASS** (e2e parser path) | **PASS** (new `weld-detect` mode → box‑as‑polygon overlay + HITL) | n/a (mobile uses seg/det stack) |
| Mobile runtime tested | **BLOCKED** — needs an EAS dev build on a physical device | **BLOCKED** — same | **BLOCKED** — same | n/a |

**No model remains disabled.** All three trained models are `enabled: true` in the registry with verified decode recipes. Every BLOCKED cell shares the same two external causes: (1) DB registration needs the service key, (2) runtime proof needs a browser/device — neither is reachable from this sandbox, per policy of never marking PASS without real execution.

---

## What was discovered (Phase 1–3, nothing guessed)

| Artifact | Where | SHA‑256 | Ground truth source |
|---|---|---|---|
| `corrosion_yolo26s_seg_1024_fp32.tflite` (40 MB) | `assets/`, web `public/models/` | `21c98fd8d1aa…aec205` | `assets/model_info.json` (matches byte‑for‑byte) |
| `wda_fissures_yolo26s_seg_1024_fp32.tflite` (40 MB) | `assets/`, web `public/models/` | `d0f086e0f589…38e703` | `assets/…_tensors.json` flatbuffer inspection |
| `yolov9t_2class_fp32.tflite` (8.1 MB) | `assets/`, web `public/models/` | `4da2665ff813…804be7` | `ai-dataset/detection/merge_config.json` + verified [1,6,8400] |
| `mobilenet_v2.tflite` (3.5 MB) | repo root | `7aad0c74c5e3…9fd4776` | `scripts/ml/corrosion-detector.v1.signed.json` (registered v1) |

Notable corrections locked in during recovery: WDA is a **5‑class end‑to‑end (NMS‑included) export** — `[1,300,38]` rows `[x1,y1,x2,y2,conf,classId,32 coeffs]` — not the 2‑class raw head previously assumed; the raw decoder would misparse it, which is why `decodeYoloSegE2E` exists and is registry‑dispatched. The ai‑dataset corrosion copy (`247fde04…`) is a **stale export** — the canonical bytes are the repo `assets/` copy matching `model_info.json`.

## What was repaired/completed this pass

`segModelManager.ts` had an interrupted edit: a duplicate `const model` declaration in `analyze()` (hard compile error) and no detection path. Fixed; added the third bundled mode `weld-detect` (yolov9t via `decodeYoloDet`, 640 input from the registry, boxes exposed as 4‑corner polygons so the SAME `SegOverlay` gestures + HITL feedback work unchanged); labels/input/parsers now come entirely from the shared registry; `SegOverlay` provenance uses `modeSlug()` (registry identity, never ad‑hoc strings); capture auto‑select routes radiography/RT/inclusion/pinhole jobs to the detector. Web `public/models/` staged with SHA‑verified copies; `qa:model-shas` guard added (parses the registry, hashes all 6 shipped copies); registration script for all 3 models generated (independent, non‑overwriting, with an audit query); Preview/Production env documentation written.

## Verification battery (all local checks green)

`tsc` mobile‑ML scope ✅ · `tsc` web ✅ · `tsc` shared‑core ✅ · `qa:model-shas` ✅ (3 models × 2 locations) · decoder synthetics ✅ (9/9: raw‑seg previously, det + e2e this pass).

## Files added/changed

- `packages/shared-core/src/ml/{modelRegistry,detDecode,segE2eDecode}.ts` — shared registry + decoders (audited, exported)
- `src/core/ml/vision/segModelManager.ts` — repaired + 3‑model registry‑driven engine
- `src/core/ml/vision/SegOverlay.tsx` — mode union + registry provenance
- `app/(inspector)/compliance/job/[id]/capture.tsx` — `modeSlug` + detector auto‑select
- `apps/web/public/models/*.tflite` — same‑origin hosting (SHA‑pinned)
- `scripts/qa/check-model-shas.mjs` + `package.json` `qa:model-shas`
- `scripts/ml/register-nexpec-models.sh` · `scripts/ops/ai-model-env.md`

## The one external action

Run on your machine, from the repo root (pushes everything, then registers all three models in the live registry):

```bash
git add -A && git commit -m "AI: shared model registry — corrosion v2 + WDA v1 + yolov9t v1 across web+mobile" && git push origin main \
&& SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-key> \
   bash scripts/ml/register-nexpec-models.sh --sign
```

After that: set the three env vars from `scripts/ops/ai-model-env.md` in Vercel (Preview + Production), redeploy, and the web/mobile **runtime tested** cells flip to PASS via a 5‑minute smoke: open `/inspector/ai-coinspector`, pick each of the 3 models, Analyse a photo, Accept one finding per model; on device, capture against a weld job, a corrosion job, and a radiography job.
