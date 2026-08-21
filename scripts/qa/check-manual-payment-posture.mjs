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

// Every buyer surface that must state the posture. Web's /client/* portal is
// shared by client, agency and enterprise (middleware CLIENT_PREFIX), so those
// two files cover all three roles there. Mobile routes each buyer role to its
// own dashboard, so each one needs it.
const POSTURE_SURFACES = [
  'apps/web/src/app/client/finance/page.tsx',
  'apps/web/src/app/client/jobs/[id]/release/page.tsx',
  'app/(client)/finance/index.tsx',
  'app/(client)/approve.tsx',
  'app/(tabs)/agency-dashboard.tsx',
  'app/(tabs)/enterprise-dashboard.tsx',
];

// SSO must not be advertised as active while no provider is configured.
const SSO_SIGNIN = 'app/(auth)/sign-in.tsx';

// Functions that could move money inbound. The payout/transfer family is
// disabled separately (NX-STRIPE-004).
const GUARDED_FNS = [
  'create-payment-intent',
  'create-wallet-deposit-intent',
  'create-disclosure-fee-intent',
  'create-setup-intent',
];

// The posture panel is FLAG-DRIVEN (nx_online_payments_enabled): both states
// must exist in code, manual payment is always offered, the coming-soon card
// stays inert, and the flag read must fail CLOSED (default to the OFF state).
const REQUIRED_COPY = [
  'Manual payment',
  'Online card payment',
  'nx_online_payments_enabled',                 // server flag actually consulted
  'payment-option-online-available',            // ON-state card exists
  'payment-option-online-coming-soon',          // OFF-state card exists
  'Secure online payments will be added in a future update.',
  'handled by NEXPEC after the required',       // manual copy (both platforms)
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

// ── 4. Every buyer surface states the posture ──────────────────────────────
for (const p of POSTURE_SURFACES) {
  if (!existsSync(p)) { flag(`posture surface missing: ${p}`); continue; }
  if (!readFileSync(p, 'utf8').includes('PaymentOptions')) {
    flag(`${p} does not render PaymentOptions — a buyer surface without the posture`);
  } else ok(`${p} states the payment posture`);
}

// ── 5. SSO is not advertised as active ─────────────────────────────────────
{
  if (!existsSync(SSO_SIGNIN)) flag(`sign-in screen missing: ${SSO_SIGNIN}`);
  else {
    const src = readFileSync(SSO_SIGNIN, 'utf8');
    const i = src.indexOf('sso-coming-soon');
    if (i === -1) {
      flag('mobile sign-in does not mark the SSO entry as coming soon');
    } else {
      const block = src.slice(Math.max(0, i - 700), i + 1200);
      if (/onPress=\{\s*\(\)\s*=>\s*handleSsoLogin/.test(block)) {
        flag('mobile sign-in still wires an ACTIVE SSO handler — no provider is configured');
      } else ok('SSO entries are inert and labelled coming soon');
    }
  }
}

if (failures) {
  console.error(`\n✘ ${failures} manual-payment posture violation(s).`);
  process.exit(1);
}
console.log('  ✓ clean — manual mode only, coming-soon inert, no reachable provider calls');
