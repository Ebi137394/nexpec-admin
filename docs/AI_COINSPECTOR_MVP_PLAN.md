# AI Co‑Inspector — Free, Own‑the‑Model MVP Plan (v0.1, ~10 %)

**Goal:** teach a defect‑detection model from your own labeled inspection photos, wire it
into NEXPEC, and keep it **100 % free — no API bills, no per‑call cost, a model you own.**

This plan is grounded in the scaffolding that already exists in the repo, so you are
*filling in a model*, not building from zero:

| Already in the repo | What it is | You provide |
|---|---|---|
| `packages/shared-core/src/ml/defectTaxonomy.ts` | The **Universal Defect Ontology** — the stable class contract (`corrosion`, `pitting`, `crack`, `coating_flaking`, …) mapped to ISO/ASTM/API standards | Label your photos with these exact class `id`s |
| `src/core/ml/useDefectAnalysis.ts` + `vision/tfliteVision.ts` + `registerVisionBackend` | An **on‑device TFLite runtime** that runs a model registered under the slug `universal-detector` and returns a `DefectAnalysis` | The `.tflite` model file |
| `src/core/ml/flags.ts` (`ML_RUNTIME_ENABLED`) | Feature flag gating the runtime | Flip it on when the model is dropped in |
| `src/shared-ui/ai/DefectFindingsCard.tsx`, `app/ai-coinspector.tsx`, `app/(inspector)/compliance/job/[id]/capture.tsx` | The UI surfaces that show findings / capture photos | Nothing — they already consume the hook |

**So the whole task reduces to: produce a `universal-detector.tflite` that outputs the taxonomy classes as bounding boxes, then flip the flag.** Everything downstream already exists.

---

## TL;DR — the two decisions you asked about

**Q1. Where do the labeled photos go *today*?**
Not Roboflow's free tier, and not the production Supabase bucket. **Annotate locally** with a
free, self‑hosted tool (**CVAT** or **Label Studio**) and keep the dataset (images + label
files) in a **private, version‑controlled folder** you own. Reason: Roboflow's *free* tier
forces every uploaded dataset to become **public** on Roboflow Universe — unacceptable for
proprietary inspection imagery. A dedicated `ai_training_data` Supabase bucket **is** part of
the plan, but for the *production* capture→correct→retrain loop (Phase 4), not for hand‑labeling today.

**Q2. Train a custom model, or few‑shot a big VLM?**
Your "no API cost / my own AI" constraint **decides this for you**: paid VLM few‑shot
(GPT‑4o Vision, Claude) is out — it bills per image forever and the model isn't yours.
**Train a small, permissively‑licensed object detector** by transfer learning on your photos.
It's genuinely *your* model, runs free on‑device, and does **localization** (boxes on the
defect) — which is exactly what a co‑inspector needs. A *local* open VLM (Qwen2.5‑VL, Moondream)
is a nice **optional reasoning layer later**, not the MVP.

> ⚠️ **Licensing landmine (important for a commercial product):** the popular **Ultralytics
> YOLO (v8/v11) is AGPL‑3.0**. Shipping an app that embeds it — *including a model you
> fine‑tuned with it* — legally requires you to **open‑source all of NEXPEC** or buy an
> Ultralytics Enterprise License. For a closed SaaS, **do not build the MVP on Ultralytics.**
> Use a **permissive (Apache‑2.0 / MIT)** detector instead (options below).

---

## What "completely free" actually means here (honest accounting)

| Stage | Free tool | Cost |
|---|---|---|
| Annotation | CVAT or Label Studio (self‑hosted, Docker, on your laptop) | $0 |
| Dataset storage | Local folder + Git‑LFS (or a private drive) | $0 |
| Training compute | Your laptop GPU **or** free Google Colab / Kaggle GPU hours | $0 |
| The model | Permissive open weights you fine‑tune (Apache/MIT) — **yours** | $0 |
| Inference in production | **On‑device** TFLite on the inspector's phone (runs offline) | $0 / call |
| Flywheel storage | Supabase Storage (already in your plan/free tier) | $0 at this scale |

The only real inputs are **your time** and **your labeled data**. No API keys, no inference
servers, no subscriptions. Inference running *on the phone* is the key that makes it free **at
scale** — 10 inspections or 10,000, server cost stays zero.

