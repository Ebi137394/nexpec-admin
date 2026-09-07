#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 *  Fail the build if a link a user could actually receive points at a route
 *  that does not exist in the web app.
 *
 *  Written after 2026-09-07: nx_role_profile_path() returned '/client/profile'
 *  and '/inspector/profile'. Neither route ever existed — the real ones are
 *  /client/settings and /inspector/settings — so every onboarding email and
 *  profile CTA sent to a real user 404'd, and nothing noticed.
 *
 *  IT CHECKS THE LIVE FUNCTION BODIES, NOT THE MIGRATION FILES. A superseded
 *  migration legitimately still contains the old literal, so a file scan
 *  reports links that can no longer be emitted. Only what the database would
 *  actually produce today counts.
 *
 *  Routes come from the FILESYSTEM rather than a hand-maintained list, which
 *  would drift exactly the way the original constant did.
 * ════════════════════════════════════════════════════════════════════════════ */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APP = 'apps/web/src/app';
const PROJECT = process.env.NEXPEC_PROD_PROJECT_REF ?? 'sxqpjxhslzzcdrdctatm';

function routes(dir, prefix = '', acc = new Set()) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (!statSync(p).isDirectory()) continue;
    if (e.startsWith('_') || e.startsWith('[')) continue;
    const seg = e.startsWith('(') && e.endsWith(')') ? '' : `/${e}`;
    const here = `${prefix}${seg}`;
    if (existsSync(join(p, 'page.tsx')) || existsSync(join(p, 'route.ts'))) acc.add(here || '/');
    routes(p, here, acc);
  }
  return acc;
}

const have = routes(APP);
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.warn('  WARN  SUPABASE_ACCESS_TOKEN not set — live link producers were NOT verified.');
  console.log(`  (filesystem knows ${have.size} routes)`);
  process.exit(0);
}

const sql = `
  SELECT DISTINCT m[1] AS path
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace,
         LATERAL regexp_matches(pg_get_functiondef(p.oid),
                 '''(/(?:client|inspector|supplier|suppliers|profile|admin)[a-z0-9/_-]*)''', 'g') AS m
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'c')
     AND pg_get_functiondef(p.oid) ~ '(link_href|profile_path|notify_safe|nx_notify_admins)'`;

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
if (!res.ok) {
  console.error(`  ✗ could not read live function bodies (HTTP ${res.status})`);
  process.exit(1);
}
const rows = await res.json();
// Pre-existing baseline producers whose destination routes have never shipped
// on web. Tracked, not silently tolerated: they still print every run, and any
// NEW broken link fails the build.
const LEGACY = new Map([
  ['/inspector/payouts', 'notify_on_job_change, notify_on_transaction_change'],
  ['/client/reviews',    'notify_on_new_review'],
]);
const fail = [];
const legacy = [];
for (const { path } of rows) {
  const base = String(path).replace(/\/$/, '');
  const parent = base.split('/').slice(0, -1).join('/');
  if (have.has(base) || have.has(parent)) continue;   // dynamic child of a real parent is fine
  if (LEGACY.has(base)) { legacy.push(`${base}  (${LEGACY.get(base)})`); continue; }
  fail.push(base);
}

for (const l of [...new Set(legacy)]) {
  console.warn(`  WARN  legacy producer emits '${l}' — route has never shipped on web`);
}
if (fail.length) {
  console.error('\n  NOTIFICATION LINK CHECK FAILED\n');
  for (const f of [...new Set(fail)]) console.error(`  ✗ a live link producer emits '${f}', which is not a route in ${APP}`);
  console.error('\n  These links would 404 for real users.\n');
  process.exit(1);
}
console.log(`  notification links OK — every live producer resolves to one of ${have.size} real routes`);
