#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  apply-canonical-message-route.sh
#
#  Applies 20260801660000_canonical_message_route.sql to Production.
#
#  Message notifications hard-coded '/client/messages/<id>' for every
#  recipient. On Production that sent 16 inspectors and 1 supplier to a route
#  middleware refuses them, and sent EVERY role to a path that has never
#  existed in the mobile app. Both producers now emit '/messages/<id>', which
#  resolves the role server-side on web and already exists natively on mobile.
#
#  Two CREATE OR REPLACE FUNCTIONs plus one in-place UPDATE of existing
#  notification rows. No table, policy, grant or trigger is touched, and
#  nothing is deleted.
#
#  USAGE
#    export SUPABASE_ACCESS_TOKEN=...      # or be logged in via `supabase login`
#    bash scripts/ops/apply-canonical-message-route.sh
#
#  Refuses any project but Production, applies, verifies, and only then
#  records the migration in the ledger.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROD_REF="sxqpjxhslzzcdrdctatm"
MIGRATION="20260801660000_canonical_message_route"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION_FILE="$REPO_ROOT/supabase/migrations/$MIGRATION.sql"

[ -f "$MIGRATION_FILE" ] || { echo "MISSING migration file: $MIGRATION_FILE" >&2; exit 1; }

# The web route the new links depend on must exist, or we would be pointing
# users at a 404 to fix a 404.
for r in "$REPO_ROOT/apps/web/src/app/messages/[id]/page.tsx" \
         "$REPO_ROOT/apps/web/src/app/messages/page.tsx"; do
  [ -f "$r" ] || { echo "MISSING web route: $r" >&2; exit 1; }
done

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$WORKDIR/supabase"
printf 'project_id = "nexpec-prod-apply"\n' > "$WORKDIR/supabase/config.toml"

echo "→ linking a scratch workdir to Production ($PROD_REF)"
( cd "$WORKDIR" && supabase link --project-ref "$PROD_REF" >/dev/null )

REF="$(cat "$WORKDIR/supabase/.temp/project-ref" 2>/dev/null || echo none)"
if [ "$REF" != "$PROD_REF" ]; then
  echo "REFUSING: linked to '$REF', not Production." >&2
  exit 1
fi

run_sql() { ( cd "$WORKDIR" && supabase db query --linked ); }

echo "→ pre-state: recipient-facing message links by role"
run_sql <<'SQL' | tail -20
SELECT p.role, count(*) AS rows
  FROM public.notifications n JOIN public.profiles p ON p.id = n.recipient_id
 WHERE n.link_href LIKE '/client/messages/%' OR n.link_href LIKE '/inspector/messages/%'
 GROUP BY p.role ORDER BY rows DESC;
SQL

echo "→ applying $MIGRATION"
run_sql < "$MIGRATION_FILE" | tail -3

echo "→ verifying"
VERIFY_OUT="$(run_sql <<'SQL'
SELECT
  (SELECT count(*) FROM public.notifications
    WHERE link_href LIKE '/client/messages/%'
       OR link_href LIKE '/inspector/messages/%')            AS stale_rows,
  (SELECT count(*) FROM public.notifications
    WHERE link_href LIKE '/messages/%')                      AS canonical_rows,
  (SELECT count(*) FROM public.notifications
    WHERE link_href LIKE '/admin/messages/%')                AS admin_rows_preserved,
  -- neither producer may still write a role-scoped recipient link
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('notify_on_new_message','tg_notify_messages')
      AND (p.prosrc LIKE '%/client/messages/%'
        OR p.prosrc LIKE '%/inspector/messages/%'))          AS producers_still_bad,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('notify_on_new_message','tg_notify_messages')
      AND p.prosrc LIKE '%/messages/%')                      AS producers_fixed,
  -- the second profile-path function must now delegate, not hard-code
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='nx_profile_path'
      AND p.prosrc LIKE '%nx_role_profile_path%')            AS profile_path_delegates,
  (SELECT public.nx_profile_path('inspector'))               AS probe_profile_path,
  (SELECT count(*) FROM public.notifications
    WHERE link_href IN ('/client/profile','/inspector/profile')) AS stale_profile_rows,
  -- the triggers that call them must still be attached and enabled
  (SELECT count(*) FROM pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgfoid IN (
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public'
           AND p.proname IN ('notify_on_new_message','tg_notify_messages'))
      AND t.tgenabled <> 'D')                                AS triggers_live;
SQL
)"
echo "$VERIFY_OUT" | tail -16

fail() { echo "  ✗ $1 — ABORTING before the ledger is touched." >&2; exit 1; }

echo "$VERIFY_OUT" | grep -q '"stale_rows": 0'          || fail "stale role-scoped rows remain"
echo "$VERIFY_OUT" | grep -q '"producers_still_bad": 0' || fail "a producer still writes a role-scoped recipient link"
echo "$VERIFY_OUT" | grep -q '"producers_fixed": 2'     || fail "both producers should emit /messages/"
echo "$VERIFY_OUT" | grep -q '"triggers_live": 2'       || fail "message triggers are not both live"
echo "$VERIFY_OUT" | grep -q '"profile_path_delegates": 1' || fail "nx_profile_path still hard-codes a role path"
echo "$VERIFY_OUT" | grep -q '"probe_profile_path": "/profile"' || fail "nx_profile_path does not resolve to /profile"
echo "$VERIFY_OUT" | grep -q '"stale_profile_rows": 0' || fail "stale /client|/inspector profile rows remain"

echo "  ✓ producers and historical rows now use the canonical path"

echo "→ recording $MIGRATION in the ledger"
run_sql <<SQL | tail -3
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('${MIGRATION%%_*}', '${MIGRATION#*_}')
ON CONFLICT (version) DO NOTHING;
SQL

echo
echo "✓ done. Deploy the web build so /messages/[id] exists before users click."
