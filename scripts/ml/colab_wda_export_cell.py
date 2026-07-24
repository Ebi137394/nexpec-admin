# ════════════════════════════════════════════════════════════════════════════
#  NEXPEC — WDA weld-defect model → BROWSER-COMPATIBLE RAW TFLite (one Colab cell)
#
#  Paste this ENTIRE cell into Google Colab and Run. It: mounts Drive, finds the
#  WDA best.pt automatically, verifies it is the 5-class weld-defect SEG model
#  (never corrosion/coating), exports a RAW head (nms=False) at imgsz=1024 FP32,
#  proves the output is [1,41,21504] + [1,32,256,256] (rejects the [1,300,38]
#  end2end shape), writes the 3 artifacts to one Drive folder, zips them, and
#  prints a short PASS/FAIL summary.
#
#  It does NOT touch the corrosion/coating models and does NOT enable WDA — that
#  only happens after the .tflite is copied into the repo and passes
#  scripts/ml/verify-wda-raw.mjs + SHA checks + browser bring-up.
# ════════════════════════════════════════════════════════════════════════════
import os, sys, glob, json, time, hashlib, shutil, tempfile, subprocess, zipfile, datetime

SEARCH_ROOT   = "/content/drive/MyDrive/nexpec_ai"
OUT_DIRNAME   = "wda_fissures_yolo26s_seg_raw"          # Drive output folder (created under SEARCH_ROOT/exported_models)
BASENAME      = "wda_fissures_yolo26s_seg_1024_fp32"
IMGSZ         = 1024
WDA_LABELS    = ["fissures-wda", "Crack", "Porosity", "Spatters", "Welding line"]
PATH_HINTS    = ("wda", "fissure", "weld", "yolo26s_seg")
NUM_CLASSES   = len(WDA_LABELS)                          # 5
NUM_COEFFS    = 32
VECLEN        = 4 + NUM_CLASSES + NUM_COEFFS             # 41
ANCHORS       = (IMGSZ // 8) ** 2 + (IMGSZ // 16) ** 2 + (IMGSZ // 32) ** 2  # 21504

def _sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""): h.update(c)
    return h.hexdigest()

def _norm(names):
    vals = list(names.values()) if isinstance(names, dict) else list(names)
    return [str(v).strip().lower() for v in vals]

# ── 1) mount Drive ───────────────────────────────────────────────────────────
from google.colab import drive
drive.mount("/content/drive")
assert os.path.isdir(SEARCH_ROOT), f"{SEARCH_ROOT} not found — check your Drive layout."

# ── 6) install the exact toolchain (ultralytics pulls the TFLite export deps) ──
print("Installing ultralytics==8.4.95 + TFLite export deps…")
subprocess.run([sys.executable, "-m", "pip", "install", "-q",
                "ultralytics==8.4.95", "onnx2tf", "onnx", "onnxslim", "onnxruntime", "sng4onnx"], check=True)
import ultralytics
from ultralytics import YOLO
import numpy as np
import tensorflow as tf
print(f"versions → python {sys.version.split()[0]} · ultralytics {ultralytics.__version__} · "
      f"tensorflow {tf.__version__} · numpy {np.__version__}")

# ── 2/3) find every best.pt, prioritise WDA-looking paths, print each ─────────
found = sorted(glob.glob(os.path.join(SEARCH_ROOT, "**", "best.pt"), recursive=True))
def _prio(p):
    lp = p.lower(); return sum(k in lp for k in PATH_HINTS)
found.sort(key=lambda p: (-_prio(p), p))
print(f"\nFound {len(found)} best.pt under {SEARCH_ROOT}:")
for p in found:
    st = os.stat(p)
    print(f"  • {p}\n      size={st.st_size/1e6:.1f} MB  modified={datetime.datetime.fromtimestamp(st.st_mtime):%Y-%m-%d %H:%M}  hints={_prio(p)}")
assert found, "No best.pt found anywhere under nexpec_ai."

