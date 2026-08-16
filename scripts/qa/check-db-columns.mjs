#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-db-columns.mjs — COLUMN-level schema drift, against the
//  live database.
//
//  ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//  check-db-refs.mjs verifies that every `.from('x')` names a relation some
//  migration creates, and says so in its own header:
//
//      "(Column-level drift is out of scope — too noisy from select strings —
//        but the RPC + relation checks catch the high-impact misses.)"
//
//  That exclusion cost the release the entire disputes feature. Every dispute
//  surface on Web and Mobile read `.from('disputes')` — a real table, so
//  check-db-refs passed — with columns belonging to no table at all:
//
//      web    : opener_id, opener_role, category, body, resolution
//      mobile : filed_by, category, body, resolution
//      actual : raised_by, reason_category, reason, resolution_notes
//                                              (and on job_disputes, not disputes)
//
//  Three surfaces, permanently empty, for as long as the code has existed.
//  PostgREST answered with an error every single time and every call site
//  discarded it.
//
//  The "too noisy" objection is answered by checking against the LIVE schema
//  rather than by grepping migrations: information_schema is exact, so a
//  mismatch is a fact rather than a heuristic.
//
//  ── WHAT IT CHECKS ─────────────────────────────────────────────────────────
//  For each `.from('<relation>')` chain it collects
//    • column names inside the following `.select('…')` string literal
//    • column names passed to the filter builders (.eq/.neq/.gt/.gte/.lt/.lte/
//      .like/.ilike/.is/.in/.contains/.order)
//  and requires each to exist on that relation in information_schema.columns.
//
//  DELIBERATELY SKIPPED (not silently — counted and reported):
//    • `*` and embedded-resource syntax `alias:table!fk(cols)` — the inner
//      columns belong to the embedded relation, resolved by PostgREST, not here
//    • template literals and concatenated selects — not statically knowable
//    • relations absent from the database (check-db-refs owns that failure)
//
//  RUN
//    node scripts/qa/check-db-columns.mjs
//    node scripts/qa/check-db-columns.mjs --list     # report, exit 0
// ════════════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

//  Orphaned modules are excluded, never "accepted". See the allowlist's own
//  header: an entry means the module is unreachable from any route, proven with
//  check-orphan-modules.mjs — not that its query is correct.
const ALLOWLIST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'db-columns-allowlist.json');
const ALLOWED = new Set(
  existsSync(ALLOWLIST_PATH)
    ? (JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).orphanedModules ?? [])
    : [],
);

const ROOTS = ['apps/web/src', 'src', 'app', 'packages/shared-core/src'];
const EXTS = new Set(['.ts', '.tsx', '.mts', '.mjs']);
const listOnly = process.argv.includes('--list');

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: process.env.PGPORT ?? '54322',
  user: process.env.PGUSER ?? 'postgres',
  db: process.env.PGDATABASE ?? 'postgres',
  pass: process.env.PGPASSWORD ?? 'postgres',
};

/** relation -> Set(columns), from the live database. */
function loadSchema() {
  const r = spawnSync('psql', [
    '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.db, '-tAc',
    `select table_name || '\t' || column_name
       from information_schema.columns
      where table_schema = 'public'`,
  ], { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.pass } });

  if (r.status !== 0) {
    console.error('FATAL: could not read the live schema. Is the local stack up?');
    console.error(r.stderr?.trim());
    process.exit(1);
  }
  const map = new Map();
  for (const line of r.stdout.split('\n')) {
    const [t, c] = line.split('\t');
    if (!t || !c) continue;
    if (!map.has(t)) map.set(t, new Set());
    map.get(t).add(c);
  }
  return map;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

/**
 * Remove // line and block comments, preserving newlines so reported
 * positions stay meaningful. Quote-aware so a `//` inside a string literal
 * (a URL, say) is not mistaken for a comment.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += src[i]; i++; }
        if (i < n) { out += src[i]; i++; }
      }
      out += src[i] ?? ''; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

/** Columns named in a PostgREST select string, minus embedded resources. */
function columnsFromSelect(sel) {
  // Drop embedded resources wholesale: `jobs(title)`, `a:profiles!fk(role)`.
  const flat = sel.replace(/[A-Za-z0-9_]*\s*:?\s*[A-Za-z0-9_]+\s*!?[A-Za-z0-9_]*\s*\([^)]*\)/g, '');
  return flat
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s !== '*')
    // `alias:column` — the real column is on the right.
    .map((s) => (s.includes(':') ? s.split(':').pop().trim() : s))
    .filter((s) => /^[a-z_][a-z0-9_]*$/i.test(s));
}

