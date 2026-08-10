#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  run-ml-tests.mjs — execute the shared-core ML test suites WITHOUT vitest.
//
//  WHY THIS EXISTS
//  `npx vitest run` cannot start in every environment: vitest pulls rolldown,
//  whose native binding is platform-specific, and on a machine where that
//  binary is absent (and the npm registry unreachable) the runner dies before a
//  single assertion executes. The tests themselves are pure TypeScript with no
//  DOM, no network and no native dependency — the runner was the only obstacle.
//
//  These suites cover the decode path for NEXPEC's own trained inspection
//  models — YOLO segmentation/detection head decoding, coordinate handling,
//  region clustering, mask refinement, finding validation and canonical
//  attestation hashing. That is exactly the logic that must not silently break,
//  so "the runner won't start" is not an acceptable reason to leave it
//  unverified.
//
//  This provides the small slice of the vitest API the suites actually use
//  (describe / it / expect with 6 matchers, counted from the sources) and runs
//  each file with Node's built-in TypeScript type-stripping.
//
//  It is a FALLBACK, not a replacement. Where vitest runs, use vitest —
//  `npm test -w @nexpec/shared-core` remains the primary path.
//
//      node scripts/qa/run-ml-tests.mjs
// ════════════════════════════════════════════════════════════════════════════
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const ML_DIR = resolve(ROOT, 'packages/shared-core/src/ml');
const TMP = resolve(ROOT, 'node_modules/.cache/nexpec-ml-tests');

let files;
try {
  files = readdirSync(ML_DIR).filter((f) => f.endsWith('.test.ts')).sort();
} catch {
  console.log('✓ ml tests: packages/shared-core/src/ml not present, nothing to run.');
  process.exit(0);
}
if (!files.length) {
  console.log('✓ ml tests: no .test.ts files found.');
  process.exit(0);
}

mkdirSync(TMP, { recursive: true });

// ── The shim: describe / it / expect, plus a resolve hook ──────────────────
//  The hook does two jobs: map the bare specifier 'vitest' onto this shim, and
//  add the extension that TypeScript source omits (Node ESM will not guess).
const shim = `
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./hooks.mjs', import.meta.url);

const state = { suites: [], failures: [], passed: 0, current: null };

function fmt(v) {
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

globalThis.describe = (name, fn) => { const prev = state.current; state.current = name; fn(); state.current = prev; };
globalThis.describe.skip = () => {};

globalThis.it = (name, fn) => {
  const label = (state.current ? state.current + ' › ' : '') + name;
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('async test not supported by this fallback runner');
    state.passed++;
  } catch (e) {
    state.failures.push({ label, message: e && e.message ? e.message : String(e) });
  }
};
globalThis.it.skip = () => {};
globalThis.test = globalThis.it;

globalThis.expect = (actual) => {
  const mk = (pass, msg) => { if (!pass) throw new Error(msg); };
  const api = {
    toBe: (e) => mk(Object.is(actual, e), \`expected \${fmt(actual)} to be \${fmt(e)}\`),
    toEqual: (e) => mk(JSON.stringify(actual) === JSON.stringify(e),
                       \`expected \${fmt(actual)} to equal \${fmt(e)}\`),
    toBeCloseTo: (e, d = 2) => mk(Math.abs(actual - e) < Math.pow(10, -d) / 2,
                       \`expected \${fmt(actual)} to be close to \${fmt(e)}\`),
    toBeGreaterThan: (e) => mk(actual > e, \`expected \${fmt(actual)} > \${fmt(e)}\`),
    toBeGreaterThanOrEqual: (e) => mk(actual >= e, \`expected \${fmt(actual)} >= \${fmt(e)}\`),
    toBeLessThan: (e) => mk(actual < e, \`expected \${fmt(actual)} < \${fmt(e)}\`),
    toBeLessThanOrEqual: (e) => mk(actual <= e, \`expected \${fmt(actual)} <= \${fmt(e)}\`),
    toBeTruthy: () => mk(!!actual, \`expected \${fmt(actual)} to be truthy\`),
    toBeFalsy: () => mk(!actual, \`expected \${fmt(actual)} to be falsy\`),
    toBeNull: () => mk(actual === null, \`expected \${fmt(actual)} to be null\`),
    toBeUndefined: () => mk(actual === undefined, \`expected \${fmt(actual)} to be undefined\`),
    toBeDefined: () => mk(actual !== undefined, \`expected value to be defined\`),
    toContain: (e) => mk(actual != null && actual.includes && actual.includes(e),
                       \`expected \${fmt(actual)} to contain \${fmt(e)}\`),
    toHaveLength: (e) => mk(actual && actual.length === e,
                       \`expected length \${actual && actual.length} to be \${e}\`),
    toThrow: () => {
      let threw = false;
      try { actual(); } catch { threw = true; }
      mk(threw, 'expected function to throw');
    },
  };
  api.not = new Proxy({}, {
    get: (_t, k) => (...args) => {
      let threw = false;
      try { api[k](...args); } catch { threw = true; }
      if (!threw) throw new Error(\`expected NOT \${String(k)}\`);
    },
  });
  return api;
};

globalThis.__nexpecMlState = state;
`;