---

## Pick a permissive detector (avoid the AGPL trap)

Any of these are Apache‑2.0 / MIT and safe to embed in a closed commercial app, and all export
to TFLite/ONNX for on‑device use:

- **D‑FINE** or **RF‑DETR** — Apache‑2.0 transformer detectors; strong accuracy, modern.
- **YOLOX** — Apache‑2.0, classic and very well documented; easiest first run.
- **LibreYOLO** — MIT drop‑in that keeps the familiar YOLO API/dataset format without the AGPL.

**Recommendation for a first run:** **YOLOX‑Nano** or **LibreYOLO‑n**. Tiny, fast, huge amount
of tutorials, exports cleanly to TFLite, and the YOLO‑format dataset you'll export from CVAT
drops straight in. (You keep the *format* everyone uses without the *AGPL library* everyone
gets bitten by.)

---

## The pipeline (five phases)

```
   YOUR LAPTOP (offline, free)                          NEXPEC (production)
┌───────────────────────────────┐          ┌──────────────────────────────────┐
│ 1 Annotate   2 Train   3 Export│          │ 4 On‑device infer   5 Flywheel   │
│  CVAT   →  YOLOX/    →  .tflite │──drop──▶ │  useDefectAnalysis  correct→bucket│
│ (taxonomy)  LibreYOLO   model  │  in app  │  (universal-detector) → retrain  │
└───────────────────────────────┘          └──────────────────────────────────┘
```

### Phase 0 — Do this *today* (30 minutes)
1. **Do NOT upload the proprietary photos to Roboflow's free tier** (it publishes them).
2. Create one private dataset folder, e.g. `nexpec-ai/dataset/` (outside the app repo, or a
   separate repo with Git‑LFS). Structure:
   ```
   dataset/
     images/            # your raw + internet‑gathered photos
     labels/            # annotation files (filled in Phase 1)
     classes.txt        # the taxonomy ids you're starting with
   ```
3. **Choose 2–3 classes** for v0.1 — not all ~15. Pick the most common + visually distinct,
   e.g. `corrosion`, `crack`, `coating_flaking`. Copy their exact `id`s from
   `packages/shared-core/src/ml/defectTaxonomy.ts` so the model's outputs line up with the app.
   A tiny dataset spread across 15 classes learns nothing; concentrated on 3, it can hit ~10 %‑useful.

### Phase 1 — Annotate (free, private)
- Run **CVAT** locally: `git clone https://github.com/cvat-ai/cvat && docker compose up -d` →
  open `localhost:8080`. (Label Studio is the alternative if you prefer its UI.)
- Draw bounding boxes around each defect; assign the taxonomy `id` as the label.
- **Aim for ≥ 50–100 boxed instances *per class*** for a first useful model. Fewer works to
  "see it light up," but expect toy accuracy. Augmentation (next phase) multiplies what you have.
- **Export as "YOLO 1.1"** (or COCO). That gives you `images/` + `labels/*.txt` + `classes.txt`.

### Phase 2 — Train (free GPU)
- If your laptop has an NVIDIA GPU, train locally. **If not, use free Google Colab or Kaggle
  GPUs** — a nano model on a small set trains in minutes.
