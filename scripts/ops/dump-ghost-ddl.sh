#!/usr/bin/env bash
# ============================================================================
#  scripts/ops/dump-ghost-ddl.sh
#
#  Pull the EXACT live DDL — columns, PK/FK/UNIQUE/CHECK constraints, indexes,
#  triggers, sequences AND RLS policies — for the four out-of-band "ghost"
#  FK-target tables, so the versioned floor can be reconciled against reality.
#
#  Uses a DIRECT Postgres connection (pg_dump), NOT the Supabase management API,
#  so it avoids the api.supabase.com i/o timeout the project CLI hits on
#  push/link.
#
#  Get the URL:  Supabase Dashboard → Project Settings → Database →
#                "Connection string" → URI (direct :5432, or the Session pooler).
#
#  Usage:
#    export SUPABASE_DB_URL='postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres'
#    bash scripts/ops/dump-ghost-ddl.sh
#
#  No pg_dump locally? Use docs/ops/ghost-ddl-introspection.sql instead — paste
#  it into the Dashboard SQL editor (no tooling, no timeout) and send the output.
# ============================================================================
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the DIRECT Postgres connection URI (see header)}"
command -v pg_dump >/dev/null 2>&1 || {
  echo "pg_dump not found. Install postgresql-client (or use the Supabase CLI's bundled pg_dump)."
  echo "Or run the no-tooling fallback: docs/ops/ghost-ddl-introspection.sql in the Dashboard."
  exit 1
}

OUT="supabase/ghost-ddl"
mkdir -p "$OUT"
TABLES=(country_codes organizations inspection_scope_templates report_templates)
LIST="{country_codes,organizations,inspection_scope_templates,report_templates}"

for t in "${TABLES[@]}"; do
  echo "→ dumping public.$t"
  # --schema-only emits the table + its constraints, indexes, triggers,
  # sequences, ENABLE RLS, and CREATE POLICY statements.
  pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges \
    --table="public.$t" --file="$OUT/$t.live.sql"
done

# Focused catalog snapshots — quick to eyeball/diff vs the versioned floor.
psql "$SUPABASE_DB_URL" -X -A -F $'\t' -c \
  "\copy (SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default \
          FROM information_schema.columns WHERE table_schema='public' \
          AND table_name = ANY('$LIST') ORDER BY table_name, ordinal_position) \
   TO '$OUT/_columns.tsv'"

psql "$SUPABASE_DB_URL" -X -A -F $'\t' -c \
  "\copy (SELECT tablename, policyname, cmd, roles::text, qual, with_check \
          FROM pg_policies WHERE schemaname='public' \
          AND tablename = ANY('$LIST') ORDER BY tablename, policyname) \
   TO '$OUT/_rls_policies.tsv'"

echo
echo "✓ Live DDL → $OUT/*.live.sql  +  _columns.tsv  +  _rls_policies.tsv"
echo "Reconcile against the versioned floor:"
echo "  • 00000000000000_baseline_core_tables.sql  (the folded ghost block)"
echo "  • 20260801120700_adopt_ghost_fk_target_tables.sql"
echo "Port any missing indexes / RLS / triggers / columns into a follow-up migration,"
echo "then re-run this script until the diff is empty. (Add supabase/ghost-ddl/ to .gitignore"
echo "if you don't want the raw dumps committed.)"
