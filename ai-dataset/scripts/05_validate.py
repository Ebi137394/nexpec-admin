#!/usr/bin/env python3
"""Step 5 — validate the finished dataset before you upload it.

Checks: per-class/per-split counts, class balance, min-per-class, corrupt files,
and train/val/test LEAKAGE (same image hash in >1 split). Exit code 1 on hard fail.

  python3 05_validate.py            # or:  --min-per-class 100
"""
from __future__ import annotations
import argparse
import hashlib
from collections import defaultdict
from _common import (load_classes, DATASET, SPLITS, iter_images,
                     header, info, require)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-per-class", type=int, default=50)
    ap.add_argument("--imbalance", type=float, default=3.0,
                    help="warn if max/min class count ratio exceeds this")
    args = ap.parse_args()

    require("PIL", "Pillow")
    from PIL import Image

    header("STEP 5 · Validate dataset")
    classes = list(load_classes())
    counts = {s: {c: 0 for c in classes} for s in SPLITS}
    seen_hash: dict[str, tuple[str, str]] = {}
    problems: list[str] = []
    corrupt = 0

    for split in SPLITS:
        for cid in classes:
            for p in iter_images(DATASET / split / cid):
                try:
                    with Image.open(p) as im:
                        im.verify()
                except Exception:
                    corrupt += 1
                    problems.append(f"corrupt: {p}")
                    continue
                counts[split][cid] += 1
                h = hashlib.sha1(p.read_bytes()).hexdigest()
                if h in seen_hash:
                    os_, op = seen_hash[h]
                    if os_ != split:
                        problems.append(f"LEAKAGE: {split}/{cid}/{p.name} also in {os_}")
                else:
                    seen_hash[h] = (split, cid)

    totals = {c: sum(counts[s][c] for s in SPLITS) for c in classes}
    for s in SPLITS:
        info(f"{s}: " + ", ".join(f"{c}={counts[s][c]}" for c in classes))
    info("totals: " + ", ".join(f"{c}={totals[c]}" for c in classes))

    # balance + minimums
    nonzero = [v for v in totals.values() if v > 0]
    if nonzero and (max(totals.values()) / max(1, min(nonzero))) > args.imbalance:
        problems.append(f"imbalanced classes (ratio > {args.imbalance}) — even them out")
    for c, v in totals.items():
        if v < args.min_per_class:
            problems.append(f"class '{c}' has {v} imgs (< {args.min_per_class} recommended)")

    print()
    hard = [p for p in problems if p.startswith(("LEAKAGE", "corrupt"))]
    if not problems:
        info("✅ dataset looks good — ready to upload.")
    else:
        for p in problems:
            info(("❌ " if p in hard else "⚠️  ") + p)
    print("\n  When green, upload data/dataset/ per README → 'Where to upload'.\n")
    raise SystemExit(1 if hard else 0)


if __name__ == "__main__":
    main()
