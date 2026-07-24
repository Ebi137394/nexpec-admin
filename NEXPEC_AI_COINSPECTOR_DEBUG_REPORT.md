# NEXPEC — Browser AI Co‑inspector Debug Report

*Deep debug of the three‑model browser inference pipeline. Browser‑only, tfjs‑tflite, no backend/paid AI, SHA binding preserved. Ground truth taken from the actual `.tflite` artifacts (magic, metadata, tensor signatures), not filenames.*

## 0. Round‑3 — the *actual* reason nothing changed in the browser (module resolution)

The decoder fixes were correct but **never executed in the browser**: the console showed the new `visionModel.ts` logs yet the new `decodeYoloSeg`'s `[AI-DEBUG] seg decode path` group was absent — proof the running `decodeYoloSeg` was the **pre‑edit** version. Root cause: `@nexpec/shared-core` is a **symlinked workspace package** (verified: `apps/web/node_modules/@nexpec/shared-core → packages/shared-core`, same inode as the edited source), consumed via `transpilePackages`. Next.js does **not** watch symlinked `node_modules` packages, so every shared‑core edit across rounds sat in the stale `.next/cache` webpack transpile while only app‑`src` files (`visionModel.ts`) hot‑reloaded. Fix: exported a runtime marker `SEG_DECODER_RUNTIME_VERSION = 'box-fallback-largest-component-v3'` (logged as `[AI-DEBUG] decoder runtime =`), rebuilt `packages/shared-core/dist`, and **cleared `apps/web/.next` (2.4 GB)**. After a dev‑server restart + hard refresh the browser must print that marker; then the box‑fallback guarantees `seg decoded ≥ 1`.

**Detector domain corrected:** training provenance (`ai-dataset/detection/merge_config.json`) shows the ONLY source is the **Zenodo coating‑defect dataset** (visible‑light, imgsz 640), classes inclusion/pinhole — it is a **coating‑defect** detector, *not* weld radiography. `~0` on a weld image is therefore **correct** (out‑of‑domain). Registry `displayName`/`purpose`/`inspectionTypes` updated to say *coating defects* (slug/mode/SHA unchanged).

## 1. Root cause per model

> **UPDATE — final root cause (two rounds of browser runtime evidence).** Round 1 assumed coords; round 2 assumed class activation. The **actual** blocker, proven by the candidate diagnostics, is the **post‑confidence mask/polygon path**. The class scores are **probabilities** (class‑region max ≈ 0.49) that clear 0.25 fine — 6 candidates survive confidence — but every one was then silently discarded during mask assembly (`seg decoded 0`). Activation `auto` correctly leaves the probability head alone; the registry now **pins `scoreActivation:'none'`** for both enabled models (evidence‑backed, deterministic). The `regionAbsMax` diagnostic also confirmed the channel layout `[box4, class11, coeff32]` (class region ≈0.49 = probabilities, coeff region ≈3.98 = linear).

**Corrosion (`corrosion-detector v2`) — root cause = mask/polygon stage dropped every valid candidate → FIXED.**
Candidates cleared confidence (0.4868, 0.4758, 0.4488, …) and NMS, then hit `if (emptyMask) continue` / `if (ring.length < 3) continue`, so a valid rust box with an empty or too‑small mask was **silently lost** → `seg decoded 0`. Fix in `decodeYoloSeg`: (1) a surviving candidate **always yields a detection** — if the mask/polygon can't be built, it falls back to the **box rectangle** (`polygonFromBox:true`), so a valid box is never dropped and polygon failure is reported *separately*; (2) the contour now traces the **largest connected component** (8‑connected flood‑fill) instead of an arbitrary first‑pixel speck; (3) full per‑candidate diagnostics (box→crop→coeff/logit stats→foreground counts at 0.30/0.40/0.50→component sizes→contour→reason) plus aggregate stage counts. Mask threshold was **not** lowered. Verified: box‑fallback preserves the detection, real masks still produce true polygons, the 48×48 blob is traced over a 1px speck.

