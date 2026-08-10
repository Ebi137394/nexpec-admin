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
  supabase/migrations/20260801318000_jobs_payout_column_privilege_symmetry.sql \
  supabase/migrations/20260801320000_discover_jobs_read_via_seller_view.sql \
  supabase/migrations/20260801322000_job_scoped_applicant_identity_and_audit_actor.sql \
  supabase/migrations/20260801324000_profiles_identity_mode_lockdown.sql \
  supabase/migrations/20260801326000_resume_disclosure_doc_access.sql \
  supabase/migrations/20260801328000_live_identity_authority_and_lifecycle_gate.sql \
  supabase/migrations/20260801330000_countersign_stops_at_assigned.sql \
  supabase/migrations/20260801332000_direct_chat_enum_value.sql \
  supabase/migrations/20260801334000_full_mode_direct_chat.sql \
  supabase/migrations/20260801336000_direct_chat_role_parity.sql \
  supabase/migrations/20260801338000_operational_chat_enum_values.sql \
  supabase/migrations/20260801340000_supplier_operational_chat.sql \
  supabase/migrations/20260801342000_chat_counterpart_resolvers.sql \
  supabase/migrations/20260801344000_conversations_kind_shape_all_channels.sql \
  supabase/migrations/20260801346000_conversations_uniqueness_multichannel.sql \
  supabase/migrations/20260801348000_two_party_media_live_gate.sql \
  supabase/migrations/20260801350000_current_job_inspector_engagement_aware.sql \
  supabase/migrations/20260801352000_brokered_engagement_no_silent_reassign.sql \
  supabase/migrations/20260801354000_resolvers_engagement_model_aware.sql \
  supabase/migrations/20260801356000_mark_job_completed_operational_terminal.sql \
  supabase/migrations/20260801358000_inspector_job_matching_engine.sql \
  supabase/tests/admin_direct_assignment_test.sql \
  supabase/tests/identity_disclosure_test.sql \
  supabase/tests/resume_disclosure_access_test.sql \
  supabase/tests/identity_lifecycle_test.sql \
  supabase/tests/countersign_lifecycle_test.sql \
  supabase/tests/direct_chat_access_test.sql \
  supabase/tests/direct_chat_role_parity_test.sql \
  supabase/tests/supplier_chat_access_test.sql \
  supabase/tests/inspector_price_blindness_test.sql \
  supabase/tests/rls_jobs_price_blindness_test.sql \
  supabase/tests/rpc_authorization_test.sql \
  supabase/tests/job_lifecycle_completion_test.sql \
  supabase/tests/inspector_matching_test.sql \
  supabase/rollback/20260801304000_to_316000_rollback.sql \
  supabase/rollback/20260801318000_rollback.sql \
  supabase/rollback/20260801322000_rollback.sql \
  supabase/rollback/20260801324000_rollback.sql \
  supabase/rollback/20260801326000_rollback.sql \
  supabase/rollback/20260801328000_rollback.sql \
  supabase/rollback/20260801330000_rollback.sql \
  supabase/rollback/20260801334000_rollback.sql \
  supabase/rollback/20260801336000_rollback.sql \
  supabase/rollback/20260801340000_rollback.sql \
  supabase/rollback/20260801342000_rollback.sql \
  supabase/rollback/20260801344000_rollback.sql \
  supabase/rollback/20260801346000_rollback.sql \
  supabase/rollback/20260801348000_rollback.sql \
  supabase/rollback/20260801350000_rollback.sql \
  supabase/rollback/20260801352000_rollback.sql \
  supabase/rollback/20260801354000_rollback.sql \
  supabase/rollback/20260801356000_rollback.sql \
  supabase/rollback/20260801358000_rollback.sql ; do
  [[ -f "$f" ]] || die "missing required file: $f"
done
ok "28 migrations, 13 test suites and 19 rollback scripts are present"

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
  ok "304000 → 306000 → 308000 → 310000 → 312000 → 314000 → 316000 → 318000 applied"
  ok "every migration self-test passed"

  # ── 3b. EXPLICITLY verify 318000 landed ──────────────────────────────────
  #  `db reset` applying without error is necessary but not sufficient: assert
  #  the objects 318000 introduces actually exist, so a silently-skipped or
  #  reordered migration cannot pass the gate.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "migration 20260801318000 did NOT apply"
