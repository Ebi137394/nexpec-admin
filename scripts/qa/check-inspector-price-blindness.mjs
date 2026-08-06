#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  check-inspector-price-blindness.mjs — GR2, the SELLER side.
//
//  scripts/qa/check-price-blindness.mjs already guards the BUYER side (a client
//  surface must not name inspector_payout_cents). This is the mirror image and
//  the one that was missing: an INSPECTOR surface must never receive the client
//  price, the platform spread, the client's budget, or an unrestricted profile
//  row.
//
//  It fails on two things, because both leak the same data:
//    1. naming a buyer-pricing column in an inspector-reachable query;
//    2. `select('*')` / `profiles(*)` / `jobs(*)` on a role-sensitive table —
//       a wildcard returns client_price_cents and platform_spread_cents today,
//       and silently absorbs every sensitive column added to `jobs` tomorrow.
//
//  Scope note: this is a STATIC guard over query projections. Since migration
//  20260801312000 the DATABASE is the real boundary — the buyer/platform columns
//  are no longer granted to `authenticated`, so a direct PostgREST call fails.
//  This guard remains useful as a fast, offline signal and to catch an inspector
//  surface pointing at the buyer-only jobs_secure_view. The authoritative proof
//  is supabase/tests/inspector_price_blindness_test.sql.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** Files an authenticated INSPECTOR can cause to run. */
const INSPECTOR_SURFACES = [
  'app/(inspector)/',
  'app/inspector/',
  'src/roles/inspector/',
  'src/components/inspector/',
  'app/(tabs)/inspector-dashboard',
  'app/my-applications',
  'app/find-jobs',
  'app/(tabs)/jobs/',
  'app/jobs/',
  'app/(shared)/job-details',
  'app/contracts/',
  'src/core/hooks/useJobs.ts',
  'src/core/services/applications.ts',
  'src/core/services/assignJob.ts',
  'apps/web/src/lib/data/openJobs',
  'apps/web/src/lib/data/inspectorJobDetail',
  'apps/web/src/lib/data/inspectorAssignments',
  'apps/web/src/lib/data/inspectorCounters',
  'apps/web/src/lib/data/inspectorDashboardMetrics',
  'apps/web/src/app/inspector/',
];

/** Buyer-side / platform-internal money columns. Never on an inspector wire. */
const FORBIDDEN_COLUMNS = [
  'client_price_cents',
  'platform_spread_cents',
  'platform_fee_cents',
  'budget_cents',
  'budget_min_cents',
  'budget_max_cents',
  'price_cents',
  'contractor_payout_amount_cents',
];

/** Tables where a wildcard projection is a data-exposure bug. */
const SENSITIVE_TABLES = ['jobs', 'profiles', 'job_contracts', 'applications', 'jobs_secure_view'];

/**
 * Known-safe exceptions, each justified. Keep this list SHORT and specific.
 */
const ALLOW = [
  // head:true + count:exact returns a COUNT only — no row bodies are sent.
  { file: 'src/roles/inspector/components/gamification/BadgeWall.tsx', reason: 'count-only (head:true), no rows returned' },
  // The inspector's OWN application rows (RLS: applicant_id = auth.uid()).
  // Contains their own bid and their own negotiation state, which is theirs.
  { file: 'src/core/hooks/useJobs.ts', table: 'applications', reason: "inspector's own application rows (RLS-scoped)" },
  { file: 'src/core/services/applications.ts', table: 'applications', reason: "own/job-scoped application rows (RLS-scoped)" },
  { file: 'app/(inspector)/jobs/[id]/index.tsx', table: 'applications', reason: 'own application row for this job (RLS-scoped)' },
  { file: 'app/(tabs)/jobs/[id].tsx', table: 'applications', reason: 'RLS-scoped; profiles are separately allowlisted' },
  { file: 'app/jobs/[id]/index.tsx', table: 'applications', reason: 'RLS-scoped' },
];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (['node_modules', '.git', '.expo', 'dist', 'build', '.next'].includes(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const isInspectorSurface = (rel) => INSPECTOR_SURFACES.some((p) => rel.startsWith(p));
const allowed = (rel, table) =>
  ALLOW.some((a) => rel === a.file && (a.table === undefined || a.table === table));

const violations = [];
let scanned = 0;

for (const abs of walk(ROOT)) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  if (!isInspectorSurface(rel)) continue;
  scanned++;
  const src = readFileSync(abs, 'utf8');

  // Locate each .from('<table>') and bound the projection search to the region
  // BEFORE the next .from(, so one query's select is never attributed to another.
  const froms = [...src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)];
  for (let i = 0; i < froms.length; i++) {
    const table = froms[i][1];
    if (!SENSITIVE_TABLES.includes(table)) continue;
    const start = froms[i].index;
    const end = i + 1 < froms.length ? froms[i + 1].index : src.length;
    const seg = src.slice(start, end);
    const line = src.slice(0, start).split('\n').length;

    const sel = seg.match(/\.select\(\s*([`'"])([\s\S]*?)\1/);
    if (!sel) continue; // variable projection (e.g. INSPECTOR_JOB_FIELDS) — fine
    const proj = sel[2].replace(/\s+/g, ' ').trim();

    const issues = [];
    // jobs_secure_view is buyer/admin-only and returns an inspector ZERO rows.
    // Reading it from an inspector surface is a silent-empty-state bug.
    if (table === 'jobs_secure_view') {
      issues.push('inspector surface reads jobs_secure_view (buyer/admin-only; returns 0 rows here)');
    }
    if (/^\*/.test(proj) && !allowed(rel, table)) issues.push(`wildcard select('*') on ${table}`);
    // NB: the embed may carry a PostgREST FK hint — `profiles!jobs_client_id_fkey(*)`
    // — so the table name and the paren are NOT adjacent. Matching only
    // /profiles\s*\(/ silently missed the worst real leak in this codebase.
    if (/\bprofiles(?:![\w]+)?\s*\(\s*\*/.test(proj)) issues.push('unrestricted profiles(*) embed');
    if (/\bjobs(?:![\w]+)?\s*\(\s*\*/.test(proj)) issues.push('unrestricted jobs(*) embed');
    for (const col of FORBIDDEN_COLUMNS) {
      if (new RegExp(`\\b${col}\\b`).test(proj)) issues.push(`buyer/platform column "${col}"`);
    }
    if (issues.length) violations.push({ rel, line, table, issues, proj: proj.slice(0, 90) });
  }
}

if (violations.length) {
  console.error('✘ GR2 inspector price-blindness violation(s):\n');
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  [${v.table}]`);
    for (const i of v.issues) console.error(`      → ${i}`);
    console.error(`      select: ${v.proj}\n`);
  }
  console.error(
    `${violations.length} violation(s). Inspector surfaces must use INSPECTOR_JOB_FIELDS\n` +
    `(lib/jobsProjection.ts) or an explicit allowlist — never select('*'), and never\n` +
    `name: ${FORBIDDEN_COLUMNS.join(', ')}.`,
  );
  process.exit(1);
}

console.log(
  `✓ GR2 inspector price-blindness: scanned ${scanned} inspector-surface file(s); ` +
  `no wildcard projections and no buyer/platform pricing columns.`,
);
