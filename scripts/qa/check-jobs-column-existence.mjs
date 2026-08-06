#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  check-jobs-column-existence.mjs
//
//  Fails the build if any application query names a column that does not exist
//  on public.jobs (and therefore not on jobs_secure_view, which is SELECT j.*).
//
//  WHY THIS EXISTS
//  PostgREST rejects the ENTIRE select with 42703 when a single column is
//  bogus. The failure is silent in the UI: the screen renders empty, or a money
//  figure renders as $0. Five such queries had been live for a long time —
//  a client invoice route that 404'd, an admin payouts queue that showed no
//  rows, an inspector wallet statement that was always blank, an admin
//  moderation queue that rendered nothing, and a client dashboard whose
//  "Total Invested" was permanently $0.
//
//  The authoritative column list is parsed from the migrations, so this guard
//  cannot drift from the schema.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// ── 1. Authoritative public.jobs column set, parsed from the migrations ────
function jobsColumns() {
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const cols = new Set();

  const baseline = readFileSync(join(dir, files[0]), 'utf8');
  const start = baseline.indexOf('CREATE TABLE IF NOT EXISTS "public"."jobs" (');
  if (start === -1) throw new Error('could not locate the jobs CREATE TABLE in the baseline');
  const ddl = baseline.slice(start, baseline.indexOf('\n);', start));
  for (const m of ddl.matchAll(/^\s+"(\w+)"\s+/gm)) cols.add(m[1]);

  // Every ALTER TABLE ... jobs ... ADD COLUMN, across all migrations.
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const alter of sql.matchAll(
      /ALTER TABLE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?jobs"?\b([\s\S]*?);/gi,
    )) {
      for (const add of alter[1].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/gi)) {
        cols.add(add[1]);
      }
    }
  }
  return cols;
}

// ── 2. Walk the application source ────────────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (['node_modules', '.git', '.expo', 'dist', 'build', '.next', 'supabase', 'scripts'].includes(e)) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * Blank out // and block comments so prose about a column is never mistaken for
 * a query. Replaces each comment with an EQUAL-LENGTH run of spaces (newlines
 * preserved) so byte offsets — and therefore reported line numbers — stay
 * identical to the original file.
 */
const stripComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

// PostgREST modifiers and JS/TS tokens that appear inside a select string but
// are not column names.
const NOT_A_COLUMN = new Set([
  'count', 'exact', 'head', 'ascending', 'foreignTable', 'referencedTable',
  'true', 'false', 'null', 'undefined', 'inner', 'left',
]);

const cols = jobsColumns();
const violations = [];
let scanned = 0;

for (const abs of walk(ROOT)) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  const raw = readFileSync(abs, 'utf8');
  if (!raw.includes(".from('jobs")) continue;
  scanned++;
  const src = stripComments(raw);

  const froms = [...src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)];
  for (let i = 0; i < froms.length; i++) {
    const table = froms[i][1];
    if (table !== 'jobs' && table !== 'jobs_secure_view') continue;
    const start = froms[i].index;
    // A Supabase query is ONE statement. Bound the segment at the first `;`
    // after the .from(, falling back to the next .from(. Using only the next
    // .from() over-reached: dashboardMetrics.ts passes a builder around, so an
    // unrelated `.eq('severity', …)` was wrongly attributed to the jobs query.
    const semi = src.indexOf(';', start);
    const nextFrom = i + 1 < froms.length ? froms[i + 1].index : src.length;
    const end = Math.min(semi === -1 ? src.length : semi, nextFrom);
    const seg = src.slice(start, end);
    const line = src.slice(0, start).split('\n').length;

    const named = new Set();

    // select list — skip embeds (`alias:other_table(...)`) which resolve elsewhere
    const sel = seg.match(/\.select\(\s*([`'"])([\s\S]*?)\1/);
    if (sel) {
      let proj = sel[2];
      if (proj.includes('${')) continue;            // variable projection (allowlist constant)
      proj = proj.replace(/[\w]+\s*(?:!\w+)?\s*\([^)]*\)/g, ' '); // drop embeds
      for (const c of proj.split(',')) {
        const t = c.trim().replace(/^\w+\s*:\s*/, '');
        if (t && t !== '*' && /^[a-z_][a-z0-9_]*$/i.test(t)) named.add(t);
      }
    }
    // filter / order columns
    for (const m of seg.matchAll(/\.(eq|neq|in|is|gt|gte|lt|lte|like|ilike|contains|order)\(\s*['"](\w+)['"]/g)) {
      named.add(m[2]);
    }

    for (const c of named) {
      if (NOT_A_COLUMN.has(c)) continue;
      if (!cols.has(c)) violations.push({ rel, line, table, col: c });
    }
  }
}

if (violations.length) {
  console.error('✘ Query names a column that does not exist on public.jobs:\n');
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  [${v.table}]  → "${v.col}"`);
  }
  console.error(
    `\n${violations.length} violation(s). PostgREST 42703s the WHOLE select when any\n` +
    `column is bogus, so these render as an empty screen or a $0 figure rather than\n` +
    `an error. Use a real column: public.jobs has ${cols.size}.`,
  );
  process.exit(1);
}

console.log(
  `✓ jobs column existence: ${scanned} file(s) query jobs/jobs_secure_view; ` +
  `every named column exists on public.jobs (${cols.size} columns).`,
);
