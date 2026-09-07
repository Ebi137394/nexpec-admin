#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  apply-partner-agency.sh — partner-agency engagements to Production.
#
#  Proven on Staging first (23/23 workflow assertions). Purely ADDITIVE: 7 new
#  tables, 3 new views, 2 helpers, 10 RPCs. No existing table, column, policy,
#  grant, view or function is modified, and nothing is deleted.
#
#  Nothing is enrolled by applying this. Partner standing, customer consent,
#  admin approval and every invitation are deliberate per-job actions.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail
PROD_REF="sxqpjxhslzzcdrdctatm"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS=(
  "20260801668000_partner_agency_engagements"
  "20260801670000_partner_agency_rls_and_rpcs"
  "20260801672000_partner_agency_workflow_rpcs"
)
# The web surfaces the notifications link to must already be deployed.
for r in "$REPO_ROOT/apps/web/src/app/partner/opportunities/page.tsx" \
         "$REPO_ROOT/apps/web/src/app/engagements/page.tsx"; do
  [ -f "$r" ] || { echo "MISSING web route: $r" >&2; exit 1; }
done

WORKDIR="$(mktemp -d)"; trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$WORKDIR/supabase"
printf 'project_id = "nexpec-prod-apply"\n' > "$WORKDIR/supabase/config.toml"
( cd "$WORKDIR" && supabase link --project-ref "$PROD_REF" >/dev/null )
REF="$(cat "$WORKDIR/supabase/.temp/project-ref" 2>/dev/null || echo none)"
[ "$REF" = "$PROD_REF" ] || { echo "REFUSING: linked to '$REF'" >&2; exit 1; }
run_sql() { ( cd "$WORKDIR" && supabase db query --linked ); }
fail() { echo "  ✗ $1 — ABORTING before the ledger is touched." >&2; exit 1; }

for m in "${MIGRATIONS[@]}"; do
  echo "→ applying $m"
  run_sql < "$REPO_ROOT/supabase/migrations/$m.sql" | tail -2
done

echo "→ verifying"
V="$(run_sql <<'SQL'
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
    AND table_name IN ('partner_agencies','job_partner_policy','partner_opportunities',
      'partner_nominations','engagement_commercials','engagement_acceptances',
      'settlement_obligations'))                                        AS tables_created,
  (SELECT count(*) FROM information_schema.views WHERE table_schema='public'
    AND table_name IN ('engagement_customer_view','engagement_partner_view',
      'engagement_inspector_view'))                                     AS views_created,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('nx_is_partner_agency','nx_partner_sees_job','nx_admin_price_engagement',
       'nx_admin_present_engagement','nx_accept_engagement','nx_admin_confirm_engagement',
       'nx_admin_settle_obligation','nx_partner_nominate_inspector',
       'nx_admin_invite_partner','nx_admin_approve_partner_job',
       'nx_job_set_partner_consent','nx_admin_set_partner_standing'))    AS rpcs_created,
  -- The money table carries the ordinary `authenticated` grant, because an
  -- ADMIN reads it through that same role. RLS is the control: the only
  -- policy on it is admin-only, so a non-admin sees zero rows. Asserting the
  -- grant were absent would be asserting the wrong property and would break
  -- admin reads.
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
    AND tablename='engagement_commercials')                             AS money_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
    AND tablename='engagement_commercials'
    AND qual LIKE '%nx_is_admin%')                                      AS money_admin_only,
  (SELECT has_table_privilege('anon','public.settlement_obligations','SELECT'))
                                                                        AS anon_reads_money,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public'
    AND tablename IN ('partner_agencies','job_partner_policy','partner_opportunities',
      'partner_nominations','engagement_commercials','engagement_acceptances',
      'settlement_obligations') AND rowsecurity)                        AS rls_enabled,
  -- nothing is enrolled by applying this
  (SELECT count(*) FROM public.partner_agencies)                        AS partners_enrolled,
  (SELECT count(*) FROM public.engagement_commercials)                  AS engagements,
  (SELECT count(*) FROM public.settlement_obligations)                  AS obligations;
SQL
)"
echo "$V" | tail -16
echo "$V" | grep -q '"tables_created": 7'      || fail "not all tables created"
echo "$V" | grep -q '"views_created": 3'       || fail "not all views created"
echo "$V" | grep -q '"rpcs_created": 12'       || fail "not all RPCs created"
echo "$V" | grep -q '"rls_enabled": 7'         || fail "RLS not enabled on every table"
echo "$V" | grep -q '"money_policies": 1'      || fail "engagement_commercials should have exactly ONE policy"
echo "$V" | grep -q '"money_admin_only": 1'    || fail "engagement_commercials policy is not admin-gated"
echo "$V" | grep -q '"anon_reads_money": false'|| fail "anon can read settlement_obligations"
echo "$V" | grep -q '"partners_enrolled": 0'   || fail "something was enrolled"
echo "  ✓ created, locked down, and nothing enrolled"

echo "→ recording in the ledger"
for m in "${MIGRATIONS[@]}"; do
  run_sql <<SQL | tail -1
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('${m%%_*}', '${m#*_}') ON CONFLICT (version) DO NOTHING;
SQL
done
echo; echo "✓ done."
