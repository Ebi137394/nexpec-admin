#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  scripts/qa/bundle-mobile-staging.sh — build a Mobile bundle that targets
#  NEXPEC-Staging, and PROVE it does before anyone installs it.
#
#  ── WHY THIS EXISTS ────────────────────────────────────────────────────────
#  `npx expo export` produces a bundle pointing at PRODUCTION. Not by policy —
#  by accident of precedence. Expo loads .env.local then .env, both of which
#  carry EXPO_PUBLIC_SUPABASE_URL for the production project, and its loader
#  OVERWRITES values already present in the environment. So this does NOT work:
#
#      set -a; . .env.staging.local; set +a
#      npx expo export …                    # ← still Production
#
#  Measured: that command produced a bundle byte-identical to the default one,
#  with 1 occurrence of the production ref and 0 of staging. `.env.staging.local`
#  is never consulted at all — "staging" is not a NODE_ENV Expo recognises.
#
#  EXPO_NO_DOTENV=1 stops the file loading entirely, at which point the exported
#  shell variables are the only source and staging wins.
#
#  ── WHY THE ASSERTION IS NOT OPTIONAL ──────────────────────────────────────
#  A QA build silently aimed at Production means synthetic test data, test jobs
#  and test accounts land in the live database. The check below greps the
#  compiled Hermes bytecode for both project refs and refuses to leave a bundle
#  behind unless staging is present and production is absent. Building without
#  verifying is how the default bundle went unnoticed in the first place.
#
#  RUN
#    bash scripts/qa/bundle-mobile-staging.sh android
#    bash scripts/qa/bundle-mobile-staging.sh ios
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PLATFORM="${1:-android}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.staging.local"
OUT_DIR="${2:-$REPO_ROOT/.expo-staging-$PLATFORM}"

PROD_REF='sxqpjxhslzzcdrdctatm'
STAGING_REF='zmzvmgaeovleuvbvwxei'

if [ ! -f "$ENV_FILE" ]; then
  echo "FATAL: $ENV_FILE not found."
  echo "It is gitignored by design — it holds the Staging anon key. Create it with"
  echo "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY for the Staging project."
  exit 1
fi

# Absolute path on purpose: sourcing a bare relative filename silently no-ops if
# the caller's cwd is not the repo root, and `set -a` hides the failure. That
# exact mistake produced a "staging" bundle that was really Production.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

case "${EXPO_PUBLIC_SUPABASE_URL:-}" in
  *"$STAGING_REF"*) : ;;
  *) echo "FATAL: EXPO_PUBLIC_SUPABASE_URL does not point at Staging after sourcing."; exit 1 ;;
esac

echo "→ exporting $PLATFORM bundle against Staging (dotenv disabled)"
rm -rf "$OUT_DIR"
( cd "$REPO_ROOT" && EXPO_NO_DOTENV=1 npx expo export --platform "$PLATFORM" --output-dir "$OUT_DIR" --clear )

BUNDLE="$(find "$OUT_DIR" -name '*.hbc' -o -name '*.js' | grep -E '/_expo/static/js/' | head -1 || true)"
if [ -z "$BUNDLE" ]; then
  echo "FATAL: no bundle produced under $OUT_DIR"
  exit 1
fi

PROD_HITS=$(strings "$BUNDLE" | grep -c "$PROD_REF" || true)
STG_HITS=$(strings "$BUNDLE" | grep -c "$STAGING_REF" || true)

echo
echo "bundle : $(basename "$BUNDLE")"
echo "  production ref occurrences : $PROD_HITS"
echo "  staging    ref occurrences : $STG_HITS"

if [ "$PROD_HITS" -ne 0 ] || [ "$STG_HITS" -eq 0 ]; then
  echo
  echo "REFUSING THIS BUNDLE: it does not target Staging."
  echo "Deleting it rather than leaving a Production-aimed QA build on disk."
  rm -rf "$OUT_DIR"
  exit 1
fi

echo
echo "ok: bundle targets Staging only. Output: $OUT_DIR"