- Transfer‑learn from COCO‑pretrained weights (don't train from scratch) and turn on heavy
  **augmentation** (flips, rotations, brightness/contrast, mosaic) — this is what makes a small
  dataset viable.
- Sanity target for v0.1: the model reliably boxes obvious defects in *held‑out* photos. Track
  mAP but don't chase it — the human inspector stays in the loop.

### Phase 3 — Export to TFLite
- Export the trained weights to **`.tflite`** (int8‑quantized keeps it small + fast on phones).
- Name it to match the runtime slug, e.g. `universal-detector.tflite`, plus a `labels.json`
  mapping output indices → taxonomy `id`s.

### Phase 4 — Wire into NEXPEC (on‑device, $0/call)
- Drop the model into the mobile app's model registry and point the `universal-detector` slug at
  it (see `src/core/ml/vision/tfliteVision.ts` / `registerVisionBackend`). The on‑device engine is
  **`react-native-fast-tflite`** (JSII, VisionCamera integration) or **React Native ExecuTorch**;
  both need an Expo **dev client / prebuild** (not Expo Go).
- Flip **`ML_RUNTIME_ENABLED`** on. The existing `useDefectAnalysis()` hook + `DefectFindingsCard`
  now show real boxes on the capture‑review screen. Nothing else to build — the UI already consumes it.
- Ship the model **bundled** in the app or lazy‑downloaded from Supabase Storage on first use.

### Phase 5 — The data flywheel (where Supabase comes in)
- **Now** create the `ai_training_data` Storage bucket (private; admin‑only RLS — treat it like
  the other sensitive buckets). This is *not* where you annotate today; it's where production
  learning accrues.
- On the capture screen, when the model proposes findings and the **inspector confirms /
  corrects** them, write `{ image, model_boxes, inspector_corrected_boxes, taxonomy_ids }` to the
  bucket + a `ai_training_samples` table. Corrections are gold‑standard labels.
- Every N weeks: pull the new corrected samples, fold them into `dataset/`, retrain, export a new
  `.tflite`, bump the model version. The product literally gets smarter as inspectors use it —
  and it's all your data and your model.

---

## Realistic expectations for "10 %"

- With dozens–hundreds of images and 2–3 classes, you get a **co‑pilot, not an autopilot**: it
  highlights *likely* defects for the inspector to confirm. That's the correct product posture
  anyway (liability, the report‑escrow model, and trust all favor human‑in‑the‑loop).
- It will miss things and false‑positive. That's fine — every correction (Phase 5) is training data.
- Don't widen the class list or promise severity grading until the flywheel has fed a few hundred
  corrected samples per class.

---

## Optional later: a *local* VLM reasoning layer (still free)

Once boxes work, you can add natural‑language findings ("moderate corrosion, ~15 % surface, ISO
4628‑3 Ri3") without any API cost by running a **small open VLM locally / on a free box**:
**Qwen2.5‑VL 7B** (best all‑rounder, ~6 GB, needs ~12 GB GPU at 4‑bit), **MiniCPM‑V 2.6**, or
**Moondream 2 (1.9 B)** for tiny hardware — all runnable via **Ollama**. Feed it the cropped
defect box + the taxonomy standard refs and ask for a one‑line, standards‑anchored description.
This is a *reasoning* layer on top of the detector, not a replacement for it, and it's out of
scope for v0.1.

---

## Your "do it today" checklist

1. [ ] Create the private `dataset/` folder (Git‑LFS or separate private repo). **Not** Roboflow free.
2. [ ] Pick 3 starter classes from `defectTaxonomy.ts` (`corrosion`, `crack`, `coating_flaking`).
3. [ ] `docker compose up` CVAT locally; import your photos; box + label them.
4. [ ] Export **YOLO/COCO**; confirm `labels/` + `classes.txt`.
5. [ ] Open a Colab/Kaggle notebook; transfer‑train **YOLOX‑Nano** (or LibreYOLO) with augmentation.
6. [ ] Export **`universal-detector.tflite`** (int8) + `labels.json`.
7. [ ] (Next) register it under the `universal-detector` slug, flip `ML_RUNTIME_ENABLED`, test on‑device.
8. [ ] (Next) create the `ai_training_data` bucket + `ai_training_samples` table for the flywheel.

---

### Sources
- Ultralytics AGPL / commercial licensing — https://www.ultralytics.com/license
- Permissive detector alternatives (RF‑DETR, D‑FINE, YOLOX, LibreYOLO) — https://www.lightly.ai/blog/best-ultralytics-alternatives-in-2026 · https://www.learnml.io/posts/apache-object-detection-models/ · https://www.libreyolo.com/articles/best-ultralytics-alternatives
- Roboflow free tier is public / annotation tool comparison — https://blog.roboflow.com/best-image-annotation-tools/ · https://www.cvat.ai/resources/blog/cvat-or-label-studio-which-one-to-choose
- On‑device inference for React Native / Expo — https://docs.swmansion.com/react-native-executorch/docs/computer-vision/useObjectDetection · https://expo.dev/blog/how-to-run-ai-models-with-react-native-executorch
- Local VLMs (Qwen2.5‑VL, MiniCPM‑V, Moondream) — https://www.bentoml.com/blog/multimodal-ai-a-guide-to-open-source-vision-language-models
