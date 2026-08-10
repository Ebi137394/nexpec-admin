#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  check-admin-route-reachability.mjs
//
//  A screen nobody can navigate to is not a feature.
//
//  This guard enforces three things about the admin web surface:
//
//    1. BROKEN NAV LINK — the sidebar links to a route with no page.tsx.
//       A 404 in the primary admin navigation.
//    2. UNDEFINED ICON — the sidebar references an icon identifier it never
//       imported. This crashes the whole admin shell at render, taking every
//       admin route down with it, and a full `tsc` is too slow here to be the
//       only thing standing between that and production. (Caught exactly this:
//       a Report Review nav entry using ClipboardCheck without the import.)
//    3. ORPHAN ROUTE — an admin page exists with no way to reach it from the
//       sidebar. Reported as INFO, not failure: detail routes ([id], /new) and
//       sub-pages are legitimately reached from a parent screen. It exists to
//       surface work that was built and then left unreachable, which is the
//       single most common way capability gets lost in a codebase this size.
//
//      node scripts/qa/check-admin-route-reachability.mjs
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ADMIN_APP = join(ROOT, 'apps/web/src/app/admin');
const SIDEBAR = join(ROOT, 'apps/web/src/components/admin/Sidebar.tsx');

if (!existsSync(ADMIN_APP) || !existsSync(SIDEBAR)) {
  console.log('✓ admin route reachability: admin surface not present, nothing to check.');
  process.exit(0);
}

const sidebar = readFileSync(SIDEBAR, 'utf8');

// ── Imported identifiers (so we can spot an icon that was never imported) ──
const imported = new Set();
for (const m of sidebar.matchAll(/import\s*\{([\s\S]*?)\}\s*from/g)) {
  for (const part of m[1].split(',')) {
    const id = part.replace(/\btype\b/, '').trim().split(/\s+as\s+/).pop();
    if (id) imported.add(id.trim());
  }
}
// Locally declared things count as available too.
for (const m of sidebar.matchAll(/(?:const|function|class)\s+(\w+)/g)) imported.add(m[1]);

// ── Nav entries ────────────────────────────────────────────────────────────
const navEntries = [...sidebar.matchAll(/\{\s*label:\s*'([^']+)'\s*,\s*href:\s*'([^']+)'\s*,\s*icon:\s*(\w+)/g)]
  .map((m) => ({ label: m[1], href: m[2], icon: m[3] }));

// ── Every admin page route ─────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (e === 'page.tsx') out.push(p);
  }
  return out;
}
const routes = walk(ADMIN_APP).map((p) => {
  const rel = relative(join(ROOT, 'apps/web/src/app'), p).split('\\').join('/');
  return '/' + rel.replace(/\/page\.tsx$/, '');
});
const routeSet = new Set(routes);

const failures = [];
const info = [];

// 1 + 2 — nav entries must resolve, and their icons must exist
for (const e of navEntries) {
  if (!e.href.startsWith('/admin')) continue;           // links out of the admin app
  if (!routeSet.has(e.href)) {
    failures.push(`BROKEN NAV LINK   "${e.label}" → ${e.href} has no page.tsx`);
  }
  if (!imported.has(e.icon)) {
    failures.push(`UNDEFINED ICON    "${e.label}" uses <${e.icon}> which Sidebar.tsx never imports (crashes the admin shell)`);
  }
}

// 3 — orphan routes (informational)
const navHrefs = new Set(navEntries.map((e) => e.href));
for (const r of routes) {
  if (navHrefs.has(r)) continue;
  if (/\[[^\]]+\]/.test(r)) continue;                   // dynamic detail route
  // a sub-route whose parent IS in the nav is reachable through it
  const parents = r.split('/').slice(0, -1);
  let reachable = false;
  for (let i = parents.length; i > 1; i--) {
    if (navHrefs.has(parents.slice(0, i).join('/'))) { reachable = true; break; }
  }
  if (!reachable) info.push(r);
}

if (failures.length) {
  console.error('✘ admin route reachability:\n');
  for (const f of failures) console.error('  ' + f);
  console.error(`\n${failures.length} failure(s). The admin sidebar is the only way most of these`);
  console.error('screens are reached; a bad entry is either a 404 or a full shell crash.');
  process.exit(1);
}

console.log(
  `✓ admin route reachability: ${navEntries.length} nav entries all resolve to a page ` +
  `and every icon is imported (${routes.length} admin routes total).`,
);
if (info.length) {
  console.log(`  note: ${info.length} route(s) have no sidebar path — reachable only via a direct link:`);
  for (const r of info.slice(0, 12)) console.log('      ' + r);
  if (info.length > 12) console.log(`      … and ${info.length - 12} more`);
}
