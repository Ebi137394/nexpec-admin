#!/usr/bin/env node
/**
 * scripts/qa/check-app-route-default-exports.mjs
 *
 * Expo Router treats EVERY file under app/ as a route. A route file without a
 * default React-component export triggers, at runtime in dev:
 *
 *   Route "./(inspector)/reviews/roundState.ts" is missing the required default
 *   export. Ensure a React component is exported as default.
 *
 * Verified against expo-router 4.0.22 (getRoutesCore.js): the check is
 * NODE_ENV === 'development' and a leading underscore does NOT exclude a file —
 * only `_layout` is special. So helper modules dropped into app/ (data plumbing,
 * shared constants, orphan components) each warn, and the mobile console fills
 * with noise that hides real warnings.
 *
 * This gate keeps helpers OUT of the route tree. Every .ts/.tsx under app/ must
 * either be a recognised special file or export a default. Helpers belong in
 * src/.
 *
 * RUN: node scripts/qa/check-app-route-default-exports.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'app';
const EXT = /\.(ts|tsx)$/;

// Files Expo Router treats specially — a default export is not required.
const SPECIAL = /(^|\/)(_layout|\+not-found|\+html|\+native-intent)\.(ts|tsx)$/;

function walk(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (EXT.test(e) && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  if (SPECIAL.test(file)) continue;
  const src = readFileSync(file, 'utf8');
  // `export default …` or `export { X as default }` or `export { default } …`
  const hasDefault =
    /(^|\n)\s*export\s+default\b/.test(src) ||
    /export\s*\{[^}]*\bdefault\b[^}]*\}/.test(src) ||
    /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(src);
  if (!hasDefault) offenders.push(file);
}

console.log(`check-app-route-default-exports: scanned ${walk(ROOT).length} files under app/`);
if (offenders.length) {
  console.error(`\nFAIL — ${offenders.length} route file(s) with no default export:\n`);
  for (const f of offenders) console.error(`  ${f}`);
  console.error(
    '\nExpo Router routes every file in app/. Move helpers/shared modules to src/ ' +
      'and import them with @/…, or give the file a default React-component export.',
  );
  process.exit(1);
}
console.log('PASS — every route file under app/ has a default export (or is a special file).');
