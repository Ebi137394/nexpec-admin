# ════════════════════════════════════════════════════════════════════════════
#  NEXPEC — COATING detector parity probe (one Colab cell, v2). Decides from
#  MEASUREMENTS why the browser gets ~0, without touching the repo/models.
#
#  Fixes vs v1: validation images are scoped to the EXACT coating dataset (never
#  corrosion/WDA); negatives found by image (not by .txt); fixed user-image path;
#  best.pt reported as RAW head-max (pre-NMS) AND post-NMS; per-class evaluation;
#  boxes restored to original-image normalized xyxy for every route; full TFLite
#  verification (SHA/shape/dtype/order); ratio-based per-class + overall verdict.
#  No sigmoid unless the head is proven to emit logits; no threshold reduction;
#  no artifact replacement without measured parity + a new verified SHA.
# ════════════════════════════════════════════════════════════════════════════
import os, sys, glob, hashlib, subprocess, numpy as np

DRIVE_ROOT     = "/content/drive/MyDrive/nexpec_ai"
BEST_PT        = f"{DRIVE_ROOT}/runs/yolov9t_2class_v1/weights/best.pt"
TFLITE_NAME    = "yolov9t_2class_fp32.tflite"
REGISTERED_SHA = "4da2665ff8134a7194accfc8764a71976ca233c9e9488a9c4083902aba804be7"
USER_IMAGE_FIXED = f"{DRIVE_ROOT}/parity_inputs/pinholew.jpeg"
IMGSZ          = 640
CLASSES        = ["inclusion", "pinhole"]          # index = classId (must match training)
BROWSER_CONF, BROWSER_IOU = 0.25, 0.45             # SAME as the browser decoder
NC = len(CLASSES)

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""): h.update(c)
    return h.hexdigest()
def first(xs): return xs[0] if xs else None

# ── mount + deps ─────────────────────────────────────────────────────────────
from google.colab import drive
drive.mount("/content/drive")
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "ultralytics==8.4.95", "pyyaml"], check=True)
import cv2, yaml, torch, tensorflow as tf
from ultralytics import YOLO
import ultralytics
print(f"versions → python {sys.version.split()[0]} · ultralytics {ultralytics.__version__} · torch {torch.__version__} · tf {tf.__version__}")

# ── checkpoint (verify 2-class detection: inclusion/pinhole) ──────────────────
if not os.path.exists(BEST_PT):
    for c in sorted(glob.glob(f"{DRIVE_ROOT}/**/best.pt", recursive=True)):
        try:
            mm = YOLO(c)
            if getattr(mm, "task", None) == "detect" and set(str(v).lower() for v in mm.names.values()) == set(CLASSES):
                BEST_PT = c; break
        except Exception: pass
assert os.path.exists(BEST_PT), "coating best.pt not found — set BEST_PT."
model = YOLO(BEST_PT); model.model.eval()
print(f"checkpoint: {BEST_PT}\n  task={getattr(model,'task',None)} names={model.names}")
assert set(str(v).lower() for v in model.names.values()) == set(CLASSES), "checkpoint classes are not {inclusion,pinhole} — refusing."

# ── (8) fully verify the TFLite artifact ─────────────────────────────────────
tfl = first(sorted(glob.glob(f"{DRIVE_ROOT}/**/{TFLITE_NAME}", recursive=True)))
assert tfl, f"{TFLITE_NAME} not found under {DRIVE_ROOT}."
tfl_sha = sha256(tfl); sha_match = (tfl_sha == REGISTERED_SHA)
interp = tf.lite.Interpreter(model_path=tfl); interp.allocate_tensors()
IN = interp.get_input_details()[0]; OUT = interp.get_output_details()[0]
in_shape = [int(x) for x in IN["shape"]]; out_shape = [int(x) for x in OUT["shape"]]
in_is_nchw = (in_shape == [1, 3, IMGSZ, IMGSZ])
vec = min(out_shape[1], out_shape[2]) if len(out_shape) == 3 else -1
order = "channels-first" if (len(out_shape) == 3 and out_shape[1] < out_shape[2]) else "det-major"
print("\n──────── TFLITE ARTIFACT ────────")
print(f"  path   : {tfl}\n  size   : {os.path.getsize(tfl)} bytes\n  sha256 : {tfl_sha}\n  registered: {REGISTERED_SHA}\n  SHA match : {sha_match}")
print(f"  input  : {in_shape} {IN['dtype'].__name__} ({'NCHW' if in_is_nchw else 'NHWC/other'})")
print(f"  output : {out_shape} {OUT['dtype'].__name__}  vecLen={vec}  classes={vec-4}  order={order}")

