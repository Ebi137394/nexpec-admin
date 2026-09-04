#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  telegram-setup.sh — the ONLY owner step for the Admin Control Center
#
#  Run it, paste the BotFather token at the hidden prompt, tap the link it
#  prints. Nothing else is required.
#
#  The token is read with `read -s`: never echoed, never written to a tracked
#  file, never added to shell history. It goes straight to Supabase secrets and
#  is unset immediately afterwards. Nothing here is ever committed.
#
#  The webhook secret is GENERATED HERE and registered with Telegram in the
#  same run, so the stored value and the value Telegram sends always match.
#
#  WHY THIS SCRIPT LOOKS THE WAY IT DOES. An earlier version minted the pairing
#  token by piping raw SQL through `supabase db query` inside a throwaway
#  workdir it first had to `init` and `link`. Both of those commands prompt,
#  and it ran them with stdout AND stderr on /dev/null while stdin was still
#  the terminal — so the prompts were invisible and their answers were whatever
#  the terminal happened to supply. The INSERT actually succeeded every time;
#  only the read-back that confirmed it came back empty, so the script threw
#  away good tokens and reported a generic failure. Every CLI call below
#  therefore runs with stdin closed, keeps its stderr, and is checked by exit
#  code AND by the API's own {"_tag":"Error"} envelope. Nothing is inferred
#  from whether a grep happened to match.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT_REF="sxqpjxhslzzcdrdctatm"     # NEXPEC Production
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

TMPDIR_RUN="$(mktemp -d)"
BOT_TOKEN=""; HOOK_SECRET=""
wipe() {
  [ -n "${TMPDIR_RUN:-}" ] && [ -d "$TMPDIR_RUN" ] && {
    find "$TMPDIR_RUN" -type f -exec shred -u {} \; 2>/dev/null || true
    rm -rf "$TMPDIR_RUN"
  }
}
trap wipe EXIT

# Never let a secret reach the screen, even inside an error message.
redact() {
  local s="$1"
  [ -n "$BOT_TOKEN" ]   && s="${s//$BOT_TOKEN/<bot-token>}"
  [ -n "$HOOK_SECRET" ] && s="${s//$HOOK_SECRET/<webhook-secret>}"
  printf '%s' "$s" | sed -E 's/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/<bot-token>/g'
}

die() {                       # die <step> <human message> [detail]
  printf '\n  ✗ FAILED at %s\n\n    %s\n' "$1" "$2" >&2
  [ -n "${3:-}" ] && printf '\n    Reported by the tool:\n    %s\n' "$(redact "$3")" >&2
  printf '\n    Nothing was left half-configured: pairing is the last step, so\n'  >&2
  printf '    the bot cannot be used by anyone until it succeeds.\n\n' >&2
  exit 1
}

# Run a supabase CLI command with stdin CLOSED so it can never block on or
# silently consume a prompt. Captures stdout and stderr separately and treats
# both a non-zero exit and an {"_tag":"Error"} envelope as failure.
sb() {
  local out rc
  set +e
  out="$("$@" < /dev/null 2>"$TMPDIR_RUN/err")"; rc=$?
  set -e
  if [ $rc -ne 0 ] || printf '%s' "$out" | grep -q '"_tag":"Error"'; then
    SB_ERR="$(printf '%s\n%s' "$out" "$(cat "$TMPDIR_RUN/err" 2>/dev/null)" | head -c 700)"
    return 1
  fi
  SB_OUT="$out"
  return 0
}

printf '\n  NEXPEC Telegram Admin Control Center — setup\n\n'
printf '  Paste the BotFather token (input hidden), then press Enter:\n  > '
read -rs BOT_TOKEN
printf '\n\n'
[ -n "$BOT_TOKEN" ] || die "the prompt" "No token was entered."

# ── 1. Verify the token really belongs to a bot ───────────────────────────
BOT_JSON="$(curl -s --max-time 30 "https://api.telegram.org/bot${BOT_TOKEN}/getMe" || true)"
printf '%s' "$BOT_JSON" | grep -q '"ok":true' \
  || die "step 1 (token check)" "Telegram rejected that token. Nothing was saved." "$BOT_JSON"
