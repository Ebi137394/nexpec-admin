#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-edge-functions.mjs — typecheck EVERY Edge Function on the
//  DEPLOYMENT runtime, resolving each function's REAL entrypoint.
//
//  ── THE DEFECT THIS REPLACES ───────────────────────────────────────────────
//  Every previous run of this gate was a shell loop shaped like:
//
//      for d in supabase/functions/*/; do
//        [ -f "$d/index.ts" ] || continue        # ← silently skips
//        docker run … deno check "$(basename $d)/index.ts"
//      done
//
//  `generate-dispute-report` does not have an index.ts. Its entrypoint is
//  declared in supabase/config.toml as:
//
//      [functions.generate-dispute-report]
//      entrypoint = "./functions/generate-dispute-report/mod.ts"
//
//  so the `continue` fired and the function was never checked. The gate then
//  reported "37 passed, 0 failed" — a green result produced by NOT LOOKING.
//  Checked directly it had four real errors, including two on a stray
//  `addEventListener('fetch', …)` handler that used the Deno Deploy FetchEvent
//  API (inert on this runtime) and re-fetched its own request (unbounded
//  recursion had it ever fired).
//
//  A skip must never be indistinguishable from a pass. This script therefore
//  treats an unresolvable entrypoint as a HARD FAILURE, not a skip.
//
//  ── WHY DOCKER, AND WHY 2.1.4 ──────────────────────────────────────────────
//  Supabase Edge Runtime v1.74.2 reports deno 2.1.4. Locally installed Deno is
//  newer (2.9.x) and is the wrong bar in BOTH directions: its newer TypeScript
//  invents failures the target does not have, and it hides real ones the target
//  does. The deployment version is the only version whose verdict means
//  anything, so it is pinned and run in a container.
//
//  A locally generated supabase/functions/deno.lock is lockfile v5, which 2.1.4
//  refuses outright. It is gitignored; this script removes it before and after.
//
//  RUN
//    node scripts/qa/check-edge-functions.mjs
//    node scripts/qa/check-edge-functions.mjs --json
// ════════════════════════════════════════════════════════════════════════════

import { readdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const FUNCTIONS_DIR = 'supabase/functions';
const CONFIG = 'supabase/config.toml';
const DENO_IMAGE = 'denoland/deno:2.1.4';
const LOCKFILE = join(FUNCTIONS_DIR, 'deno.lock');

const asJson = process.argv.includes('--json');

/**
 * Parse `entrypoint = "./functions/<name>/<file>"` out of every
 * [functions.<name>] block. Deliberately a narrow regex rather than a TOML
 * dependency: this file must run with zero install steps in CI.
 */
function declaredEntrypoints() {
  const out = new Map();
  if (!existsSync(CONFIG)) return out;
  const text = readFileSync(CONFIG, 'utf8');
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const section = line.match(/^\[functions\.([A-Za-z0-9_-]+)\]/);
    if (section) { current = section[1]; continue; }
    if (line.startsWith('[')) { current = null; continue; }
    if (!current) continue;
    // Strip a trailing `# comment` before reading the value.
    const ep = line.match(/^entrypoint\s*=\s*"([^"]+)"/);
    if (ep) out.set(current, ep[1]);
  }
  return out;
}

/**
 * The entrypoint the deployment would actually run, as a path relative to
 * FUNCTIONS_DIR. Returns null when nothing resolves — which is a failure,
 * never a skip.
 */
function resolveEntrypoint(fn, declared) {
  const fromConfig = declared.get(fn);
  if (fromConfig) {
    // config.toml paths are relative to supabase/, e.g. "./functions/x/mod.ts"
    const rel = fromConfig.replace(/^\.\//, '').replace(/^functions\//, '');
    if (existsSync(join(FUNCTIONS_DIR, rel))) return rel;
    return null; // declared but missing — worse than undeclared
  }
  for (const candidate of ['index.ts', 'mod.ts']) {
    if (existsSync(join(FUNCTIONS_DIR, fn, candidate))) return `${fn}/${candidate}`;
  }
  return null;
}

function dockerAvailable() {
  return spawnSync('docker', ['version', '--format', '{{.Server.Version}}'],
    { encoding: 'utf8' }).status === 0;
}

function main() {
  if (!dockerAvailable()) {
    console.error('FATAL: docker is not available. This gate must run on the\n' +
      `deployment runtime (${DENO_IMAGE}); a local Deno is not a substitute.`);
    process.exit(1);
  }

  const declared = declaredEntrypoints();
  const fns = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_shared')
    .map((e) => e.name)
    .sort();

  rmSync(LOCKFILE, { force: true });

  const results = [];
  for (const fn of fns) {
    const entry = resolveEntrypoint(fn, declared);
    if (!entry) {
      results.push({
        fn, entry: null, ok: false,
        reason: declared.has(fn)
          ? `config.toml declares entrypoint "${declared.get(fn)}" but that file does not exist`
          : 'no entrypoint: neither index.ts nor mod.ts exists and config.toml declares none',
        output: '',
      });
      continue;
    }
    const r = spawnSync('docker', [
      'run', '--rm',
      '-v', `${process.cwd()}/${FUNCTIONS_DIR}:/w`,
      '-w', '/w', DENO_IMAGE,
      'deno', 'check', entry,
    ], { encoding: 'utf8' });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    results.push({
      fn, entry, ok: r.status === 0,
      reason: r.status === 0 ? null : `deno check failed (exit ${r.status})`,
      output,
    });
  }

  rmSync(LOCKFILE, { force: true });

  const failed = results.filter((r) => !r.ok);
  const declaredCustom = [...declared.entries()].filter(([, v]) => !v.endsWith('/index.ts'));

  if (asJson) {
    console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
  } else {
    for (const r of failed) {
      console.error(`\n── FAIL ${r.fn}  (${r.entry ?? 'NO ENTRYPOINT'})`);
      console.error(`   ${r.reason}`);
      if (r.output) console.error(r.output.split('\n').slice(-25).join('\n'));
    }
    console.log(`\nEdge Functions @ deno 2.1.4 (deployment runtime)`);
    console.log(`  checked           : ${results.length}`);
    console.log(`  passed            : ${results.length - failed.length}`);
    console.log(`  failed            : ${failed.length}`);
    console.log(`  non-index entries : ${declaredCustom.length}` +
      (declaredCustom.length ? ` — ${declaredCustom.map(([k]) => k).join(', ')}` : ''));
    console.log('  (a function with no resolvable entrypoint FAILS — it is never skipped)');
  }

  process.exit(failed.length ? 1 : 0);
}

main();
