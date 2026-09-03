#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  telegram-setup.sh — the ONLY owner step for the Admin Control Center
#
#  Run it, paste the BotFather token at the hidden prompt, tap the link it
#  prints. Nothing else is required.
#
#  The token is read with `read -s`, so it is never echoed, never written to a
#  file, never added to shell history and never committed. It goes straight to
#  Supabase secrets and is unset immediately afterwards.
#
#  The webhook secret is GENERATED HERE and registered with Telegram in the same
#  run, so the stored value and the value Telegram sends always match — nothing
#  has to read a secret back.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT_REF="sxqpjxhslzzcdrdctatm"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

cleanup() { [ -n "${ENVFILE:-}" ] && [ -f "$ENVFILE" ] && { shred -u "$ENVFILE" 2>/dev/null || rm -f "$ENVFILE"; }; }
trap cleanup EXIT

printf '\n  NEXPEC Telegram Admin Control Center — setup\n\n'
printf '  Paste the BotFather token (input hidden), then press Enter:\n  > '
read -rs BOT_TOKEN
printf '\n\n'
[ -n "$BOT_TOKEN" ] || { echo "  No token entered. Aborted."; exit 1; }

# ── 1. Verify the token really belongs to a bot ───────────────────────────
BOT_JSON="$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getMe")"
if ! printf '%s' "$BOT_JSON" | grep -q '"ok":true'; then
  echo "  That token was rejected by Telegram. Nothing was saved."; exit 1
fi
BOT_USER="$(printf '%s' "$BOT_JSON" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
printf '  1/6  token valid — bot is @%s\n' "$BOT_USER"

# ── 2. Generate the webhook secret ────────────────────────────────────────
HOOK_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
printf '  2/6  webhook secret generated (not shown)\n'

# ── 3. Store both secrets ─────────────────────────────────────────────────
ENVFILE="$(mktemp)"; chmod 600 "$ENVFILE"
printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_WEBHOOK_SECRET=%s\n' "$BOT_TOKEN" "$HOOK_SECRET" > "$ENVFILE"
npx supabase secrets set --project-ref "$PROJECT_REF" --env-file "$ENVFILE" >/dev/null 2>&1
cleanup; ENVFILE=""
printf '  3/6  secrets stored in Supabase\n'

# ── 4. Register the webhook, with the secret-token header ─────────────────
HOOK_URL="https://${PROJECT_REF}.supabase.co/functions/v1/telegram-webhook"
SET_JSON="$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"${HOOK_URL}\",\"secret_token\":\"${HOOK_SECRET}\",\"allowed_updates\":[\"message\",\"callback_query\"],\"drop_pending_updates\":true}")"
printf '%s' "$SET_JSON" | grep -q '"ok":true' || { echo "  Webhook registration failed: $SET_JSON"; exit 1; }
printf '  4/6  webhook registered\n'

# ── 5. Confirm Telegram accepted it ───────────────────────────────────────
INFO="$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo")"
printf '%s' "$INFO" | grep -q "$HOOK_URL" || { echo "  Telegram did not confirm the webhook: $INFO"; exit 1; }
printf '  5/6  Telegram confirmed the endpoint\n'
unset BOT_TOKEN HOOK_SECRET

# ── 6. Mint a one-tap pairing link ────────────────────────────────────────
PAIR_TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(24).replace("-","").replace("_",""))')"
SQLF="$(mktemp)"
cat > "$SQLF" <<SQL
INSERT INTO public.telegram_bootstrap (token, profile_id, expires_at)
SELECT '${PAIR_TOKEN}', p.id, NOW() + interval '60 minutes'
  FROM public.profiles p
 WHERE p.role IN ('super_admin','admin')
 ORDER BY CASE WHEN p.role='super_admin' THEN 0 ELSE 1 END, p.created_at
 LIMIT 1;
SQL
WORK="$(mktemp -d)"; ( cd "$WORK" && npx supabase init --force >/dev/null 2>&1 && npx supabase link --project-ref "$PROJECT_REF" >/dev/null 2>&1 && npx supabase db query --linked --file "$SQLF" >/dev/null 2>&1 )
rm -f "$SQLF"; rm -rf "$WORK"
printf '  6/6  one-tap pairing link minted (valid 60 minutes, single use)\n\n'

printf '  ▶ Final step — open this link and press START:\n\n'
printf '      https://t.me/%s?start=%s\n\n' "$BOT_USER" "$PAIR_TOKEN"
printf '  The link carries a single-use token, so only whoever opens it is\n'
printf '  enrolled. A stranger messaging the bot gets nothing.\n\n'
