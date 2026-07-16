# Where to get images (license-clean first)

Your **own labeled inspection photos are the best data** — drop them straight into
`data/raw/<class>/` (e.g. `data/raw/corrosion/`). For everything else, prefer sources you
are allowed to reuse. Scraped web images have unknown licenses; for a **commercial** model
(NEXPEC) that is a real risk, so start with the curated open datasets below.

## 1) Curated open defect datasets (recommended — download, then sort into class folders)
- **Roboflow Universe** — free open CV datasets; export as "Folder / Classification".
  - Building Defect Detection (~1,518 imgs: crack, corrosion, dampness, vegetation)
  - Corrosion-Detection (~449 imgs) and other corrosion sets
  - Crack datasets (COCO/classification exports available)
  - Browse: https://universe.roboflow.com/search?q=class%3Acorrosion  ·  `class:crack`  ·  `class:defect`
- **Kaggle Datasets** — e.g. surface-defect / concrete-crack / steel-defect sets. Check each dataset's license tab. https://www.kaggle.com/datasets
- **Hugging Face Datasets** — e.g. `elliemci/building_cracks`. https://huggingface.co/datasets
- **Openverse** (CC-licensed image search): https://openverse.org
- **Wikimedia Commons** (mostly CC / public domain): https://commons.wikimedia.org

> After downloading any set, move its images into the matching `data/raw/<class>/` folder.
> The **folder name is the label** — that is how classification datasets are annotated.

## 2) Optional web search download (01_fetch_images.py)
`01_fetch_images.py` can pull images via `icrawler` using each class's search terms in
`classes.txt`, with a **commercial-reuse license filter** applied. Treat results as a
*starting point*: verify licenses before shipping a commercial model, and always de-dupe
(02_clean.py) against your curated sets.

## Rule of thumb for a v0.1 (~10%) model
Aim for **150–400 clean images per class**, roughly balanced across classes. Fewer works to
"see it learn"; more (and more *varied* — angles, lighting, equipment) is what actually helps.
