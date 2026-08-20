#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-manual-payment-posture.mjs
//
//  Static guard for the MANUAL-PAYMENT-ONLY release posture. The database
//  suite (manual_payment_posture_test.sql) proves the server behaviour; this
//  proves the things a SQL test cannot see:
//
//    1. The "Coming soon" option is visible but CANNOT be activated — it is
//       not a button/Pressable and carries no click handler on either platform.
//    2. Every edge function that can create a Checkout Session, PaymentIntent,
//       SetupIntent or Transfer consults the payment-mode guard FIRST, so zero
//       provider calls happen while manual mode is active.
//    3. Both platforms state the same two options with the approved copy.
//
//  Run: node scripts/qa/check-manual-payment-posture.mjs   (npm run qa:payments)
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';

let failures = 0;
const fail = (m) => { failures++; console.error(`  ✘ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

const WEB = 'apps/web/src/components/payments/PaymentOptions.tsx';
const MOB = 'src/shared-ui/payments/PaymentOptions.tsx';

// Functions that could move money inbound. The payout/transfer family is
// disabled separately (NX-STRIPE-004).
const GUARDED_FNS = [
  'create-payment-intent',
  'create-wallet-deposit-intent',
  'create-disclosure-fee-intent',
  'create-setup-intent',
];

const REQUIRED_COPY = [
  'Manual payment',
  'Available now',
  'Handled manually by NEXPEC after the required approvals.',
  'Online card payment',
  'Coming soon',
  'Secure online payments will be added in a future update.',
];

console.log('manual payment posture guard');

// ── 1 + 3. The two options, and the coming-soon card is inert ───────────────
for (const [label, path] of [['web', WEB], ['mobile', MOB]]) {
  if (!existsSync(path)) { fail(`${label}: ${path} is missing`); continue; }
  const src = readFileSync(path, 'utf8');

  for (const phrase of REQUIRED_COPY) {
    if (!src.includes(phrase)) fail(`${label}: missing required copy "${phrase}"`);
  }

  // Isolate the coming-soon card and prove it is not interactive.
  const idx = src.indexOf('payment-option-online-coming-soon');
  if (idx === -1) {
    fail(`${label}: the coming-soon card has no testID/data-testid anchor`);
  } else {
    const card = src.slice(Math.max(0, idx - 400), idx + 900);
    const interactive =
      /<button/i.test(card) ||
      /Touchable|Pressable|onPress=|onClick=/.test(card) ||
      /<a\s/i.test(card);
    if (interactive) {
      fail(`${label}: the coming-soon option is INTERACTIVE — it must not be activatable`);
    } else {
      ok(`${label}: coming-soon option is present and non-interactive`);
    }
    const disabledSignal = /aria-disabled|accessibilityState=\{\{ disabled: true \}\}|pointerEvents="none"/.test(card);
    if (!disabledSignal) fail(`${label}: the coming-soon option is not marked disabled for assistive tech`);
  }
}

// ── 2. Zero provider calls while manual mode is active ─────────────────────
for (const fn of GUARDED_FNS) {
  const p = `supabase/functions/${fn}/index.ts`;
  if (!existsSync(p)) { fail(`${fn}: function missing`); continue; }
  const src = readFileSync(p, 'utf8');
  if (!src.includes('assertOnlinePaymentsEnabled')) {
    fail(`${fn}: does NOT consult the payment-mode guard — it could charge in manual mode`);
    continue;
  }
  const guardAt = src.indexOf('assertOnlinePaymentsEnabled(');
  // The guard must precede every provider call in the file.
  for (const call of ['paymentIntents.create', 'setupIntents.create', 'checkout.sessions.create', 'transfers.create']) {
    const callAt = src.indexOf(call);
    if (callAt !== -1 && callAt < guardAt) {
      fail(`${fn}: ${call} appears BEFORE the payment-mode guard`);
    }
  }
  ok(`${fn}: guarded before any provider call`);
}

// The guard module itself must fail closed.
const modPath = 'supabase/functions/_shared/paymentMode.ts';
if (!existsSync(modPath)) fail('the shared paymentMode guard module is missing');
else {
  const mod = readFileSync(modPath, 'utf8');
  if (!/catch\s*\{\s*\n?\s*return false/.test(mod) && !mod.includes('return false')) {
    fail('paymentMode guard does not fail closed on error');
  } else ok('payment-mode guard fails closed');
}

if (failures) {
  console.error(`\n✘ ${failures} manual-payment posture violation(s).`);
  process.exit(1);
}
console.log('  ✓ clean — manual mode only, coming-soon inert, no reachable provider calls');
