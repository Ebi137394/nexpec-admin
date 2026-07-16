"""Shared helpers for the NEXPEC dataset pipeline.

All scripts import from here so paths + class parsing stay consistent.
Pure-stdlib except where a script explicitly needs Pillow/numpy/etc.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple

# ── Paths (everything is relative to the ai-dataset/ root) ───────────────────
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"          # downloaded / dropped-in images, per class
CLEAN = ROOT / "data" / "clean"      # after dedup + quality filtering, per class
DATASET = ROOT / "data" / "dataset"  # final train/val/test ImageFolder + manifests
SOURCES = ROOT / "sources"           # optional per-class URL/query lists
CLASSES_FILE = ROOT / "classes.txt"

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
SPLITS = ("train", "val", "test")


def load_classes() -> Dict[str, List[str]]:
    """Parse classes.txt → {class_id: [extra search terms]} preserving order."""
    if not CLASSES_FILE.exists():
        die(f"classes.txt not found at {CLASSES_FILE}")
    classes: Dict[str, List[str]] = {}
    for raw_line in CLASSES_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "|" in line:
            cid, terms = line.split("|", 1)
            extra = [t.strip() for t in terms.split(",") if t.strip()]
        else:
            cid, extra = line, []
        cid = cid.strip().lower().replace(" ", "_")
        if cid:
            classes[cid] = extra
    if not classes:
        die("No classes parsed from classes.txt — add at least one class line.")
    return classes


def iter_images(folder: Path):
    """Yield image file paths under folder (non-recursive), sorted."""
    if not folder.exists():
        return
    for p in sorted(folder.iterdir()):
        if p.is_file() and p.suffix.lower() in IMG_EXTS:
            yield p


def ensure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def die(msg: str, code: int = 1):
    print(f"\n  ERROR: {msg}\n", file=sys.stderr)
    raise SystemExit(code)


def info(msg: str):
    print(f"  • {msg}")


def header(title: str):
    print("\n" + "═" * 68)
    print(f"  {title}")
    print("═" * 68)


def require(mod: str, pip_name: str | None = None):
    """Import a third-party module or exit with an install hint."""
    try:
        return __import__(mod)
    except ImportError:
        die(f"missing dependency '{mod}'. Install with:  "
            f"python3 -m pip install {pip_name or mod}")
