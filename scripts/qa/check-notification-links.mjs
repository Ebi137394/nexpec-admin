#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 *  Fail the build if a link a user could actually receive points at a route
 *  that does not exist on the platform they will open it on.
 *
 *  Written after 2026-09-07: nx_role_profile_path() returned '/client/profile'
 *  and '/inspector/profile'. Neither route ever existed — the real ones are
 *  /client/settings and /inspector/settings — so every onboarding email and
 *  profile CTA sent to a real user 404'd, and nothing noticed.
 *
 *  EXTENDED 2026-09-07 (second incident, same day). The web-only check above
 *  could not see the next bug: notify_on_new_message wrote
 *  '/client/messages/<id>' to EVERY recipient. '/client/messages/[id]' is a
 *  real web route, so the guard passed — yet 16 inspectors and 1 supplier were
 *  sent to a page middleware refuses them, and every single recipient got a
 *  hard 404 on mobile, where only 'app/messages/[id].tsx' exists.
 *
 *  So a recipient-facing link is now checked against BOTH route tables:
 *    web    apps/web/src/app        (Next.js App Router)
 *    mobile app/                    (expo-router)
 *  A link that resolves on only one of them is a defect, because the same
 *  link_href is delivered to phone and browser alike.
 *
 *  '/admin/**' is exempt from the mobile check by design: the admin console is
 *  web-only and admin notifications are only ever sent to admins.
 *
 *  IT CHECKS THE LIVE FUNCTION BODIES, NOT THE MIGRATION FILES. A superseded
 *  migration legitimately still contains the old literal, so a file scan
 *  reports links that can no longer be emitted. Only what the database would
 *  actually produce today counts.
 *
 *  Routes come from the FILESYSTEM rather than a hand-maintained list, which
 *  would drift exactly the way the original constant did.
 *
 *  THIRD EXTENSION: the producer filter originally matched only notify_safe and
 *  nx_notify, so client_sign_job_contract — which emits through
 *  create_system_notification — was never scanned at all, and its
 *  '/contracts/job/<id>' link went unnoticed. A guard that inspects only some
 *  producers gives false assurance about all of them.
 * ════════════════════════════════════════════════════════════════════════════ */
import { readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const APP = 'apps/web/src/app';
const MOBILE = 'app';
const PROJECT = process.env.NEXPEC_PROD_PROJECT_REF ?? 'sxqpjxhslzzcdrdctatm';

/** Next.js App Router. Two DIFFERENT facts are collected, because a producer
 *  literal means two different things depending on its trailing slash:
 *
 *    exact          this path is itself a page      ('/contracts')
 *    dynamicParent  this path has an [id] child     ('/contracts/' || id)
 *
 *  Conflating them is what made an earlier version of this guard both miss
 *  '/client/messages/' (no such route, but '/client' existed) and later flag
 *  '/client/contracts/job/' as broken (no page.tsx of its own, but its
 *  '[id]/page.tsx' child resolves perfectly). '(groups)' add no URL segment. */
function webRoutes(dir, prefix = '', exact = new Set(), dynamicParent = new Set()) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (!statSync(p).isDirectory()) continue;
    if (e.startsWith('_')) continue;
    if (e.startsWith('[')) {
      // A dynamic segment: its parent can serve `<parent>/<anything>`.
      if (existsSync(join(p, 'page.tsx')) || existsSync(join(p, 'route.ts'))) {
        dynamicParent.add(prefix || '/');
      }
      continue;
    }
    const seg = e.startsWith('(') && e.endsWith(')') ? '' : `/${e}`;
    const here = `${prefix}${seg}`;
    if (existsSync(join(p, 'page.tsx')) || existsSync(join(p, 'route.ts'))) exact.add(here || '/');
    webRoutes(p, here, exact, dynamicParent);
  }
  return { exact, dynamicParent };
}

/** expo-router, same two facts. '_layout' is not a route and 'index'
 *  collapses to its parent. */
