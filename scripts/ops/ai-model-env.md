# AI Model Hosting — Environment Variables (Preview + Production)

The three trained models are **self‑hosted same‑origin** under `apps/web/public/models/`
(committed to the repo, deployed with the site — same policy as the self‑hosted
TFJS/WASM under `public/tf/`). The browser verifies each download's **SHA‑256
against the shared registry pin before loading** (`loadModel(url, expectedSha256)`),
so a stale CDN copy or tampered file refuses to load.

`webModelUrl()` (apps/web/src/lib/data/aiCoinspector.ts) reads one env var per
slug. Relative same‑origin paths work identically in Preview and Production —
set the SAME values in both Vercel environments (they are still set per
environment so a future move to bucket URLs can diverge safely).

## Vercel → Project → Settings → Environment Variables

### Preview
```
NEXT_PUBLIC_VISION_MODEL_URL=/models/corrosion_yolo26s_seg_1024_fp32.tflite
NEXT_PUBLIC_WDA_MODEL_URL=/models/wda_fissures_yolo26s_seg_1024_fp32.tflite
NEXT_PUBLIC_YOLOV9T_MODEL_URL=/models/yolov9t_2class_fp32.tflite
```

### Production
```
NEXT_PUBLIC_VISION_MODEL_URL=/models/corrosion_yolo26s_seg_1024_fp32.tflite
NEXT_PUBLIC_WDA_MODEL_URL=/models/wda_fissures_yolo26s_seg_1024_fp32.tflite
NEXT_PUBLIC_YOLOV9T_MODEL_URL=/models/yolov9t_2class_fp32.tflite
```

> Note: `NEXT_PUBLIC_VISION_MODEL_URL` previously pointed at the mobilenet_v2
> placeholder (corrosion-detector **v1**, sha `7aad0c74…`). Registering
> **v2** (`register-nexpec-models.sh`) supersedes it in the DB registry; the URL
> above must point at the corrosion seg model or the browser SHA check will
> (correctly) refuse the stale file.

## Post-deploy SHA verification (hosted bytes == local bytes)

```bash
for f in corrosion_yolo26s_seg_1024_fp32 wda_fissures_yolo26s_seg_1024_fp32 yolov9t_2class_fp32; do
  echo "$f:"; curl -sL "https://<your-domain>/models/$f.tflite" | shasum -a 256
done
# Expected (from the shared registry / scripts/qa/check-model-shas.mjs):
#   corrosion  21c98fd8d1aab087560ab06183e9e996889aa9b4b6e2ca828f28d779f0aec205
#   wda        d0f086e0f5896dc430624960b59ca09f610cd8c33e9a04f82748077b6238e703
#   yolov9t    4da2665ff8134a7194accfc8764a71976ca233c9e9488a9c4083902aba804be7
```

Mobile needs **no env** — the same files are bundled from `assets/` via Metro,
and `npm run qa:model-shas` proves bundle + web copies match the registry pins.
