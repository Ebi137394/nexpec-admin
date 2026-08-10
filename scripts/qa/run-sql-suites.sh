#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  run-sql-suites.sh — apply the migrations to LOCAL Supabase and run every
#  behavioural SQL suite, stopping at the first failure.
#
#  WHY THIS EXISTS
#  The authoring sandbox has no Postgres and cannot obtain one (the Ubuntu
#  archive, PyPI and npm are all blocked by its proxy), so the SQL suites can
#  only be executed on the developer machine. This script makes that one
#  command instead of a dozen, so "did it actually run?" is never ambiguous.
#
#  USAGE
#    bash scripts/qa/run-sql-suites.sh              # reset + migrate + test
#    bash scripts/qa/run-sql-suites.sh --no-reset   # test against the DB as-is
#
#  SAFETY
#  Refuses to run against anything that is not localhost. Every suite is
#  self-contained and ends in ROLLBACK, so no permanent rows are created.
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

RESET=1
[[ "${1:-}" == "--no-reset" ]] && RESET=0

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
pass=0; fail=0; failed_suites=()

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$RST" "$*"; }
bad()  { printf '%s✘%s %s\n' "$RED" "$RST" "$*"; }
die()  { bad "$*"; exit 1; }

command -v supabase >/dev/null || die "supabase CLI not found — install it or run with --no-reset and set LOCAL_DATABASE_URL"

# ── Resolve the local connection string ────────────────────────────────────
DB_URL="${LOCAL_DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
  DB_URL="$(supabase status 2>/dev/null | sed -n 's/.*DB URL: *//p' | head -1)"
fi
[[ -z "$DB_URL" ]] && DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# ── Refuse anything that is not local ──────────────────────────────────────
case "$DB_URL" in
  *127.0.0.1*|*localhost*|*@db:*) : ;;
  *) die "refusing to run against a non-local database: ${DB_URL%%\?*}" ;;
esac
say "${DIM}database: ${DB_URL%%\?*}${RST}"

command -v psql >/dev/null || die "psql not found (brew install libpq, or use the one bundled with Postgres.app)"

# ── 1. Apply migrations ────────────────────────────────────────────────────
if [[ $RESET -eq 1 ]]; then
  say ""; say "── resetting local database and applying all migrations ──"
  if ! supabase db reset; then
    die "supabase db reset FAILED — a migration did not apply. Fix that before running the suites."
  fi
  ok "all migrations applied cleanly (this also runs every migration self-test)"
else
  say "${YEL}skipping reset — testing against the database as it stands${RST}"
fi

# ── 2. Run every behavioural suite ─────────────────────────────────────────
say ""; say "── behavioural SQL suites ──"
shopt -s nullglob
for suite in supabase/tests/*.sql; do
  name="$(basename "$suite")"
  out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$suite" 2>&1)"
  if [[ $? -eq 0 ]]; then
    ok "$name"
    # Surface the suite's own PASSED banner if it printed one.
    printf '%s' "$out" | grep -E "ALL ASSERTIONS PASSED|^\s*ok [0-9]" | tail -1 | sed "s/^/    ${DIM}/;s/$/${RST}/"
    pass=$((pass+1))
  else
    bad "$name"
    printf '%s\n' "$out" | grep -E "ERROR|FAILED|DETAIL|CONTEXT" | head -8 | sed 's/^/    /'
    failed_suites+=("$name")
    fail=$((fail+1))
  fi
done

# ── 3. Static guards (these also run in the sandbox) ───────────────────────
say ""; say "── static guards ──"
for g in qa:sql-schema qa:admin-routes qa:gr2 qa:gr2-inspector qa:assignment-privacy qa:jobs-columns qa:admin-money qa:db-refs; do
  if npm run --silent "$g" >/tmp/nx-$g.log 2>&1; then ok "$g"; else bad "$g"; sed 's/^/    /' /tmp/nx-$g.log | tail -6; fail=$((fail+1)); fi
done

# ── Verdict ────────────────────────────────────────────────────────────────
say ""
if [[ $fail -eq 0 ]]; then
  printf '%s══ ALL GREEN ══%s  %d suite(s) passed\n' "$GRN" "$RST" "$pass"
  exit 0
fi
printf '%s══ %d FAILURE(S) ══%s  %d passed\n' "$RED" "$fail" "$RST" "$pass"
for s in "${failed_suites[@]}"; do printf '    %s\n' "$s"; done
exit 1