# ── 4/5) select ONLY the 5-class weld SEG checkpoint (never corrosion/coating) ─
target_set = set(l.lower() for l in WDA_LABELS)
candidates = []   # (path, exact_order_match)
for p in found:
    try:
        m = YOLO(p)                      # instantiate ONCE per checkpoint
        names = m.names
        task  = getattr(m, "task", None)
    except Exception as e:
        print(f"  ! could not read {p}: {e}"); continue
    n = _norm(names)
    is_wda = (task == "segment") and (len(n) == NUM_CLASSES) and (set(n) == target_set)
    print(f"  inspect {os.path.basename(os.path.dirname(p))}: task={task} classes={names}")
    if is_wda:
        candidates.append((p, n == [l.lower() for l in WDA_LABELS]))

assert candidates, ("No segmentation checkpoint with exactly the 5 WDA classes "
                    f"{WDA_LABELS} was found — refusing to export (won't ship corrosion/coating).")
candidates.sort(key=lambda c: (not c[1], -_prio(c[0])))   # exact-order match first, then path hints
best_pt = candidates[0][0]
print(f"\n✔ selected WDA checkpoint: {best_pt}")

# ── 7) clean temp workdir so no stale tflite can be picked up ─────────────────
work = tempfile.mkdtemp(prefix="wda_export_")
src  = os.path.join(work, "wda_src.pt")
shutil.copyfile(best_pt, src)

# ── 8) export RAW head (nms=False, end2end=False when supported), FP32 ────────
kw = dict(format="tflite", imgsz=IMGSZ, half=False, int8=False, nms=False)
try:
    exported = YOLO(src).export(end2end=False, **kw)
except TypeError:
    exported = YOLO(src).export(**kw)

# ── 9) resolve the artifact from export()'s OWN return path (scoped, no broad glob)
ep = str(exported)
if ep.endswith(".tflite") and os.path.exists(ep):
    tflite_path = ep
else:
    base = ep if os.path.isdir(ep) else os.path.dirname(ep)
    hits = sorted(glob.glob(os.path.join(base, "**", "*float32.tflite"), recursive=True), key=os.path.getmtime)
    assert hits, f"No *float32.tflite under the export output {base}"
    tflite_path = hits[-1]
print(f"exported artifact: {tflite_path}")

# ── 10/11/12) prove the RAW contract with the TFLite runtime ──────────────────
interp = tf.lite.Interpreter(model_path=tflite_path); interp.allocate_tensors()
ins  = interp.get_input_details(); outs = interp.get_output_details()
in_shape  = [int(x) for x in ins[0]["shape"]]
out_shapes = [[int(x) for x in o["shape"]] for o in outs]
out_dtypes = [str(o["dtype"]) for o in outs]

# Raw det head may be channels-first [1,41,21504] or transposed [1,21504,41] —
# the shared decoder derives the axis from the shape, so both are OK.
def _is_det(s):   return len(s) == 3 and {s[1], s[2]} == {VECLEN, ANCHORS}
# Prototype MUST be channels-first [1,32,256,256] — decodeYoloSeg indexes it as
# out1[k*plane+p]. [1,256,256,32] (NHWC) is NOT accepted (would misread the mask).
def _is_proto(s): return s == [1, NUM_COEFFS, 256, 256]
def _is_e2e(s):   return len(s) == 3 and (300 in s or 38 in s)

det_ok   = any(_is_det(s)   for s in out_shapes)
proto_ok = any(_is_proto(s) for s in out_shapes)
e2e_bad  = any(_is_e2e(s)   for s in out_shapes)
# Input MUST be NCHW [1,3,1024,1024] — the browser runtime always builds NCHW
# (fromPixels→resize→/255→transpose([2,0,1])). NHWC is FAIL (mismatched feed).
in_ok      = (in_shape == [1, 3, IMGSZ, IMGSZ])
in_is_nhwc = (in_shape == [1, IMGSZ, IMGSZ, 3])
tfl3     = open(tflite_path, "rb").read(8)[4:8] == b"TFL3"
nc_from_head = (min([s for s in out_shapes if _is_det(s)][0][1:]) - 4 - NUM_COEFFS) if det_ok else None
cls_ok   = (nc_from_head == NUM_CLASSES)

