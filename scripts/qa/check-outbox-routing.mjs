#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  check-outbox-routing.mjs  ·  NEXPEC offline-integrity CI guardrail
 *
 *  WHY THIS EXISTS
 *  ───────────────
 *  Field screens run where there is no signal. Any write a field screen makes
 *  DIRECTLY against Supabase (supabase.from(...).insert/update/upsert/delete, or
 *  a write RPC) silently fails offline — the inspector's evidence is lost with no
 *  error and no retry. The ONLY correct path is the offline outbox
 *  (src/core/offline → enqueue*), which persists the op to SQLite and drains it
 *  when connectivity returns.
 *
 *  A code review caught capture.tsx doing exactly this. A review will not catch
 *  the next one. This script makes it STRUCTURALLY IMPOSSIBLE to merge a field
 *  screen that bypasses the outbox: any direct write that is not explicitly
 *  exempted fails the build (exit 1).
 *
 *  THE RATCHET
 *  ───────────
 *  Pre-existing debt (writes that predate this rule) is captured ONCE into a
 *  baseline allowlist so the build is green today. From now on:
 *    • a NEW direct write in a field screen  → build fails;
 *    • re-introducing a write on a line we cleaned (e.g. capture.tsx) → build
 *      fails, because that line is not in the baseline.
 *  The baseline can only shrink without ceremony; growing it is a conscious,
 *  reviewable edit to a checked-in JSON file. Two escape hatches, both explicit:
 *    1. inline pragma  `// outbox-exempt: <reason>`  on the offending line (or the
 *       line directly above it) — visible at the call site, best for a one-off;
 *    2. the baseline file — for grandfathered debt, each entry self-documenting.
 *
 *  USAGE
 *    node scripts/qa/check-outbox-routing.mjs              # check (CI mode)
 *    node scripts/qa/check-outbox-routing.mjs --write-baseline   # seed/refresh
 *    node scripts/qa/check-outbox-routing.mjs --list      # list findings, exit 0
 *
 *  Zero dependencies (pure Node ≥16, no install) → no third-party cost, runs
 *  anywhere CI runs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const BASELINE_PATH = join(__dirname, 'outbox-routing-allowlist.json');

// ── CONFIG ───────────────────────────────────────────────────────────────────
// Directories whose writes MUST go through the outbox — the offline-critical
// mobile surface: every screen (app/**) AND the service/data layer that backs
// them (src/**). Scanning only screens missed the flash-report bug, whose write
// lived in a src/lib service. The outbox engine + the supabase client wrapper
// are the ONE sanctioned write surface, so they're excluded below.
const SCAN_DIRS = ['app', 'src'];

// Excluded sub-trees (path prefixes, '/'-normalized). The outbox legitimately
// writes to supabase; the client wrapper IS supabase.
const EXCLUDE_DIRS = [
  'src/core/offline',
  'src/core/supabase',
];

const FILE_EXTS = ['.ts', '.tsx'];

