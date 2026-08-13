#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/run-pgtap.mjs — the authoritative pgTAP runner.
//
//  WHY THIS EXISTS. The previous ad-hoc loop grepped `^ERROR`, but psql emits
//  `psql:file:62: ERROR: ...` — not line-anchored. Every suite that ABORTED at
//  fixture setup produced no TAP output at all, matched neither `^ERROR` nor
//  `not ok`, and was silently counted as a PASS. That reported 52/4 when the
//  truth was ~17/39.
//
//  A suite is GREEN here only if ALL of these hold:
//    • psql exit code is 0
//    • no `ERROR:` anywhere in stdout+stderr, at any position
//    • a TAP plan `1..N` was emitted
//    • assertions run === N
//    • zero `not ok` lines
//    • no "Looks like you planned" mismatch line
//  Anything else is a failure with a recorded reason. An aborted suite CANNOT
//  be counted as passing, which is the specific bug this replaces.
//
//  Usage:
//    node scripts/qa/run-pgtap.mjs               # all suites, grouped summary
//    node scripts/qa/run-pgtap.mjs --json        # machine-readable
//    node scripts/qa/run-pgtap.mjs <substring>   # only matching suites
// ════════════════════════════════════════════════════════════════════════════

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = 'supabase/tests';
const DB = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: process.env.PGPORT ?? '54322',
  user: process.env.PGUSER ?? 'postgres',
  db: process.env.PGDATABASE ?? 'postgres',
  pass: process.env.PGPASSWORD ?? 'postgres',
};

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const filter = args.find((a) => !a.startsWith('--'));

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => (filter ? f.includes(filter) : true))
  .sort();

/**
 * First root cause, so the baseline groups by what actually has to be fixed
 * rather than by 60 individually-phrased messages.
 */
function classify(out) {
  const m = out.match(/ERROR:\s*([^\n]+)/);
  const first = m ? m[1].trim() : null;
  if (!first) return { bucket: 'tap-assertion', detail: null };

  if (/FUNDING_REQUIRED/.test(first))
    return { bucket: 'fixture: dispatched-job INSERT (FUNDING_REQUIRED)', detail: first };
  if (/FUNDING_COLUMN_IS_PLATFORM_ONLY/.test(first))
    return { bucket: 'fixture: presets platform-only funding column', detail: first };
  if (/Illegal jobs\.status transition/.test(first))
    return { bucket: 'fixture: bypasses admin_dispatch_job state machine', detail: first };
  if (/permission denied/i.test(first))
    return { bucket: 'privilege', detail: first };
  if (/violates (foreign key|not-null|check) constraint/i.test(first))
    return { bucket: 'fixture: constraint', detail: first };
  if (/does not exist/i.test(first))
    return { bucket: 'missing object', detail: first };
  if (/syntax error/i.test(first))
    return { bucket: 'suite syntax', detail: first };
  return { bucket: 'other', detail: first };
}

function run(file) {
  const r = spawnSync(
    'psql',
    ['-h', DB.host, '-p', DB.port, '-U', DB.user, '-d', DB.db, '-X', '-q', '-f', join(DIR, file)],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: DB.pass }, maxBuffer: 32 * 1024 * 1024 },
  );

  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

  // ERROR: anywhere — NOT anchored. This is the bug being fixed.
  const errors = [...out.matchAll(/ERROR:\s*[^\n]+/g)].map((x) => x[0]);
  const planM = out.match(/^\s*1\.\.(\d+)/m);
  const planned = planM ? Number(planM[1]) : null;
  const ran = (out.match(/^\s*(?:ok|not ok)\s+\d+/gm) ?? []).length;
  const notOk = (out.match(/^\s*not ok\s+\d+/gm) ?? []).length;
  const mismatch = /Looks like you planned/.test(out);

  const reasons = [];
  if (r.status !== 0) reasons.push(`psql exit ${r.status}`);
  if (errors.length) reasons.push(`${errors.length} psql ERROR`);
  if (planned === null) reasons.push('no TAP plan emitted (aborted before plan)');
  else if (ran !== planned) reasons.push(`plan ${planned} vs ran ${ran}`);
  if (notOk) reasons.push(`${notOk} failed assertion(s)`);
  if (mismatch) reasons.push('plan mismatch reported by pgTAP');

  const { bucket, detail } = reasons.length
    ? classify(out)
    : { bucket: null, detail: null };

  return {
    file,
    ok: reasons.length === 0,
    exit: r.status,
    planned,
    ran,
    notOk,
    reasons,
    bucket,
    detail,
  };
}

const results = files.map(run);
const pass = results.filter((x) => x.ok);
const fail = results.filter((x) => !x.ok);

if (asJson) {
  console.log(JSON.stringify({ total: results.length, pass: pass.length, fail: fail.length, results }, null, 2));
} else {
  const groups = new Map();
  for (const f of fail) {
    const k = f.bucket ?? 'other';
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }

  console.log(`\npgTAP: ${results.length} suites · ${pass.length} PASS · ${fail.length} FAIL\n`);
  for (const [bucket, items] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`── ${bucket}  (${items.length})`);
    if (items[0].detail) console.log(`   e.g. ${items[0].detail.slice(0, 110)}`);
    for (const i of items) {
      console.log(`   ${i.file.replace(/_test\.sql$/, '')}  [${i.reasons.join('; ')}]`);
    }
    console.log('');
  }
}

process.exit(fail.length === 0 ? 0 : 1);