BOT_USER="$(printf '%s' "$BOT_JSON" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
[ -n "$BOT_USER" ] || die "step 1 (token check)" "Telegram accepted the token but returned no bot username." "$BOT_JSON"
printf '  1/6  token valid — bot is @%s\n' "$BOT_USER"

# ── 2. Generate the webhook secret ────────────────────────────────────────
HOOK_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  || die "step 2 (secret generation)" "Could not generate a webhook secret (is python3 available?)."
printf '  2/6  webhook secret generated (not shown)\n'

# ── 3. Store both secrets ─────────────────────────────────────────────────
ENVFILE="$TMPDIR_RUN/env"; umask 077; : > "$ENVFILE"
printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_WEBHOOK_SECRET=%s\n' "$BOT_TOKEN" "$HOOK_SECRET" > "$ENVFILE"
sb npx supabase secrets set --project-ref "$PROJECT_REF" --env-file "$ENVFILE" \
  || die "step 3 (storing secrets)" "Supabase would not store the secrets." "${SB_ERR:-}"
shred -u "$ENVFILE" 2>/dev/null || rm -f "$ENVFILE"
printf '  3/6  secrets stored in Supabase\n'

# ── 4. Register the webhook, with the secret-token header ─────────────────
HOOK_URL="https://${PROJECT_REF}.supabase.co/functions/v1/telegram-webhook"
SET_JSON="$(curl -s --max-time 30 -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"${HOOK_URL}\",\"secret_token\":\"${HOOK_SECRET}\",\"allowed_updates\":[\"message\",\"callback_query\"],\"drop_pending_updates\":true}" || true)"
printf '%s' "$SET_JSON" | grep -q '"ok":true' \
  || die "step 4 (webhook registration)" "Telegram refused to register the webhook." "$SET_JSON"
printf '  4/6  webhook registered\n'

# ── 5. Confirm Telegram accepted it ───────────────────────────────────────
INFO="$(curl -s --max-time 30 "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" || true)"
printf '%s' "$INFO" | grep -q "$HOOK_URL" \
  || die "step 5 (webhook confirmation)" "Telegram did not report our endpoint as the active webhook." "$INFO"
printf '  5/6  Telegram confirmed the endpoint\n'
BOT_TOKEN=""; HOOK_SECRET=""      # no longer needed in this process

# ── 6. Mint the one-tap pairing link ──────────────────────────────────────
#  One atomic RPC. It generates the token server-side, binds it to the owner
#  account, clamps its lifetime, and retires any older unconsumed token — so
#  this step either yields a usable link or fails loudly.
#
#  NOTE: this repo's own supabase link points at STAGING, so --project-ref is
#  passed explicitly on every call. --linked --project-ref needs no `init` and
#  no `link`, which is what removes the prompting path entirely.
echo 'SELECT token, expires_at FROM public.tg_mint_bootstrap(60);' > "$TMPDIR_RUN/mint.sql"
sb npx supabase db query --linked --project-ref "$PROJECT_REF" --file "$TMPDIR_RUN/mint.sql" \
  || die "step 6 (pairing token)" \
         "Could not mint the pairing token on Production ($PROJECT_REF).
    The bot token and webhook ARE stored and registered — only pairing is left.
    Re-running this script is safe and will retry just this step." "${SB_ERR:-}"

PAIR_TOKEN="$(printf '%s' "$SB_OUT" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    rows = d.get("rows") or []
    print(rows[0].get("token","") if rows else "")
except Exception:
    print("")
')"
[ -n "$PAIR_TOKEN" ] \
  || die "step 6 (pairing token)" \
         "The mint call returned no token row. Nothing is paired; re-run to retry." "$SB_OUT"
printf '  6/6  pairing link minted (single use, expires in 60 minutes)\n\n'

printf '  ▶ Final step — open this link and press START:\n\n'
printf '      https://t.me/%s?start=%s\n\n' "$BOT_USER" "$PAIR_TOKEN"
printf '  The link carries a single-use token bound to your owner account.\n'
printf '  Anyone else messaging the bot — including a bare /start — gets nothing.\n\n'