DO $v318$
BEGIN
  IF to_regprocedure('public.nx_jobs_seller_only_columns()') IS NULL
     OR to_regprocedure('public.nx_jobs_margin_columns()')   IS NULL
     OR to_regprocedure('public.nx_is_inspector()')          IS NULL THEN
    RAISE EXCEPTION '318000 NOT APPLIED: helper function(s) missing';
  END IF;
  IF to_regclass('public.jobs_inspector_secure_view') IS NULL THEN
    RAISE EXCEPTION '318000 NOT APPLIED: jobs_inspector_secure_view missing';
  END IF;
  IF position('nx_is_admin' in pg_get_viewdef('public.jobs_secure_view'::regclass, true)) = 0 THEN
    RAISE EXCEPTION '318000 NOT APPLIED: jobs_secure_view still exposes margin columns unmasked';
  END IF;
  RAISE NOTICE '318000 verified: seller view + margin masking present';
END
$v318$;
SQL
  ok "migration 318000 verified (seller view, helpers, margin masking)"

  # ── 3c. EXPLICITLY verify 322000 landed ──────────────────────────────────
  #  Same reasoning as 3b: assert the OBJECTS exist and behave, not that a
  #  filename appears in a migration list. A missing identity resolver here is
  #  the difference between Professional disclosure working and the buyer
  #  silently seeing a pseudonym — which is exactly how this shipped broken.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "migration 20260801322000 did NOT apply"
DO $v322$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.nx_job_effective_identity_mode(uuid)') IS NULL THEN
    RAISE EXCEPTION '322000 NOT APPLIED: identity resolver missing';
  END IF;
  IF to_regclass('public.job_applicant_identity_view') IS NULL THEN
    RAISE EXCEPTION '322000 NOT APPLIED: job_applicant_identity_view missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid='public.audit_events'::regclass
                    AND tgname='trg_audit_events_fill_actor' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '322000 NOT APPLIED: audit actor back-fill trigger missing';
  END IF;
  -- behavioural: contact must be Full-mode only, counter bump relabelled
  SELECT pg_get_viewdef('public.job_applicant_identity_view'::regclass, true) INTO v;
  IF v !~* 'eff_mode\s*=\s*''full''::text\s+THEN\s+p\.email' THEN
    RAISE EXCEPTION '322000 REGRESSION: Professional mode would disclose private contact';
  END IF;
  IF public.audit_public_summary('Job fields updated: applications_count', false)
       <> 'Application received'
     OR public.audit_public_summary('Job fields updated: description', false)
       <> 'Job details updated' THEN
    RAISE EXCEPTION '322000 REGRESSION: audit summary relabelling is wrong';
  END IF;
  RAISE NOTICE '322000 verified: job-scoped identity resolver + audit actor fix';
END
$v322$;
SQL
  ok "migration 322000 verified (identity resolver, disclosure view, audit actor)"

  # ── 3d. IDENTITY-MODE IS ENFORCED BY THE DATABASE, NOT THE UI ────────────
  #  This probe exists because the hole it guards shipped once already:
  #  Protected was enforced only by which columns React chose to SELECT, while
  #  profiles RLS handed a buyer the applicant's whole row the moment an
  #  application existed. It builds a real Protected job + application and
  #  asserts, as the BUYER, that a direct profiles read returns NOTHING.
  #  Wrapped in BEGIN/ROLLBACK so it leaves no residue.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "PROFILE PRIVACY REGRESSION: a Protected buyer can read applicant PII"