**YOLOv9t (`yolov9t-weld-detector v1`) — NOT broken; the test image was out‑of‑domain.**
The "~100 boxes @0–1%" was the classic **transposed‑tensor** read (box/coeff used as scores); capturing the real shape (`[1,6,8400]`→channels‑first) fixed that. Round‑2 evidence: top class score **0.0066** on a **rust image** — but this detector's classes are *inclusion/pinhole* (weld radiography), so ~0 on a rust photo is **correct**, not a bug. The tensor is bounded ~[0,1] with no wide negatives → **probabilities**; the registry now pins **`scoreActivation:'none'`** so sigmoid is never applied (sigmoid(0.0066)≈0.5017 would recreate the false‑positive flood). Threshold left at 0.25. **Judgement deferred until an in‑domain weld/radiograph positive is tested** (ideally the same validation image through `best.pt` and the TFLite artifact with equivalent preprocessing). The `[AI-DEBUG] detect candidates` log quantifies anchors ≥ each threshold to separate "under‑confident/out‑of‑domain image" from a decode fault.

**WDA (`wda-fissure-detector v1`) — "INVALID_ARGUMENT: Can't initialize model" → artifact must be RE‑EXPORTED.**
The file is a valid TFLite FlatBuffer (`TFL3` magic, byte‑identical to `assets/`, not HTML/404, SHA matches the pin). It is the **only end2end (NMS‑baked) export** (`output_0 = [1,300,38]`). The corrosion + yolov9t **raw‑head** siblings init fine in tfjs‑tflite; only this one fails. The end2end graph's in‑graph selection (top‑k/gather over dynamic tensors) uses ops the tfjs‑tflite **web WASM** runtime cannot initialize. No Flex/Select‑TF strings were found, so it is a builtin‑op/dynamic‑shape incompatibility of the end2end head, not a corrupt file.

