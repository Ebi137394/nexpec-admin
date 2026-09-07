#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  apply-cross-surface-interop.sh
#
#  Applies 20260801666000_cross_surface_write_interop.sql to Production.
#  Proven on Staging first (Staging was brought to Production parity by
#  scripts/ops/sync-staging-to-production.sh), where all 7 behavioural
#  assertions passed inside a rolled-back transaction:
#    web-shaped document insert now succeeds (it was a hard 23502 before),
#    mobile-shaped insert fills file_path, equipment mirrors both ways with no
#    ping-pong duplicate, and job_expenses does NOT back-mirror (no second
#    payable for one service).
#
#  Additive only: one BEFORE trigger, four AFTER triggers, and two backfills
#  that fill NULLs / insert missing mirror rows. No column, policy or grant is
#  changed and nothing is deleted.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail
PROD_REF="sxqpjxhslzzcdrdctatm"
MIGRATION="20260801666000_cross_surface_write_interop"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
F="$REPO_ROOT/supabase/migrations/$MIGRATION.sql"
[ -f "$F" ] || { echo "MISSING $F" >&2; exit 1; }

WORKDIR="$(mktemp -d)"; trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$WORKDIR/supabase"
printf 'project_id = "nexpec-prod-apply"\n' > "$WORKDIR/supabase/config.toml"
( cd "$WORKDIR" && supabase link --project-ref "$PROD_REF" >/dev/null )
REF="$(cat "$WORKDIR/supabase/.temp/project-ref" 2>/dev/null || echo none)"
[ "$REF" = "$PROD_REF" ] || { echo "REFUSING: linked to '$REF'" >&2; exit 1; }
run_sql() { ( cd "$WORKDIR" && supabase db query --linked ); }
fail() { echo "  ✗ $1 — ABORTING before the ledger is touched." >&2; exit 1; }

echo "→ pre-state"
run_sql <<'SQL' | tail -10
SELECT (SELECT count(*) FROM public.equipment)            AS equipment,
       (SELECT count(*) FROM public.inspector_equipment)  AS inspector_equipment,
       (SELECT count(*) FROM public.inspector_documents)  AS documents,
       (SELECT count(*) FROM public.job_expenses)         AS job_expenses;
SQL

echo "→ applying $MIGRATION"
run_sql < "$F" | tail -3

echo "→ verifying"
V="$(run_sql <<'SQL'
SELECT
  (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
      AND p.proname IN ('nx_inspector_document_paths',
                        'nx_mirror_equipment_to_inspector',
                        'nx_mirror_inspector_to_equipment',
                        'nx_mirror_expense_to_job_expense'))          AS triggers_live,
  (SELECT count(*) FROM public.inspector_documents
    WHERE file_path IS NULL AND file_url IS NOT NULL)                 AS docs_unmirrored,
  (SELECT count(*) FROM public.equipment e WHERE e.inspector_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.inspector_equipment ie
      WHERE ie.inspector_id=e.inspector_id AND ie.name=e.name
        AND ie.serial_number IS NOT DISTINCT FROM e.serial_number))   AS equipment_unmirrored,
  (SELECT count(*) FROM public.inspector_equipment)                   AS inspector_equipment_now;
SQL
)"
echo "$V" | tail -10
echo "$V" | grep -q '"triggers_live": 4'       || fail "not all 4 triggers are live"
echo "$V" | grep -q '"docs_unmirrored": 0'     || fail "documents left unmirrored"
echo "$V" | grep -q '"equipment_unmirrored": 0'|| fail "equipment left unmirrored"
echo "  ✓ interop adapters live and backfills complete"

echo "→ recording in the ledger"
run_sql <<SQL | tail -1
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('${MIGRATION%%_*}', '${MIGRATION#*_}') ON CONFLICT (version) DO NOTHING;
SQL
echo; echo "✓ done."
