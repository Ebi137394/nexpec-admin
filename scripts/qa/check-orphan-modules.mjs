#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-orphan-modules.mjs — which modules are reachable from a
//  real route entry point, and which are not.
//
//  ── WHY ────────────────────────────────────────────────────────────────────
//  check-db-columns.mjs found 60 queries naming columns that do not exist. That
//  number is only actionable if you know which of them a user can actually
//  reach: a broken query on a live route is a defect; the same query in a
//  module nothing imports is dead weight, and fixing it would be inventing
//  correctness for code that never runs.
//
//  Rather than guess from directory names, this walks the import graph from the
//  actual entry points — every Expo Router screen under app/ and every Next
//  route under apps/web/src/app — and reports what is never reached.
//
//  ── RESOLUTION ─────────────────────────────────────────────────────────────
//  Handles relative imports, the `@/…` alias (repo root), and index files.
//  Type-only imports count as edges: a module can be reached for its types and
//  still ship no runtime query, so this over-reports reachability rather than
//  under-reports it. Erring that way matters — calling something orphaned when
//  it is not would justify ignoring a live defect.
//
//  RUN
//    node scripts/qa/check-orphan-modules.mjs
//    node scripts/qa/check-orphan-modules.mjs --check <file> [<file>…]
// ════════════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname, relative } from 'node:path';

const REPO = process.cwd();
const EXTS = ['.ts', '.tsx', '.mts', '.js', '.jsx'];
const SRC_DIRS = ['app', 'src', 'apps/web/src', 'packages/shared-core/src', 'lib', 'components'];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.includes(extname(p))) out.push(p);
  }
  return out;
}

const allFiles = new Set(SRC_DIRS.flatMap((d) => walk(d)).map((f) => resolve(REPO, f)));

/**
 * `@/` is NOT one alias — it is per-workspace, and getting this wrong silently
 * marks half the web app as dead code:
 *
 *   apps/web/tsconfig.json   "@/*" -> "./src/*"    (i.e. apps/web/src/*)
 *   root tsconfig.json       "@/*" -> "./*"        (i.e. repo root)
 *
 * A first cut of this script used the repo-root mapping everywhere and reported
 * apps/web/src/lib/data/reviews.ts as an orphan while three route pages import
 * it. Resolve against the owning workspace instead.
 */
function aliasRootFor(fromFile) {
  return relative(REPO, fromFile).startsWith('apps/web/')
    ? resolve(REPO, 'apps/web/src')
    : REPO;
}

/** Resolve a specifier to a file on disk, or null if it is external. */
function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = resolve(aliasRootFor(fromFile), spec.slice(2));
  else return null; // package import

  const candidates = [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => join(base, 'index' + e)),
  ];
  for (const c of candidates) if (allFiles.has(resolve(c))) return resolve(c);
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function edgesOf(file) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    const r = resolveSpec(spec, file);
    if (r) out.push(r);
  }
  return out;
}

// Entry points: every routable screen/page, plus config-level roots.
const entries = [...allFiles].filter((f) => {
  const rel = relative(REPO, f);
  if (rel.startsWith('apps/web/src/app/')) {
    return /\/(page|layout|route|template|error|not-found|middleware)\.[tj]sx?$/.test(rel);
  }
  if (rel === 'apps/web/src/middleware.ts') return true;
  if (rel.startsWith('app/')) return true;          // Expo Router: every file is a route
  return false;
});

const seen = new Set();
const stack = [...entries];
while (stack.length) {
  const f = stack.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  for (const n of edgesOf(f)) if (!seen.has(n)) stack.push(n);
}

const checkArgIdx = process.argv.indexOf('--check');
if (checkArgIdx !== -1) {
  const targets = process.argv.slice(checkArgIdx + 1);
  for (const t of targets) {
    const abs = resolve(REPO, t);
    const known = allFiles.has(abs);
    console.log(
      `${seen.has(abs) ? 'REACHABLE' : known ? 'ORPHAN   ' : 'NOT-FOUND'}  ${t}`,
    );
  }
  process.exit(0);
}

const orphans = [...allFiles].filter((f) => !seen.has(f)).sort();
console.log(`\nmodule reachability from ${entries.length} route entry points`);
console.log(`  modules total     : ${allFiles.size}`);
console.log(`  reachable         : ${seen.size}`);
console.log(`  never imported    : ${orphans.length}`);
console.log('\n  (orphans are reported, not failed — dead code is a cleanup item,');
console.log('   not a release blocker. Use --check <file> to test one path.)\n');
for (const o of orphans.slice(0, 60)) console.log('   ' + relative(REPO, o));
if (orphans.length > 60) console.log(`   … and ${orphans.length - 60} more`);
