#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fetch-tf-assets.sh — vendor the TensorFlow.js + TFLite runtime into
# apps/web/public/tf so the web AI Co-inspector has ZERO external-CDN dependency.
# Run ONCE from the repo root: bash scripts/ops/fetch-tf-assets.sh
# Re-run only to upgrade (bump the versions below; keep script + wasm in lockstep).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TFJS_VER="3.21.0"
TFLITE_VER="0.0.1-alpha.10"   # script + wasm must come from the SAME version
DEST="apps/web/public/tf"

[ -f apps/web/package.json ] || { echo "Run from the repo root."; exit 1; }
mkdir -p "$DEST/tflite"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ @tensorflow/tfjs@$TFJS_VER"
( cd "$TMP" && npm pack "@tensorflow/tfjs@$TFJS_VER" >/dev/null && tar -xzf tensorflow-tfjs-*.tgz )
cp "$TMP/package/dist/tf.min.js" "$DEST/tf.min.js"

echo "→ @tensorflow/tfjs-tflite@$TFLITE_VER"
( cd "$TMP" && npm pack "@tensorflow/tfjs-tflite@$TFLITE_VER" >/dev/null && tar -xzf tensorflow-tfjs-tflite-*.tgz )
# the TFLite script + every wasm + its JS glue (the wasm loaders) live in dist/
cp "$TMP"/package/dist/tf-tflite.min.js "$DEST/tflite/"
cp "$TMP"/package/dist/*.wasm "$DEST/tflite/" 2>/dev/null || true
cp "$TMP"/package/dist/*.js   "$DEST/tflite/" 2>/dev/null || true

echo "✓ vendored under $DEST:"
ls -lh "$DEST" "$DEST/tflite"