BEGIN;
DO $gate$
DECLARE
  v_cl  uuid := '0f000000-0000-4000-8000-0000000000c1';
  v_in  uuid := '0f000000-0000-4000-8000-0000000000a1';
  v_job uuid := '0f000000-0000-4000-8000-0000000000b1';
  v_n   int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_cl,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','gate.cl@nx.test',now(),now()),
    (v_in,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','gate.in@nx.test',now(),now());
  INSERT INTO public.profiles (id,email,role,full_name,phone,specialty_slugs) VALUES
    (v_cl,'gate.cl@nx.test','client','Gate Buyer',NULL,'{}'::text[]),
    (v_in,'gate.in@nx.test','inspector','Gate Inspector Realname','+1-555-9999','{}'::text[]);
  INSERT INTO public.jobs (id,title,client_id,status,moderation_status,identity_mode)
    VALUES (v_job,'gate privacy probe',v_cl,'open','approved','protected');
  INSERT INTO public.applications (job_id,applicant_id,status) VALUES (v_job,v_in,'pending');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',v_cl::text,'role','authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_in;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'GATE FAILED: a Protected buyer reached the applicant profile row (% row(s)) — identity_mode is UI-only again', v_n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'gate: Protected buyer cannot read applicant PII directly.';
END
$gate$;
ROLLBACK;
SQL
  ok "identity_mode enforced at the DB boundary (Protected buyer cannot read applicant PII)"

  # ── 3e. RESUME DISCLOSURE IS JOB-SCOPED AND FORWARD-GATED ────────────────
  #  Professional is DEFINED to release the applicant resume. Before 326000
  #  nx_can_access_doc had no branch for it at all, so the feature silently
  #  did nothing while the UI promised it. Assert BOTH directions: a dead
  #  feature and an over-permissive one must each fail the gate.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || die "RESUME DISCLOSURE REGRESSION detected"
BEGIN;
DO $gate$
DECLARE
  v_b uuid := '0e000000-0000-4000-8000-0000000000b1';
  v_i uuid := '0e000000-0000-4000-8000-0000000000a1';
  v_j uuid := '0e000000-0000-4000-8000-0000000000c1';
  v_p text := '0e000000-0000-4000-8000-0000000000a1/resume-gate.pdf';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','g.res.b@nx.test',now(),now()),
    (v_i,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','g.res.i@nx.test',now(),now());
  INSERT INTO public.profiles (id,email,role,full_name,resume_url,specialty_slugs) VALUES
    (v_b,'g.res.b@nx.test','client','Gate Buyer',NULL,'{}'::text[]),
    (v_i,'g.res.i@nx.test','inspector','Gate Inspector',
       'https://x/storage/v1/object/sign/resumes/'||v_p,'{}'::text[]);
  INSERT INTO public.jobs (id,title,client_id,status,moderation_status,identity_mode)
    VALUES (v_j,'gate resume probe',v_b,'open','approved','protected');
  INSERT INTO public.applications (job_id,applicant_id,status,forwarded_to_client_at)
    VALUES (v_j,v_i,'pending',now());

  IF public.nx_can_access_doc(v_b,'resumes',v_p) THEN
    RAISE EXCEPTION 'GATE FAILED: a PROTECTED buyer can mint the applicant resume';
  END IF;

  UPDATE public.jobs SET identity_mode='professional' WHERE id=v_j;
  IF NOT public.nx_can_access_doc(v_b,'resumes',v_p) THEN
    RAISE EXCEPTION 'GATE FAILED: a PROFESSIONAL buyer CANNOT mint the applicant resume (feature is dead)';
  END IF;

  UPDATE public.applications SET forwarded_to_client_at=NULL WHERE job_id=v_j;
  IF public.nx_can_access_doc(v_b,'resumes',v_p) THEN
    RAISE EXCEPTION 'GATE FAILED: an UNFORWARDED application grants resume access';
  END IF;

  RAISE NOTICE 'gate: resume disclosure is job-scoped, forward-gated and mode-gated.';
END
$gate$;
ROLLBACK;
SQL
  ok "resume disclosure verified (protected denies, professional allows, unforwarded denies)"

  # ── run_suite: psql alone is NOT sufficient for pgTAP ────────────────────
  #  A DO-block suite RAISEs, so ON_ERROR_STOP fails the run. A pgTAP suite
  #  (plan()/finish()) prints "not ok 3 - …" for a FAILED assertion and still
  #  exits 0 — so every pgTAP file was previously non-gating here. Detect the
  #  style and, for pgTAP, fail on "not ok" / a missing plan.
  run_suite() {
    local t="$1" out rc plan_n ok_n notok_n
    if grep -qE '(^|[^a-z_])plan\(' "$t"; then
      printf "   running %s (pgTAP)\n" "$t"
      # ── psql OUTPUT FORMAT is load-bearing here ──────────────────────────
      #  pgTAP emits its TAP stream as ordinary SELECT result rows. Under
      #  psql's DEFAULT (aligned) format each line arrives padded inside a
      #  table — a column header, a leading space, and a "(1 row)" footer:
      #
      #        ok
      #      ------------------------------
      #       ok 1 - BUYER cannot read payout
      #      (1 row)
      #
      #  so anchored greps (^ok / ^not ok) match NOTHING. That produced two
      #  bugs at once: a PASSING suite was reported as "no pgTAP output", and
      #  — far worse — a suite with real "not ok" lines would have been
      #  reported as PASSING, because the failure grep could never fire.
      #
      #  -A (unaligned) -t (tuples only) -X (ignore ~/.psqlrc, which could
      #  re-enable formatting) give the bare TAP stream, so the checks below
      #  are meaningful. We assert TAP semantics explicitly rather than
      #  trusting psql's exit code, which is 0 for a failed assertion.
      out="$(psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -f "$t" 2>&1)"; rc=$?
      if [[ $rc -ne 0 ]]; then
        printf '%s\n' "$out"
        die "$(basename "$t") FAILED (psql exit $rc)"
      fi
      plan_n="$(printf '%s\n' "$out" | sed -n 's/^1\.\.\([0-9][0-9]*\).*/\1/p' | head -1)"
      notok_n="$(printf '%s\n' "$out" | grep -cE '^not ok' || true)"
      ok_n="$(printf '%s\n' "$out" | grep -cE '^ok [0-9]+' || true)"

      if [[ -z "$plan_n" ]]; then
        printf '%s\n' "$out"
        die "$(basename "$t") emitted no TAP plan (1..N) — the suite did not run"
      fi
      if [[ "$notok_n" -gt 0 ]]; then
        printf '%s\n' "$out" | grep -E '^not ok' || true
        die "$(basename "$t") FAILED — $notok_n pgTAP assertion(s) not ok"
      fi
      if [[ "$ok_n" -ne "$plan_n" ]]; then
        printf '%s\n' "$out"
        die "$(basename "$t") ran $ok_n of $plan_n planned assertion(s) — incomplete run"
      fi
      ok "$(basename "$t") — $ok_n/$plan_n pgTAP assertions"
      return 0
    fi
    printf "   running %s\n" "$t"
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 -q -f "$t" || die "$(basename "$t") FAILED"
    ok "$(basename "$t")"
  }

  step "4/5. Database test suites"
  for t in \
    supabase/tests/inspector_price_blindness_test.sql \
    supabase/tests/rls_jobs_price_blindness_test.sql \
    supabase/tests/identity_disclosure_test.sql \
    supabase/tests/resume_disclosure_access_test.sql \
    supabase/tests/identity_lifecycle_test.sql \
    supabase/tests/countersign_lifecycle_test.sql \
    supabase/tests/direct_chat_access_test.sql \
    supabase/tests/direct_chat_role_parity_test.sql \
    supabase/tests/supplier_chat_access_test.sql \
    supabase/tests/rpc_authorization_test.sql \
    supabase/tests/admin_direct_assignment_test.sql ; do
    run_suite "$t"
  done

  shopt -s nullglob
  for t in supabase/tests/*.sql; do
    case "$(basename "$t")" in
      inspector_price_blindness_test.sql|rls_jobs_price_blindness_test.sql|rpc_authorization_test.sql|admin_direct_assignment_test.sql|identity_disclosure_test.sql|resume_disclosure_access_test.sql|identity_lifecycle_test.sql|countersign_lifecycle_test.sql|direct_chat_access_test.sql|direct_chat_role_parity_test.sql|supplier_chat_access_test.sql) continue ;;
    esac
    printf "   (pre-existing) "
    run_suite "$t"
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
  -- ★ 20260801318000 — INVERTED. This probe used to require that payout stay
  --   readable on the base table; that was the pre-318000 boundary and was the
  --   margin leak itself (`authenticated` covers buyers too). Payout must now
  --   be revoked on the table and reachable ONLY through the seller view.
  IF has_column_privilege('authenticated','public.jobs','inspector_payout_cents','SELECT')
     OR has_column_privilege('authenticated','public.jobs','payout_amount_cents','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: payout is still readable on public.jobs — buyers can derive the margin';
  END IF;
  IF NOT has_table_privilege('authenticated','public.jobs_inspector_secure_view','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: jobs_inspector_secure_view unreachable — the inspector could not read any payout';
  END IF;
  IF has_table_privilege('anon','public.jobs_inspector_secure_view','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: anon can read the seller view';
  END IF;
  IF NOT has_table_privilege('authenticated','public.jobs_secure_view','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: jobs_secure_view is unreadable (client/admin pricing would break)';
  END IF;
  IF NOT has_column_privilege('service_role','public.jobs','inspector_payout_cents','SELECT') THEN
    RAISE EXCEPTION 'PROBE FAILED: service_role lost payout access (payout Edge Functions would break)';
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
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -q <<'SQL' || die "smoke probes FAILED"
-- One transaction, discarded at the end: probe (5) seeds a job + three users to
-- exercise the boundary as real callers, and must leave the database untouched.
BEGIN;
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
  --  jobs_secure_view must expose the SAME COLUMN SET as public.jobs. It was
  --  literally `SELECT j.*` until 20260801318000; it is now an explicit column
  --  list in ordinal order where the margin columns are wrapped in
  --  `CASE WHEN nx_is_admin() THEN … END` — the VALUES are masked for
  --  non-admins, the column set is deliberately unchanged. Asserting the set is
  --  strictly stronger than any hand-maintained list: it catches the view being
  --  narrowed, and it automatically covers every column a future caller might
  --  request. (Masking is asserted separately: structurally in step 3b, and
  --  behaviourally in probe (5) below.)
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

  -- ── (3) BOTH money sides must be unreachable on the base table ──────────
  --  ★ 20260801318000 — widened from nx_jobs_buyer_only_columns() to include
  --  the seller/margin set. Before 318000 only the buyer half was revoked, so
  --  a CLIENT could read inspector_payout_cents off public.jobs and derive the
  --  platform margin. Both directions are now asserted here.
  FOREACH v_col IN ARRAY (public.nx_jobs_buyer_only_columns() || public.nx_jobs_margin_columns()) LOOP
    IF has_column_privilege('authenticated','public.jobs',v_col,'SELECT') THEN
      RAISE EXCEPTION 'SMOKE FAILED: authenticated regained jobs.%', v_col;
    END IF;
  END LOOP;

  -- ── (4) Operational columns still resolve on the base table ─────────────
  --  ★ 20260801318000 — REWRITTEN. This list used to include
  --  inspector_payout_cents / payout_amount_cents and demanded they stay
  --  readable on public.jobs. That was the pre-318000 boundary and was itself
  --  the leak (`authenticated` covers buyers too). Payout is NOT an
  --  operational column any more — it moved to jobs_inspector_secure_view and
  --  is proven behaviourally in (5). Only the genuinely non-money operational
  --  columns are asserted here.
  FOREACH v_col IN ARRAY ARRAY['id','title','status','scheduled_date','contractor_id','hired_inspector_id'] LOOP
    IF NOT has_column_privilege('authenticated','public.jobs',v_col,'SELECT') THEN
      RAISE EXCEPTION 'SMOKE FAILED: operational column jobs.% is unreadable', v_col;
    END IF;
  END LOOP;

  -- ── (4b) The seller view is the ONLY payout route, and it is locked down ─
  IF to_regclass('public.jobs_inspector_secure_view') IS NULL THEN
    RAISE EXCEPTION 'SMOKE FAILED: jobs_inspector_secure_view does not exist — no route to payout at all';
  END IF;
  IF NOT has_table_privilege('authenticated','public.jobs_inspector_secure_view','SELECT') THEN
    RAISE EXCEPTION 'SMOKE FAILED: authenticated cannot read jobs_inspector_secure_view';
  END IF;
  IF has_table_privilege('anon','public.jobs_inspector_secure_view','SELECT') THEN
    RAISE EXCEPTION 'SMOKE FAILED: anon can read jobs_inspector_secure_view';
  END IF;
  FOREACH v_col IN ARRAY ARRAY['inspector_payout_cents','payout_amount_cents'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='jobs_inspector_secure_view'
                      AND column_name=v_col) THEN
      RAISE EXCEPTION 'SMOKE FAILED: jobs_inspector_secure_view lacks %', v_col;
    END IF;
  END LOOP;

  RAISE NOTICE 'smoke probes (structural) passed';
END
$smoke$;

-- ── (5) BEHAVIOURAL boundary probe ────────────────────────────────────────
--  Catalog privileges alone cannot prove the boundary: the views are owned by
--  postgres and bypass column privileges, so masking and row filters must be
--  exercised as a REAL caller. Seeds one job and reads it as each role through
--  request.jwt.claims + SET LOCAL ROLE (what PostgREST does per request).
--  Everything is inside the transaction the surrounding ROLLBACK discards.
DO $behav$
DECLARE
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_job    uuid;
  v_n      bigint;
  v_ok     boolean;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sm.client@test.nx',now(),now()),
    (v_insp,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sm.insp@test.nx',  now(),now()),
    (v_admin, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sm.admin@test.nx', now(),now());
  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','Smoke Client','sm.client@test.nx',true),
    (v_insp,  'inspector','Smoke Inspector','sm.insp@test.nx',true),
    (v_admin, 'admin','Smoke Admin','sm.admin@test.nx',true);
  INSERT INTO public.jobs (id, client_id, contractor_id, title, description, status,
                           moderation_status, client_price_cents, inspector_payout_cents, payout_amount_cents)
  VALUES (gen_random_uuid(), v_client, v_insp, 'SMOKE BOUNDARY', 'smoke', 'assigned', 'approved',
          250000, 155500, 155500)
  RETURNING id INTO v_job;

  -- ── INSPECTOR ───────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_ok := false;
  BEGIN
    EXECUTE format('SELECT inspector_payout_cents FROM public.jobs WHERE id = %L', v_job) INTO v_n;
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF v_ok THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: the inspector read payout DIRECTLY from public.jobs';
  END IF;

  EXECUTE format('SELECT inspector_payout_cents FROM public.jobs_inspector_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS DISTINCT FROM 155500 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: inspector payout via the seller view reads % (expected 155500)', v_n;
  END IF;

  EXECUTE format('SELECT client_price_cents FROM public.jobs_inspector_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS NOT NULL THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: the seller view leaked client_price_cents (%) to an inspector', v_n;
  END IF;
  EXECUTE 'RESET ROLE';

  -- ── CLIENT / AGENCY ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  EXECUTE format('SELECT inspector_payout_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS NOT NULL THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: the buyer read inspector_payout_cents (%) via jobs_secure_view', v_n;
  END IF;
  EXECUTE format('SELECT platform_spread_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS NOT NULL THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: the buyer read platform_spread_cents (%) — the margin itself', v_n;
  END IF;
  EXECUTE format('SELECT client_price_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS DISTINCT FROM 250000 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: the buyer lost their own client_price_cents (got %)', v_n;
  END IF;
  EXECUTE 'SELECT count(*) FROM public.jobs_inspector_secure_view' INTO v_n;
  IF v_n <> 0 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: the seller view returned % row(s) to a buyer', v_n;
  END IF;
  EXECUTE 'RESET ROLE';

  -- ── ADMIN — must still see BOTH sides ───────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT inspector_payout_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS DISTINCT FROM 155500 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: the admin lost the inspector payout (got %)', v_n;
  END IF;
  EXECUTE format('SELECT client_price_cents FROM public.jobs_secure_view WHERE id = %L', v_job) INTO v_n;
  IF v_n IS DISTINCT FROM 250000 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SMOKE FAILED: the admin lost the client price (got %)', v_n;
  END IF;
  EXECUTE 'RESET ROLE';

  RAISE NOTICE 'smoke probes (behavioural) passed';
END
$behav$;
ROLLBACK;
SQL
  ok "jobs_secure_view column set is identical to public.jobs (no drift)"
  ok "every caller column resolves on the view"
  ok "both money sides denied on the base table (buyer AND seller)"
  ok "operational columns still resolve on public.jobs"
  ok "behavioural: inspector denied direct payout, reads it via the seller view"
  ok "behavioural: buyer gets NULL payout/margin and zero seller-view rows"
  ok "behavioural: admin still reads both sides"
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
