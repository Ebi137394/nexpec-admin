#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  scripts/deploy-stripe-functions.sh
#
#  Clears the "Edge Function returned a non-2xx status code" blocker on the
#  Client → Finance / Stripe payment-sheet path.
#
#  Root cause: every Stripe Edge Function builds `new Stripe(
#  Deno.env.get('STRIPE_SECRET_KEY')!)` at module load. If that secret is unset
#  the function boot-errors → 500 on every invoke. The only non-auto secret
#  needed is STRIPE_SECRET_KEY (SUPABASE_URL / SERVICE_ROLE_KEY are injected by
#  the platform — never set those yourself).
#
#  Run from the repo root, logged in (`supabase login`), project linked to
#  sxqpjxhslzzcdrdctatm:
#      bash scripts/deploy-stripe-functions.sh
#
#  Reads the secret key with no echo — it is never written to disk or printed.
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

FUNCS=(create-payment-intent create-setup-intent create-disclosure-fee-intent
       sync-payment-method create-stripe-connect-link sync-stripe-connect-status)

# ── preconditions ───────────────────────────────────────────────────────────
command -v supabase >/dev/null 2>&1 || { echo "✗ supabase CLI not found. Install: https://supabase.com/docs/guides/cli"; exit 1; }
[ -f supabase/config.toml ] || { echo "✗ Run from the repo root (supabase/config.toml not found)."; exit 1; }
supabase projects list >/dev/null 2>&1 || { echo "✗ Not logged in. Run: supabase login"; exit 1; }
REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
echo "Project ref : ${REF:-<not linked>}"
[ -n "$REF" ] || { echo "✗ Project not linked. Run: supabase link --project-ref sxqpjxhslzzcdrdctatm"; exit 1; }

# ── 1. set STRIPE_SECRET_KEY (no echo, never stored) ────────────────────────
echo
read -r -s -p "Paste Stripe SECRET key (sk_test_… for App Review): " SK; echo
[ -n "$SK" ] || { echo "✗ Empty key — aborting."; exit 1; }
case "$SK" in
  sk_test_*) : ;;
  sk_live_*) read -r -p "⚠ That's a LIVE key (sk_live_). App Review needs sk_test_. Continue anyway? [y/N] " a; [ "$a" = y ] || [ "$a" = Y ] || { echo "Aborted."; unset SK; exit 0; } ;;
  *) echo "✗ Doesn't look like a Stripe secret key (expected sk_test_/sk_live_). Aborting."; unset SK; exit 1 ;;
esac
if supabase secrets set STRIPE_SECRET_KEY="$SK"; then echo "✓ STRIPE_SECRET_KEY set"; else echo "✗ Failed to set secret"; unset SK; exit 1; fi
unset SK

# ── 2. deploy the payment functions ─────────────────────────────────────────
echo
fail=0
for fn in "${FUNCS[@]}"; do
  printf '→ deploying %s … ' "$fn"
  if supabase functions deploy "$fn" >/dev/null 2>&1; then echo "✓"; else echo "✗"; fail=1; fi
done

# ── 3. verify ───────────────────────────────────────────────────────────────
echo
echo "── secrets (names only) ──"; supabase secrets list 2>/dev/null | grep -i stripe || true
echo
if [ "$fail" = 0 ]; then
  echo "✓ Done. Reload the app → Client → Finance. Payment sheet should present; test card 4242 4242 4242 4242."
  echo "  If it still errors, read the live trace: supabase functions logs create-payment-intent"
else
  echo "⚠ One or more deploys failed — re-run, or: supabase functions logs <name>"
  exit 1
fi
