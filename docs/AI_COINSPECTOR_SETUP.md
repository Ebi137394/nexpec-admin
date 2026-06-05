# Web AI Co-inspector — Technical Implementation Guide

How to make the browser-side **Analyse** feature live: get a model the browser can run, host it, set the Vercel env vars, and verify. Inference is 100% client-side (TensorFlow.js on the inspector's CPU/WebGL) — $0, no backend, no GPU worker.

---

## ⚠️ Read this first — there is no direct `.tflite → model.json` converter

`tensorflowjs_converter` does **not** accept `.tflite` as an input format (valid inputs are `tf_saved_model`, `keras`, `keras_saved_model`, `tf_hub`). So you have three realistic paths, best first:

| Path | When to use | Effort | Fidelity |
|---|---|---|---|
| **A. Convert from the SOURCE model** (SavedModel / Keras the `.tflite` was made from) | You still have the original training export | Low | Best |
| **B. Run the `.tflite` directly in-browser** via `@tensorflow/tfjs-tflite` (no conversion) | You only have the `.tflite` | Low (one code change) | Exact same file |
| **C. Reconstruct a SavedModel from the `.tflite`, then convert** | Only `.tflite`, and you want GraphModel | High / fiddly | Lossy-ish |

**Recommendation:** if you have the source model → **Path A**. If you only have the `.tflite` → **Path B** (I switch the web code to `tfjs-tflite`; you skip conversion entirely and run the identical model). Path C is a last resort.

---

## Path A — Convert from the source model (recommended)

The current web code (`lib/ai/visionModel.ts`) expects a **TFJS model** (`model.json` + `*.bin` shards).

### 1. Install the converter (Python 3.9–3.11)
```bash
python -m venv tfjs-env && source tfjs-env/bin/activate
pip install tensorflowjs
```

### 2. Convert
From a **TF SavedModel** directory:
```bash
tensorflowjs_converter \
  --input_format=tf_saved_model \
  --output_format=tfjs_graph_model \
  --signature_name=serving_default \
  ./path/to/saved_model \
  ./web_model
```
From a **Keras `.h5`**:
```bash
tensorflowjs_converter --input_format=keras ./model.h5 ./web_model
```
Output in `./web_model/`:
```
model.json
group1-shard1of2.bin
group1-shard2of2.bin   ...
```
> The web loader tries `loadGraphModel` first and falls back to `loadLayersModel`, so either `tfjs_graph_model` or the default `tfjs_layers_model` works. Prefer **graph model** (faster inference).

### 3. Sanity-check locally (optional)
```bash
pip install tensorflow
python -c "import tensorflow as tf; m=tf.saved_model.load('./path/to/saved_model'); print([t.shape for t in m.signatures['serving_default'].inputs])"
```
Confirm the **input shape** (e.g. `[1, 224, 224, 3]`) and **output length** (number of classes).

---

## Path B — Run the `.tflite` directly (✅ NOW ACTIVE — no conversion)

`lib/ai/visionModel.ts` now loads your `.tflite` as-is with `@tensorflow/tfjs-tflite` (WebAssembly + XNNPACK) — **the exact same model file the Expo app runs**, executed in the browser. The TF runtime (TFJS 3.21 + the TFLite runtime + its WASM) is **self-hosted under `apps/web/public/tf/`** — zero external-CDN dependency. Inference uses `pixel/255 → [0,1]` and top-K (matches your classifier).

**Vendor the runtime once** (run on your machine — the registry is reachable there):
```bash
bash scripts/ops/fetch-tf-assets.sh   # downloads tf.min.js + tf-tflite + wasm into public/tf
git add apps/web/public/tf && git commit -m "chore(web): vendor self-hosted TF runtime"
```
See `apps/web/public/tf/README.md` for the exact file list.

You only need to:
1. **Host the `.tflite` file** publicly (single file — no shards). A public Supabase bucket is easiest:
   ```
   https://<your-project-ref>.supabase.co/storage/v1/object/public/ml-public/vision/model.tflite
   ```
2. Set `NEXT_PUBLIC_VISION_MODEL_URL` to that `.tflite` URL (see the Vercel table below) + optional `NEXT_PUBLIC_VISION_LABELS`.

No conversion, no `model.json`, no `.bin` shards. (Path A below is only relevant if you ever switch to a TFJS GraphModel.)

---

## Hosting the model

The browser fetches the model over HTTPS, so it must be **publicly readable with CORS allowing your domain**.

**Easiest — a public Supabase Storage bucket:**
```bash
# one-time: create a public bucket (e.g. ml-public) in the dashboard, then:
# upload model.json + every *.bin shard into ml-public/vision/
```
The public URL of `model.json` becomes:
```
https://<your-project-ref>.supabase.co/storage/v1/object/public/ml-public/vision/model.json
```
Keep all `*.bin` shards **in the same folder** as `model.json` (TFJS resolves them relative to it).

> Do **not** reuse the private `ml-models` bucket for this — the browser can't follow the relative shard URLs through per-file signed URLs. Use a small **public** bucket that holds only the web-servable model.

---

## Vercel environment variables — checklist

These are read by `lib/data/aiCoinspector.ts`. **`NEXT_PUBLIC_*` vars are inlined at build time → set them, then trigger a fresh deploy.** Set for **Production** (and **Preview** if you test there).

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_VISION_MODEL_URL` | ✅ Yes | `https://<ref>.supabase.co/storage/v1/object/public/ml-public/vision/model.json` | The model the browser downloads + runs |
| `NEXT_PUBLIC_VISION_LABELS` | Optional | `corrosion,crack,coating_loss,weld_defect,ok` | Class labels **in the model's output order** |
| `NEXT_PUBLIC_VISION_MODEL_SLUG` | Optional¹ | `vision-defect-detector` | Recording identity (provable binding) |
| `NEXT_PUBLIC_VISION_MODEL_VERSION` | Optional¹ | `1` | Recording identity |
| `NEXT_PUBLIC_VISION_MODEL_SHA256` | Optional¹ | `a1b2…` (64 hex) | Recording identity |

¹ The recording identity is resolved automatically from `ml_resolve_models` (kind `vision_defect`) if a **published, signed** artifact exists. Only set the `SLUG`/`VERSION`/`SHA256` vars if you'd rather pin it manually — and they **must** match a published, signed row in `model_artifacts`, or `pi_record_ai_detection` will (correctly) reject the recording.

After saving: **Deployments → Redeploy** (so the new `NEXT_PUBLIC_*` values are baked in).

---

## Two alignment details that affect accuracy

The generic classifier in `classify()` assumes:
1. **Input normalisation `pixel / 255` → [0,1].** If your model expects `[-1,1]` (`x/127.5 - 1`) or ImageNet mean/std, results will be wrong. Tell me which and I'll add a `NEXT_PUBLIC_VISION_NORM` switch.
2. **Output is class scores** (logits or probabilities); we take top-K and softmax in JS if needed. If your model is an **object detector** (bounding boxes), the mapping differs — I'll extend `classify()` to parse boxes/scores.

---

## Pre-freeze verification checklist

Run through these before the final push:

**Deploy plumbing**
- [ ] Vercel **Root Directory = `apps/web`** (the recurring setting — build fails without it).
- [ ] `supabase db push` applied the latest migrations: `supplier_earnings`, `supplier_releases`, `conversation_kind_supplier`, `supplier_job_chat`.
- [ ] Edge functions deployed: `create-supplier-payout`, redeployed `create-stripe-connect-link` (Stripe payouts).
- [ ] Vercel build is green (TS strict, ESLint).

**AI Co-inspector specifically**
- [ ] `NEXT_PUBLIC_VISION_MODEL_URL` opens in a browser and returns JSON (not 403/404); the `*.bin` shards sit beside it.
- [ ] Bucket/host CORS allows your domain (open devtools → Network → no CORS error when the model loads).
- [ ] `NEXT_PUBLIC_VISION_LABELS` order matches the model's output indices.
- [ ] A **published + signed** `vision_defect` model exists in `model_artifacts` (or the manual identity envs point at one) — otherwise "Accept" records will be rejected.
- [ ] TF runtime vendored: `bash scripts/ops/fetch-tf-assets.sh` ran and `public/tf/tf.min.js` + `public/tf/tflite/*.wasm` are committed.
- [ ] CSP is now **self-only**: `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'` (the `'wasm-unsafe-eval'` is required to compile the WASM). No third-party CDN needed.
- [ ] Smoke test: inspector signs in → AI Co-inspector shows **"On-device model ready"** → select a job → drop a photo → **Analyse** → a suggestion appears → **Accept** → it shows under **Recorded findings**.

**Sanity (already green in code)**
- [ ] `cd apps/web && npm run typecheck` → 0 errors.
- [ ] Supplier login, supplier portal, unified inbox, admin Supplier Releases all reachable.

---

## TL;DR
1. Get a browser-runnable model: **Path A** (convert from source) or **Path B** (run the `.tflite` directly — I make the code change).
2. Host `model.json` + shards in a **public** bucket with CORS.
3. Set `NEXT_PUBLIC_VISION_MODEL_URL` (+ labels) in Vercel → **redeploy**.
4. Ensure a published signed `vision_defect` artifact exists so accepted findings record.
5. Smoke-test the drop → analyse → accept flow.

Once these are set, an inspector drops a drone photo and it's analysed instantly, entirely in-browser. 🟢
