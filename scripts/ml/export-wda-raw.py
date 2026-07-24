# ════════════════════════════════════════════════════════════════════════════
#  export-wda-raw.py — re-export the WDA weld-defect SEG model as a BROWSER-
#  COMPATIBLE RAW head (nms=False), mirroring the PROVEN corrosion export.
#
#  WHY: the shipped WDA .tflite is an END-TO-END (NMS-baked) export whose output
#  is [1,300,38]. tfjs-tflite's web-WASM runtime cannot initialize its in-graph
#  selection ops → "INVALID_ARGUMENT: Can't initialize model". The corrosion +
#  coating siblings are RAW heads and initialize fine. Re-exporting WDA the same
#  way ([1,41,21504] + [1,32,256,256]) makes it load and decode with the exact
#  same shared decoder that already renders corrosion.
#
#  WHERE TO RUN: your Colab/Drive environment — that is where best.pt and the
#  torch/ultralytics/tensorflow toolchain live (the NEXPEC dev sandbox has none
#  of these, and best.pt is NOT in the repo). Matches the corrosion export:
#    ultralytics 8.4.95 · nms=False · imgsz=1024 · FP32.
#
#  USAGE (Colab cell or `python export-wda-raw.py`):
#    pip install "ultralytics==8.4.95" tensorflow onnx onnx2tf
#    python export-wda-raw.py
#  then download best_saved_model/best_float32.tflite + the two .json it writes.
# ════════════════════════════════════════════════════════════════════════════
import json, hashlib, os, glob, datetime, shutil

# ── EDIT THIS: the WDA segmentation checkpoint in your Drive ──────────────────
# (analogous to corrosion's /content/drive/MyDrive/nexpec_ai/training/
#  corrosion_yolo26s_seg/run/weights/best.pt — set the WDA equivalent).
BEST_PT = "/content/drive/MyDrive/nexpec_ai/training/wda_fissures_yolo26s_seg/run/weights/best.pt"
IMGSZ = 1024
OUT_BASENAME = "wda_fissures_yolo26s_seg_1024_fp32"
# 5 classes, verbatim order from training (index = classId). MUST match the
# registry WDA_LABELS: ['fissures-wda','Crack','Porosity','Spatters','Welding line'].
CLASSES = ["fissures-wda", "Crack", "Porosity", "Spatters", "Welding line"]

EXPECTED_VECLEN = 4 + len(CLASSES) + 32          # 41
EXPECTED_ANCHORS = (IMGSZ // 8) ** 2 + (IMGSZ // 16) ** 2 + (IMGSZ // 32) ** 2  # 21504


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    from ultralytics import YOLO  # torch + ultralytics 8.4.95

    assert os.path.exists(BEST_PT), f"best.pt not found at {BEST_PT} — set BEST_PT to your WDA checkpoint."
    model = YOLO(BEST_PT)

    # RAW head — the single flag that matters. nms=False (and, on versions that
    # expose it, end2end=False) prevents the in-graph NMS/selection that breaks
    # tfjs-tflite. half=False → FP32. Same recipe that produced corrosion's
    # working [1,47,21504] raw head.
    kwargs = dict(format="tflite", imgsz=IMGSZ, half=False, int8=False, nms=False)
    try:
        model.export(end2end=False, **kwargs)   # some builds accept end2end
    except TypeError:
        model.export(**kwargs)                    # older/newer signatures: nms=False suffices

    # locate the FP32 tflite Ultralytics just wrote
    cands = glob.glob("**/*_float32.tflite", recursive=True) + glob.glob("**/*float32*.tflite", recursive=True)
    assert cands, "No *_float32.tflite produced — check the export logs above."
    src = max(cands, key=os.path.getmtime)
    dst = f"{OUT_BASENAME}.tflite"
    shutil.copyfile(src, dst)

    # introspect with the TFLite runtime (present in Colab) → shapes we can verify
    import tensorflow as tf
    it = tf.lite.Interpreter(model_path=dst)
    it.allocate_tensors()
    ins = [{"name": d["name"], "shape": [int(x) for x in d["shape"]], "dtype": str(d["dtype"])} for d in it.get_input_details()]
    outs = [{"name": d["name"], "shape": [int(x) for x in d["shape"]], "dtype": str(d["dtype"])} for d in it.get_output_details()]

    tensors = {
        "format": "LiteRT/TFLite", "task": "instance-segmentation", "precision": "FP32",
        "input_image_size": IMGSZ, "batch_size": 1, "sha256": sha256_of(dst),
        "output_count": len(outs), "inputs": ins, "outputs": outs,
    }
    with open(f"{OUT_BASENAME}_tensors.json", "w") as f:
        json.dump(tensors, f, indent=2)

    info = {
        "name": "NEXPEC WDA Weld-Defect YOLO26s Segmentation (RAW head)",
        "task": "instance-segmentation", "format": "LiteRT/TFLite FP32",
        "nms": False, "output_contract": "raw-yolo-segmentation-heads",
        "input_size": IMGSZ, "classes": {str(i): c for i, c in enumerate(CLASSES)},
        "source_checkpoint": BEST_PT, "tflite_file": dst,
        "tflite_sha256": sha256_of(dst),
        "exported_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    with open(f"{OUT_BASENAME}_model_info.json", "w") as f:
        json.dump(info, f, indent=2)

    # ── acceptance checks: raw head must be [1,41,21504] + proto [1,32,256,256] ──
    shapes = [tuple(o["shape"]) for o in outs]
    det = next((s for s in shapes if len(s) == 3 and min(s[1], s[2]) == EXPECTED_VECLEN), None)
    proto = next((s for s in shapes if len(s) == 4 and s[1] == 32), None)
    print("\n──────── WDA RAW EXPORT RESULT ────────")
    print("input  :", ins[0]["shape"])
    print("outputs:", shapes)
    print("sha256 :", info["tflite_sha256"])
    ok = det is not None and proto is not None and 300 not in [s[1] for s in shapes if len(s) == 3]
    print("det head [1,%d,%d]:" % (EXPECTED_VECLEN, EXPECTED_ANCHORS), "OK" if det else "MISSING — still end2end? re-check nms=False")
    print("proto [1,32,256,256]     :", "OK" if proto else "MISSING")
    print("RAW (not [1,300,38])     :", "OK" if ok else "FAIL — output still looks end2end")
    print("VERDICT:", "PASS — copy the .tflite into the repo and run scripts/ml/verify-wda-raw.mjs" if ok else "FAIL — do not ship")


if __name__ == "__main__":
    main()
