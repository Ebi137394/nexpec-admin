#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  apply-inbox-and-review-fixes.sh
#
#  Applies two migrations to Production:
#
#   20260801662000_inbox_and_group_leak_links
#     Re-points 5 live producers from '/inbox/<id>' to '/messages/<id>' and
#     repairs the 29 delivered rows. '/inbox/' resolves on NEITHER platform:
#     web had no such route, and the mobile allowlist
#     (app/notifications.tsx:229) silently DROPS the tap. '/messages/' is
#     already in that allowlist, so this reaches phones already in users'
#     hands without a new mobile build. Also fixes an expo-router route group
#     ('/(admin)/job-moderation') that leaked into 2 notification URLs.
#
#   20260801664000_reviews_allow_mutual
#     Drops the legacy UNIQUE(job_id) on public.reviews, which permitted only
#     ONE review per job and therefore made the two-sided review feature
#     impossible. The correct UNIQUE(job_id, reviewer_id) is untouched.
#
#  DESTRUCTIVE-OPS NOTE (docs/runbooks/PRODUCTION-DESTRUCTIVE-OPS.md):
#  The only DROP is a UNIQUE CONSTRAINT. Dropping a uniqueness rule can only
#  ever PERMIT rows — it deletes and rewrites nothing. public.reviews is
#  verified to hold ZERO rows before the drop, so no existing data depends on
#  it. The row count is captured and asserted BEFORE the drop runs, and an
#  append-only audit_events row is written afterwards recording the count, the
#  scope, what was preserved and the backup status.
#
#  USAGE
#    export SUPABASE_ACCESS_TOKEN=...      # or be logged in via `supabase login`
#    bash scripts/ops/apply-inbox-and-review-fixes.sh
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROD_REF="sxqpjxhslzzcdrdctatm"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS=(
  "20260801662000_inbox_and_group_leak_links"
  "20260801664000_reviews_allow_mutual"
)
# The owner/admin this change is attributed to in audit_events.
ACTOR="efa609bf-57c2-4b65-a284-62178599b305"

for m in "${MIGRATIONS[@]}"; do
  [ -f "$REPO_ROOT/supabase/migrations/$m.sql" ] || {
    echo "MISSING migration file: $m.sql" >&2; exit 1; }
done

# The web routes the new links depend on must exist first.
for r in "$REPO_ROOT/apps/web/src/app/messages/[id]/page.tsx" \
         "$REPO_ROOT/apps/web/src/app/messages/page.tsx"; do
  [ -f "$r" ] || { echo "MISSING web route: $r" >&2; exit 1; }
done

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$WORKDIR/supabase"
printf 'project_id = "nexpec-prod-apply"\n' > "$WORKDIR/supabase/config.toml"

echo "→ linking a scratch workdir to Production ($PROD_REF)"
( cd "$WORKDIR" && supabase link --project-ref "$PROD_REF" >/dev/null )
REF="$(cat "$WORKDIR/supabase/.temp/project-ref" 2>/dev/null || echo none)"
[ "$REF" = "$PROD_REF" ] || { echo "REFUSING: linked to '$REF', not Production." >&2; exit 1; }

run_sql() { ( cd "$WORKDIR" && supabase db query --linked ); }
fail() { echo "  ✗ $1 — ABORTING." >&2; exit 1; }

# ── Pre-state, and the safety precondition for the constraint drop ─────────
echo "→ pre-state"
PRE="$(run_sql <<'SQL'
SELECT
  (SELECT count(*) FROM public.notifications WHERE link_href LIKE '/inbox%')       AS inbox_rows,
  (SELECT count(*) FROM public.notifications WHERE link_href LIKE '/(admin)%')     AS group_leak_rows,
  (SELECT count(*) FROM public.reviews)                                           AS review_rows,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid='public.reviews'::regclass AND conname='reviews_job_reviewer_unique') AS correct_constraint;
SQL
)"
echo "$PRE" | tail -10

# reviews must be empty before we drop a uniqueness rule that has been
# enforcing it. If it is not, stop and re-plan rather than proceeding.
echo "$PRE" | grep -q '"review_rows": 0'        || fail "public.reviews is NOT empty; re-plan the constraint drop"
echo "$PRE" | grep -q '"correct_constraint": 1' || fail "reviews_job_reviewer_unique missing; refusing to drop the legacy rule"

for m in "${MIGRATIONS[@]}"; do
  echo "→ applying $m"
  run_sql < "$REPO_ROOT/supabase/migrations/$m.sql" | tail -3
done

# ── Verify BEFORE recording ────────────────────────────────────────────────
echo "→ verifying"
VERIFY="$(run_sql <<'SQL'
SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND p.prolang <> (SELECT oid FROM pg_language WHERE lanname='c')
      AND pg_get_functiondef(p.oid) LIKE '%''/inbox/%')                          AS producers_still_inbox,
  (SELECT count(*) FROM public.notifications WHERE link_href LIKE '/inbox%')     AS inbox_rows_left,
  (SELECT count(*) FROM public.notifications WHERE link_href LIKE '/(admin)%')   AS group_leak_left,
  (SELECT count(*) FROM public.notifications WHERE link_href LIKE '/messages/%') AS messages_rows,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid='public.reviews'::regclass AND conname='unique_review_per_job')       AS legacy_constraint,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid='public.reviews'::regclass AND conname='reviews_job_reviewer_unique') AS correct_constraint;
SQL
)"
echo "$VERIFY" | tail -12

echo "$VERIFY" | grep -q '"producers_still_inbox": 0' || fail "a producer still emits /inbox/"
echo "$VERIFY" | grep -q '"inbox_rows_left": 0'       || fail "stale /inbox rows remain"
echo "$VERIFY" | grep -q '"group_leak_left": 0'       || fail "route-group rows remain"
echo "$VERIFY" | grep -q '"legacy_constraint": 0'     || fail "unique_review_per_job was not dropped"
echo "$VERIFY" | grep -q '"correct_constraint": 1'    || fail "reviews_job_reviewer_unique disappeared"

echo "  ✓ links repaired and the review constraint corrected"

# ── Append-only audit record (destructive-ops runbook) ─────────────────────
echo "→ writing the audit_events record"
run_sql <<SQL | tail -3
-- audit_events requires event_type, subject_table, subject_id and summary.
INSERT INTO public.audit_events
  (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
VALUES (
  'schema.constraint_dropped', 'warning', '$ACTOR', '$ACTOR', 'reviews',
  'Dropped legacy UNIQUE(job_id) on public.reviews so both parties can review a job. Table verified empty (0 rows) first; UNIQUE(job_id, reviewer_id) preserved.',
  jsonb_build_object(
    'object',        'public.reviews',
    'constraint',    'unique_review_per_job',
    'definition',    'UNIQUE (job_id)',
    'scope',         'whole table',
    'rows_affected', 0,
    'rows_before',   0,
    'preserved',     'reviews_job_reviewer_unique UNIQUE (job_id, reviewer_id)',
    'backup',        'NOT captured - table verified empty (0 rows) before the drop; a DROP CONSTRAINT removes no rows',
    'reason',        'UNIQUE(job_id) allowed only one review per job, blocking the two-sided review feature',
    'rollback',      'supabase/rollback/20260801664000_reviews_allow_mutual.sql',
    'verified',      'legacy_constraint=0, correct_constraint=1'
  )
);
SQL

echo "→ recording the migrations in the ledger"
for m in "${MIGRATIONS[@]}"; do
  run_sql <<SQL | tail -1
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('${m%%_*}', '${m#*_}') ON CONFLICT (version) DO NOTHING;
SQL
done

echo
echo "✓ done."
