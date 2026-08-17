#!/usr/bin/env node
/**
 * scripts/qa/check-use-server-exports.mjs
 *
 * A "use server" module may export ONLY async functions. Exporting a runtime
 * VALUE from one makes the whole module invalid, and Next.js throws while
 * loading it:
 *
 *     Error: A "use server" file can only export async functions, found object.
 *
 * That is a RUNTIME failure. `tsc` is happy, `next build` is happy, and the
 * route renders fine — the module only explodes when the Server Action is
 * actually POSTed. We shipped exactly that: `lib/actions/dispatch.ts` exported
 * `INITIAL_STATE`, so every "Confirm & Dispatch" threw and Admin dispatch — the
 * final step of the job lifecycle — could never run. The UI showed no error.
 *
 * This gate catches the whole class statically.
 *
 * Allowed from a "use server" file:
 *   • export async function foo() {}
 *   • export type / export interface        (erased at compile time)
 *   • export type { X } / export { type X } (type-only re-export)
 * Everything else is a runtime value and is refused.
 *
 * RUN: node scripts/qa/check-use-server-exports.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/web/src', 'src'];
const EXT = /\.(ts|tsx)$/;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === 'dist') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(walk(p));
    else if (EXT.test(e)) out.push(p);
  }
  return out;
}

const violations = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    // 'use server' must be the module prologue to make the whole file a server module.
    const head = src.slice(0, 400);
    if (!/^\s*(['"])use server\1\s*;/m.test(head)) continue;
    scanned++;

    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const t = line.trim();
      // `export` must be the KEYWORD, not the start of an identifier. Without
      // the boundary this matches object literal keys such as `export_id:` and
      // `exported_at:` inside an unrelated payload.
      if (!/^export[\s{*]/.test(t)) return;
      // allowed forms
      if (/^export\s+(async\s+function|type\b|interface\b)/.test(t)) return;
      if (/^export\s+type\s*\{/.test(t)) return;
      if (/^export\s*\{\s*type\s/.test(t)) return;
      if (/^export\s+default\s+async\s+function/.test(t)) return;
      if (t === 'export {};') return;
      // a bare `export { X }` or `export { X as Y }` re-exports a VALUE
      violations.push({ file, line: i + 1, text: t.slice(0, 110) });
    });
  }
}

console.log(`check-use-server-exports: scanned ${scanned} "use server" modules`);
if (violations.length) {
  console.error(`\nFAIL — ${violations.length} non-async export(s) in "use server" modules:\n`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error('\nMove runtime values into a plain (non-"use server") module and import them.');
  process.exit(1);
}
console.log('PASS — every "use server" module exports only async functions and types.');