# ── (1) scope validation to the EXACT coating dataset ────────────────────────
def resolve_coating_dataset(root):
    # prefer a data.yaml whose names are exactly the coating classes
    for y in sorted(glob.glob(f"{root}/**/*.yaml", recursive=True) + glob.glob(f"{root}/**/*.yml", recursive=True)):
        try: d = yaml.safe_load(open(y))
        except Exception: continue
        names = d.get("names") if isinstance(d, dict) else None
        vals = set(str(v).lower() for v in (names.values() if isinstance(names, dict) else (names or [])))
        if {"inclusion", "pinhole"}.issubset(vals):
            base = d.get("path") or os.path.dirname(y)
            base = base if os.path.isabs(str(base)) else os.path.join(os.path.dirname(y), str(base))
            def res(split):
                v = d.get(split)
                if not v: return None
                p = v if os.path.isabs(str(v)) else os.path.join(base, str(v))
                return p
            return y, base, res("val") or res("test") or res("train")
    return None, None, None

def list_val_images(val_spec, base):
    imgs = []
    if val_spec and os.path.isfile(val_spec) and val_spec.endswith((".txt",)):
        for ln in open(val_spec).read().splitlines():
            ln = ln.strip()
            if not ln: continue
            for cand in (ln, os.path.join(base, ln), os.path.join(base, os.path.basename(ln)),
                         os.path.join(base, "images", os.path.basename(ln))):
                if os.path.exists(cand): imgs.append(cand); break
    else:
        d = val_spec if (val_spec and os.path.isdir(val_spec)) else (os.path.join(base or "", "images"))
        for ext in ("*.jpg", "*.jpeg", "*.png", "*.bmp"):
            imgs += glob.glob(os.path.join(d, "**", ext), recursive=True)
    return sorted(set(imgs))

def label_for(img):
    stem = os.path.splitext(img)[0]
    for cand in (stem + ".txt", stem.replace("/images/", "/labels/") + ".txt",
                 os.path.join(os.path.dirname(img).replace("/images", "/labels"), os.path.splitext(os.path.basename(img))[0] + ".txt")):
        if os.path.exists(cand): return cand
    return None

yaml_path, base, val_spec = resolve_coating_dataset(DRIVE_ROOT)
assert yaml_path, "coating data.yaml (names include inclusion+pinhole) not found — cannot scope validation. Aborting."
val_imgs = list_val_images(val_spec, base)
print("\n──────── COATING VALIDATION (scoped) ────────")
print(f"  data.yaml : {yaml_path}\n  base      : {base}\n  val spec  : {val_spec}\n  val images: {len(val_imgs)}")
assert val_imgs, "no coating validation images resolved — aborting (won't use another dataset)."

def pick_with_class(cid):
    for img in val_imgs:
        lb = label_for(img)
        if not lb: continue
        rows = [r.split() for r in open(lb).read().splitlines() if r.strip()]
        if any(len(r) >= 5 and r[0].isdigit() and int(r[0]) == cid for r in rows):
            return img, lb, rows
    return None, None, None
def pick_negative():
    for img in val_imgs:
        lb = label_for(img)
        if lb is None or os.path.getsize(lb) == 0 or not open(lb).read().strip():
            return img, lb
    return None, None

inc_img, inc_lb, inc_rows = pick_with_class(0)
pin_img, pin_lb, pin_rows = pick_with_class(1)
neg_img, neg_lb = pick_negative()
print(f"  inclusion : {inc_img}\n     label  : {inc_lb}\n     rows   : {inc_rows}")
print(f"  pinhole   : {pin_img}\n     label  : {pin_lb}\n     rows   : {pin_rows}")
print(f"  negative  : {neg_img}  (label: {neg_lb if neg_lb else 'none'})")

# ── (3) user image: fixed path first, then search ────────────────────────────
user_img = USER_IMAGE_FIXED if os.path.exists(USER_IMAGE_FIXED) else first(
    sorted(glob.glob(f"{DRIVE_ROOT}/**/pinholew.jpeg", recursive=True) + glob.glob("/content/**/pinholew.jpeg", recursive=True)))
