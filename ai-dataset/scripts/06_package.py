#!/usr/bin/env python3
"""Step 6 — zip the finished dataset for upload.

  python3 06_package.py

Creates in data/:
  • nexpec_dataset_full.zip  — train/val/test/<class>/* + manifests (archive/Vertex/local)
  • nexpec_dataset_hf.zip    — train/<class>/* only, the layout Hugging Face AutoTrain wants
"""
from __future__ import annotations
import zipfile
from _common import DATASET, ROOT, SPLITS, iter_images, load_classes, header, info, die


def zip_paths(zip_path, pairs):
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for abs_p, arc in pairs:
            z.write(abs_p, arc)


def main() -> None:
    header("STEP 6 · Package for upload → data/*.zip")
    if not DATASET.exists():
        die("run 03_split.py + 04_manifest.py first")
    classes = list(load_classes())
    out_dir = ROOT / "data"

    # full archive (all splits + manifests)
    full = []
    for split in SPLITS:
        for cid in classes:
            for p in iter_images(DATASET / split / cid):
                full.append((p, f"{split}/{cid}/{p.name}"))
    for m in ("labels.csv", "annotations.json", "labels.txt", "dataset_card.json"):
        mp = DATASET / m
        if mp.exists():
            full.append((mp, m))
    if not full:
        die("no images found — run the pipeline first")
    zip_paths(out_dir / "nexpec_dataset_full.zip", full)

    # HF AutoTrain layout: <class>/* from the train split (+ val folded in for size)
    hf = []
    for split in ("train", "val"):
        for cid in classes:
            for p in iter_images(DATASET / split / cid):
                hf.append((p, f"{cid}/{p.name}"))
    zip_paths(out_dir / "nexpec_dataset_hf.zip", hf)

    info(f"nexpec_dataset_full.zip  ({len(full)} entries)")
    info(f"nexpec_dataset_hf.zip    ({len(hf)} entries)")
    info(f"location: {out_dir}")
    print("\n  Upload per README → 'Where to upload'.\n")


if __name__ == "__main__":
    main()