function mobileRoutes(dir, prefix = '', exact = new Set(), dynamicParent = new Set()) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e.startsWith('_')) continue;
      if (e.startsWith('[')) { dynamicParent.add(prefix || '/'); continue; }
      const seg = e.startsWith('(') && e.endsWith(')') ? '' : `/${e}`;
      mobileRoutes(p, `${prefix}${seg}`, exact, dynamicParent);
      continue;
    }
    if (!e.endsWith('.tsx') && !e.endsWith('.ts')) continue;
    const base = e.replace(/\.(tsx|ts)$/, '');
    if (base === '_layout' || base.startsWith('+')) continue;
    if (base.startsWith('[')) { dynamicParent.add(prefix || '/'); continue; }
    const seg = base === 'index' ? '' : `/${base}`;
    exact.add(`${prefix}${seg}` || '/');
  }
  return { exact, dynamicParent };
}

const web = webRoutes(APP);
const mobile = existsSync(MOBILE)
  ? mobileRoutes(MOBILE)
  : { exact: new Set(), dynamicParent: new Set() };

/* Capture the two characters BEFORE each path literal so concatenation tails
 * can be discarded. In
 *     '/client/jobs/' || NEW.job_id::text || '/applications'
 * the trailing '/applications' is not a link — it is the tail of one. Reading
 * it as a root path made this guard demand a '/applications' route that no
 * producer has ever emitted. A literal preceded by '||' is always a
 * continuation of the expression to its left, never the start of a path. */
const SQL = `
  SELECT DISTINCT m[1] AS lead, m[2] AS path
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace,
         LATERAL regexp_matches(pg_get_functiondef(p.oid),
                 '(..)\\s*''(/[a-z0-9/_-]+)''', 'g') AS m
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'c')
     AND pg_get_functiondef(p.oid) ~
         '(link_href|profile_path|notify_safe|nx_notify|create_system_notification|notify_admins)'`;

/** Read live function bodies. Prefer the Management API token; fall back to the
 *  Supabase CLI, which is how a developer is normally authenticated locally.
 *  Without one of these the guard cannot see Production and says so loudly
 *  rather than passing silently. */
