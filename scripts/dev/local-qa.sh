#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  scripts/dev/local-qa.sh  —  ONE command to run NEXPEC web against LOCAL Supabase
#
#  What it does (and does NOT do):
#    • Verifies local Supabase is up (starts it if needed).
#    • Reads the LOCAL API URL + anon key (+ service-role key) straight from
#      `supabase status` — no hand-typed env vars.
#    • Starts `next dev` with those values injected into THIS process only.
#      Next.js 15 gives real process.env precedence over .env files, so the LOCAL
#      values override whatever is in apps/web/.env.local — WITHOUT editing,
#      overwriting, or reading your remote .env.local.
#    • Prints the exact browser URL.
#    • Refuses to run against anything that is not localhost (protects Dev/Prod).
#    • Fails with a clear message if the CLI/values are missing.
#
#  Usage:
#    npm run qa:local              # http://localhost:3000
#    QA_PORT=3001 npm run qa:local # if 3000 is busy
#
#  It never touches remote Supabase, Development, or Production.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

die() { printf '\n\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }

command -v supabase >/dev/null 2>&1 \
  || die "Supabase CLI not found. Install it (https://supabase.com/docs/guides/cli) and retry."

# ── 1. Ensure local Supabase is running (start it if not) ────────────────────
if ! supabase status >/dev/null 2>&1; then
  info "Local Supabase is not running — starting it (supabase start). This needs Docker."
  supabase start || die "Could not start local Supabase. Is Docker running?"
fi

# ── 2. Read local URL + keys from the CLI (machine-local, authoritative) ─────
ENVOUT="$(supabase status -o env 2>/dev/null)" \
  || die "Could not read 'supabase status -o env'. Is local Supabase running?"
get() { printf '%s\n' "$ENVOUT" | sed -n "s/^$1=//p" | tr -d '"' | head -1; }
LOCAL_URL="$(get API_URL)"
LOCAL_ANON="$(get ANON_KEY)"
LOCAL_SRK="$(get SERVICE_ROLE_KEY)"

# ── 6. Fail clearly if required values are missing ───────────────────────────
[ -n "$LOCAL_URL" ]  || die "API_URL not found in 'supabase status' — cannot determine the local Supabase URL."
[ -n "$LOCAL_ANON" ] || die "ANON_KEY not found in 'supabase status' — cannot determine the local anon key."

# ── 7. SAFETY: refuse any non-local URL (protects Development / Production) ───
case "$LOCAL_URL" in
  http://127.0.0.1:*|http://localhost:*|http://0.0.0.0:*) : ;;
  *) die "Resolved Supabase URL is NOT local: '$LOCAL_URL'. Refusing to start (this guard protects Development/Production)." ;;
esac

# ── Deterministic port (override with QA_PORT=) ──────────────────────────────
PORT="${QA_PORT:-3000}"
node -e "require('net').createServer().listen(${PORT},'127.0.0.1',function(){this.close(()=>process.exit(0))}).on('error',()=>process.exit(1))" \
  || die "Port ${PORT} is already in use (often a stale 'next dev'). Stop that process, or run:  QA_PORT=3001 npm run qa:local"

printf '\n\033[1;32m────────────────────────────────────────────────────────\033[0m\n'
printf '  LOCAL QA  ·  Supabase API : %s\n' "$LOCAL_URL"
printf '  \033[1mOpen the app here      : http://localhost:%s\033[0m\n' "$PORT"
printf '  apps/web/.env.local is NOT modified — local values are\n'
printf '  passed to THIS process only; every other var still\n'
printf '  comes from your .env.local.\n'
printf '\033[1;32m────────────────────────────────────────────────────────\033[0m\n\n'

# ── 3. Start the web app with LOCAL values injected (no files written) ───────
cd apps/web
export NEXT_PUBLIC_SUPABASE_URL="$LOCAL_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$LOCAL_ANON"
[ -n "$LOCAL_SRK" ] && export SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SRK"
exec npm run dev -- -p "$PORT"
