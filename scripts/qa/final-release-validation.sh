#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  scripts/qa/final-release-validation.sh
#
#  ONE command that validates the entire NEXPEC release-hardening stack against
#  a LOCAL Supabase. Stops on the first real error. Never touches a remote
#  project — it refuses to run against a non-local database URL.
#
#      bash scripts/qa/final-release-validation.sh
#
#  Requires on the developer Mac: Docker running, Supabase CLI, Node.
#  `--static-only` runs steps 1, 6, 7 and then reports clearly that the whole
#  database half did NOT run. It exits 2, never 0, so it can never be mistaken
#  for a full pass.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

STATIC_ONLY=0
[[ "${1:-}" == "--static-only" ]] && STATIC_ONLY=1

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
step() { printf "\n${BLD}── %s${RST}\n" "$*"; }
ok()   { printf "   ${GRN}ok${RST}   %s\n" "$*"; }
warn() { printf "   ${YEL}warn${RST} %s\n" "$*"; }
die()  { printf "\n${RED}${BLD}FINAL RELEASE VALIDATION FAILED${RST}\n   %s\n\n" "$*" >&2; exit 1; }
trap 'die "aborted at line $LINENO"' ERR

EXPECTED_BRANCH="release/identity-replacement"
DB_URL=""

# ════════════════════════════════════════════════════════════════════════════
#  1. Repository state
# ════════════════════════════════════════════════════════════════════════════
step "1. Repository state"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "$EXPECTED_BRANCH" ]] || die "on branch '$BRANCH', expected '$EXPECTED_BRANCH'"
ok "branch $BRANCH"

for f in \
  supabase/migrations/20260801304000_schedule_meeting_engagement_authorization.sql \
  supabase/migrations/20260801306000_admin_direct_inspector_assignment.sql \
  supabase/migrations/20260801308000_revoke_unguarded_definer_rpc_grants.sql \
  supabase/migrations/20260801310000_admin_direct_assignment_override.sql \
  supabase/migrations/20260801312000_jobs_column_privilege_price_blindness.sql \
  supabase/migrations/20260801314000_revoke_remaining_unguarded_definer_rpcs.sql \
  supabase/migrations/20260801316000_nx_notify_lockdown.sql \
  supabase/tests/admin_direct_assignment_test.sql \
  supabase/tests/inspector_price_blindness_test.sql \
  supabase/tests/rpc_authorization_test.sql \
  supabase/rollback/20260801304000_to_316000_rollback.sql ; do
  [[ -f "$f" ]] || die "missing required file: $f"
done
ok "7 migrations, 3 new test suites and the rollback script are present"

