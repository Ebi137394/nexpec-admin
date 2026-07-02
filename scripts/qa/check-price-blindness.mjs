#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-price-blindness.mjs
//
//  GR2 / anti-poaching CI guard. Buyer-facing surfaces (client / agency /
//  enterprise / supplier) must NEVER name an inspector-payout or platform-
//  margin column in a query — those fields must not even be transmitted to a
//  buyer frontend. The DB views (client_job_contracts_view, the row-gated
//  inspector leg of unified_contracts_view) already enforce this at the wire
//  boundary; this static check prevents a future edit from reintroducing a
//  buyer-reachable select of the forbidden columns.
//
//  Heuristic: flag any FORBIDDEN token on a NON-comment line within a
//  buyer-surface file. Comments that document the exclusion are ignored.
//  Shared, role-branched files (e.g. contracts/index.tsx, PipelineSection.tsx)
//  are intentionally NOT scanned — they select these columns only inside
//  inspector/admin branches that are themselves row-gated.
//
//  Run: node scripts/qa/check-price-blindness.mjs   (wired as npm run qa:gr2)
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// Inspector pay / platform margin columns — never for a buyer's wire payload.
const FORBIDDEN = [
  'inspector_payout_cents',
  'payout_amount_cents',
  'platform_spread_cents',
  'platform_margin_cents',
  'contractor_payout_amount_cents',
];

// Buyer-only surfaces. A path matches if it is (or lives under) one of these.
const BUYER_DIRS = [
  'app/(client)',
  'app/(agency)',
  'app/suppliers',
  'src/screens/client',
];
const BUYER_FILES = [
  'app/(shared)/agency-job-details.tsx',
  'app/(tabs)/client-dashboard.tsx',
  'app/(tabs)/agency-dashboard.tsx',
  'app/(tabs)/enterprise-dashboard.tsx',
  // Root-level buyer surface (filters jobs by client_id) — not under a buyer
  // route group, so it must be listed explicitly or the GR2 scan misses it.
  'app/inspectors.tsx',
];

// Blank out comments while preserving line count, so wrapped block/JSX
// comments that document the exclusion don't produce false positives.
const stripComments = (src) => {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((l) => l.replace(/\/\/.*$/, ''));
};

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
}

const files = [];
for (const d of BUYER_DIRS) walk(join(ROOT, d), files);
for (const f of BUYER_FILES) files.push(join(ROOT, f));

const violations = [];
for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  stripComments(src).forEach((line, i) => {
    for (const token of FORBIDDEN) {
      if (line.includes(token)) {
        violations.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 100)}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error('✘ GR2 price-blindness violation — buyer surface references an inspector-payout/margin column:');
  for (const v of violations) console.error('   ' + v);
  console.error(`\n${violations.length} violation(s). Buyer queries must not name: ${FORBIDDEN.join(', ')}.`);
  process.exit(1);
}

console.log(`✓ GR2 price-blindness: scanned ${files.length} buyer-surface file(s); no forbidden inspector-payout/margin columns selected.`);
process.exit(0);
