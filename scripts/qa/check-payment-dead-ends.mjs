#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  check-payment-dead-ends.mjs — no user-visible Stripe control may exist
//  without a flag gate.
//
//  While platform_settings.online_payments_enabled is false the edge functions
//  return ONLINE_PAYMENTS_DISABLED. Any CTA that reaches one of them is a
//  guaranteed dead end, which is exactly what a store reviewer files against.
//  This guard asserts that every Stripe-invoking surface consults the flag.
//
//  It does NOT ask the integration to be deleted: the Stripe code stays, gated,
//  so restoring payments is a flag flip with no rebuild.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';

const STRIPE_CALLS = [
  'create-payment-intent', 'create-setup-intent',
  'create-wallet-deposit-intent', 'create-disclosure-fee-intent',
  'initPaymentSheet', 'presentPaymentSheet', 'loadStripe', 'PaymentElement',
];
const GATES = [
  'onlinePayments', 'useOnlinePayments', 'useOnlinePaymentsEnabled',
  'onlinePaymentsEnabled', 'nx_online_payments_enabled',
];

// Surfaces that invoke Stripe and are reachable by a normal user.
const SURFACES = [
  'app/(tabs)/finance.tsx',
  'app/(client)/approve.tsx',
  'apps/web/src/app/client/jobs/[id]/funding/JobFundingClient.tsx',
  'apps/web/src/app/client/jobs/[id]/funding/page.tsx',
  'apps/web/src/app/(marketplace)/deals/[id]/sign/page.tsx',
];

let failed = 0;
const fail = (m) => { console.error(`  ✘ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('payment dead-end guard');
for (const rel of SURFACES) {
  if (!existsSync(rel)) { fail(`${rel} is missing`); continue; }
  const src = readFileSync(rel, 'utf8');
  const callsStripe = STRIPE_CALLS.some((c) => src.includes(c));
  const gated = GATES.some((g) => src.includes(g));
  if (callsStripe && !gated) fail(`${rel} reaches Stripe with no online-payments gate`);
  else ok(`${rel}${callsStripe ? ' — gated' : ' — no direct Stripe call'}`);
}

// The gates themselves must fail closed.
for (const rel of ['apps/web/src/lib/payments/onlinePayments.ts',
                   'apps/web/src/lib/payments/useOnlinePayments.ts',
                   'src/core/payments/onlinePayments.ts']) {
  if (!existsSync(rel)) { fail(`${rel} is missing`); continue; }
  const src = readFileSync(rel, 'utf8');
  if (!/catch\s*(\([^)]*\))?\s*\{[^}]*(return false|setEnabled\(false\))/s.test(src))
    fail(`${rel} does not fail closed on error`);
  else ok(`${rel} fails closed`);
}

console.log(failed ? `\n✘ ${failed} payment dead-end violation(s).`
                   : '\n✓ clean — every Stripe surface is flag-gated and fails closed.');
process.exit(failed ? 1 : 0);
