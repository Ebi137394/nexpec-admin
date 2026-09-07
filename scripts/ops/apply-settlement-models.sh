#!/usr/bin/env bash
# Applies the second settlement model + audit repairs to Production.
# Proven on Staging first (17/17 financial invariants).
set -euo pipefail
PROD_REF="sxqpjxhslzzcdrdctatm"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS=("20260801674000_settlement_model_b_and_repairs" "20260801676000_settlement_model_workflow")
WORKDIR="$(mktemp -d)"; trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$WORKDIR/supabase"; printf 'project_id = "nx"\n' > "$WORKDIR/supabase/config.toml"
( cd "$WORKDIR" && supabase link --project-ref "$PROD_REF" >/dev/null )
[ "$(cat "$WORKDIR/supabase/.temp/project-ref")" = "$PROD_REF" ] || { echo "REFUSING" >&2; exit 1; }
run_sql() { ( cd "$WORKDIR" && supabase db query --linked ); }
fail() { echo "  ✗ $1 — ABORTING." >&2; exit 1; }
for m in "${MIGRATIONS[@]}"; do
  echo "→ applying $m"; run_sql < "$REPO_ROOT/supabase/migrations/$m.sql" | tail -2
done
echo "→ verifying"
V="$(run_sql <<'SQL'
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
    AND table_name='engagement_commercials'
    AND column_name IN ('settlement_model','agency_total_cents','inspector_agency_comp_cents')) AS model_cols,
  (SELECT count(*) FROM pg_constraint WHERE conname IN
    ('engagement_model_shape','engagement_settlement_model_enum','engagement_model_b_total_required')) AS model_checks,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
    AND table_name='settlement_obligations' AND column_name='obligation_kind')                  AS kind_col,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='nx_admin_price_engagement')                          AS price_fns,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('nx_mirror_work_experience','nx_mirror_inspector_work_experience',
       'nx_mirror_client_feedback','nx_admin_set_supplier_verification'))                        AS repair_fns,
  (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND t.tgenabled<>'D' AND p.proname IN
      ('nx_mirror_work_experience','nx_mirror_inspector_work_experience','nx_mirror_client_feedback')) AS repair_triggers,
  (SELECT count(*) FROM public.engagement_commercials)                                           AS engagements,
  (SELECT count(*) FROM public.settlement_obligations)                                           AS obligations;
SQL
)"
echo "$V" | tail -14
echo "$V" | grep -q '"model_cols": 3'      || fail "settlement model columns missing"
echo "$V" | grep -q '"model_checks": 3'    || fail "model CHECK constraints missing"
echo "$V" | grep -q '"kind_col": 1'        || fail "obligation_kind missing"
echo "$V" | grep -q '"price_fns": 1'       || fail "expected exactly ONE nx_admin_price_engagement (old signature must be gone)"
echo "$V" | grep -q '"repair_fns": 4'      || fail "repair functions missing"
echo "$V" | grep -q '"repair_triggers": 3' || fail "repair triggers not live"
echo "$V" | grep -q '"engagements": 0'     || fail "engagements exist unexpectedly"
echo "  ✓ both models live, repairs live, nothing activated"
echo "→ ledger"
for m in "${MIGRATIONS[@]}"; do
  run_sql <<SQL | tail -1
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('${m%%_*}', '${m#*_}') ON CONFLICT (version) DO NOTHING;
SQL
done
echo; echo "✓ done."
