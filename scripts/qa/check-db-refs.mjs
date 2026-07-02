#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  check-db-refs.mjs  ·  NEXPEC schema-drift CI guardrail
 *
 *  WHY THIS EXISTS
 *  ───────────────
 *  Code-before-schema deploys are silent killers. The Admin Intercept & Markup
 *  ship referenced a new RPC (admin_present_quote) and view (rfq_client_offers_view)
 *  whose migration had not been applied — the web compiled and deployed fine, but
 *  the admin saw "0 quotes" and "Could not find the function … in the schema cache"
 *  at RUNTIME. A type-check can't catch it: the names are strings.
 *
 *  This guard makes it STRUCTURALLY IMPOSSIBLE to merge frontend code that calls a
 *  Postgres function (`.rpc('x')`) or reads a table/view (`.from('x')`) that NO
 *  migration in the repo creates. If the migration isn't in git, the build fails —
 *  forcing schema and code to ship together.
 *
 *  WHAT IT CHECKS
 *    • every `.rpc('name')` in app/, src/, apps/web/src  → must have a
 *      `CREATE [OR REPLACE] FUNCTION name(` in supabase/migrations
 *    • every `.from('name')` (Supabase query builder; NOT .storage.from, NOT
 *      Array/Object/Buffer.from)  → must have a CREATE TABLE / VIEW / MAT VIEW
 *  (Column-level drift is out of scope — too noisy from select strings — but the
 *   RPC + relation checks catch the high-impact misses.)
 *
 *  THE RATCHET (same model as check-outbox-routing)
 *    Genuinely-external names (Supabase built-ins, dashboard-managed relations)
 *    live in db-refs-allowlist.json. Anything referenced-but-undefined and NOT
 *    allowlisted fails the build.
 *
 *  USAGE
 *    node scripts/qa/check-db-refs.mjs                 # check (CI mode), exit 1 on drift
 *    node scripts/qa/check-db-refs.mjs --list          # print findings, exit 0
 *    node scripts/qa/check-db-refs.mjs --write-baseline # seed allowlist with current misses
 *
 *  Zero dependencies (pure Node ≥16).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const ALLOWLIST_PATH = join(__dirname, 'db-refs-allowlist.json');

const CODE_DIRS = ['app', 'src', join('apps', 'web', 'src')];
const MIGRATIONS_DIR = join('supabase', 'migrations');
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIR = new Set(['node_modules', '.next', 'dist', 'build', '.git', '.expo']);

// JS built-ins / known query-builder hosts whose `.from(` is NOT a Supabase table.
const FROM_HOST_EXCLUDE = /(?:storage|Array|Object|Buffer|Set|Map|Promise|Number|String|JSON|Date|Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array)$/;

const args = process.argv.slice(2);
const MODE = args.includes('--write-baseline') ? 'baseline' : args.includes('--list') ? 'list' : 'check';

function walk(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.has(extname(name))) out.push(full);
  }
  return out;
}
const SQL_EXT = new Set(['.sql']);

// ── 1. Collect references from frontend code ──────────────────────────────────
const refRpc = new Map();   // name → [file]
const refRel = new Map();
function addRef(map, name, file) {
  const arr = map.get(name) ?? [];
  arr.push(file);
  map.set(name, arr);
}

for (const d of CODE_DIRS) {
  for (const file of walk(join(REPO_ROOT, d), CODE_EXT)) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(REPO_ROOT.length + 1);

    // .rpc('name')
    const rpcRe = /\.rpc\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g;
    let m;
    while ((m = rpcRe.exec(src))) addRef(refRpc, m[1], rel);

    // .from('name') — skip JS built-ins + storage buckets
    const fromRe = /\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g;
    while ((m = fromRe.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 24), m.index);
      if (FROM_HOST_EXCLUDE.test(before.replace(/\([^)]*\)\s*$/, ''))) continue; // host.from(
      addRef(refRel, m[1], rel);
    }
  }
}

// ── 2. Collect definitions from migrations ────────────────────────────────────
const defFn = new Set();
const defRel = new Set();
for (const file of walk(join(REPO_ROOT, MIGRATIONS_DIR), SQL_EXT)) {
  const sql = readFileSync(file, 'utf8');
  let m;
  // Accept both bare (`public.name`, `name`) and pg_dump-quoted
  // (`"public"."name"`) forms on schema + name.
  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  while ((m = fnRe.exec(sql))) defFn.add(m[1].toLowerCase());
  const tblRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  while ((m = tblRe.exec(sql))) defRel.add(m[1].toLowerCase());
  const viewRe = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  while ((m = viewRe.exec(sql))) defRel.add(m[1].toLowerCase());
}

// ── 3. Allowlist (genuinely-external names) ───────────────────────────────────
const allow = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
  : { rpcs: [], relations: [] };
const allowRpc = new Set((allow.rpcs ?? []).map((s) => s.toLowerCase()));
const allowRel = new Set((allow.relations ?? []).map((s) => s.toLowerCase()));

// ── 4. Diff ───────────────────────────────────────────────────────────────────
const missRpc = [...refRpc.keys()].filter((n) => !defFn.has(n) && !allowRpc.has(n)).sort();
const missRel = [...refRel.keys()].filter((n) => !defRel.has(n) && !allowRel.has(n)).sort();

if (MODE === 'baseline') {
  const next = {
    _comment: 'check-db-refs allowlist — names referenced in code but defined outside supabase/migrations (Supabase built-ins, dashboard-managed relations). Shrink freely; grow consciously.',
    rpcs: [...new Set([...(allow.rpcs ?? []), ...missRpc])].sort(),
    relations: [...new Set([...(allow.relations ?? []), ...missRel])].sort(),
  };
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log(`seeded allowlist: ${next.rpcs.length} rpcs, ${next.relations.length} relations`);
  process.exit(0);
}

const fmt = (name, map) => `  • ${name}  ←  ${[...new Set(map.get(name))].slice(0, 3).join(', ')}`;

if (missRpc.length || missRel.length) {
  console.error('\n✖ check-db-refs: frontend references a DB object no migration creates.\n');
  if (missRpc.length) {
    console.error('  Undefined RPC functions (.rpc):');
    for (const n of missRpc) console.error(fmt(n, refRpc));
  }
  if (missRel.length) {
    console.error('  Undefined tables/views (.from):');
    for (const n of missRel) console.error(fmt(n, refRel));
  }
  console.error('\n  Fix: add the CREATE … migration under supabase/migrations, OR — if this is a');
  console.error('  Supabase built-in / dashboard-managed object — add it to scripts/qa/db-refs-allowlist.json.\n');
  if (MODE === 'list') process.exit(0);
  process.exit(1);
}

console.log(`ok: db-refs clean — ${refRpc.size} RPCs + ${refRel.size} relations all defined in migrations (or allowlisted).`);
