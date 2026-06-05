# Self-hosted TensorFlow.js + TFLite runtime

These assets power the **web AI Co-inspector**'s 100% client-side, $0 inference with
**zero external-CDN dependency**. They are served same-origin from `/tf/...` and
referenced by `apps/web/src/lib/ai/visionModel.ts`.

## Populate (one-time — run from the repo root)

```bash
bash scripts/ops/fetch-tf-assets.sh
git add apps/web/public/tf
git commit -m "chore(web): vendor self-hosted TF runtime assets"
```

## Required files after running

```
public/tf/
├── tf.min.js                      # @tensorflow/tfjs@3.21.0 (umbrella: core + backends)
└── tflite/
    ├── tf-tflite.min.js           # @tensorflow/tfjs-tflite runtime
    ├── *.wasm                     # TFLite Web API wasm (simd / threaded variants)
    └── *.js                       # wasm JS glue/loaders
```

`visionModel.ts` loads `/tf/tf.min.js` and `/tf/tflite/tf-tflite.min.js`, and sets
the TFLite wasm path to `/tf/tflite/`. Nothing is fetched from any third-party CDN.

## CSP

With these self-hosted, the only directives needed are:

```
script-src 'self' 'wasm-unsafe-eval';
connect-src 'self';
```

(`'wasm-unsafe-eval'` is required by browsers to compile the WebAssembly module.)

> These binaries are intentionally committed to the repo so the build is fully
> self-contained. Re-run the script (after bumping versions in it) only to upgrade.
