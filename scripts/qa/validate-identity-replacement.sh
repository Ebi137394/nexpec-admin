#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  scripts/qa/validate-identity-replacement.sh
#
#  ONE-COMMAND local validation for the Inspection-Marketplace identity +
#  replacement feature. Run this on YOUR machine (Supabase CLI logged in / local
#  stack up) — it performs the DB-dependent steps the assistant sandbox cannot:
#  apply migrations, run pgTAP, then all static guards + typechecks + lint.
#
#  Usage:
#    ./scripts/qa/validate-identity-replacement.sh            # local stack
#    TARGET=linked ./scripts/qa/validate-identity-replacement.sh   # linked dev project
#
#  DEV ONLY. Never point this at production.
#  Stops at the first failure so you fix one thing at a time (Phase 5).
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.."
TARGET="${TARGET:-local}"
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

# ── Phase 1: apply migrations ────────────────────────────────────────────────
# pgTAP (supabase test db) ALWAYS runs against the LOCAL shadow database — it
# cannot test a linked remote project. So we keep the two paths cleanly separate:
#   • local  → apply to local + authoritative pgTAP suite.
#   • linked → push to the linked DEV project + a READ-ONLY remote smoke that the
#              new objects resolved; pgTAP is NOT claimed for linked (run it in
#              local mode). Never target production.
if [ "$TARGET" = "local" ]; then
  step "Phase 1 · start local stack + apply all migrations (reset)"
  supabase start
  supabase db reset            # applies every migration from scratch on the local db
  ok "migrations applied (local)"

  step "Phase 2a · pgTAP database tests against LOCAL (all supabase/tests/*.sql)"
  supabase test db
  ok "pgTAP passed on local (incl. rls_identity_replacement_test.sql: 31 assertions)"
else
  step "Phase 1 · push migrations to the LINKED (dev) project"
  echo "   (ensure: supabase link --project-ref <DEV_REF>; this must NOT be prod)"
  supabase db push
  ok "migrations pushed (linked dev)"

  step "Phase 2a · REMOTE smoke (read-only): confirm new objects resolved in the linked schema"
  echo "   NOTE: pgTAP (supabase test db) validates the LOCAL shadow DB, not this"
  echo "   linked project — run this script in local mode for the authoritative pgTAP run."
  # Read-only existence probe via the REST schema cache (no writes, no prod).
  psql "${SUPABASE_DB_URL:?set SUPABASE_DB_URL to the linked DEV pooler URL}" -v ON_ERROR_STOP=1 -c \
    "select 'admin_set_project_policy'::regproc, 'admin_void_contract'::regproc, 'admin_replace_inspector'::regproc, 'client_job_contracts_view'::regclass, 'is_active_contract_inspector'::regproc;"
  ok "remote smoke passed (new RPCs + view resolve on the linked dev project)"
fi

# ── Phase 2: static guards (no DB needed) ────────────────────────────────────
step "Phase 2b · QA guards"
node scripts/qa/check-db-refs.mjs
node scripts/qa/check-price-blindness.mjs
node scripts/qa/check-rls-admin-coverage.mjs
node scripts/qa/check-outbox-routing.mjs
node scripts/qa/check-model-shas.mjs
ok "QA guards passed"

# ── Phase 2: typecheck + lint ────────────────────────────────────────────────
step "Phase 2c · web typecheck"
( cd apps/web && npx tsc --noEmit )
ok "web typecheck clean"

step "Phase 2d · mobile typecheck"
npx tsc --noEmit -p tsconfig.json
ok "mobile typecheck clean"

step "Phase 2e · lint"
( cd apps/web && npm run lint )
ok "lint clean"

step "Phase 2f · shared-core unit tests"
( cd packages/shared-core && npx vitest run )
ok "unit tests passed"

printf '\n\033[1;32m════════ ALL LOCAL VALIDATION PASSED ════════\033[0m\n'
echo "Next: run the app against DEV and walk the manual checklist"
echo "  (see NEXPEC_IDENTITY_REPLACEMENT_MANUAL_QA.md)."