const FILTERS =
  'eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|order|overlaps';

/**
 * The builder chain that follows `.from(…)`, ending at the statement's `;`.
 * Depth-aware so a `;` inside a nested arrow function or object literal does
 * not terminate early, and quote-aware so a `;` in a string does not either.
 */
function statementSlice(src, start) {
  let depth = 0;
  let i = start;
  const n = Math.min(src.length, start + 4000);
  while (i < n) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;          // chain's own expression closed
      depth--;
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
    } else if (c === ';' && depth === 0) break;
    i++;
  }
  return src.slice(start, i);
}

function main() {
  const schema = loadSchema();
  const files = ROOTS.flatMap((r) => walk(r));

  const findings = [];
  let excludedFiles = 0;
  let checkedChains = 0;
  let skippedDynamic = 0;
  let skippedUnknownRel = 0;

  for (const file of files) {
    if (ALLOWED.has(file)) { excludedFiles++; continue; }
    // Comments must go first. A file that DOCUMENTS a previous broken query —
    // "this used to read .from('disputes').eq('opener_id', …)" — would
    // otherwise be reported as still containing it, and the gate would keep
    // failing on the very note explaining the fix.
    const src = stripComments(readFileSync(file, 'utf8'));
    // Each .from('x') plus the chain that follows, up to the next .from(.
    const re = /\.from\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const rel = m[1];
      const start = m.index + m[0].length;

      // Bound the chain by BOTH limits, whichever comes first. Each alone is
      // wrong, and each wrongness invents defects:
      //
      //   • next `.from(` alone — a chain inside an IIFE runs on to the next
      //     query in the file. That reported `jobs.severity` in
      //     dashboardMetrics.ts, where `.eq('severity',…)` actually belongs to
      //     a safeCount(…, 'audit_events') call further down.
      //   • statement end alone — a Promise.all([...]) holds several queries in
      //     ONE statement, so every filter in the array got attributed to the
      //     first relation. That reported profiles.job_id, profiles.applicant_id
      //     and contracts.is_read, none of which anyone wrote.
      //
      // A gate that invents defects gets ignored, so this takes the tighter of
      // the two and reports only what it can actually attribute.
      const stmtEnd = start + statementSlice(src, start).length;
      const nextFrom = src.indexOf(".from(", start);
      const end = nextFrom === -1 ? stmtEnd : Math.min(stmtEnd, nextFrom);
      const chain = src.slice(start, end);

      const cols = schema.get(rel);
      if (!cols) { skippedUnknownRel++; continue; }   // check-db-refs owns this
      checkedChains++;

      const named = new Set();

      // .select('…') — string literal only.
      const selM = chain.match(/\.select\(\s*(['"])([\s\S]*?)\1/);
      if (selM) {
        for (const c of columnsFromSelect(selM[2])) named.add(c);
      } else if (/\.select\(\s*[`$]/.test(chain)) {
        skippedDynamic++;
      }

      // Filter builders.
      const fre = new RegExp(`\\.(?:${FILTERS})\\(\\s*['"]([A-Za-z0-9_]+)['"]`, 'g');
      let fm;
      while ((fm = fre.exec(chain))) named.add(fm[1]);

      for (const c of named) {
        if (!cols.has(c)) {
          findings.push({ file, rel, col: c });
        }
      }
    }
  }

  if (findings.length) {
    console.error('\nCOLUMN DRIFT — these columns do not exist on the relation queried:\n');
    for (const f of findings) {
      console.error(`  ${f.rel}.${f.col}`.padEnd(46) + f.file);
    }
    console.error(`\n  ${findings.length} mismatch(es).`);
    console.error('  A PostgREST query naming a missing column FAILS at runtime. If the');
    console.error('  call site discards the error, the surface renders empty forever —');
    console.error('  which is exactly how the disputes feature shipped broken.');
  }

  console.log(`\ndb column drift (live schema, ${schema.size} relations)`);
  console.log(`  files scanned          : ${files.length}`);
  console.log(`  .from() chains checked : ${checkedChains}`);
  console.log(`  skipped, dynamic select: ${skippedDynamic}`);
  console.log(`  skipped, unknown rel   : ${skippedUnknownRel}  (check-db-refs owns those)`);
  console.log(`  excluded, orphaned     : ${excludedFiles}  (unreachable from any route; see db-columns-allowlist.json)`);
  console.log(`  mismatches             : ${findings.length}`);

  process.exit(!listOnly && findings.length ? 1 : 0);
}

main();
