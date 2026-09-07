#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  sync-staging-to-production.sh
#
#  Replays every migration Production has that Staging does not, in version
#  order, so Staging can actually validate new migrations before they reach
#  Production. Staging had drifted 24 migrations behind (614000 vs 664000),
#  which made "test on Staging first" impossible.
#
#  Forward-only and safe by construction: Staging holds NO migration that
#  Production lacks, so this is a replay, not a merge. Stops at the first
#  failure and reports it rather than continuing past a broken schema.
#
#  Targets STAGING only. It refuses to run against the Production ref.
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

STG_REF="zmzvmgaeovleuvbvwxei"
PROD_REF="sxqpjxhslzzcdrdctatm"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SC="/private/tmp/claude-501/-Users-ebrahimfeyzi/e0d7a7c3-485d-4b52-8a45-4564ebade504/scratchpad"

REF="$(cat "$SC/stg/supabase/.temp/project-ref" 2>/dev/null || echo none)"
[ "$REF" = "$STG_REF" ] || { echo "REFUSING: staging workdir is '$REF'" >&2; exit 1; }
[ "$REF" != "$PROD_REF" ] || { echo "REFUSING: that is Production" >&2; exit 1; }

run_stg() { ( cd "$SC/stg" && supabase db query --linked ); }

ok=0; fail=0
while read -r v; do
  f=$(ls "$REPO_ROOT"/supabase/migrations/${v}_*.sql 2>/dev/null | head -1)
  [ -n "$f" ] || { echo "  SKIP $v (no file)"; continue; }
  name=$(basename "$f" .sql)
  out="$(run_stg < "$f" 2>&1)"
  if echo "$out" | grep -q '"_tag": *"Error"\|"_tag":"Error"'; then
    echo "  ✗ $name"
    echo "$out" | head -4 | sed 's/^/      /'
    fail=$((fail+1))
    echo "STOPPING at first failure so the schema is not advanced past a break." >&2
    break
  fi
  run_stg >/dev/null 2>&1 <<SQL
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('${name%%_*}', '${name#*_}') ON CONFLICT (version) DO NOTHING;
SQL
  echo "  ✓ $name"
  ok=$((ok+1))
done < "$SC/missing_on_stg.txt"

echo
echo "applied=$ok failed=$fail"
[ "$fail" -eq 0 ]