print("USER IMAGE NOT FOUND — continuing with dataset examples." if not user_img else f"  user image: {user_img}")

# ── (7) preprocessing: exact Ultralytics letterbox + browser stretch ─────────
def letterbox(bgr, size=IMGSZ, color=(114, 114, 114)):
    h, w = bgr.shape[:2]; r = min(size / h, size / w); nu = (round(w * r), round(h * r))
    dw, dh = (size - nu[0]) / 2, (size - nu[1]) / 2
    resized = cv2.resize(bgr, nu, interpolation=cv2.INTER_LINEAR)
    top, bottom = round(dh - 0.1), round(dh + 0.1); left, right = round(dw - 0.1), round(dw + 0.1)
    canvas = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
    return canvas, r, left, top

def to_tensor(bgr_canvas, bgr=False):  # RGB (or BGR diagnostic), /255, NCHW
    img = bgr_canvas if bgr else cv2.cvtColor(bgr_canvas, cv2.COLOR_BGR2RGB)
    return np.ascontiguousarray(np.transpose(img.astype(np.float32) / 255.0, (2, 0, 1))[None])

def tflite_raw(x_nchw):
    xi = x_nchw if in_is_nchw else np.transpose(x_nchw, (0, 2, 3, 1))
    if IN["dtype"] == np.uint8:
        sc, zp = IN["quantization"]; xi = np.clip(np.round(xi / (sc or 1.0) + zp), 0, 255).astype(np.uint8)
    interp.set_tensor(IN["index"], xi.astype(IN["dtype"])); interp.invoke()
    return interp.get_tensor(OUT["index"])

def restore_lb(xyxy_n, r, padX, padY, ow, oh):  # normalized-640 → normalized-original
    p = np.array(xyxy_n, float) * IMGSZ; p[[0, 2]] -= padX; p[[1, 3]] -= padY; p /= r
    p[[0, 2]] = np.clip(p[[0, 2]], 0, ow); p[[1, 3]] = np.clip(p[[1, 3]], 0, oh)
    return [round(p[0] / ow, 3), round(p[1] / oh, 3), round(p[2] / ow, 3), round(p[3] / oh, 3)]

def nms(boxes, scores, iou_thr):
    idx = scores.argsort()[::-1]; keep = []
    while len(idx):
        i = idx[0]; keep.append(i)
        if len(idx) == 1: break
        rest = idx[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0]); yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2]); yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        ai = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        ar = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        iou = inter / (ai + ar - inter + 1e-9); idx = rest[iou <= iou_thr]
    return keep

def decode_tflite(out, r, padX, padY, ow, oh, stretch):
    a = out[0]
    if a.shape[0] in (5, 6, 7) and a.shape[1] > a.shape[0]: a = a.T           # (6,8400)->(8400,6)
    cls = a[:, 4:4 + NC]; scores = cls.max(1); ids = cls.argmax(1)
    raw_max = float(scores.max()) if scores.size else 0.0
    xywh = a[:, :4]
    xyxy = np.stack([xywh[:, 0] - xywh[:, 2] / 2, xywh[:, 1] - xywh[:, 3] / 2, xywh[:, 0] + xywh[:, 2] / 2, xywh[:, 1] + xywh[:, 3] / 2], 1)
    m = scores >= BROWSER_CONF; dets = []
    if m.any():
        for c in range(NC):
            cm = m & (ids == c)
            if not cm.any(): continue
            bx, sc = xyxy[cm], scores[cm]
            for k in nms(bx, sc, BROWSER_IOU):
                box_n = list(np.clip(bx[k], 0, 1)) if stretch else restore_lb(bx[k], r, padX, padY, ow, oh)
                dets.append((CLASSES[c], round(float(sc[k]), 4), [round(float(v), 3) for v in box_n]))
    return raw_max, (CLASSES[int(ids[scores.argmax()])] if scores.size else None), dets

