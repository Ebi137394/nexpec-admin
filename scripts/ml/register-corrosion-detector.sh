#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  register-corrosion-detector.sh — publish the student vision-defect model,
#  signed with the canonical key (key-id nexpec-model-2026-v1).
#
#  Run this ON THE SIGNING BOX — the only machine that holds the private key
#  (nexpec_model_signing.pem is gitignored; see docs/KEY_CUSTODY.md). It hashes
#  the model, uploads it to the private `ml-models` bucket, signs the canonical
#  attestation, registers it via ml_register_model, and publishes it. $0, no
#  third-party service.
#
#  Usage:
#    SUPABASE_URL=https://<ref>.supabase.co \
#    SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
#    ./scripts/ml/register-corrosion-detector.sh
#
#  The produced sha256 + signature must match scripts/ml/corrosion-detector.v1.signed.json
#  (that file is the public, auditable record of this exact registration).
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEY="${SIGNING_KEY:-$ROOT/nexpec_model_signing.pem}"
MODEL="${MODEL_FILE:-$ROOT/mobilenet_v2.tflite}"

[ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || {
  echo "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first." >&2; exit 1; }
[ -f "$KEY" ] || {
  echo "Signing key not found: $KEY" >&2
  echo "It is gitignored on purpose — keep it ONLY on the signing box (docs/KEY_CUSTODY.md)." >&2; exit 1; }
[ -f "$MODEL" ] || { echo "Model file not found: $MODEL" >&2; exit 1; }

# NOTE: mobilenet_v2.tflite is the current student artifact. When the distilled
# corrosion model is trained, re-run with MODEL_FILE=<new.tflite> and --version 2.
exec node "$ROOT/scripts/ml/register-model.mjs" \
  --file "$MODEL" \
  --kind vision_defect --slug corrosion-detector --version 1 --semver 1.0.0 \
  --runtime tflite --tier student --device-min-tier standard --os any \
  --license Apache-2.0 \
  --sign "$KEY" --alg ed25519 --key-id nexpec-model-2026-v1 \
  --params '{"input":"rgb_224","mean":[0.485,0.456,0.406],"std":[0.229,0.224,0.225],"labels":["corrosion","crack","spall","clean"]}' \
  --notes 'Phase A.5 student vision-defect detector, Ed25519-signed (nexpec-model-2026-v1).'
