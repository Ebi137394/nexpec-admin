#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-role-routing.mjs — every role the database admits must
//  have somewhere to go.
//
//  ── THE DEFECT THIS GUARDS ─────────────────────────────────────────────────
//  profiles.role admits 'senior'. The Web middleware did not:
//
//      PORTAL_ROLES[INSPECTOR_PREFIX] = ['inspector', 'admin', 'super_admin']
//
//  and the post-sign-in switch had no 'senior' branch, so it fell through to
//  `dest = '/'`. A Senior Inspector therefore signed in, was shown the public
//  MARKETING HOMEPAGE, and was redirected off every /inspector route —
//  including /inspector/reviews, the review inbox built specifically for them.
//  The role had no reachable surface on Web at all.
//
//  It was invisible to every existing check because inspector/layout.tsx DOES
//  list 'senior' in its ALLOWED_ROLES, and carries a comment stating the bug had
//  been fixed. Reading the layout, it looks handled. Middleware runs first, so
//  the layout's allowance could never be reached.
//
//  ── WHAT IT CHECKS ─────────────────────────────────────────────────────────
//  The role list comes from the LIVE profiles.role CHECK constraint, not from a
//  hand-maintained copy — a role added by migration is picked up automatically,
//  which is the only way this stays true.
//
//  For every role the database admits:
//    1. at least one portal prefix in PORTAL_ROLES admits it, AND
//    2. the post-sign-in switch gives it a destination other than the
//       marketing root.
//
//  Failing (2) is not cosmetic: landing a signed-in professional on the public
//  homepage is indistinguishable from being signed out.
//
//  RUN
//    node scripts/qa/check-role-routing.mjs
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MIDDLEWARE = 'apps/web/src/middleware.ts';

//  Middleware is NOT the only thing that decides where a signed-in user lands.
//  Two more functions do, and they are the ones the sign-in form and the
//  OAuth/magic-link callback actually use:
//
//    lib/auth/actions.ts        destinationForUser()  — the email+password form
//    app/auth/callback/route.ts pathForRole()         — Google/Apple/magic link
//
//  This gate originally read only MIDDLEWARE, so it reported "all roles have a
//  portal and a destination" while a Senior Inspector who signed in was still
//  being dropped on the marketing homepage: middleware had been fixed, these
//  two had not. A gate that green-lights a live defect is worse than no gate,
//  so all three are now required to cover every role the database admits.
//
//  This is a recurring class, not a one-off: pathForRole() carries its own
//  #QA note recording that 'supplier' drifted out of it the same way.
const DEST_SOURCES = [
  ['apps/web/src/lib/auth/actions.ts', 'destinationForUser', /normalisedRole === '([a-z_]+)'/g],
  ['apps/web/src/app/auth/callback/route.ts', 'pathForRole', /r === '([a-z_]+)'/g],
];

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: process.env.PGPORT ?? '54322',
  user: process.env.PGUSER ?? 'postgres',
  db: process.env.PGDATABASE ?? 'postgres',
  pass: process.env.PGPASSWORD ?? 'postgres',
};

/** The roles the database itself admits, straight from the CHECK constraint. */
function rolesFromDatabase() {
  const r = spawnSync('psql', [
    '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.db, '-tAc',
    `select pg_get_constraintdef(oid)
       from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%role%'`,
  ], { encoding: 'utf8', env: { ...process.env, PGPASSWORD: PG.pass } });

  if (r.status !== 0) {
    console.error('FATAL: could not read profiles.role from the live schema. Is the local stack up?');
    console.error(r.stderr?.trim());
    process.exit(1);
  }
  const roles = new Set();
  for (const m of r.stdout.matchAll(/'([a-z_]+)'::text/g)) roles.add(m[1]);
  return [...roles].sort();
}

const src = readFileSync(MIDDLEWARE, 'utf8');

// Roles named anywhere inside the PORTAL_ROLES object literal.
const portalBlock = src.match(/const PORTAL_ROLES[\s\S]*?\n\};/);
if (!portalBlock) {
  console.error(`FATAL: could not locate PORTAL_ROLES in ${MIDDLEWARE}.`);
  process.exit(1);
}
// Comments must be stripped first. The fix for the 'senior' defect added an
// explanatory comment that NAMES the role, and a naive match then "found"
// 'senior' in the prose — so reverting the actual code still looked green.
// A gate satisfied by a comment about the bug is worse than no gate.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const portalRoles = new Set(
  [...stripComments(portalBlock[0]).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
);

// Roles given a post-sign-in destination. The switch lives between the
// "Role-aware post-sign-in destination" comment and the redirect that follows.
const destBlock = src.match(/Role-aware post-sign-in destination[\s\S]*?const url = request\.nextUrl\.clone\(\)/);
if (!destBlock) {
  console.error(`FATAL: could not locate the post-sign-in destination switch in ${MIDDLEWARE}.`);
  process.exit(1);
}
const destRoles = new Set(
  [...stripComments(destBlock[0]).matchAll(/normalisedRole === '([a-z_]+)'/g)].map((m) => m[1]),
);

//  The same requirement, applied to the two real destination resolvers.
const destSourceRoles = new Map();
for (const [file, fnName, re] of DEST_SOURCES) {
  let body;
  try {
    body = readFileSync(file, 'utf8');
  } catch {
    console.error(`FATAL: ${file} is missing — it resolves a post-sign-in destination.`);
    process.exit(1);
  }
  //  Take the function body only, so an unrelated role string elsewhere in the
  //  file cannot make a role look handled.
  const fn = body.match(new RegExp(`function ${fnName}[\\s\\S]*?\\n}`));
  if (!fn) {
    console.error(`FATAL: could not locate ${fnName}() in ${file}.`);
    process.exit(1);
  }
  destSourceRoles.set(
    `${fnName} (${file})`,
    new Set([...stripComments(fn[0]).matchAll(re)].map((m) => m[1])),
  );
}

const dbRoles = rolesFromDatabase();
const failures = [];

for (const role of dbRoles) {
  if (!portalRoles.has(role)) {
    failures.push(`${role}: no portal in PORTAL_ROLES admits it — every portal route will redirect it away`);
  }
  if (!destRoles.has(role)) {
    failures.push(`${role}: no post-sign-in destination — falls through to the marketing root '/', which is indistinguishable from being signed out`);
  }
  for (const [label, roles] of destSourceRoles) {
    if (!roles.has(role)) {
      failures.push(`${role}: ${label} has no branch for it — the role lands on the marketing root '/' after signing in`);
    }
  }
}

console.log('\nrole routing (roles read from the live profiles.role CHECK)');
console.log(`  roles in database   : ${dbRoles.join(', ')}`);
console.log(`  admitted by a portal: ${[...portalRoles].sort().join(', ')}`);
console.log(`  given a destination : ${[...destRoles].sort().join(', ')}`);
for (const [label, roles] of destSourceRoles) {
  console.log(`  ${label.split(' ')[0].padEnd(20)}: ${[...roles].sort().join(', ')}`);
}

if (failures.length) {
  console.error('\nUNROUTED ROLES:\n');
  for (const f of failures) console.error('  • ' + f);
  console.error('');
  process.exit(1);
}

console.log(`\n  ok: all ${dbRoles.length} roles have a portal and a destination.\n`);
