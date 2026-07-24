# NEXPEC — Coating detector: proven domain, parity procedure, retrain plan

*Model slug `yolov9t-weld-detector` (UI: **"Coating pinhole / inclusion"**). This documents what the model actually is, why the uploaded large coating‑damage image reads ~0, how to prove `best.pt`↔TFLite↔browser parity, and the plan if general coating‑damage detection is the real product requirement.*

## 1. Proven training domain (from repo provenance, not assumption)

Ground truth is `ai-dataset/detection/merge_config.json` + `merged/data.yaml`:

- **Single source dataset:** `zenodo_coating` → *"Coating Defect Detection Dataset"* (Zenodo), visible‑light, `imgsz=640`. Images are timestamped rig captures (`Image__2025-03-11__14-17-38.png`) — controlled close‑up coating inspection, **not** radiography.
- **Classes:** `class_map {0: inclusion, 1: pinhole, 2: null}` — trained 2‑class (`scratch` dropped as unlearnable, 28 boxes).
- **What the classes are:** *pinhole* = a tiny through‑film pore; *inclusion* = a small embedded particle. Both are **small, localized point defects**.

**Conclusion:** this is a **coating pinhole/inclusion point‑defect detector**. A large dark coating‑loss / delamination / repair‑patch region is a **different defect category outside its two classes**, so `det decoded 0` (raw class max ≈ 0.0156) on that image is **correct behavior, not a decoder bug**. The decoder path is verified consistent (channels‑first `[1,6,8400]`, probabilities, `scoreActivation:'none'` — no sigmoid, no flood). The UI has been narrowed from "Coating defects" to **"Coating pinhole / inclusion"** so it no longer over‑claims.

## 2. best.pt ↔ TFLite ↔ browser parity (run in Colab — weights are in Drive)

`best.pt` is **not in the repo** (metadata points to `/content/drive/MyDrive/nexpec_ai/runs/yolov9t_2class_v1/weights/best.pt`), and this sandbox has no torch/TF, so parity must be measured where the weights + toolchain live. Use **genuine positive validation images whose labels prove `inclusion`/`pinhole`** (not the uploaded damage image). For each image compare `best.pt` vs the FP32 TFLite vs browser‑equivalent preprocessing on: **max class score, predicted class, box, #detections, RGB/BGR, normalization, input size (640), interpolation, direct‑resize vs letterbox, coordinate restoration, output memory order, artifact SHA**. Interpretation:

- **best.pt detects positives, TFLite/browser doesn't →** export or preprocessing parity bug (see §3).
- **best.pt + TFLite detect positives, but not the uploaded damage image →** the image is out‑of‑domain (outcome B). Keep the model; the narrowed UI is correct.
- **best.pt also ~0 on genuine positives →** the checkpoint/artifact is inadequate (outcome C); replace/retrain.

## 3. Preprocessing parity (letterbox) — gated on §2

The browser preprocesses with a **direct square resize** (`resizeBilinear([640,640])`); Ultralytics trains/validates with **aspect‑ratio letterbox (pad 114)**. On non‑square inputs this distorts geometry and can cost accuracy. **Do not implement it speculatively** — it cannot turn a 0.016 out‑of‑domain score into a detection, and it risks the working corrosion/WDA paths. Only if §2 shows letterbox restores parity on genuine positives, add a **model‑configurable** shared preprocessor returning `{ tensor, scale, padX, padY, originalW, originalH }` and undo the pad/scale when mapping boxes/masks back — applied to the coating detector only (corrosion/WDA unchanged unless their own validation proves they need it).

## 4. If the product needs GENERAL coating‑damage detection

A 2‑class pinhole/inclusion detector does **not** satisfy a general coating‑damage requirement (coating loss, peeling/delamination, blistering, cracking, corrosion‑under‑coating, repair patches, pinholes, inclusions). Plan:

1. **Assemble a multi‑class coating‑damage dataset** (permissively licensed): extend `zenodo_coating` with coating‑loss/delamination/blister/crack/repair sources; label the large‑region classes as **segmentation** (they're areas, not points).
2. **Prefer a seg model** (YOLO26‑seg, like corrosion/WDA) so large damage regions get polygons and flow through the same `decodeYoloSeg` + `refineSegFindings` path already shipped.
3. **Train + export RAW** with the proven recipe (`scripts/ml/export-wda-raw.py` pattern: `nms=False`, `imgsz=1024`, FP32, NCHW input, `[1, 4+nc+32, 21504]` + `[1,32,256,256]`).
4. **Integrate** as a new registry entry (new slug), verify with a `verify-*-raw.mjs` clone + `check-model-shas`, add a `findingsPolicy`, keep the point‑defect detector as a separate, honestly‑scoped model.

## 5. Automated smoke tests (status)

The decode + refinement logic is covered by the in‑repo suites (run in CI): `decoderCoords.test.ts` (coords/activation/mask‑path) and `segRefine.test.ts` (dedup/non‑defect/tiny‑mask/cap). A **browser** smoke test (init + real polygons + duplicate cap on known‑positive images, and ~0 on negatives) requires genuine validation images per model, which are dataset‑licensed and not committed — document local fixture paths and run the browser procedure in §2 against them. Fixtures needed: 1 corrosion+, 1 WDA+, 1 coating‑inclusion+, 1 coating‑pinhole+, 1 weld negative, 1 coating negative.
