#!/usr/bin/env node
/**
 * check-auth-hydration.mjs — cold-start / post-OAuth-callback hydration guard.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * supabase-js holds an internal auth lock while onAuthStateChange callbacks
 * run. Awaiting another Supabase call inside that callback can deadlock: the
 * await never resolves, setState never runs, AuthContext.loading stays true —
 * and because AuthGate gates every redirect on `!loading`, the user sits on
 * login/onboarding with a perfectly valid session until they force-close the
 * app (whose getSession() path runs outside the lock). That was the reported
 * "OAuth succeeds but the app stays on login until reopen" defect.
 *
 * Static, dependency-free, runs in CI alongside the other qa: guards.
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/contexts/AuthContext.tsx';
const src = readFileSync(FILE, 'utf8');
const fail = [];
const pass = [];

// 1. The callback must not be an async function.
const cbMatch = src.match(/onAuthStateChange\(\s*(async\s*)?\(/);
if (!cbMatch) fail.push('onAuthStateChange listener not found in ' + FILE);
else if (cbMatch[1]) fail.push('onAuthStateChange callback is `async` — it must stay synchronous (auth-lock deadlock).');
else pass.push('onAuthStateChange callback is synchronous');

// 2. The callback body must contain no `await` and must defer hydration.
const start = src.indexOf('onAuthStateChange(');
if (start !== -1) {
  let depth = 0, i = src.indexOf('(', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  const raw = src.slice(start, end === -1 ? start + 2000 : end);
  // Strip comments first: prose explaining the deadlock legitimately contains
  // the word "await", and matching that would be a false positive.
  const body = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (/\bawait\b/.test(body)) fail.push('onAuthStateChange callback contains `await` — no Supabase call may be awaited inside the auth lock.');
  else pass.push('no await inside the onAuthStateChange callback');

  if (!/setTimeout\(/.test(body)) fail.push('onAuthStateChange callback does not defer hydration (expected setTimeout(...,0) outside the lock).');
  else pass.push('hydration deferred outside the auth lock');

  for (const banned of ['computeMfaRequired(', 'fetchOrganization(']) {
    if (new RegExp('await\\s+[^;]*' + banned.replace('(', '\\(')).test(body))
      fail.push(`\`${banned}\` awaited inside the auth-state callback.`);
  }
}

// 3. Every hydration path must terminate in loading:false, incl. failure.
if (!/catch[\s\S]{0,400}loading:\s*false/.test(src))
  fail.push('no catch path sets loading:false — a failed profile fetch would strand the user on login.');
else pass.push('failure path still clears loading');

if (!/getSession\(\)[\s\S]{0,300}\.catch\(/.test(src))
  fail.push('initial getSession() has no .catch — a rejection would leave loading:true forever.');
else pass.push('initial getSession() rejection is handled');

console.log('auth hydration guard');
for (const p of pass) console.log('  ✓ ' + p);
for (const f of fail) console.log('  ✗ ' + f);
if (fail.length) { console.log(`\n✗ ${fail.length} problem(s) — cold start after OAuth callback could hang.`); process.exit(1); }
console.log('\n✓ clean — session hydrates without holding the auth lock.');
