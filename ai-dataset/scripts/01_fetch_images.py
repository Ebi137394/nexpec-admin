#!/usr/bin/env python3
"""Step 1 — collect images per class  (YOU run this on your own machine).

Two sources, combined:
  1) sources/<class>.txt  — any line that is a direct image URL is downloaded.
  2) search phrases       — classes.txt terms (+ non-URL lines in sources/<class>.txt)
     are searched via `icrawler` with a COMMERCIAL-REUSE license filter.

  python3 01_fetch_images.py                 # all classes, default cap
  python3 01_fetch_images.py --max 250       # up to 250 imgs/class
  python3 01_fetch_images.py --only corrosion crack
  python3 01_fetch_images.py --no-search     # only download explicit URLs

⚠️  LICENSING: web-search results have mixed licenses even with the filter on.
    For a COMMERCIAL model, prefer the curated open datasets in SOURCES.md and
    verify rights before shipping. This tool is a starting point, not clearance.
"""
from __future__ import annotations
import argparse
import urllib.request
from pathlib import Path
from _common import (load_classes, RAW, SOURCES, ensure_dir, iter_images,
                     header, info, die)

UA = "Mozilla/5.0 (NEXPEC-dataset-prep; respectful; +local)"
DEFAULT_MAX = 200


def read_seed_lines(cid: str) -> list[str]:
    f = SOURCES / f"{cid}.txt"
    if not f.exists():
        return []
    out = []
    for ln in f.read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if s and not s.startswith("#"):
            out.append(s)
    return out


def download_url(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        if len(data) < 1024:  # skip tiny/placeholder responses
            return False
        dest.write_bytes(data)
        return True
    except Exception as e:  # noqa: BLE001 — best-effort, keep going
        info(f"skip url ({e}): {url[:80]}")
        return False


def search_download(query: str, out_dir: Path, max_num: int) -> None:
    """Use icrawler (Bing) with a commercial-reuse license filter."""
    try:
        from icrawler.builtin import BingImageCrawler
    except ImportError:
        die("icrawler not installed. Run:  python3 -m pip install icrawler\n"
            "  (or re-run with --no-search to only download explicit URLs)")
    crawler = BingImageCrawler(
        downloader_threads=4,
        storage={"root_dir": str(out_dir)},
        log_level=40,  # quiet
    )
    # 'commercial,modify' = free to use + modify (closest safe filter for a product)
    crawler.crawl(keyword=query, max_num=max_num,
                  filters={"license": "commercial,modify"}, file_idx_offset="auto")


def main() -> None:
    ap = argparse.ArgumentParser(description="Collect images per class.")
    ap.add_argument("--max", type=int, default=DEFAULT_MAX, help="max images per class")
    ap.add_argument("--only", nargs="*", help="limit to these class ids")
    ap.add_argument("--no-search", action="store_true", help="only download explicit URLs")
    args = ap.parse_args()

    header("STEP 1 · Collect images  (respect licenses — see SOURCES.md)")
    print("  ⚠️  Verify image rights before using in a COMMERCIAL model.\n")
    classes = load_classes()

    for cid, terms in classes.items():
        if args.only and cid not in args.only:
            continue
        out = ensure_dir(RAW / cid)
        have = sum(1 for _ in iter_images(out))
        info(f"[{cid}] starting with {have} image(s), target ≤ {args.max}")

        # 1) explicit URLs from sources/<class>.txt
        seeds = read_seed_lines(cid)
        urls = [s for s in seeds if s.lower().startswith(("http://", "https://"))
                and any(s.lower().split("?")[0].endswith(e)
                        for e in (".jpg", ".jpeg", ".png", ".webp", ".bmp"))]
        for i, u in enumerate(urls):
            if sum(1 for _ in iter_images(out)) >= args.max:
                break
            download_url(u, out / f"url_{i:04d}{Path(u.split('?')[0]).suffix or '.jpg'}")

        # 2) search phrases (classes.txt terms + non-URL seed lines)
        if not args.no_search:
            phrases = list(dict.fromkeys(
                [cid.replace("_", " ")] + terms +
                [s for s in seeds if not s.lower().startswith("http")]
            ))
            remaining = args.max - sum(1 for _ in iter_images(out))
            per_phrase = max(10, remaining // max(1, len(phrases)))
            for q in phrases:
                if sum(1 for _ in iter_images(out)) >= args.max:
                    break
                info(f"[{cid}] searching: “{q}” (≤{per_phrase})")
                try:
                    search_download(q, out, per_phrase)
                except SystemExit:
                    raise
                except Exception as e:  # noqa: BLE001
                    info(f"[{cid}] search error: {e}")

        info(f"[{cid}] now {sum(1 for _ in iter_images(out))} image(s) in {out}")

    print("\n  Next: python3 02_clean.py  (dedupe + drop low-quality)\n")


if __name__ == "__main__":
    main()