## 2. Files changed
- `packages/shared-core/src/ml/segDecode.ts` — **box‑fallback** (a confident+NMS'd candidate always yields a detection; polygon failure flagged `polygonFromBox`, never silently dropped); **largest‑connected‑component** tracing; **per‑candidate + aggregate decode diagnostics** (optional `SegDebugSink`); evidence‑based class activation; coords auto‑detect.
- `packages/shared-core/src/ml/detDecode.ts` — evidence‑based class activation (auto/none/sigmoid).
- `packages/shared-core/src/ml/segE2eDecode.ts` — nullish default‑merge (was `{...DEFAULTS, ...options}`).
- `packages/shared-core/src/ml/modelRegistry.ts` — parser gains optional `scoreActivation`; **corrosion + yolov9t pinned `scoreActivation:'none'`** (both are probability heads, per browser evidence); WDA `enabled:false` + `needs` (re‑export).
- `apps/web/src/lib/ai/visionModel.ts` — real tensor **shapes** → order from shape; **candidate diagnostics** (class min/max/mean + logits/probs verdict, per‑region maxima, anchor counts ≥ 0.01/0.05/0.10/0.25/0.50); **seg decode‑path table** (box→crop→logit→foreground→component→reason) via the `SegDebugSink`.
- `apps/web/src/app/inspector/ai-coinspector/page.tsx` — stale‑state hygiene (clear on model switch + run‑token guard).
- `packages/shared-core/src/ml/decoderCoords.test.ts` — regression tests incl. logit‑recovery, no‑double‑sigmoid, **empty‑mask box‑fallback**, **largest‑component**.

## 3. Exact decoder / preprocessing / runtime fixes
- **segE2eDecode default merge:** explicit `undefined` options no longer clobber defaults (`o.confThreshold ?? DEFAULTS…`). The old bug made `score < undefined` always false → 300 phantom rows.
- **Coordinate space (seg):** decoder now resolves `coords`: explicit `normalized`/`pixel`, or `auto` = peek at the max confident box magnitude (normalized ≤ ~2 → normalized). Corrosion's collapsed masks are recovered.
- **Memory order (det + seg):** `runNchw` returns each output tensor's **runtime shape**; `detect()`/`segment()` set `order` (and det `numDet/vecLen/numClasses`) from the shape — the yolov9t axis is now read from evidence.
- **Preprocessing (verified, unchanged — it was already correct):** `fromPixels` (alpha dropped → RGB) → `resizeBilinear(size)` → `/255` (0–1) → `transpose([2,0,1])` → `[1,3,size,size]` NCHW. Matches the models' `[1,3,1024/640,…]` inputs. *(Note: direct stretch, not letterbox — an accuracy refinement, not the bug; left unchanged to preserve behavior.)*
- **Diagnostics:** dev‑guarded (`NEXT_PUBLIC_AI_DEBUG=1` or `window.__NEXPEC_AI_DEBUG=true`) — per output tensor logs index/shape/length/min/max/mean/NaN/Inf (via **loop**, never `Math.min(...big)`)/first‑20/strategic slices, plus model context, layout, and pre/post‑decode counts.
- **SHA binding:** untouched — `loadModel` still fetches bytes and rejects on `MODEL_SHA_MISMATCH` before load (11 refs intact).
- **Runtime (WDA):** disabled in the registry so tfjs‑tflite is never asked to init the incompatible end2end graph; the co‑inspector lists `enabledModels()` only, so WDA no longer surfaces the init error.

## 4. Tests & commands run
| Command | Result |
|---|---|
| shared‑core `tsc --noEmit` | PASS (exit 0) |
| web `tsc --noEmit` | PASS (exit 0) |
| mobile‑ML `tsc -p tsconfig.ai.json` | PASS (exit 0) |
| `next lint` (ai lib + page) | ✔ no warnings/errors |
| `qa:model-shas` | PASS (SHAs unchanged) |
| decoder fix tests (standalone node) | **9/9 PASS** — corrosion‑normalized survives, both det orders match, segE2e no‑flood |
| vitest (`decoderCoords.test.ts`) | BLOCKED locally (rolldown native binding won't load in sandbox); file added, runs in CI |
| TFLite artifact inspection | magic `TFL3` ✓, `_NormalizeCoords` on corrosion+yolov9t, WDA end2end `[1,300,38]` |

## 5. Remaining limitations
- **WDA cannot run** in tfjs‑tflite until re‑exported raw (see §8). Decoder is ready.
- **yolov9t** correctness is fixed at the code level (order‑from‑shape + coords‑auto), but final confirmation needs a **browser run** — enable `window.__NEXPEC_AI_DEBUG=true` and read the logged shape/score stats; if scores are logits (not 0–1), a `sigmoid` toggle is the one remaining knob (diagnostics will show it).
- Preprocessing uses stretch, not letterbox — may cost some localization accuracy on non‑square inputs (not a detection blocker).
- vitest can't execute in this sandbox (native binding) — run it in CI.

## 6. Git diff summary (working tree vs HEAD)
```
 apps/web/src/app/inspector/ai-coinspector/page.tsx | 15 ++
 apps/web/src/lib/ai/visionModel.ts                 | 82 +++++++++---
 packages/shared-core/src/ml/segDecode.ts           | 43 ++++++--
 packages/shared-core/src/ml/segE2eDecode.ts        | 11 +-
 packages/shared-core/src/ml/modelRegistry.ts       | 16 +-
 packages/shared-core/src/ml/detDecode.ts           |  6 (formatting)
 packages/shared-core/src/ml/decoderCoords.test.ts  | new
```
No secrets, no `.env`, model bytes untouched, SHA checks intact. (Not committed — left for your review.)

## 7. Exact browser test procedure
1. `cd apps/web && npm run dev` with the three `NEXT_PUBLIC_*_MODEL_URL` set.
2. Open `/inspector/ai-coinspector`; in the console run `window.__NEXPEC_AI_DEBUG = true`.
3. **Corrosion:** select "Corrosion / rust", pick a job, upload an obvious‑rust image, Analyse → expect ≥1 detection with a violet polygon; console shows `[AI-DEBUG] segment` (shape `[1,47,21504]`) and `seg decoded N` with N≥1.
4. **YOLOv9t:** select "Weld defects (detect)", upload a relevant weld/radiograph image, Analyse → expect boxes; check `[AI-DEBUG] detect` — confirm `layout.order` matches the logged shape and scores are 0–1. If empty and scores look like logits, tell me and I'll add the sigmoid toggle.
5. **Switch models mid‑result** → the previous "No defects…"/suggestions must clear immediately (stale‑state fix); a slow run from the old model must not overwrite the new one.
6. **WDA** no longer appears in the selector (disabled) → no init error.
7. Confirm SHA binding: temporarily point a model URL at a different file → must fail with `MODEL_SHA_MISMATCH`, nothing loads.

## 8. Must WDA be re‑exported? — **YES.**
The WDA artifact is valid but is the only **end2end (NMS‑baked)** export, and tfjs‑tflite's web WASM runtime cannot initialize its in‑graph selection ops. Re‑export from the same weights as a **raw head** (Ultralytics `export(format='tflite', nms=False, end2end=False, imgsz=1024)`) — identical to how corrosion was exported. Then: put the file at `apps/web/public/models/` + `assets/`, recompute its SHA‑256, update the registry (`sha256`, `outputParser.kind:'yolo-seg'` raw with `coords:'auto'`, `enabled:true`), and `qa:model-shas` re‑verifies. The raw‑seg decoder path already handles it (same as corrosion). Until then WDA stays disabled — no fake fallback, SHA binding preserved.
