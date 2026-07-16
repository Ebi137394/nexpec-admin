#!/usr/bin/env python3
"""Step 4 — write annotation manifests over the split dataset.

Outputs into data/dataset/:
  • labels.csv        filepath,label,split            (universal, Vertex-friendly)
  • annotations.json  [{file,label,split,width,height,sha1}]
  • dataset_card.json summary: classes, per-split counts, created_at, notes
  • labels.txt        one class per line (index order = model output order)

  python3 04_manifest.py
"""
from __future__ import annotations
import csv
import hashlib
import json
from datetime import datetime, timezone
from _common import (load_classes, DATASET, SPLITS, iter_images,
                     header, info, die, require)


def main() -> None:
    require("PIL", "Pillow")
    from PIL import Image

    header("STEP 4 · Manifests → labels.csv / annotations.json / dataset_card.json")
    if not DATASET.exists() or not any((DATASET / s).exists() for s in SPLITS):
        die("no split found — run 03_split.py first")

    classes = list(load_classes())
    rows: list[dict] = []
    counts = {s: {c: 0 for c in classes} for s in SPLITS}

    for split in SPLITS:
        for cid in classes:
            folder = DATASET / split / cid
            for p in iter_images(folder):
                try:
                    with Image.open(p) as im:
                        w, h = im.size
                except Exception:
                    continue
                sha1 = hashlib.sha1(p.read_bytes()).hexdigest()
                rel = p.relative_to(DATASET).as_posix()
                rows.append({"file": rel, "label": cid, "split": split,
                             "width": w, "height": h, "sha1": sha1})
                counts[split][cid] += 1

    if not rows:
        die("no images found under data/dataset/ — run 01→03 first")

    # labels.csv
    with (DATASET / "labels.csv").open("w", newline="", encoding="utf-8") as f:
        wcsv = csv.DictWriter(f, fieldnames=["file", "label", "split", "width", "height", "sha1"])
        wcsv.writeheader()
        wcsv.writerows(rows)

    # annotations.json
    (DATASET / "annotations.json").write_text(
        json.dumps(rows, indent=2), encoding="utf-8")

    # labels.txt (index order = training output order)
    (DATASET / "labels.txt").write_text("\n".join(classes) + "\n", encoding="utf-8")

    # dataset_card.json
    card = {
        "name": "nexpec-coinspector-classification",
        "task": "image_classification",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "classes": classes,
        "num_classes": len(classes),
        "total_images": len(rows),
        "counts": counts,
        "format": "ImageFolder (train/val/test/<class>/*.jpg) + labels.csv",
        "notes": "Folder name = label. Verify image licenses before commercial use.",
    }
    (DATASET / "dataset_card.json").write_text(json.dumps(card, indent=2), encoding="utf-8")

    info(f"{len(rows)} images across {len(classes)} classes")
    for s in SPLITS:
        info(f"{s}: " + ", ".join(f"{c}={counts[s][c]}" for c in classes))
    info(f"written → {DATASET}/labels.csv, annotations.json, labels.txt, dataset_card.json")
    print("\n  Next: python3 05_validate.py\n")


if __name__ == "__main__":
    main()
