#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  scripts/ml/register-nexpec-models.sh — register ALL trained inspection
#  models in the NEXPEC signed registry (one independent call per model; a
#  failure in one never blocks or overwrites another).
#
#  Metadata below is VERBATIM from the shared registry
#  (packages/shared-core/src/ml/modelRegistry.ts) — slug/version/sha256/labels
#  must match exactly; pi_record_ai_detection enforces the sha at record time.
#
#  Prereqs (run from repo root, on the signing box):
#    export SUPABASE_URL=https://<project>.supabase.co
#    export SUPABASE_SERVICE_ROLE_KEY=...          # service key, never committed
#    # optional signing (recommended): nexpec_model_signing.pem present
#
#  Usage:  bash scripts/ml/register-nexpec-models.sh [--sign]
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/../.."

SIGN_ARGS=()
if [[ "${1:-}" == "--sign" ]]; then
  SIGN_ARGS=(--sign ./nexpec_model_signing.pem --alg ed25519 --key-id nexpec-model-2026-v1)
fi

fail=0

echo "── [1/3] corrosion-detector v2 (YOLO26s-seg, 11 classes, 1024) ──"
node scripts/ml/register-model.mjs \
  --file ./assets/corrosion_yolo26s_seg_1024_fp32.tflite \
  --kind vision_defect --slug corrosion-detector --version 2 \
  --runtime tflite --tier student --device-min-tier standard --os any \
  --license AGPL-3.0 \
  "${SIGN_ARGS[@]}" \
  --params '{"task":"instance-segmentation","input":"rgb_1024_nchw","parser":"yolo-seg:channels-first","labels":["rust","Rust","car","copper corrosion","corroded-part","corrosion","iron rust","mild-corrosion","moderate-corrosion","rust","severe-corrosion"],"non_defect_class_ids":[2],"expected_sha256":"21c98fd8d1aab087560ab06183e9e996889aa9b4b6e2ca828f28d779f0aec205"}' \
  || { echo "✗ corrosion-detector v2 FAILED"; fail=1; }

echo "── [2/3] wda-fissure-detector v1 (YOLO26s-seg e2e, 5 classes, 1024) ──"
node scripts/ml/register-model.mjs \
  --file ./assets/wda_fissures_yolo26s_seg_1024_fp32.tflite \
  --kind vision_defect --slug wda-fissure-detector --version 1 \
  --runtime tflite --tier student --device-min-tier standard --os any \
  --license AGPL-3.0 \
  "${SIGN_ARGS[@]}" \
  --params '{"task":"instance-segmentation","input":"rgb_1024_nchw","parser":"yolo-seg-e2e:maxdet300","labels":["fissures-wda","Crack","Porosity","Spatters","Welding line"],"non_defect_class_ids":[4],"expected_sha256":"d0f086e0f5896dc430624960b59ca09f610cd8c33e9a04f82748077b6238e703"}' \
  || { echo "✗ wda-fissure-detector v1 FAILED"; fail=1; }

echo "── [3/3] yolov9t-weld-detector v1 (detection, 2 classes, 640) ──"
node scripts/ml/register-model.mjs \
  --file ./assets/yolov9t_2class_fp32.tflite \
  --kind vision_defect --slug yolov9t-weld-detector --version 1 \
  --runtime tflite --tier student --device-min-tier standard --os any \
  --license GPL-3.0 \
  "${SIGN_ARGS[@]}" \
  --params '{"task":"detection","input":"rgb_640_nchw","parser":"yolo-det:channels-first","labels":["inclusion","pinhole"],"non_defect_class_ids":[],"expected_sha256":"4da2665ff8134a7194accfc8764a71976ca233c9e9488a9c4083902aba804be7"}' \
  || { echo "✗ yolov9t-weld-detector v1 FAILED"; fail=1; }

echo
if [[ $fail -eq 0 ]]; then
  echo "✓ All 3 models registered. Audit with:"
else
  echo "✗ At least one registration failed — the others were still attempted. Audit with:"
fi
cat <<'SQL'
  -- Run in Supabase SQL editor to confirm registrations match the shared registry:
  select slug, version, sha256, status
  from ml_model_artifacts            -- (or the registry table used by ml_resolve_models)
  order by slug, version;
SQL
exit $fail
