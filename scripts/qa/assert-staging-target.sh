#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  scripts/qa/assert-staging-target.sh — TARGET SAFETY PREFLIGHT
#
#  Refuses to let a staging database command run against Production.
#
#  WHY THIS EXISTS: `supabase db push --linked` obeys whatever
#  supabase/.temp/project-ref happens to hold. That file changes whenever
#  anyone runs `supabase link`, and nothing in the command echoes the target,
#  so a push intended for Staging can silently address Production. That
#  happened on 2026-08-20: the push failed on its first migration and wrote
#  nothing, but the only reason it was caught was a manual parity check.
#
#  USAGE — put it in front of every staging DB command:
#     bash scripts/qa/assert-staging-target.sh && supabase db push --linked
#
#  Exit codes: 0 staging · 2 PRODUCTION · 3 unknown/missing ref
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

STAGING_REF="zmzvmgaeovleuvbvwxei"
PROD_REF="sxqpjxhslzzcdrdctatm"
REF_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/supabase/.temp/project-ref"

if [[ ! -f "$REF_FILE" ]]; then
  echo "✗ ABORT: no linked project (${REF_FILE} missing). Run: supabase link --project-ref ${STAGING_REF}" >&2
  exit 3
fi

REF="$(tr -d '[:space:]' < "$REF_FILE")"

case "$REF" in
  "$STAGING_REF")
    echo "✓ target OK — Staging (${REF})"
    exit 0 ;;
  "$PROD_REF")
    echo "✗ ABORT: linked project is PRODUCTION (${REF})." >&2
    echo "  Production must not be written by staging commands." >&2
    echo "  Re-link first: supabase link --project-ref ${STAGING_REF}" >&2
    exit 2 ;;
  *)
    echo "✗ ABORT: unrecognised project ref '${REF}' — refusing to guess." >&2
    exit 3 ;;
esac