# ════════════════════════════════════════════════════════════════════════════
#  Database phase (2 → 5, 8, 8b)
# ════════════════════════════════════════════════════════════════════════════
run_database_phase() {
  step "2. Local Supabase"
  command -v supabase >/dev/null 2>&1 || die "Supabase CLI not found — install it, or re-run with --static-only"
  command -v psql     >/dev/null 2>&1 || die "psql not found — install libpq, or re-run with --static-only"
  docker info >/dev/null 2>&1         || die "Docker is not running — start Docker Desktop, or re-run with --static-only"

  if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
    case "$SUPABASE_DB_URL" in
      *localhost*|*127.0.0.1*) : ;;
      *) die "SUPABASE_DB_URL points at a non-local host — refusing to run" ;;
    esac
  fi

  supabase start >/dev/null 2>&1 || true
  DB_URL="$(supabase status 2>/dev/null | sed -n 's/.*DB URL: *//p' | head -1)"
  [[ -z "$DB_URL" ]] && DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  case "$DB_URL" in
    *localhost*|*127.0.0.1*) : ;;
    *) die "resolved DB_URL is not local: $DB_URL" ;;
  esac
  ok "local database $DB_URL"

  step "3. Reset and apply every migration in order"
  # Each migration ends in a DO $test$ block that RAISEs on failure, so a failed
  # self-test aborts the reset — applying IS testing.
  supabase db reset --local >/dev/null || die "supabase db reset failed — a migration or its self-test did not pass"
  ok "304000 → 306000 → 308000 → 310000 → 312000 → 314000 → 316000 applied"
  ok "every migration self-test passed"

  step "4/5. Database test suites"
  for t in \
    supabase/tests/inspector_price_blindness_test.sql \
    supabase/tests/rpc_authorization_test.sql \
    supabase/tests/admin_direct_assignment_test.sql ; do
    printf "   running %s\n" "$t"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$t" || die "$t FAILED"
    ok "$(basename "$t")"
  done

  shopt -s nullglob
  for t in supabase/tests/*.sql; do
    case "$(basename "$t")" in
      inspector_price_blindness_test.sql|rpc_authorization_test.sql|admin_direct_assignment_test.sql) continue ;;
    esac
    printf "   running %s (pre-existing)\n" "$t"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$t" || die "$(basename "$t") FAILED — a pre-existing suite regressed"
    ok "$(basename "$t")"
  done
  shopt -u nullglob

  step "8. Direct role/privilege probes"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "direct probes FAILED"
DO $probe$
BEGIN
  IF has_column_privilege('authenticated','public.jobs','client_price_cents','SELECT')
     OR has_column_privilege('authenticated','public.jobs','platform_spread_cents','SELECT')
     OR has_column_privilege('authenticated','public.jobs','contractor_payout_amount_cents','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: a forbidden pricing column is readable by authenticated';
  END IF;
  IF NOT has_column_privilege('authenticated','public.jobs','inspector_payout_cents','SELECT')
     OR NOT has_column_privilege('authenticated','public.jobs','payout_amount_cents','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: the inspector lost their own payout columns';
  END IF;
  IF NOT has_table_privilege('authenticated','public.jobs_secure_view','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: jobs_secure_view is unreadable (client/admin pricing would break)';
  END IF;
  IF has_function_privilege('authenticated','public.debit_wallet_for_payout(uuid,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAILED: wallet debit is reachable';
  END IF;
  IF has_function_privilege('authenticated','public.nx_notify(uuid,text,text,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAILED: arbitrary notification is reachable';
  END IF;
  IF NOT has_column_privilege('service_role','public.jobs','client_price_cents','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: service_role lost pricing access (Edge Functions would break)';
  END IF;
  RAISE NOTICE 'direct probes passed';
END
$probe$;
SQL
  ok "inspector denied · client/admin allowed · wallet denied · notification denied · service_role intact"

  step "8b. Smoke probes — migrated callers resolve"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "smoke probes FAILED"
DO $smoke$
DECLARE
  v_missing text := '';
  v_col     text;
  v_n       int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='jobs_secure_view') THEN
    RAISE EXCEPTION 'SMOKE FAILED: jobs_secure_view does not exist';
  END IF;

  -- ── (1) THE REAL INVARIANT, and the drift detector ──────────────────────
  --  jobs_secure_view is `SELECT j.* FROM public.jobs j`, so its column set
  --  must be IDENTICAL to public.jobs. Asserting that is strictly stronger
  --  than any hand-maintained list: it catches the view being narrowed, and it
  --  automatically covers every column a future caller might request.
  --  (The previous version of this probe hard-coded a column list that had
  --  been derived by an unbounded source scan; it wrongly demanded
  --  `is_published`, which belongs to inspection_reports, not to jobs.)
  SELECT count(*) INTO v_n
    FROM (
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='jobs'
      EXCEPT
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='jobs_secure_view'
    ) d;
  IF v_n <> 0 THEN
    SELECT string_agg(column_name, ' ') INTO v_missing
      FROM (
        SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='jobs'
        EXCEPT
        SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='jobs_secure_view'
      ) d;
    RAISE EXCEPTION 'SMOKE FAILED: jobs_secure_view has drifted from public.jobs; missing: %', v_missing;
  END IF;

  -- ── (2) The exact union of columns the 32 redirected callers request ────
  --  Derived per-query (bounded to each .from() call, not a fixed look-ahead)
  --  and filtered to columns that actually exist on public.jobs.
  FOREACH v_col IN ARRAY ARRAY[
    'admin_confirmed_at','agency_id','applications_count','budget_cents','budget_max_cents',
    'budget_min_cents','budget_type','client_id','client_price_cents','client_settled_at',
    'contractor_id','contractor_payout_amount_cents','created_at','currency','deleted_at',
    'description','escrow_status','hired_inspector_id','id','identity_mode',
    'inspector_payout_cents','job_country','location','location_city','moderation_status',
    'payment_mode','payout_amount_cents','payout_paid_at','payout_status',
    'platform_spread_cents','replacement_mode','scheduled_date','source_rfq_id','status',
    'title','updated_at','urgency'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='jobs_secure_view'
                      AND column_name=v_col) THEN
      v_missing := v_missing || v_col || ' ';
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'SMOKE FAILED: jobs_secure_view is missing caller column(s): %', v_missing;
  END IF;

  -- ── (3) Forbidden columns must NOT be reachable on the base table ───────
  --  The view legitimately exposes pricing to owners/admins; the BASE TABLE
  --  must still refuse it to `authenticated`. Re-asserted here so a future
  --  change to the view can never quietly re-open the inspector path.
  FOREACH v_col IN ARRAY public.nx_jobs_buyer_only_columns() LOOP
    IF has_column_privilege('authenticated','public.jobs',v_col,'SELECT') THEN
      RAISE EXCEPTION 'SMOKE FAILED: authenticated regained jobs.%', v_col;
    END IF;
  END LOOP;

  -- ── (4) Inspector operational columns still resolve on the base table ───
  FOREACH v_col IN ARRAY ARRAY['id','title','status','scheduled_date','inspector_payout_cents','payout_amount_cents'] LOOP
    IF NOT has_column_privilege('authenticated','public.jobs',v_col,'SELECT') THEN
      RAISE EXCEPTION 'SMOKE FAILED: the inspector cannot read jobs.%', v_col;
    END IF;
  END LOOP;

  RAISE NOTICE 'smoke probes passed';
END
$smoke$;
SQL
  ok "jobs_secure_view column set is identical to public.jobs (no drift)"
  ok "every caller column resolves on the view"
  ok "forbidden pricing columns still denied on the base table"
  ok "inspector operational columns still resolve on public.jobs"
}

if [[ $STATIC_ONLY -eq 0 ]]; then
  run_database_phase
else
  step "2-5, 8, 8b. Database phase"
  warn "SKIPPED (--static-only): no migration applied, NO database test ran."
fi

# ════════════════════════════════════════════════════════════════════════════
#  6. Typechecks
# ════════════════════════════════════════════════════════════════════════════
step "6. Typechecks"
( cd apps/web && npx tsc --noEmit ) || die "web tsc failed"
ok "web tsc"
( cd packages/shared-core && npx tsc --noEmit ) || die "shared-core tsc failed"
ok "shared-core tsc"
npx tsc --noEmit || die "mobile tsc failed"
ok "mobile tsc (full project)"

# ════════════════════════════════════════════════════════════════════════════
#  7. Lint and QA guards
# ════════════════════════════════════════════════════════════════════════════
step "7. Lint and QA guards"
( cd apps/web && npx eslint src ) || die "web eslint failed"
ok "web eslint"
for g in qa:gr2 qa:gr2-inspector qa:assignment-privacy qa:jobs-columns qa:admin-money qa:db-refs qa:rls-admin qa:outbox; do
  npm run --silent "$g" >/dev/null || die "$g failed"
  ok "$g"
done

# ════════════════════════════════════════════════════════════════════════════
#  9. Result
# ════════════════════════════════════════════════════════════════════════════
if [[ $STATIC_ONLY -eq 1 ]]; then
  printf "\n${YEL}${BLD}STATIC CHECKS PASSED — DATABASE VALIDATION DID NOT RUN${RST}\n"
  printf "   This is NOT a release pass. Re-run without --static-only.\n\n"
  exit 2
fi

printf "\n${GRN}${BLD}ALL FINAL RELEASE VALIDATION PASSED${RST}\n\n"
