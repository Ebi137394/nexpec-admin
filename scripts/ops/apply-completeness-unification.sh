#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  apply-completeness-unification.sh
#
#  Applies 20260801658000_unify_completeness_rule.sql to Production, which
#  collapses the two competing profile-completeness rules into one.
#
#  Before: nx_profile_missing_fields() applied a role-BLIND rule (always
#  full_name/company_name/phone/location) while nx_role_missing_fields()
#  applied the canonical role-aware one. Four live consumers read the blind
#  rule — the Admin incomplete-profiles queue, the Telegram /pending queue,
#  the Admin User Detail readiness label, and the reminder-email nudge — so
#  the platform asked independent inspectors for a "Company" they cannot have
#  while onboarding asked the same user for something else entirely.
#
#  This is REPLACE-ONLY: one CREATE OR REPLACE FUNCTION. No table, policy,
#  grant or trigger is touched, and the signature, return type, volatility
#  (STABLE), SECURITY DEFINER flag and pinned search_path are reproduced
#  exactly, so the existing EXECUTE grants carry over unchanged.
#
#  USAGE
#    export SUPABASE_ACCESS_TOKEN=...      # or be logged in via `supabase login`
#    bash scripts/ops/apply-completeness-unification.sh
#
#  The script refuses to run against anything but Production, applies the
#  migration, proves the behaviour actually changed against a REAL production
#  account, and only then records it in the ledger. A failed verification
#  aborts before the ledger is touched.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROD_REF="sxqpjxhslzzcdrdctatm"
MIGRATION="20260801658000_unify_completeness_rule"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION_FILE="$REPO_ROOT/supabase/migrations/$MIGRATION.sql"

# The real inspector from the incident. Role-aware answer is phone/location/
# specialties; the old blind rule said company_name/phone/location.
PROBE_USER="93858a9e-a16d-42ff-b0ef-ba36ebdc8cf0"

[ -f "$MIGRATION_FILE" ] || { echo "MISSING migration file: $MIGRATION_FILE" >&2; exit 1; }

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

# ── Capture the pre-state so the change is provable and reversible ─────────
echo "→ pre-state for probe user $PROBE_USER"
run_sql <<SQL | tail -12
SELECT public.nx_role_missing_fields('$PROBE_USER')    AS role_aware,
       public.nx_profile_missing_fields('$PROBE_USER') AS legacy,
       public.nx_missing_fields_label('$PROBE_USER')   AS label;
SQL

# ── Apply ──────────────────────────────────────────────────────────────────
echo "→ applying $MIGRATION"
run_sql < "$MIGRATION_FILE" | tail -3

# ── Verify BEFORE recording ────────────────────────────────────────────────
# Two independent proofs: the two rules must now agree for EVERY non-admin
# account in Production, and the probe user's label must have actually
# changed to the role-aware answer.
echo "→ verifying the two rules now agree for every non-admin account"
VERIFY_OUT="$(run_sql <<SQL
SELECT
  (SELECT count(*) FROM public.profiles p
    WHERE p.deleted_at IS NULL
      AND p.role NOT IN ('admin','super_admin')
      AND public.nx_profile_missing_fields(p.id)
          IS DISTINCT FROM public.nx_role_missing_fields(p.id)) AS disagreements,
  (SELECT public.nx_missing_fields_label('$PROBE_USER'))        AS probe_label,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='nx_profile_missing_fields'
      AND p.prosrc LIKE '%nx_role_missing_fields%')             AS delegates,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='nx_profile_missing_fields'
      AND p.prosecdef AND p.provolatile='s')                    AS props_preserved,
  (SELECT has_function_privilege('anon',
            'public.nx_profile_missing_fields(uuid)', 'EXECUTE')) AS anon_can_exec;
SQL
)"
echo "$VERIFY_OUT" | tail -14

fail() { echo "  ✗ $1 — ABORTING before the ledger is touched." >&2; exit 1; }

echo "$VERIFY_OUT" | grep -q '"disagreements": 0'   || fail "the two rules still disagree for some account"
echo "$VERIFY_OUT" | grep -q '"delegates": 1'       || fail "nx_profile_missing_fields does not delegate"
echo "$VERIFY_OUT" | grep -q '"props_preserved": 1' || fail "SECURITY DEFINER / STABLE not preserved"
echo "$VERIFY_OUT" | grep -q '"anon_can_exec": false' || fail "anon gained EXECUTE — grant regression"
echo "$VERIFY_OUT" | grep -qi 'Company'             && fail "probe label still asks an inspector for a Company"

echo "  ✓ one rule, both names agree, grants and properties unchanged"

# ── Reconcile the ledger only after verification passed ────────────────────
echo "→ recording $MIGRATION in the ledger"
run_sql <<SQL | tail -3
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('${MIGRATION%%_*}', '${MIGRATION#*_}')
ON CONFLICT (version) DO NOTHING;
SQL

echo
echo "✓ done. Completeness is now computed by exactly one rule."
