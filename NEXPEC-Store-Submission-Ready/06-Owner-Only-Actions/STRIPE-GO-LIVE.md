# Stripe LIVE go-live — exact steps (single-merchant model)

**Architecture (locked):** one NEXPEC Stripe business account. Buyer (client/
agency/enterprise) card payments settle into it. NO Connect, NO connected
provider accounts, NO automatic transfers/payouts, NO splits. Inspector and
supplier payouts remain manual (bank/Wise) via admin Mark-as-Paid. The payout
and Connect endpoints refuse server-side; the UI states the manual model.

## Current audited state (verified 2026-08-21)

| Surface | Key/mode today | Evidence |
|---|---|---|
| Backend edge functions (Prod) | `STRIPE_SECRET_KEY` = **sk_test** | Deposit sheet rendered "TEST MODE" live |
| Mobile Production env (EAS) | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` = **pk_test** | env listing |
| Web Production (Vercel) | `STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set 96 days ago — **assume test** | values sensitive; age predates live account |
| Payments webhook secret | **`STRIPE_PAYMENTS_WEBHOOK_SECRET` MISSING on Prod** | secrets list — webhook cannot verify signatures |
| Connect webhook secret | present but now irrelevant (Connect disabled) | — |
| DB flag `online_payments_enabled` | **false** (fail-closed everywhere) | live RPC |

## Steps (in order)

### 1 — Stripe Dashboard (LIVE mode)
1. Developers → API keys → copy the **live publishable key** (`pk_live_…`)
   and the **live secret key** (`sk_live_…`). Never paste them into chat or
   the repo.
2. Developers → Webhooks → **Add endpoint**:
   - URL: `https://sxqpjxhslzzcdrdctatm.supabase.co/functions/v1/stripe-payments-webhook`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`,
     `setup_intent.succeeded`, `charge.refunded`
   - Copy the endpoint's **signing secret** (`whsec_…`).
   (No Connect endpoint needed — Connect is disabled this release.)

### 2 — Supabase secrets (Production) — run yourself
```bash
cd ~/Desktop/nexpec
supabase secrets set STRIPE_SECRET_KEY="sk_live_…" --project-ref sxqpjxhslzzcdrdctatm
supabase secrets set STRIPE_PAYMENTS_WEBHOOK_SECRET="whsec_…" --project-ref sxqpjxhslzzcdrdctatm
```

### 3 — Deploy the gated functions (includes the fail-closed guard + disabled Connect)
```bash
for f in create-wallet-deposit-intent create-payment-intent create-setup-intent \
         create-disclosure-fee-intent create-stripe-connect-link stripe-payments-webhook; do
  supabase functions deploy "$f" --project-ref sxqpjxhslzzcdrdctatm
done
```

### 4 — Client keys
- **EAS (mobile)**: `npx eas-cli env:update production --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value "pk_live_…"`
  then rebuild both store artifacts once (`npx eas-cli build --platform all --profile production`).
- **Vercel (web)**: replace `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and
  `STRIPE_SECRET_KEY` for Production in the Vercel dashboard → redeploy
  (`npx vercel deploy --prod --yes`).

### 5 — Flip the flag (LAST, after 1–4)
```bash
supabase db query --linked "update platform_settings set online_payments_enabled = true where id='global';"
```
(run with the Production link, or via the SQL editor). The UI switches to
"Online card payment — AVAILABLE" automatically on both platforms — no
rebuild needed for the flip itself.

### 6 — Controlled live smoke (recommended)
Deposit the minimum ($1.00) with a real card in the mobile app, confirm the
transaction appears, then refund it from the Stripe Dashboard. One charge,
immediately refunded, fully explained.

## Verification matrix to fill after go-live

| Surface | Stripe mode | Key type | Backend mode | TEST MODE visible? | Verdict |
|---|---|---|---|---|---|
| Web Production | live | pk_live | sk_live | must be NO | ☐ |
| iOS Production (rebuild) | live | pk_live | sk_live | must be NO | ☐ |
| Android Production (rebuild) | live | pk_live | sk_live | must be NO | ☐ |
| Edge functions | live | — | sk_live | — | ☐ |
| Payments webhook | live | whsec (live) | verified signature | — | ☐ |
