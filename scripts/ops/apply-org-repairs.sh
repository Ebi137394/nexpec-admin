#!/usr/bin/env bash
# Org scoping / invitations / departments / client credit terms -> Production.
# Proven on Staging first (13/13).
set -euo pipefail
PROD_REF="sxqpjxhslzzcdrdctatm"
M="20260801678000_org_scoping_invitations_departments_credit"
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/supabase"; printf 'project_id = "nx"\n' > "$W/supabase/config.toml"
( cd "$W" && supabase link --project-ref "$PROD_REF" >/dev/null )
[ "$(cat "$W/supabase/.temp/project-ref")" = "$PROD_REF" ] || { echo REFUSING >&2; exit 1; }
q() { ( cd "$W" && supabase db query --linked ); }
fail() { echo "  ✗ $1 — ABORTING." >&2; exit 1; }
echo "→ applying $M"; q < "$R/supabase/migrations/$M.sql" | tail -2
echo "→ verifying"
V="$(q <<'SQL'
SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='nx_is_org_member'
      AND p.prosrc LIKE '%org_members%')                                  AS member_authoritative,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('nx_user_org_ids','nx_accept_org_invitation','nx_admin_revoke_org_invitation',
       'nx_admin_set_client_credit_terms'))                               AS new_rpcs,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_department'
      AND p.prosrc LIKE '%INSERT INTO public.org_departments%')           AS dept_writes_fk_target,
  (SELECT count(*) FROM public.departments)                               AS legacy_departments,
  (SELECT count(*) FROM public.org_members)                               AS memberships,
  (SELECT count(*) FROM public.profiles
    WHERE client_payment_terms IS DISTINCT FROM 'prepay')                 AS non_default_terms;
SQL
)"
echo "$V" | tail -12
echo "$V" | grep -q '"member_authoritative": 1'  || fail "nx_is_org_member not repaired"
echo "$V" | grep -q '"new_rpcs": 4'              || fail "new RPCs missing"
echo "$V" | grep -q '"dept_writes_fk_target": 1' || fail "create_department still writes the legacy table"
echo "$V" | grep -q '"non_default_terms": 0'     || fail "credit terms changed unexpectedly"
echo "  ✓ applied; no customer credit granted"
q <<SQL | tail -1
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('${M%%_*}', '${M#*_}') ON CONFLICT (version) DO NOTHING;
SQL
echo; echo "✓ done."
