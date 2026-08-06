#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  check-admin-money-mapping.mjs
//
//  Regression test for the "Admin Jobs shows $0" bug.
//
//  Job cbddb77a-3e2a-4364-950b-66860b2791eb held, in the database:
//      client_price_cents     = 230000
//      inspector_payout_cents = 120000
//      payout_amount_cents    = 120000
//  …and the admin list and moderation drawer both rendered $0.
//
//  TWO independent defects produced that, and this guard covers both:
//    A. jobsModeration.ts read pricing from public.jobs. Migration
//       20260801312000 revoked the buyer-pricing columns from `authenticated`
//       (admins are authenticated too), so the pricing projections failed and
//       the cascade fell through to a projection with NO money columns.
//       → the admin queries must read jobs_secure_view.
//    B. fmtCents() returned '$0.00' for null/undefined, so absent data was
//       displayed as a genuine zero.
//       → unavailable must render as '—', never as a money figure.
//
//  Runs with plain Node — no test runner needed.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
const pass = [];
const check = (cond, ok, bad) => (cond ? pass.push(ok) : fail.push(bad));

// ── 1. The exact rendering assertion ──────────────────────────────────────
// Mirrors fmtCents() from the admin components.
function fmtCents(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(Number(v) / 100);
}
// Mirrors the canonical payout mapping in jobsModeration.ts.
const canonicalPayout = (row) => row.inspector_payout_cents ?? row.payout_amount_cents ?? null;

const JOB = {
  client_price_cents: 230000,
  inspector_payout_cents: 120000,
  payout_amount_cents: 120000,
};

check(fmtCents(JOB.client_price_cents) === '$2,300.00',
  'client_price_cents 230000 renders $2,300.00',
  `client price rendered "${fmtCents(JOB.client_price_cents)}", expected $2,300.00`);

check(fmtCents(canonicalPayout(JOB)) === '$1,200.00',
  'inspector payout 120000 renders $1,200.00',
  `payout rendered "${fmtCents(canonicalPayout(JOB))}", expected $1,200.00`);

// legacy-safe fallback: canonical missing, legacy mirror present
check(canonicalPayout({ inspector_payout_cents: null, payout_amount_cents: 120000 }) === 120000,
  'payout falls back to payout_amount_cents when the canonical column is null',
  'legacy payout fallback is broken');

// canonical wins when both are present and differ
check(canonicalPayout({ inspector_payout_cents: 120000, payout_amount_cents: 999 }) === 120000,
  'inspector_payout_cents takes precedence over the legacy mirror',
  'canonical payout does not take precedence');

// ── 2. Unavailable must NOT render as money ───────────────────────────────
for (const v of [null, undefined, NaN]) {
  check(fmtCents(v) === '—',
    `unavailable (${String(v)}) renders '—', not a money figure`,
    `unavailable (${String(v)}) rendered "${fmtCents(v)}" — a permission error would look like a real $0`);
}

// ── 3. The components must actually use that behaviour ────────────────────
for (const f of [
  'apps/web/src/components/admin/jobs/JobsModerationTable.tsx',
  'apps/web/src/components/admin/jobs/JobModerationPanel.tsx',
  'apps/web/src/components/admin/jobs/JobModerationDrawer.tsx',
]) {
  const src = read(f);
  const name = f.split('/').pop();
  check(!/return '\$0\.00';/.test(src),
    `${name} does not render '$0.00' for missing data`,
    `${name} still returns '$0.00' for null/undefined — a denied read would show as a real zero`);
}

// ── 4. Admin queries must read the pricing-bearing view ───────────────────
const jm = read('apps/web/src/lib/data/jobsModeration.ts');
check(!/\.from\('jobs'\)/.test(jm),
  'jobsModeration.ts no longer reads pricing from public.jobs',
  "jobsModeration.ts still queries public.jobs — client_price_cents is revoked from `authenticated` there, so admins would see $0");
check((jm.match(/\.from\('jobs_secure_view'\)/g) || []).length >= 2,
  'both admin job queries read jobs_secure_view',
  'not every admin job query reads jobs_secure_view');
check(/PRICING projection failed/.test(jm),
  'a failing pricing projection is logged at error level',
  'a failing pricing projection is still swallowed silently');
check(/inspector_payout_cents as number \| null\) \?\?/.test(jm),
  'payout mapping is canonical-first with a legacy fallback',
  'payout mapping is not canonical-first');

// ── Report ────────────────────────────────────────────────────────────────
for (const p of pass) console.log(`  ok   ${p}`);
if (fail.length) {
  console.error('\n✘ Admin money mapping regression:\n');
  for (const f of fail) console.error(`  ✘ ${f}`);
  process.exit(1);
}
console.log(`\n✓ admin money mapping: ${pass.length}/${pass.length} assertions hold ` +
  `(230000 → $2,300.00, 120000 → $1,200.00, missing → '—').`);
