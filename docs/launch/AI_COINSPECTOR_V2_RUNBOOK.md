# AI Co-inspector — corrosion-detector v2 runbook

Launch model: **`assets/corrosion_yolo26s_seg_1024_fp32.tflite`** — YOLO26 instance-segmentation, 1024×1024, 11 classes, sha256 **`21c98fd8d1aab087560ab06183e9e996889aa9b4b6e2ca828f28d779f0aec205`**. Registered as `vision_defect` / slug `corrosion-detector` / **v2** / 2.0.0. v1 is left untouched.

All code-side work is done (see "Files changed"). The steps below need your **private signing key**, **service-role key**, a **hosting URL**, and **Vercel dashboard** — none of which I can access.

## 1. Sign + register v2 (signing box only) — [YOU][SECRET]
```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
./scripts/ml/register-corrosion-detector.v2.sh
```
This hashes the model (expect `21c98fd8…`), uploads it, signs the canonical attestation with `nexpec-model-2026-v1`, and publishes it via `ml_register_model`. **Capture the printed sha256** — it must equal the hosted bytes and the env var below. Commit the produced `corrosion-detector.v2.signed.json` (public, non-secret) if you keep signed manifests in-repo. **Do not modify v1 files.**

## 2. Host the model for the browser — [YOU]
The web runs inference **client-side**, so the model must be fetchable by the browser at an HTTPS URL with permissive CORS. The registration bucket (`ml-models`) is private, so choose one:
- **Public read** on the model object (simplest), or a **long-lived signed URL**, or
- Copy the `.tflite` to a public/CDN path (e.g. a public Supabase bucket, or `apps/web/public/models/…` so it ships with the deploy).

The served bytes' sha256 **must** equal the registered sha (`21c98fd8…`) — the browser verifies it before loading and refuses on mismatch.

## 3. Vercel environment variables — [YOU][DASH]
Set in **Preview** and **Production** scopes (all public / `NEXT_PUBLIC_*`):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_VISION_MODEL_URL` | `<the hosted .tflite URL from step 2>` |
| `NEXT_PUBLIC_VISION_MODEL_SLUG` | `corrosion-detector` |
| `NEXT_PUBLIC_VISION_MODEL_VERSION` | `2` |
| `NEXT_PUBLIC_VISION_MODEL_SHA256` | `21c98fd8d1aab087560ab06183e9e996889aa9b4b6e2ca828f28d779f0aec205` |
| `NEXT_PUBLIC_VISION_LABELS` | `Rust,Rust,Car,Copper corrosion,Corroded part,Corrosion,Iron rust,Mild corrosion,Moderate corrosion,Rust,Severe corrosion` |

`NEXT_PUBLIC_VISION_LABELS` is optional (the app falls back to the normalized launch labels in `@nexpec/shared-core`). Leave the model URL **unset** on any environment where you deliberately want manual mode.

## 4. Mobile configuration — [YOU + confirm]
Mobile already bundles the **same** `corrosion_yolo26s_seg_1024_fp32.tflite` (`src/core/ml/vision/segModelManager.ts`), same 1024 NCHW ÷255 preprocessing, the same `decodeYoloSeg` decoder, the same 11 labels, and the same signing pubkey; `src/core/ml/runtime.ts` already **downloads-by-sha and refuses on sha mismatch**. The mobile screen now records provenance under `corrosion-detector` v2 (shared `CORROSION_MODEL`). **You must confirm** the mobile model runtime can resolve `corrosion-detector` v2 from the registry (i.e. the v2 artifact from step 1 is downloadable to devices, or the bundled asset path is wired to slug `corrosion-detector`). If the mobile runtime previously resolved a different slug (`universal-detector`), verify on-device analysis still returns results after this change. I could not run the mobile app to validate this.

## 5. Model format / size — recommendation (item 11)
- **Only an FP32 export exists** (`…fp32.tflite`, ~42 MB). There is **no** FP16 or INT8 export in the repo. Do not silently swap.
- **Launch with FP32.** It is the trained, signed-eligible artifact; correctness and accuracy are known. Mitigate the 42 MB **one-time** client download with HTTP compression (gzip/brotli — TFLite compresses well) and a long `Cache-Control`; it downloads once per browser and is cached.
- **Future optimization (separate task):** an INT8/FP16 export would cut size substantially but **requires** re-export → re-hash → **re-sign** (new sha, new version, e.g. v3) → **accuracy re-validation**. Report the accuracy tradeoff before adopting. Never point v2's env/sha at a quantized file — the sha would mismatch and loading would (correctly) refuse.

## 6. Verify end-to-end in the browser — [YOU]
On the Preview with the env set:
1. Open `/inspector/ai-coinspector` → status chip should read **"On-device model ready, corrosion-detector v2"** (it only turns ready after the SHA-256 verifies).
2. Select an assigned job, upload a corroded-surface image, click **Analyse** → a spinner, then segmentation polygons on the overlay and one or more **detections** in the suggestions list (the non-defect "Car" class is suppressed).
3. Click **Accept** on a detection → it records (bound to `corrosion-detector` v2 + sha) and appears under "Recorded findings"; **Reject** dismisses it.
4. Tamper test: point the URL at a different file (or wrong sha) → the page must show the config error and **refuse to load** — never silently "ready".

## Remaining manual steps (only you can do)
- [ ] Run step 1 on the signing box (private key + service-role key).
- [ ] Host the model publicly and confirm CORS + sha (step 2).
- [ ] Set the 5 Vercel vars in Preview + Production (step 3).
- [ ] Confirm mobile artifact resolution for `corrosion-detector` v2 (step 4).
- [ ] Browser-verify on the Preview (step 6).
- [ ] Decide FP32 vs a future quantized export (step 5).
