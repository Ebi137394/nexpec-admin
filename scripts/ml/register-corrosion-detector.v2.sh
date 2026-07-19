#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  register-corrosion-detector.v2.sh — publish the REAL YOLO26-seg corrosion
#  model as corrosion-detector v2 (the official launch model).
#
#  ⚠️ RUN ON THE SIGNING BOX ONLY — the machine that holds the private key
#     (nexpec_model_signing.pem is gitignored; see docs/KEY_CUSTODY.md).
#  ⚠️ DOES NOT touch v1. This registers a NEW version (2) of the same slug.
#
#  It hashes the model, uploads it, signs the canonical attestation with the
#  canonical key (nexpec-model-2026-v1), registers it via ml_register_model,
#  and publishes it. The produced sha256 must equal the bytes you host and the
#  value you put in NEXT_PUBLIC_VISION_MODEL_SHA256.
#
#  Usage:
#    SUPABASE_URL=https://<ref>.supabase.co \
#    SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
#    ./scripts/ml/register-corrosion-detector.v2.sh
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEY="${SIGNING_KEY:-$ROOT/nexpec_model_signing.pem}"
MODEL="${MODEL_FILE:-$ROOT/assets/corrosion_yolo26s_seg_1024_fp32.tflite}"

[ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || {
  echo "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first." >&2; exit 1; }
[ -f "$KEY" ] || {
  echo "Signing key not found: $KEY" >&2
  echo "It is gitignored on purpose — keep it ONLY on the signing box (docs/KEY_CUSTODY.md)." >&2; exit 1; }
[ -f "$MODEL" ] || { echo "Model file not found: $MODEL" >&2; exit 1; }

# Print the sha256 so it can be cross-checked against NEXT_PUBLIC_VISION_MODEL_SHA256
# and the hosted bytes. (Expected for the current asset: 21c98fd8…)
echo "Model sha256:"; shasum -a 256 "$MODEL" | awk '{print "  "$1}'

# The corrosion model is a 1024² instance-segmentation model with 11 raw classes
# (index = classId; kept verbatim for the classId contract — see
# packages/shared-core/src/ml/corrosionLabels.ts). Labels here are the raw model
# classes; the apps normalize them for display and suppress the non-defect 'car'.
exec node "$ROOT/scripts/ml/register-model.mjs" \
  --file "$MODEL" \
  --kind vision_defect --slug corrosion-detector --version 2 --semver 2.0.0 \
  --runtime tflite --tier student --device-min-tier standard --os any \
  --license Apache-2.0 \
  --sign "$KEY" --alg ed25519 --key-id nexpec-model-2026-v1 \
  --params '{"input":"seg_1024_nchw","normalize":{"scale":0.00392156862745098,"offset":0},"task":"instance-segmentation","labels":["rust","Rust","car","copper corrosion","corroded-part","corrosion","iron rust","mild-corrosion","moderate-corrosion","rust","severe-corrosion"]}' \
  --notes 'Launch vision-defect model: YOLO26s-seg 1024 FP32, Ed25519-signed (nexpec-model-2026-v1). v2 supersedes the v1 placeholder for inference; v1 remains registered/immutable.'
