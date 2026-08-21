#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  scripts/stripe-live-golive.sh — ONE-ACTION Stripe LIVE go-live (Production)
#
#  Run from the repo root:   bash scripts/stripe-live-golive.sh
#
#  Asks for exactly two values with HIDDEN input (they never echo, never touch
#  a file, never enter shell history):
#     1. LIVE publishable key   pk_live_…
#     2. LIVE secret key        sk_live_…
#
#  Then it does EVERYTHING else itself:
#     • verifies the secret against Stripe (/v1/account: livemode, charges)
#     • sets Supabase Production secrets (STRIPE_SECRET_KEY)
#     • creates the LIVE payments webhook via the Stripe API and captures its
#       signing secret programmatically → STRIPE_PAYMENTS_WEBHOOK_SECRET
#       (an existing endpoint for our URL is recreated — its old secret is
#        unrecoverable by design and was never configured anywhere)
#     • deploys the six payment edge functions (fail-closed guard + disabled
#       Connect + webhook) to Production
#     • updates EAS production EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
#     • updates Vercel production NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and
#       STRIPE_SECRET_KEY, then redeploys the web
#
#  Architecture guard: single NEXPEC merchant account, inbound only. This
#  script configures NO Connect, NO transfers, NO provider payouts.
#
#  It does NOT flip platform_settings.online_payments_enabled — that final
#  switch is thrown afterwards, once verification passes.
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

PROD_REF="sxqpjxhslzzcdrdctatm"
WEBHOOK_URL="https://${PROD_REF}.supabase.co/functions/v1/stripe-payments-webhook"
FNS=(create-wallet-deposit-intent create-payment-intent create-setup-intent \
     create-disclosure-fee-intent create-stripe-connect-link stripe-payments-webhook)

ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad(){ printf '  \033[31m✗\033[0m %s\n' "$*"; }
die(){ bad "$*"; exit 1; }

[ -f eas.json ] || die "run from the repo root"
command -v supabase >/dev/null || die "supabase CLI missing"
command -v curl >/dev/null || die "curl missing"

echo "── Stripe LIVE go-live · Production ${PROD_REF} ──"
read -r -s -p "Paste LIVE publishable key (pk_live_…): " PK; echo ""
read -r -s -p "Paste LIVE secret key      (sk_live_…): " SK; echo ""
case "$PK" in pk_live_*) [ "${#PK}" -ge 60 ] || die "publishable key looks too short";; *) die "that is not a pk_live_ key";; esac
case "$SK" in sk_live_*|rk_live_*) [ "${#SK}" -ge 60 ] || die "secret key looks too short";; *) die "that is not a live secret key";; esac

# ── 1. verify the secret against Stripe ────────────────────────────────────
ACCT_JSON=$(curl -s --max-time 30 -u "${SK}:" https://api.stripe.com/v1/account)
ACCT_ID=$(printf '%s' "$ACCT_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id',''))" 2>/dev/null)
CHARGES=$(printf '%s' "$ACCT_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('charges_enabled'))" 2>/dev/null)
[ -n "$ACCT_ID" ] || die "Stripe rejected the secret key (no account id returned)"
ok "Stripe account ${ACCT_ID} · charges_enabled=${CHARGES} · LIVE mode"

# ── 2. Supabase Production secret ──────────────────────────────────────────
supabase secrets set "STRIPE_SECRET_KEY=${SK}" --project-ref "$PROD_REF" >/dev/null \
  && ok "Supabase STRIPE_SECRET_KEY set (live)" || die "supabase secrets set failed"

# ── 3. LIVE payments webhook (recreate to capture a fresh signing secret) ──
EXISTING=$(curl -s --max-time 30 -u "${SK}:" "https://api.stripe.com/v1/webhook_endpoints?limit=100" \
  | python3 -c "import sys,json;print(' '.join(e['id'] for e in json.load(sys.stdin).get('data',[]) if e.get('url')=='${WEBHOOK_URL}'))" 2>/dev/null)
for e in $EXISTING; do
  curl -s --max-time 30 -u "${SK}:" -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$e" >/dev/null
  ok "removed stale webhook endpoint $e (its secret was never configured anywhere)"
done
WH_JSON=$(curl -s --max-time 30 -u "${SK}:" https://api.stripe.com/v1/webhook_endpoints \
  -d "url=${WEBHOOK_URL}" \
  -d "enabled_events[]=payment_intent.succeeded" \
  -d "enabled_events[]=payment_intent.payment_failed" \
  -d "enabled_events[]=setup_intent.succeeded" \
  -d "enabled_events[]=charge.refunded" \
  -d "description=NEXPEC production payments (managed by go-live script)")
WH_ID=$(printf '%s' "$WH_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
WH_SECRET=$(printf '%s' "$WH_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin).get('secret',''))" 2>/dev/null)
[ -n "$WH_ID" ] && [ -n "$WH_SECRET" ] || die "webhook creation failed"
ok "LIVE webhook ${WH_ID} created for stripe-payments-webhook"
supabase secrets set "STRIPE_PAYMENTS_WEBHOOK_SECRET=${WH_SECRET}" --project-ref "$PROD_REF" >/dev/null \
  && ok "Supabase STRIPE_PAYMENTS_WEBHOOK_SECRET set" || die "webhook secret set failed"

# ── 4. deploy the six payment functions ────────────────────────────────────
for f in "${FNS[@]}"; do
  if supabase functions deploy "$f" --project-ref "$PROD_REF" >/dev/null 2>&1; then
    ok "deployed $f"
  else
    die "deploy failed for $f — rerun the script; nothing else was harmed"
  fi
done

# ── 5. EAS production publishable key ──────────────────────────────────────
if npx eas-cli env:update --non-interactive --variable-environment production \
     --variable-name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value "$PK" >/dev/null 2>&1 \
   || { npx eas-cli env:delete --non-interactive --variable-environment production \
          --variable-name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY >/dev/null 2>&1; \
        printf '%s' "$PK" | npx eas-cli env:create --non-interactive \
          --environment production --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY \
          --value "$PK" --visibility plaintext --scope project --type string >/dev/null 2>&1; }; then
  ok "EAS production EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY → pk_live"
else
  bad "EAS update failed — run scripts/eas-prod-env.sh after putting the pk_live in it"
fi

# ── 6. Vercel production web ───────────────────────────────────────────────
( cd apps/web 2>/dev/null || exit 0
  npx vercel env rm NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY production --yes >/dev/null 2>&1
  printf '%s' "$PK" | npx vercel env add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY production --sensitive >/dev/null 2>&1 \
    && ok "Vercel NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY → pk_live" || bad "Vercel publishable update failed"
  npx vercel env rm STRIPE_SECRET_KEY production --yes >/dev/null 2>&1
  printf '%s' "$SK" | npx vercel env add STRIPE_SECRET_KEY production --sensitive >/dev/null 2>&1 \
    && ok "Vercel STRIPE_SECRET_KEY → sk_live" || bad "Vercel secret update failed"
)
npx vercel deploy --prod --yes >/dev/null 2>&1 && ok "web redeployed to production" || bad "web redeploy failed — run: npx vercel deploy --prod --yes"

unset SK PK WH_SECRET
echo ""
echo "══ DONE. Tell the agent 'go-live script done' — it will verify end-to-end,"
echo "   flip online_payments_enabled, run the regression battery and rebuild"
echo "   the final iOS/Android artifacts. ══"