const hooks = `
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const SHIM = process.env.NEXPEC_VITEST_SHIM;

// NOTE: the exported hook MUST be named \`resolve\`, so node:path's resolve is
// imported under an alias — declaring both plainly is a redeclaration
// SyntaxError that fails the module before any test can load.
export async function resolve(specifier, context, nextResolve) {
  // 'vitest' → the local shim (which has already installed the globals, so the
  // named exports simply point at them).
  if (specifier === 'vitest') {
    return { url: pathToFileURL(SHIM).href, shortCircuit: true };
  }
  // TypeScript source omits the extension; Node ESM requires it.
  if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
    const base = dirname(fileURLToPath(context.parentURL));
    for (const ext of ['.ts', '.js', '.mts', '.mjs']) {
      const cand = pathResolve(base, specifier + ext);
      if (existsSync(cand)) {
        return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

// The shim module must also EXPORT the vitest names, since tests do
// `import { describe, it, expect } from 'vitest'`.
const shimExports = `
export const describe = globalThis.describe;
export const it = globalThis.it;
export const test = globalThis.it;
export const expect = globalThis.expect;
export default { describe, it, test, expect };
`;

writeFileSync(join(TMP, 'hooks.mjs'), hooks);
writeFileSync(join(TMP, 'shim.mjs'), shim + shimExports);

const shimPath = join(TMP, 'shim.mjs');
let totalPassed = 0;
const allFailures = [];

for (const f of files) {
  const testPath = join(ML_DIR, f);
  const entry = join(TMP, `entry-${f.replace(/\W/g, '_')}.mjs`);
  writeFileSync(
    entry,
    `import ${JSON.stringify(pathToFileURL(shimPath).href)};\n` +
    `await import(${JSON.stringify(pathToFileURL(testPath).href)});\n` +
    `const s = globalThis.__nexpecMlState;\n` +
    `console.log('__RESULT__' + JSON.stringify({ passed: s.passed, failures: s.failures }));\n`,
  );

  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', entry],
    { encoding: 'utf8', env: { ...process.env, NEXPEC_VITEST_SHIM: shimPath }, timeout: 60_000 },
  );

  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('__RESULT__'));
  if (!line) {
    allFailures.push({ label: `${f} (suite did not run)`, message: ((r.stderr || '').trim().split('\n').slice(-3).join(' | ')) || 'no output' });
    console.log(`  ✘ ${f}`);
    continue;
  }
  const res = JSON.parse(line.slice('__RESULT__'.length));
  totalPassed += res.passed;
  for (const fail of res.failures) allFailures.push({ label: `${f} › ${fail.label}`, message: fail.message });
  console.log(`  ${res.failures.length ? '✘' : '✓'} ${f}  (${res.passed} passed${res.failures.length ? `, ${res.failures.length} FAILED` : ''})`);
}

console.log('');
if (allFailures.length) {
  console.error(`✘ ml tests: ${allFailures.length} failure(s), ${totalPassed} passed\n`);
  for (const f of allFailures) console.error(`  ${f.label}\n      ${f.message}`);
  process.exit(1);
}
console.log(`✓ ml tests: ${totalPassed} assertions passed across ${files.length} suite(s) — decode, clustering, refinement, validation and attestation for the trained inspection models.`);
