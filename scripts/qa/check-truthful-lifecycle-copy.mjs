#!/usr/bin/env node
/**
 * scripts/qa/check-truthful-lifecycle-copy.mjs
 *
 * Two classes of user-visible LIE were shipped, both in contract screens:
 *
 *  1. "The job is now in progress" rendered on contract full execution.
 *     Signing does NOT dispatch. `inspector_sign_job_contract` had its status
 *     promotion REMOVED in 20260801506000, so after both signatures the job is
 *     still `open` with `contractor_id IS NULL`. The screen told the inspector
 *     to start work on a job nobody had dispatched or funded.
 *
 *  2. "Released to your Stripe Connect account after you and admin sign off."
 *     Settlement is not automatic. `admin_mark_payout_processed` is
 *     super_admin-only, requires the job to be `completed`, and requires an
 *     explicit reference (Stripe transfer id or "manual:<context>"). Nothing
 *     pays the inspector on report approval.
 *
 * Neither is caught by tsc, tests, or a build — they are strings. This gate
 * catches the CLASS: it refuses progress/dispatch claims and automatic-payment
 * promises in contract and signature surfaces.
 *
 * If a phrase here is ever legitimately correct, gate it on real state
 * (`job.status === 'in_progress'`) rather than on contract status, and add the
 * file to ALLOW with a reason.
 *
 * RUN: node scripts/qa/check-truthful-lifecycle-copy.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/web/src', 'src', 'app'];
const EXT = /\.(ts|tsx)$/;

/** Files allowed to use a banned phrase, each with a justification. */
const ALLOW = new Map([
  // Gated on the REAL job status, not on contract status — this one is honest.
  ['app/job-details/[id].tsx', "gated on job?.status === 'in_progress'"],
  // This gate's own documentation quotes the banned strings.
  ['scripts/qa/check-truthful-lifecycle-copy.mjs', 'the gate itself'],
]);

const BANNED = [
  {
    id: 'false-in-progress',
    // "job is (now) in progress" as a literal claim in JSX copy
    re: /job is (now )?in progress/i,
    why: 'signing does not dispatch — the job stays `open` until admin funds and dispatches',
  },
  {
    id: 'auto-payout',
    re: /released to your stripe connect account/i,
    why: 'settlement is manual and super_admin-gated (admin_mark_payout_processed)',
  },
  {
    id: 'auto-payout-generic',
    re: /(automatically|instantly) (paid|released|transferred|deposited)/i,
    why: 'no automatic inspector payout exists anywhere in the platform',
  },
];

/** Only contract / signature / payout surfaces — not the whole app. */
const SCOPE = /(contract|signature|sign|payout|wallet|finance)/i;

function walk(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === 'dist') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(walk(p));
    else if (EXT.test(e)) out.push(p);
  }
  return out;
}

const violations = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (!SCOPE.test(file)) continue;
    if (ALLOW.has(file)) continue;
    scanned++;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // skip comments — the fix commentary legitimately quotes the old copy
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const b of BANNED) {
        if (b.re.test(line)) {
          violations.push({ file, line: i + 1, id: b.id, why: b.why, text: t.slice(0, 100) });
        }
      }
    });
  }
}

console.log(`check-truthful-lifecycle-copy: scanned ${scanned} contract/payout surfaces`);
if (violations.length) {
  console.error(`\nFAIL — ${violations.length} untruthful lifecycle claim(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.id}]`);
    console.error(`    ${v.text}`);
    console.error(`    why: ${v.why}\n`);
  }
  process.exit(1);
}
console.log('PASS — no false progress/dispatch or automatic-payment claims.');
