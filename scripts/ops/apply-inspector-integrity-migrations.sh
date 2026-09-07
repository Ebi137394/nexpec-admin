#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  apply-inspector-integrity-migrations.sh
#
#  Applies the two migrations from the inspector data-integrity incident to
#  Production, then reconciles the migration ledger.
#
#  Both are ADDITIVE ONLY — new columns, new policies, new triggers, one new
#  function. Nothing is dropped, no data is deleted, no existing policy is
#  loosened. The only widening is that an admin may INSERT/UPDATE objects in
#  the `inspector-docs` bucket outside their own folder; admins already had
#  SELECT and DELETE on every object in that bucket and ALL on the
#  inspector_documents table, so this closes a gap rather than opening one.
#
#  Both were applied to Staging (zmzvmgaeovleuvbvwxei) and their triggers
#  proven there with a self-rolling-back test before this script was written.
#
#  USAGE
#    export SUPABASE_ACCESS_TOKEN=...      # or be logged in via `supabase login`
#    bash scripts/ops/apply-inspector-integrity-migrations.sh
#
#  The script refuses to run against anything but Production, applies each
#  migration, verifies the objects landed, and only then records them in the
#  ledger. A failed verification aborts before the ledger is touched, so the
#  ledger can never claim a migration that did not actually apply.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROD_REF="sxqpjxhslzzcdrdctatm"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

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

# ── Apply ──────────────────────────────────────────────────────────────────
MIGRATIONS=(
  "20260801654000_admin_assisted_profile_and_documents"
  "20260801656000_mobile_write_contract_compat"
)

for m in "${MIGRATIONS[@]}"; do
  f="$MIGRATIONS_DIR/$m.sql"
  [ -f "$f" ] || { echo "MISSING migration file: $f" >&2; exit 1; }
  echo "→ applying $m"
  run_sql < "$f" | tail -3
done

# ── Verify BEFORE recording ────────────────────────────────────────────────
# Every object the two migrations create. If any count is wrong the ledger is
# left untouched, so a partial apply can never be recorded as complete.
echo "→ verifying objects landed"
VERIFY_OUT="$(run_sql <<'SQL'
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inspector_documents'
      AND column_name IN ('uploaded_by','upload_source','upload_reason')) AS provenance_cols,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name IN ('daily_rate_cents','travel_rate_unit','accepts_credit_card',
                          'accepts_bank_transfer','accepts_check')) AS rate_cols,
  (SELECT count(*) FROM pg_policies WHERE schemaname='storage'
      AND policyname IN ('inspector_docs_insert_admin','inspector_docs_update_admin')) AS storage_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='work_experience'
      AND policyname LIKE 'work_experience_self%') AS we_owner_policies,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='nx_admin_notify_profile_edit') AS notify_fn,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('nx_profiles_mobile_compat_trg','nx_equipment_owner_compat_trg')) AS triggers;
SQL
)"
echo "$VERIFY_OUT"

for pair in "provenance_cols\": 3" "rate_cols\": 5" "storage_policies\": 2" \
            "we_owner_policies\": 3" "notify_fn\": 1" "triggers\": 2"; do
  if ! grep -q "\"$pair" <<<"$VERIFY_OUT"; then
    echo "VERIFY FAILED — expected $pair. Ledger NOT updated." >&2
    exit 1
  fi
done
echo "  ✓ all objects present"

# ── Reconcile the ledger ───────────────────────────────────────────────────
# 20260801648000 / 650000 / 652000 were applied to Production earlier by direct
# SQL and never recorded. Their effects are verified live (nx_role_profile_path
# returns '/profile'; tg_send_daily_brief links '/admin/dashboard'; no producer
# emits '/admin/support'), so recording them is truthful, and it stops a future
# `supabase db push` from trying to re-apply them.
echo "→ reconciling the migration ledger"
run_sql <<'SQL' | tail -3
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES
  ('20260801648000', 'canonical_profile_route'),
  ('20260801650000', 'fix_admin_deeplinks'),
  ('20260801652000', 'daily_brief_admin_link'),
  ('20260801654000', 'admin_assisted_profile_and_documents'),
  ('20260801656000', 'mobile_write_contract_compat')
ON CONFLICT (version) DO NOTHING;
SQL

echo "→ ledger now at:"
run_sql <<'SQL' | tail -8
SELECT version, name FROM supabase_migrations.schema_migrations
 ORDER BY version DESC LIMIT 5;
SQL

echo
echo "✓ done. Now promote the web build so Admin reads the new columns."
