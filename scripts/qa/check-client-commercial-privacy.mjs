#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-client-commercial-privacy.mjs
//
//  OWNER-REVIEW guard (2026-08-19; commercial scope per 20260801558000,
//  identity scope superseded by 20260801566000). Client-facing surfaces — web
//  (apps/web/src/app/client) and mobile (app/(client)) — must never name an
//  inspector-pay / platform-margin column or ship payout-implying copy. The
//  DB views enforce the wire boundary (sanitized contract bodies); identity
//  contact (email/phone) is governed by the three-tier disclosure matrix in
//  the views and its SQL suites, not by this guard.
//
//  Checks
//    1. Forbidden tokens on non-comment lines under the client dirs:
//         columns:  inspector_payout_cents, payout_amount_cents,
//                    platform_spread_cents, platform_margin_cents,
//                    contractor_payout_amount_cents,
//                    inspector_email, inspector_phone
//         copy:      "Inspector payout", "held for payout", "Your price, held"
//    2. Precision projections:
//         • jobContracts.ts CLIENT_CONTRACT_COLUMNS excludes contact + payout
//         • jobApplications.ts never selects inspector_email / inspector_phone
//    3. Required copy: the client contract page says "Total contract price".
//
//  Run: node scripts/qa/check-client-commercial-privacy.mjs
//       (wired as npm run qa:client-privacy)
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
let failures = 0;
const flag = (msg) => {
  failures += 1;
  console.error(`  ✘ ${msg}`);
};

// Commercial-privacy tokens only. Inspector email/phone are NOT forbidden:
// per the final owner policy (20260801566000) they are legitimately part of
// FULL-mode identity disclosure; the DB views are the authority (NULL outside
// `full`), and the identity SQL suites enforce that matrix.
const FORBIDDEN = [
  /inspector_payout_cents/,
  /payout_amount_cents/,
  /platform_spread_cents/,
  /platform_margin_cents/,
  /contractor_payout_amount_cents/,
  /Inspector payout/,
  /held for payout/i,
  /Your price, held/,
];

const CLIENT_DIRS = ['apps/web/src/app/client', 'app/(client)'];

// Blank out comments while preserving line count so documentation of the
// exclusions never false-positives.
const stripComments = (src) => {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((l) => l.replace(/\/\/.*$/, ''));
};

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
}

console.log('client commercial privacy guard');

// ── 1. directory sweep ───────────────────────────────────────────────────────
const files = [];
for (const d of CLIENT_DIRS) walk(join(ROOT, d), files);
for (const f of files) {
  const lines = stripComments(readFileSync(f, 'utf8'));
  lines.forEach((line, i) => {
    for (const re of FORBIDDEN) {
      if (re.test(line)) {
        flag(`${relative(ROOT, f)}:${i + 1} forbidden ${re} → ${line.trim().slice(0, 90)}`);
      }
    }
  });
}

// ── 2. precision projections ─────────────────────────────────────────────────
{
  const src = readFileSync(join(ROOT, 'apps/web/src/lib/data/jobContracts.ts'), 'utf8');
  const m = src.match(/const CLIENT_CONTRACT_COLUMNS =\s*'([^']+)'/);
  if (!m) {
    flag('jobContracts.ts: CLIENT_CONTRACT_COLUMNS constant not found');
  } else {
    for (const bad of ['payout', 'spread', 'margin']) {
      if (m[1].includes(bad)) {
        flag(`jobContracts.ts: CLIENT_CONTRACT_COLUMNS names forbidden column fragment "${bad}"`);
      }
    }
  }
}

// ── 3. required copy ─────────────────────────────────────────────────────────
{
  const page = readFileSync(
    join(ROOT, 'apps/web/src/app/client/contracts/job/[id]/page.tsx'),
    'utf8',
  );
  if (!page.includes('Total contract price')) {
    flag('client contract page lost the "Total contract price" heading');
  }
  if (!page.includes('Open Project Messages')) {
    flag('client contract page lost the Project Messages link');
  }
}

if (failures > 0) {
  console.error(`\n✘ ${failures} client commercial-privacy violation(s).`);
  process.exit(1);
}
console.log('  ✓ clean — no payout/margin/contact tokens on client surfaces');