# run one zeros inference → outputs must be finite (no NaN/Inf)
try:
    z = np.zeros(in_shape, dtype=np.float32); interp.set_tensor(ins[0]["index"], z); interp.invoke()
    finite_ok = all(np.isfinite(interp.get_tensor(o["index"])).all() for o in outs)
except Exception as e:
    finite_ok = False; print(f"  ! inference check failed: {e}")

size_bytes = os.path.getsize(tflite_path)
sha = _sha256(tflite_path)
PASS = all([tfl3, in_ok, det_ok, proto_ok, cls_ok, finite_ok, not e2e_bad, size_bytes > 1_000_000])

# ── 13/14) write the 3 artifacts into ONE Drive folder + zip ─────────────────
out_dir = os.path.join(SEARCH_ROOT, "exported_models", OUT_DIRNAME); os.makedirs(out_dir, exist_ok=True)
final_tflite = os.path.join(out_dir, f"{BASENAME}.tflite"); shutil.copyfile(tflite_path, final_tflite)
tensors = {"format": "LiteRT/TFLite", "task": "instance-segmentation", "precision": "FP32",
           "input_image_size": IMGSZ, "batch_size": 1, "sha256": sha, "output_count": len(outs),
           "inputs": [{"name": ins[0]["name"], "shape": in_shape, "dtype": str(ins[0]["dtype"])}],
           "outputs": [{"name": o["name"], "shape": s, "dtype": d} for o, s, d in zip(outs, out_shapes, out_dtypes)]}
info = {"name": "NEXPEC WDA Weld-Defect YOLO26s Segmentation (RAW head)", "task": "instance-segmentation",
        "format": "LiteRT/TFLite FP32", "nms": False, "output_contract": "raw-yolo-segmentation-heads",
        "input_size": IMGSZ, "classes": {str(i): c for i, c in enumerate(WDA_LABELS)},
        "source_checkpoint": best_pt, "tflite_file": f"{BASENAME}.tflite", "tflite_sha256": sha,
        "tflite_size_bytes": size_bytes, "exported_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat()}
json.dump(tensors, open(os.path.join(out_dir, f"{BASENAME}_tensors.json"), "w"), indent=2)
json.dump(info,    open(os.path.join(out_dir, f"{BASENAME}_model_info.json"), "w"), indent=2)
zip_path = os.path.join(out_dir, f"{BASENAME}_raw_bundle.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for fn in (f"{BASENAME}.tflite", f"{BASENAME}_tensors.json", f"{BASENAME}_model_info.json"):
        z.write(os.path.join(out_dir, fn), fn)

# ── 15) final summary — ONLY these lines ─────────────────────────────────────
print("\n══════════════════ WDA RAW EXPORT SUMMARY ══════════════════")
print("selected best.pt :", best_pt)
print("exported tflite  :", final_tflite)
in_note = "" if in_ok else (
    "  ⚠ NHWC — FAIL: browser feeds NCHW [1,3,1024,1024]; re-export must be NCHW like corrosion"
    if in_is_nhwc else "  ⚠ expected NCHW [1,3,1024,1024]")
print("input shape      :", in_shape, in_note)
out_note = "" if (det_ok and proto_ok and not e2e_bad) else (
    "  ⚠ not the raw contract: need det [1,41,21504] + proto [1,32,256,256] channels-first "
    "(proto must NOT be [1,256,256,32]; must NOT be end2end [1,300,38])")
print("output shapes    :", out_shapes, out_note)
print("sha256           :", sha)
print("result           :", "PASS" if PASS else "FAIL")
print("zip download path:", zip_path)
if not PASS:
    print("  reasons:", {"tfl3": tfl3, "input_NCHW[1,3,1024,1024]": in_ok, "det[1,41,21504]": det_ok,
                          "proto[1,32,256,256]": proto_ok, "classes==5": cls_ok, "finite": finite_ok,
                          "not_end2end": not e2e_bad, "size>1MB": size_bytes > 1_000_000})
if PASS:
    try:
        from google.colab import files; files.download(zip_path)   # download ONLY on PASS
    except Exception:
        pass
