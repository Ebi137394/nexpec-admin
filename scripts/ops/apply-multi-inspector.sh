#!/usr/bin/env bash
# Multi-inspector allocations -> Production. Proven on Staging (13/13).
# The duplicate-payment guard is made MORE precise, never weakened:
#   old UNIQUE (commercial_id, beneficiary_role)
#   new UNIQUE (commercial_id, beneficiary_role, beneficiary_id)
#     + partial UNIQUE (commercial_id) WHERE the obligation is an agency payment
set -euo pipefail
PROD_REF="sxqpjxhslzzcdrdctatm"
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGS=("20260801682000_multi_inspector_allocations" "20260801684000_allocation_workflow")
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/supabase"; printf 'project_id="nx"\n' > "$W/supabase/config.toml"
( cd "$W" && supabase link --project-ref "$PROD_REF" >/dev/null )
[ "$(cat "$W/supabase/.temp/project-ref")" = "$PROD_REF" ] || { echo REFUSING >&2; exit 1; }
q(){ ( cd "$W" && supabase db query --linked ); }
fail(){ echo "  ✗ $1 — ABORTING." >&2; exit 1; }
for m in "${MIGS[@]}"; do echo "→ $m"; q < "$R/supabase/migrations/$m.sql" | tail -2; done
echo "→ verifying"
V="$(q <<'SQL'
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
     AND table_name='engagement_allocations')                                   AS alloc_table,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
     AND indexname='settlement_obligations_per_beneficiary')                    AS per_beneficiary,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
     AND indexname='settlement_obligations_one_agency_payment')                 AS one_agency_payment,
  (SELECT count(*) FROM pg_constraint WHERE conname='settlement_obligations_once') AS old_guard_removed,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
     AND indexname='engagement_acceptances_per_party')                          AS acceptance_per_party,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN
       ('nx_admin_set_allocation','nx_admin_remove_allocation'))                AS alloc_rpcs,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='engagement_allocations')                                    AS alloc_policies,
  (SELECT count(*) FROM public.engagement_allocations)                          AS allocations,
  (SELECT count(*) FROM public.settlement_obligations)                          AS obligations;
SQL
)"
echo "$V" | tail -14
echo "$V" | grep -q '"alloc_table": 1'          || fail "allocations table missing"
echo "$V" | grep -q '"per_beneficiary": 1'      || fail "per-beneficiary guard missing"
echo "$V" | grep -q '"one_agency_payment": 1'   || fail "single-agency-payment guard missing"
echo "$V" | grep -q '"old_guard_removed": 0'    || fail "old role-only constraint still present"
echo "$V" | grep -q '"acceptance_per_party": 1' || fail "per-party acceptance index missing"
echo "$V" | grep -q '"alloc_rpcs": 2'           || fail "allocation RPCs missing"
echo "$V" | grep -q '"alloc_policies": 2'       || fail "allocations RLS missing"
echo "  ✓ guards replaced with stricter, more precise ones"
for m in "${MIGS[@]}"; do q <<SQL | tail -1
INSERT INTO supabase_migrations.schema_migrations (version,name)
VALUES ('${m%%_*}','${m#*_}') ON CONFLICT (version) DO NOTHING;
SQL
done
echo; echo "✓ done."