def best_pt_routes(path):
    bgr = cv2.imread(path); oh, ow = bgr.shape[:2]
    canvas, r, padX, padY = letterbox(bgr)
    x = torch.from_numpy(to_tensor(canvas)).float()
    with torch.no_grad(): out = model.model(x)
    pred = out[0] if isinstance(out, (list, tuple)) else out
    p = pred.cpu().numpy()[0]
    if p.shape[0] > p.shape[1]: p = p.T                    # -> (anchors, 4+nc)
    cls = p[:, 4:4 + NC]; raw_max = float(cls.max())
    head_is_prob = (cls.min() >= -0.01 and cls.max() <= 1.01)   # (4) sigmoid ONLY if logits
    if not head_is_prob: raw_max = float(1 / (1 + np.exp(-cls)).max())
    # post-NMS via Ultralytics (its own letterbox); low floor so tiny scores show
    res = model.predict(path, imgsz=IMGSZ, conf=0.001, iou=BROWSER_IOU, verbose=False)[0]
    b = res.boxes; post = []
    if b is not None and len(b):
        conf = b.conf.cpu().numpy(); cl = b.cls.cpu().numpy().astype(int); xyxyn = b.xyxyn.cpu().numpy()
        for i in range(len(b)):
            if conf[i] >= BROWSER_CONF: post.append((CLASSES[cl[i]], round(float(conf[i]), 4), [round(float(v), 3) for v in xyxyn[i]]))
        post_maxconf = float(conf.max())
    else:
        post_maxconf = 0.0
    return dict(raw_max=raw_max, head_is_prob=head_is_prob, post=post, post_maxconf=post_maxconf)

def run_image(path):
    bgr = cv2.imread(path); assert bgr is not None, f"unreadable {path}"; oh, ow = bgr.shape[:2]
    bp = best_pt_routes(path)
    cL, r, pX, pY = letterbox(bgr); rawL, clsL, detL = decode_tflite(tflite_raw(to_tensor(cL)), r, pX, pY, ow, oh, stretch=False)
    cS = cv2.resize(bgr, (IMGSZ, IMGSZ), interpolation=cv2.INTER_LINEAR); rawS, clsS, detS = decode_tflite(tflite_raw(to_tensor(cS)), 1, 0, 0, ow, oh, stretch=True)
    return dict(size=(ow, oh), bp=bp, tflL=(rawL, clsL, detL), tflS=(rawS, clsS, detS))

# ── run per image (per-class, independent) ───────────────────────────────────
IMAGES = [("inclusion+", inc_img), ("pinhole+", pin_img), ("negative", neg_img), ("user:pinholew", user_img)]
print("\n════════════ PER-IMAGE PARITY (max class prob) ════════════")
print("NOTE: browser uses tf.resizeBilinear (halfPixelCenters=false); this cell uses cv2.INTER_LINEAR — a minor interpolation diff, negligible for score parity.")
results = {}
for name, path in IMAGES:
    if not path: print(f"{name:14s} (image not found)"); continue
    R = run_image(path); results[name] = R
    print(f"\n{name}  [{path.split('/')[-1]}  {R['size'][0]}x{R['size'][1]}]")
    print(f"  best.pt  raw_head_max={R['bp']['raw_max']:.4f} (head={'prob' if R['bp']['head_is_prob'] else 'LOGITS→sigmoid'})  post-NMS_max={R['bp']['post_maxconf']:.4f}  dets={R['bp']['post']}")
    print(f"  tflite   letterbox raw_max={R['tflL'][0]:.4f} pred={R['tflL'][1]} dets={R['tflL'][2]}")
    print(f"  tflite   stretch   raw_max={R['tflS'][0]:.4f} pred={R['tflS'][1]} dets={R['tflS'][2]}")

# ── (9) per-class + overall verdict (absolute AND ratio) ─────────────────────
HI = BROWSER_CONF
def verdict_for(name):
    R = results.get(name)
    if not R: return f"{name}: (no image)"
    bp, tfl_lb, tfl_st = R["bp"]["raw_max"], R["tflL"][0], R["tflS"][0]
    ratio = (tfl_lb / bp) if bp > 1e-6 else 0.0
    if not sha_match: return f"{name}: ARTIFACT SHA MISMATCH — re-locate/re-export before judging"
    if bp < HI: return f"{name}: CHECKPOINT FAILS on its own validation positive (best.pt raw {bp:.4f})"
    if tfl_lb < HI <= bp: return f"{name}: EXPORT MISMATCH — best.pt {bp:.3f} but TFLite-letterbox {tfl_lb:.3f} (ratio {ratio:.2f})"
    if tfl_st < HI <= tfl_lb: return f"{name}: BROWSER PREPROCESSING MISMATCH — TFLite letterbox {tfl_lb:.3f} vs stretch {tfl_st:.3f} → implement coating letterbox"
    return f"{name}: OK (best.pt {bp:.3f} · tflite-lb {tfl_lb:.3f} · stretch {tfl_st:.3f})"

