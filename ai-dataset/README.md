# NEXPEC AI Co‑Inspector — Image Classification Dataset Builder

A complete, **free**, runnable pipeline that turns raw inspection photos into a clean,
labeled, split, and packaged **image‑classification dataset** you can upload to a training
platform. For image classification, **the folder a picture sits in _is_ its label** — so
"labeling" here means getting clean images into the right class folder, which these scripts do.

> This folder is **self‑contained and movable** — copy `ai-dataset/` anywhere (it does not need
> to live inside the app repo). Images/venvs are git‑ignored so they never pollute NEXPEC's history.

---

## Folder structure
```
ai-dataset/
  classes.txt            ← EDIT THIS: your classes drive the whole pipeline
  requirements.txt
  SOURCES.md             ← where to get license-clean images
  sources/<class>.txt    ← optional per-class URL / search-term lists
  data/
    raw/<class>/         ← images land here (downloaded OR your own photos)
    clean/<class>/       ← after dedupe + quality filter (auto)
    dataset/
      train|val|test/<class>/*.jpg
      labels.csv  annotations.json  labels.txt  dataset_card.json
    nexpec_dataset_full.zip   nexpec_dataset_hf.zip   ← upload-ready
  scripts/  00_setup → 06_package
```

---

## One‑time setup
```bash
cd ai-dataset
python3 -m venv .venv && source .venv/bin/activate      # optional but recommended
python3 -m pip install -r requirements.txt
```

## The workflow
```bash
cd scripts

# 0) Create per-class folders from classes.txt (edit classes.txt first!)
python3 00_setup.py

# 1) Get images (choose either or both):
#    a) BEST: drop your OWN labeled photos into  ../data/raw/<class>/
#    b) download license-clean sets (see ../SOURCES.md) into the same folders
#    c) optional web search (verify licenses!):
python3 01_fetch_images.py --max 200

# 2) Clean: de-duplicate, drop tiny/blurry/corrupt, standardize + rename
python3 02_clean.py

# 3) Split into train/val/test  (70/20/10 by default)
python3 03_split.py

# 4) Write labels.csv + annotations.json + dataset_card.json
python3 04_manifest.py

# 5) Validate (counts, balance, leakage) — fix warnings, re-run
python3 05_validate.py

# 6) Zip for upload
python3 06_package.py
```
Or just: `python3 run_all.py` (runs 0,2–5) once images are in `data/raw/`.

## Adding your OWN photos
Put them straight into `data/raw/<class>/` (e.g. `data/raw/corrosion/`). Mixed/unsorted photos
must be sorted by hand into class folders first — a classifier can't self‑label its own training
data (chicken‑and‑egg). The scripts then dedupe, clean, split, and manifest them alongside any
downloaded images.

---

## Where to upload (train your own model)

Your goal — *upload a dataset → platform trains a model → later classify a new image* — with the
"free / model‑I‑own" constraint. Ranked for that:

1. **Google Teachable Machine** — https://teachablemachine.withgoogle.com/train/image
   **Best first choice.** 100% free, no account, trains in your browser. Create one class per
   folder, drag in the images from `data/dataset/train/<class>/`, click Train, then **Export →
   TensorFlow Lite (.tflite)** or Keras. You *own* the exported model, and the **`.tflite` drops
   straight into NEXPEC's on‑device runtime** (`universal-detector` slug) from the MVP plan.
   Test instantly by uploading a new image right in the browser.

2. **Hugging Face AutoTrain** — https://huggingface.co/autotrain
   Free for **< 500 images** with a few candidate models. Upload **`data/nexpec_dataset_hf.zip`**
   (already in the exact "one folder per class" shape it expects). Gives you a hosted model +
   an inference widget/API and downloadable weights.

3. **Google Vertex AI AutoML** (paid) or **Azure Custom Vision** (free tier) — turnkey cloud
   training if you outgrow the above. Both accept `labels.csv` / ImageFolder. These are hosted
   (per‑call cost), so they trade the "fully‑own‑it, zero‑cost" property for scale/managed serving.

4. **Fully offline, no platform** (ties back to the MVP plan): the same `data/dataset/` trains a
   transfer‑learning classifier locally in ~30 lines (Keras/PyTorch) → export `.tflite`. Maximum
   ownership, still $0.

**Recommendation:** start with **Teachable Machine** — fastest path to a working, exportable,
free model, and its `.tflite` feeds NEXPEC's existing on‑device inference directly.

---

## Notes
- **Classification vs. the co‑inspector:** this builds a *whole‑image* classifier (e.g. "this
  photo shows corrosion"). The full co‑inspector eventually wants *object detection* (a box around
  the defect) — see `docs/AI_COINSPECTOR_MVP_PLAN.md`. Classification is the right, simpler v0.1;
  the same photos + labels later seed the detector.
- **Class list:** keep ids aligned with `packages/shared-core/src/ml/defectTaxonomy.ts` so results
  map cleanly onto the app. Classification also needs a **`normal`** (no‑defect) class — included.
- **Licensing:** web‑sourced images carry mixed rights. For a commercial model, prefer the curated
  open datasets in `SOURCES.md` and verify licenses before shipping.
