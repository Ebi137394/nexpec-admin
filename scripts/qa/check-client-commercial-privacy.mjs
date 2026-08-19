#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-client-commercial-privacy.mjs
//
//  OWNER-REVIEW guard (2026-08-19, migration 20260801558000). Client-facing
//  surfaces — web (apps/web/src/app/client) and mobile (app/(client)) — must
//  never name an inspector-pay / platform-margin column, select or render the
//  inspector's private contact details, or ship payout-implying copy. The DB
//  views enforce the wire boundary (sanitized contract bodies, NULL contact
//  for non-admins); this static check stops a future edit from re-introducing
//  a client-reachable reference or the misleading wording.
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

const FORBIDDEN = [
  /inspector_payout_cents/,
  /payout_amount_cents/,
  /platform_spread_cents/,
  /platform_margin_cents/,
  /contractor_payout_amount_cents/,
  /inspector_email/,
  /inspector_phone/,
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
    for (const bad of ['inspector_email', 'inspector_phone', 'payout', 'spread', 'margin']) {
      if (m[1].includes(bad)) {
        flag(`jobContracts.ts: CLIENT_CONTRACT_COLUMNS names forbidden column fragment "${bad}"`);
      }
    }
  }
}
{
  const lines = stripComments(
    readFileSync(join(ROOT, 'apps/web/src/lib/data/jobApplications.ts'), 'utf8'),
  );
  lines.forEach((line, i) => {
    if (/inspector_email|inspector_phone/.test(line)) {
      flag(`jobApplications.ts:${i + 1} selects/maps inspector contact → ${line.trim().slice(0, 90)}`);
    }
  });
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