print("\n──────── VERDICT (per class) ────────")
for name in ("inclusion+", "pinhole+"): print("  " + verdict_for(name))
neg = results.get("negative"); usr = results.get("user:pinholew")
if neg: print(f"  negative: best.pt {neg['bp']['raw_max']:.4f} · tflite-stretch {neg['tflS'][0]:.4f} (want low)")
if usr: print(f"  user:pinholew: best.pt {usr['bp']['raw_max']:.4f} · tflite-lb {usr['tflL'][0]:.4f} · stretch {usr['tflS'][0]:.4f}")

print("\n──────── OVERALL ────────")
inc, pin = results.get("inclusion+"), results.get("pinhole+")
if not sha_match: print("→ ARTIFACT SHA MISMATCH — the Drive .tflite ≠ registered artifact. Fix first.")
elif not (inc and pin): print("→ INCONCLUSIVE — could not scope both inclusion AND pinhole validation positives.")
else:
    both_bp = min(inc["bp"]["raw_max"], pin["bp"]["raw_max"])
    both_lb = min(inc["tflL"][0], pin["tflL"][0]); both_st = min(inc["tflS"][0], pin["tflS"][0])
    if both_bp < HI: print("→ CHECKPOINT INADEQUATE: best.pt itself fails a validation positive. Locate the correct run or retrain (see NEXPEC_COATING_MODEL_DOMAIN.md).")
    elif both_lb < HI: print("→ EXPORT MISMATCH: best.pt validates but the TFLite (matched letterbox) does not. Run reexport_raw().")
    elif both_st < HI: print("→ BROWSER PREPROCESSING MISMATCH: TFLite validates with letterbox but not stretch → implement coating-only letterbox (undo pad/scale on boxes).")
    elif inc["bp"]["raw_max"] >= HI and pin["bp"]["raw_max"] < HI: print("→ PINHOLE FAILS / INCLUSION WORKS — class-imbalanced checkpoint.")
    elif pin["bp"]["raw_max"] >= HI and inc["bp"]["raw_max"] < HI: print("→ INCLUSION FAILS / PINHOLE WORKS — class-imbalanced checkpoint.")
    elif usr and max(usr["tflL"][0], usr["tflS"][0]) < HI: print("→ FULLY VALIDATED on dataset positives; USER IMAGE OUT OF DOMAIN (keep the narrowed 'Coating pinhole / inclusion' UI; general coating-damage needs the retrain plan).")
    else: print("→ FULLY VALIDATED (dataset positives + user image detected).")

# ── re-export ONLY after a proven export mismatch (never automatic) ──────────
def reexport_raw():
    import shutil, tempfile, datetime, json
    w = tempfile.mkdtemp(prefix="coating_reexport_"); src = os.path.join(w, "src.pt"); shutil.copyfile(BEST_PT, src)
    kw = dict(format="tflite", imgsz=IMGSZ, half=False, int8=False, nms=False)
    try: ep = YOLO(src).export(end2end=False, **kw)
    except TypeError: ep = YOLO(src).export(**kw)
    ep = str(ep); path = ep if ep.endswith(".tflite") and os.path.exists(ep) else first(sorted(
        glob.glob(os.path.join(ep if os.path.isdir(ep) else os.path.dirname(ep), "**", "*float32.tflite"), recursive=True), key=os.path.getmtime))
    it = tf.lite.Interpreter(model_path=path); it.allocate_tensors()
    ins = [int(x) for x in it.get_input_details()[0]["shape"]]; outs = [[int(x) for x in o["shape"]] for o in it.get_output_details()]
    outd = f"{DRIVE_ROOT}/exported_models/yolov9t_2class_raw"; os.makedirs(outd, exist_ok=True); dst = f"{outd}/{TFLITE_NAME}"; shutil.copyfile(path, dst)
    okk = ins == [1, 3, IMGSZ, IMGSZ] and any(o in ([1, 6, 8400], [1, 8400, 6]) for o in outs)
    print("re-export →", dst, "\n  input", ins, "outputs", outs, "sha256", sha256(dst), "→", "OK" if okk else "CHECK SHAPES")
print("\n(reexport_raw() is available but NOT run — call it only if the verdict is EXPORT MISMATCH.)")
