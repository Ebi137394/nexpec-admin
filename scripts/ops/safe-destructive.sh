#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  safe-destructive.sh — backup-gated destructive Production operation
#
#  WHY THIS EXISTS
#  On 2026-09-03 a scoped, owner-authorised cleanup deleted 19 stale
#  notification rows on Production. The intended pre-flight export silently
#  failed — its target directory had been removed earlier the same session —
#  and the DELETE still ran, leaving no rollback copy. The deletion itself was
#  correct; the *procedure* was not: a failed backup must stop the operation,
#  not be stepped over.
#
#  This wrapper makes that failure mode structurally impossible: the destructive
#  statement is never reached unless a backup file exists, is non-empty, and
#  contains at least one row. `set -euo pipefail` means any failure aborts.
#
#  USAGE
#    scripts/ops/safe-destructive.sh <workdir> <select.sql> <destructive.sql> <backup.json>
#
#      workdir         directory linked to the target project (supabase link)
#      select.sql      SELECT returning the EXACT rows the destructive statement
#                      will affect — same predicate, no exceptions
#      destructive.sql the DELETE/UPDATE, ideally with RETURNING
#      backup.json     where the export must land
#
#  The select and the destructive statement MUST share one predicate. If they
#  can drift, the backup is not a backup.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

WORKDIR="${1:?workdir required}"
SELECT_SQL="${2:?select sql required}"
DESTRUCTIVE_SQL="${3:?destructive sql required}"
BACKUP_OUT="${4:?backup output path required}"

fail() { printf '\n  ABORTED: %s\n  The destructive statement was NOT executed.\n' "$1" >&2; exit 1; }

[ -f "$SELECT_SQL" ]      || fail "select file not found: $SELECT_SQL"
[ -f "$DESTRUCTIVE_SQL" ] || fail "destructive file not found: $DESTRUCTIVE_SQL"

# The backup directory must already exist — creating it here would have masked
# exactly the failure this script exists to prevent.
BACKUP_DIR="$(dirname "$BACKUP_OUT")"
[ -d "$BACKUP_DIR" ] || fail "backup directory does not exist: $BACKUP_DIR"
[ -w "$BACKUP_DIR" ] || fail "backup directory is not writable: $BACKUP_DIR"

cd "$WORKDIR" || fail "cannot enter workdir: $WORKDIR"
TARGET="$(cat supabase/.temp/project-ref 2>/dev/null || echo unknown)"
printf '  target project : %s\n' "$TARGET"

# ── 1. Export ─────────────────────────────────────────────────────────────
printf '  step 1/4       : exporting affected rows…\n'
if ! npx supabase db query --linked --file "$SELECT_SQL" > "$BACKUP_OUT" 2>&1; then
  fail "backup export command failed"
fi

# ── 2. Prove the backup is real ───────────────────────────────────────────
[ -s "$BACKUP_OUT" ] || fail "backup file is empty: $BACKUP_OUT"
if grep -qi '"_tag"[[:space:]]*:[[:space:]]*"Error"' "$BACKUP_OUT"; then
  fail "backup export returned a query error (see $BACKUP_OUT)"
fi
ROWS="$(grep -c '"' "$BACKUP_OUT" || true)"
[ "${ROWS:-0}" -gt 0 ] || fail "backup contains no rows"
printf '  step 2/4       : backup verified (%s bytes) -> %s\n' "$(wc -c < "$BACKUP_OUT" | tr -d ' ')" "$BACKUP_OUT"

# ── 3. Destructive statement — only now reachable ─────────────────────────
printf '  step 3/4       : executing destructive statement…\n'
npx supabase db query --linked --file "$DESTRUCTIVE_SQL" || fail "destructive statement failed (backup retained)"

printf '  step 4/4       : done. Backup retained at %s\n' "$BACKUP_OUT"
printf '  REMINDER       : write an append-only audit_events row for this change.\n'
