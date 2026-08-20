#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  check-assignment-client-invisibility.mjs
//
//  Executable guard for the client-invisibility half of Admin Direct Assignment.
//  Covers required tests 9, 10 and 15 statically — the parts that can be proven
//  without a database — and fails the build if any of them regress.
//
//  It asserts:
//    A. No provenance/override column exists on public.applications (a client
//       `select('*')` must be unable to reveal the route).
//    B. The provenance annex is admin-only: RLS enabled, an admin-gated SELECT
//       policy, and NO write policy of any kind.
//    C. No client-reachable source file references the annex or the admin RPCs.
//    D. No client-facing string anywhere says "admin assigned", "direct
//       assignment", "self-assigned", "verification overridden", etc.
//    E. The override facts are written ONLY to the annex.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const fail = [];
const pass = [];

// ── Read the migration surface ─────────────────────────────────────────────
const migDir = join(ROOT, 'supabase/migrations');
const migrations = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const migSql = migrations.map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');

// A. no provenance column on applications
const bannedCols = ['origin', 'assignment_origin', 'verification_overridden', 'self_assigned', 'is_direct_assignment', 'assigned_by'];
const appAlter = [...migSql.matchAll(/ALTER TABLE\s+(?:public\.)?"?applications"?([\s\S]*?);/g)]
  .map((m) => m[1]).join(' ');
const leaked = bannedCols.filter((c) => new RegExp(`ADD COLUMN[^;]*\\b${c}\\b`).test(appAlter));
if (leaked.length) fail.push(`A. provenance column(s) added to public.applications: ${leaked.join(', ')}`);
else pass.push('A. no provenance/override column on public.applications');

// B. annex is admin-only
const hasRls = /ALTER TABLE public\.application_assignment_origin ENABLE ROW LEVEL SECURITY/.test(migSql);
const selPol = /CREATE POLICY application_assignment_origin_admin_read[\s\S]{0,400}?nx_is_admin/.test(migSql);
const writePol = /CREATE POLICY[^;]*ON public\.application_assignment_origin[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/i.test(migSql);
if (!hasRls) fail.push('B. RLS not enabled on application_assignment_origin');
if (!selPol) fail.push('B. no admin-gated SELECT policy on application_assignment_origin');
if (writePol) fail.push('B. a write policy exists on application_assignment_origin');
if (hasRls && selPol && !writePol) pass.push('B. annex has RLS, admin-only SELECT, no write policy');

// ── Walk source ────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let e; try { e = readdirSync(dir); } catch { return out; }
  for (const n of e) {
    if (['node_modules', '.git', '.claude', '.expo', 'dist', 'build', '.next', 'migrations', 'migrations_archive'].includes(n)) continue;
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

const ADMIN_ONLY_PREFIXES = [
  'apps/web/src/lib/actions/inspectionAdmin.ts',
  'apps/web/src/components/admin/',
  'apps/web/src/app/admin/',
  'app/(admin)/',
  'app/(super-admin)/',
  'src/roles/admin/',
  'scripts/',
];
const ADMIN_SYMBOLS = [
  'application_assignment_origin',
  'admin_assign_inspector_directly',
  'admin_search_assignable_inspectors',
  'nx_admin_upsert_direct_application',
];

// C. admin symbols confined to admin surfaces
const misplaced = [];
for (const abs of walk(ROOT)) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  const src = readFileSync(abs, 'utf8');
  for (const sym of ADMIN_SYMBOLS) {
    if (!src.includes(sym)) continue;
    if (!ADMIN_ONLY_PREFIXES.some((p) => rel.startsWith(p))) misplaced.push(`${rel} → ${sym}`);
  }
}
if (misplaced.length) fail.push(`C. admin-only symbol reachable from a non-admin surface:\n      ${misplaced.join('\n      ')}`);
else pass.push('C. admin-only symbols confined to admin surfaces');

// D. no client-visible override wording
const BANNED_PHRASES = [
  'admin assigned', 'admin-assigned', 'direct assignment', 'directly assigned',
  'known inspector', 'verification overridden', 'verification override',
  'self assigned', 'self-assigned', 'platform administrator',
];
const CLIENT_SURFACES = ['app/(client)/', 'apps/web/src/app/client/', 'src/screens/client/', 'src/roles/client/'];
const wording = [];
for (const abs of walk(ROOT)) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  if (!CLIENT_SURFACES.some((p) => rel.startsWith(p))) continue;
  const src = readFileSync(abs, 'utf8').toLowerCase();
  for (const ph of BANNED_PHRASES) {
    // Word-boundary match. A plain substring test fires on innocuous strings —
    // "Unknown Inspector" contains "known inspector" — which would train people
    // to ignore this guard.
    const re = new RegExp(`(^|[^a-z0-9-])${ph.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9-]|$)`);
    if (re.test(src)) wording.push(`${rel} → "${ph}"`);
  }
}
if (wording.length) fail.push(`D. client-visible override wording:\n      ${wording.join('\n      ')}`);
else pass.push('D. no override wording on any client surface');

// E. override facts written only to the annex
const assignFn = migSql.slice(migSql.indexOf('CREATE OR REPLACE FUNCTION public.admin_assign_inspector_directly'));
const body = assignFn.slice(0, assignFn.indexOf('END $$;'));
const writesElsewhere = /INSERT INTO public\.(?!application_assignment_origin)/.test(body)
  || /UPDATE public\.applications[\s\S]{0,200}(verification|self_assigned|origin)/.test(body);
if (writesElsewhere) fail.push('E. override facts written outside the annex');
else pass.push('E. override facts written only to the admin-only annex');

// ── Report ─────────────────────────────────────────────────────────────────
for (const p of pass) console.log(`  ok   ${p}`);
if (fail.length) {
  console.error('\n✘ Admin Direct Assignment client-invisibility violation(s):\n');
  for (const f of fail) console.error(`  ✘ ${f}`);
  process.exit(1);
}
console.log(`\n✓ assignment client-invisibility: ${pass.length}/5 structural guarantees hold.`);