// Direct table-write methods on a supabase query builder.
const WRITE_METHOD_RE = /\.(insert|update|upsert|delete)\s*\(/;
// Storage writes (the flash-report evidence-loss vector) + edge-function calls —
// both throw "Network request failed" offline exactly like a direct DB write.
const STORAGE_WRITE_RE = /\.(upload|createSignedUploadUrl)\s*\(/;
const FUNCTIONS_RE = /\.functions\.invoke\s*\(/;

// Write RPCs (reads via .rpc(...) are fine and must NOT be flagged). Extend this
// set when you add a server-side write RPC a field screen / service might call.
const WRITE_RPCS = new Set([
  'pi_record_ai_detection',
  'record_seal_anchor',
  'flash_report_create',
  'flash_report_transition',
  'flash_report_add_attachment',
]);
const RPC_RE = /\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/;

const PRAGMA = 'outbox-exempt';

// ── helpers ──────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  const relDir = relative(REPO_ROOT, dir).split(sep).join('/');
  if (EXCLUDE_DIRS.some((ex) => relDir === ex || relDir.startsWith(ex + '/'))) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (FILE_EXTS.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

// A stable, line-number-free key so a finding survives reformatting/reflow:
// "<relpath>::<trimmed source line>". Line numbers are reported to humans but
// never used for matching (they churn constantly).
function keyFor(relPath, line) {
  return `${relPath.split(sep).join('/')}::${line.trim()}`;
}

function isCommentLine(t) {
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Scan one file → array of { line (1-based), text, key }. */
function scanFile(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  const src = readFileSync(absPath, 'utf8');
  // No supabase client referenced → no outbox bypass possible. Skips the file
  // wholesale, which also avoids false positives from Map/Set `.delete(` etc.
  if (!src.includes('supabase')) return [];
  const lines = src.split(/\r?\n/);
  let inBlockComment = false;
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Track /* ... */ block comments so prose mentioning .insert( is ignored.
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
      inBlockComment = true;
      continue;
    }
    if (isCommentLine(trimmed)) continue;

    // Does this line do a forbidden write?
    let hit = false;
    if (WRITE_METHOD_RE.test(raw)) hit = true;
    if (STORAGE_WRITE_RE.test(raw)) hit = true;
    if (FUNCTIONS_RE.test(raw)) hit = true;
    const rpc = raw.match(RPC_RE);
    if (rpc && WRITE_RPCS.has(rpc[1])) hit = true;
    if (!hit) continue;

    // Inline escape hatch: pragma on this line or the line directly above.
    const prev = i > 0 ? lines[i - 1] : '';
    if (raw.includes(PRAGMA) || prev.includes(PRAGMA)) continue;

    findings.push({ line: i + 1, text: raw, key: keyFor(rel, raw), rel });
  }
  return findings;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return [];
  try {
    const j = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    return Array.isArray(j.allow) ? j.allow : [];
  } catch {
    console.error(`✗ Could not parse ${relative(REPO_ROOT, BASELINE_PATH)} — is it valid JSON?`);
    process.exit(2);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const mode = process.argv.includes('--write-baseline')
  ? 'write'
  : process.argv.includes('--list')
    ? 'list'
    : 'check';

const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
const all = files.flatMap(scanFile);

if (mode === 'write') {
  const allow = all.map((f) => f.key).sort(); // keep duplicates → multiset baseline
  const out = {
    _comment:
      'GRANDFATHERED direct-write debt in field screens. Each entry is "<path>::<source line>". ' +
      'The outbox guardrail (scripts/qa/check-outbox-routing.mjs) fails the build on any field-screen ' +
      'write NOT listed here. Shrink this list as you migrate writes to enqueue* (src/core/offline). ' +
      'Do NOT hand-add entries to dodge the gate — use an inline `// outbox-exempt: <reason>` pragma instead.',
    generated_at: new Date().toISOString(),
    allow,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`✓ Wrote baseline with ${allow.length} grandfathered finding(s) → ${relative(REPO_ROOT, BASELINE_PATH)}`);
  process.exit(0);
}

const baselineList = loadBaseline();
const allowCounts = new Map();
for (const k of baselineList) allowCounts.set(k, (allowCounts.get(k) ?? 0) + 1);

// Multiset match: the first N identical (path::line) findings are grandfathered
// (N = the baselined count); anything beyond N — e.g. a newly added identical
// write in an already-grandfathered file — is a violation. Line-number-free so
// it survives reflow, while still catching duplicate additions.
const usedQuota = new Map();
const violationSet = new Set();
for (const f of all) {
  const used = usedQuota.get(f.key) ?? 0;
  if (used < (allowCounts.get(f.key) ?? 0)) {
    usedQuota.set(f.key, used + 1);
  } else {
    violationSet.add(f);
  }
}
const violations = all.filter((f) => violationSet.has(f));

if (mode === 'list') {
  console.log(`Scanned dirs: ${SCAN_DIRS.join(', ')} (excluding ${EXCLUDE_DIRS.join(', ')})`);
  console.log(`Files: ${files.length} · total writes found: ${all.length} · grandfathered: ${all.length - violations.length} · new: ${violations.length}\n`);
  for (const v of all) {
    const tag = violationSet.has(v) ? 'NEW  ' : 'allow';
    console.log(`  [${tag}] ${v.rel}:${v.line}  ${v.text.trim()}`);
  }
  process.exit(0);
}

// check mode
if (violations.length === 0) {
  console.log(
    `✓ outbox-routing: ${files.length} field-screen file(s) scanned, ` +
      `${all.length} write(s) all accounted for (${baselineList.length} grandfathered). No new bypass.`,
  );
  process.exit(0);
}

console.error('\n✗ outbox-routing guardrail FAILED — field screens must route writes through the offline outbox.\n');
for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}`);
  console.error(`      ${v.text.trim()}`);
}
console.error(
  `\n${violations.length} direct write(s) bypassing the outbox.\n\n` +
    'Fix one of these ways:\n' +
    '  • PREFERRED — replace the call with an enqueue* helper from @/lib/offline\n' +
    "      (enqueueCaptureSave, enqueueReportSave, enqueueAiDetection, …). Offline-safe + idempotent.\n" +
    '  • If the write is genuinely outbox-exempt, annotate the line:\n' +
    `      // ${PRAGMA}: <why this is safe to write directly>\n` +
    '  • To re-baseline intentionally migrated debt: node scripts/qa/check-outbox-routing.mjs --write-baseline\n',
);
process.exit(1);