async function livePaths() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: SQL }),
    });
    if (!res.ok) throw new Error(`Management API HTTP ${res.status}`);
    return (await res.json()).filter((r) => r.lead?.trim() !== '||').map((r) => r.path);
  }

  const dir = mkdtempSync(join(tmpdir(), 'nxlinks-'));
  try {
    mkdtempSync; // no-op, keeps intent clear
    writeFileSync(join(dir, 'supabase-config-marker'), '');
    const sub = join(dir, 'supabase');
    execFileSync('mkdir', ['-p', sub]);
    writeFileSync(join(sub, 'config.toml'), 'project_id = "nexpec-link-guard"\n');
    execFileSync('supabase', ['link', '--project-ref', PROJECT], { cwd: dir, stdio: 'ignore' });
    const out = execFileSync('supabase', ['db', 'query', '--linked'], {
      cwd: dir,
      input: SQL,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    return (parsed.rows ?? []).filter((r) => r.lead?.trim() !== '||').map((r) => r.path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let paths;
try {
  paths = await livePaths();
} catch (err) {
  console.error(`  ✗ could not read live function bodies: ${err.message}`);
  console.error('    Set SUPABASE_ACCESS_TOKEN or run `supabase login`.');
  process.exit(1);
}

/** Producers whose destination has never shipped on WEB. Tracked, not silently
 *  tolerated: each still prints every run, and any NEW one fails the build.
 *  Empty today — the two former entries (/inspector/payouts, /client/reviews)
 *  have since shipped real page.tsx files. */
const LEGACY = new Map([]);

/** Paths that resolve on web but have no expo-router equivalent, so they 404 in
 *  the mobile notification list. Closing these needs NEW MOBILE SCREENS, which
 *  ship on the next mobile release — they cannot be fixed from the web deploy
 *  or the database, so failing the build on them would block work that is
 *  already correct. They are listed here explicitly, printed on every run, and
 *  any path NOT in this list fails the build.
 *
 *  Measured delivered volume on Production at 2026-09-07 (rows / people):
 *    /client/jobs           21 / 4      /inspector/compliance   5 / 2
 *    /inspector/jobs        15 / 2      /client/contracts       6 / 2
 *    /contact                9 / 3      /inspector/contracts    4 / 2
 *  See the final report's "next mobile release" section. */
const MOBILE_GAP = new Set([
  '/client/jobs',
  '/inspector/jobs',
  '/inspector/payouts',
  '/inspector/reviews',
  '/inspector/compliance',
  '/inspector/assignments',
  '/client/reviews',
  '/client/contracts',
  '/inspector/contracts',
  '/suppliers/profile',
  '/contact',
  // Added by this change: /talent/submissions now resolves on web (it used to
  // 404 on BOTH platforms), but expo-router still has no talent screen.
  '/talent/submissions',
  // Partner-agency functionality is deliberately WEB-ONLY for the pilot: there
  // is no partner surface in the published mobile binary and none can be added
  // without a store release. A partner tapping this notification on their phone
  // gets nothing today and must open it on the web — a real limitation, tracked
  // here rather than hidden by pointing the link somewhere less correct.
  '/partner/opportunities',
  // Web has /client/contracts/job/[id] and /inspector/contracts/job/[id];
  // mobile has only the un-prefixed app/contracts/job/[id].tsx, so these two
  // role-scoped forms 404 on the phone.
  '/client/contracts/job',
  '/inspector/contracts/job',
]);

/** Recipient-facing paths that legitimately resolve on web only. */
const WEB_ONLY_OK = (p) => p === '/admin' || p.startsWith('/admin/');

/** A producer literal that ENDS IN '/' is a prefix with an id concatenated on
 *  ("'/messages/' || conv.id"), so the thing that must exist is the parent
 *  route with a dynamic child. A literal without a trailing slash must itself
 *  be a route.
 *
 *  Matching a bare parent for BOTH shapes — the original heuristic — is what
 *  let '/client/messages/' pass: mobile has an unrelated '/client', so the
 *  parent test succeeded and the missing '/client/messages' went unnoticed. */
/** `isPrefix` is true when the producer literal ended in '/', i.e. an id is
 *  concatenated onto it. Then the requirement is a dynamic child, not a page
 *  of its own. */
const resolves = (routes, base, isPrefix) =>
  isPrefix ? routes.dynamicParent.has(base) || routes.exact.has(base) : routes.exact.has(base);

const failWeb = [];
const failMobile = [];
const legacy = [];
const mobileGap = [];

for (const raw of paths) {
  const literal = String(raw);
  if (!literal.startsWith('/')) continue;
  // Both shapes reduce to the same requirement: this exact route must exist.
  // For a prefix the trailing slash is simply dropped, because the dynamic
  // child is registered against its parent by both route builders.
  const isPrefix = literal.endsWith('/');
  const base = literal.replace(/\/$/, '');
  if (base === '') continue;

  if (!resolves(web, base, isPrefix)) {
    if (LEGACY.has(base)) legacy.push(`${base}  (${LEGACY.get(base)})`);
    else failWeb.push(base);
    continue;
  }
  if (!WEB_ONLY_OK(base) && !resolves(mobile, base, isPrefix)) {
    if (MOBILE_GAP.has(base)) mobileGap.push(base);
    else failMobile.push(base);
  }
}

console.log(
  `  routes known: web ${web.exact.size} pages + ${web.dynamicParent.size} dynamic parents, ` +
    `mobile ${mobile.exact.size} + ${mobile.dynamicParent.size}`,
);

for (const l of [...new Set(legacy)]) {
  console.warn(`  WARN  legacy producer emits '${l}' — route has never shipped on web`);
}
for (const m of [...new Set(mobileGap)].sort()) {
  console.warn(`  WARN  '${m}' resolves on web but not on mobile — needs a screen in the next mobile release`);
}

if (failWeb.length || failMobile.length) {
  console.error('\n  NOTIFICATION LINK CHECK FAILED\n');
  for (const f of [...new Set(failWeb)])
    console.error(`  ✗ a live producer emits '${f}', which is not a route in ${APP}`);
  for (const f of [...new Set(failMobile)])
    console.error(`  ✗ a live producer emits '${f}', which resolves on web but NOT in mobile ${MOBILE}/ — it 404s on the phone`);
  console.error('\n  These links would fail for real users.\n');
  process.exit(1);
}

console.log(
  mobileGap.length
    ? `  notification links OK on web — ${new Set(mobileGap).size} tracked mobile gap(s) above, no NEW breakage`
    : '  notification links OK — every live producer resolves on every platform that receives it',
);
