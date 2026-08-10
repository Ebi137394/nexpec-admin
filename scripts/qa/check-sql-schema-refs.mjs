#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  check-sql-schema-refs.mjs
//
//  Validates every INSERT in the SQL test suites and in NEW migrations against
//  the authoritative schema parsed from the migrations themselves.
//
//  WHY THIS EXISTS
//  The authoring environment has no Postgres (the package archive, PyPI and npm
//  are all blocked by the proxy), so a bad fixture is otherwise only discovered
//  when a human runs the suite. Two bug classes have already cost real time on
//  this project:
//
//    1. PHANTOM COLUMN — a fixture names a column that does not exist. Five such
//       queries were live in the app for a long time; the same mistake in a test
//       fixture aborts the whole suite on line 1 of the run.
//    2. MISSING NOT-NULL — a fixture omits a NOT NULL column that has no
//       DEFAULT (e.g. certifications.issuing_organization). The INSERT throws
//       23502 and every later assertion never executes.
//
//  Both are mechanically detectable without a database. This guard therefore
//  runs in CI and locally, and is the closest thing to runtime validation that
//  the sandbox permits. It does NOT replace running the suites — it removes the
//  most common reason a run dies before it reaches its assertions.
//
//  Deliberately conservative: anything it cannot parse with confidence is
//  skipped rather than guessed at, so it never blocks on a false positive.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');

// Blank comments to equal-length runs of spaces (newlines preserved) so byte
// offsets — and therefore reported line numbers — stay identical.
const stripSql = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
   .replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));

// ── 1. Parse the authoritative schema ──────────────────────────────────────
//  { table -> { cols:Set, required:Set } }  required = NOT NULL and no DEFAULT
//  and not generated/identity.
function parseSchema() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const schema = new Map();

  const ensure = (t) => {
    if (!schema.has(t)) schema.set(t, { cols: new Set(), required: new Set() });
    return schema.get(t);
  };

  for (const f of files) {
    // Comments MUST be stripped before parsing DDL. A trailing `-- note` on a
    // column line otherwise swallows the NEXT column: the top-level comma split
    // leaves a part beginning with `--`, whose first token is not an
    // identifier, so the column silently vanishes from the schema and every
    // fixture naming it is reported as a phantom. (This guard's own first run
    // produced 22 such false positives.)
    const sql = stripSql(readFileSync(join(MIGRATIONS, f), 'utf8'));

    // CREATE TABLE [IF NOT EXISTS] "public"."x" ( ... );
    const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
    for (const m of sql.matchAll(re)) {
      const table = m[1];
      // Find the matching close paren for the column list.
      let depth = 0, i = m.index + m[0].length - 1, end = -1;
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) continue;
      const body = sql.slice(m.index + m[0].length, end);
      const t = ensure(table);

      // Split top-level commas only (CHECK(...) contains commas).
      const parts = [];
      let cur = '', d = 0;
      for (const ch of body) {
        if (ch === '(') d++;
        if (ch === ')') d--;
        if (ch === ',' && d === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
      }
      parts.push(cur);

      for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE|LIKE)\b/i.test(line)) continue;
        const cm = line.match(/^"?(\w+)"?\s+/);
        if (!cm) continue;
        const col = cm[1];
        t.cols.add(col);
        const hasDefault = /\bDEFAULT\b/i.test(line);
        const generated = /\bGENERATED\b/i.test(line);
        const notNull = /\bNOT\s+NULL\b/i.test(line);
        if (notNull && !hasDefault && !generated) t.required.add(col);
      }
    }

    // ALTER TABLE ... ADD COLUMN
    for (const alter of sql.matchAll(
      /ALTER TABLE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?(\w+)"?\b([\s\S]*?);/gi,
    )) {
      const t = ensure(alter[1]);
      for (const add of alter[2].matchAll(
        /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?([^,;]*)/gi,
      )) {
        t.cols.add(add[1]);
        const tail = add[2] || '';
        if (/\bNOT\s+NULL\b/i.test(tail) && !/\bDEFAULT\b/i.test(tail) && !/\bGENERATED\b/i.test(tail)) {
          t.required.add(add[1]);
        }
      }
      // A later migration may drop the NOT NULL or add a default.
      for (const alt of alter[2].matchAll(/ALTER COLUMN\s+"?(\w+)"?\s+(DROP NOT NULL|SET DEFAULT)/gi)) {
        t.required.delete(alt[1]);
      }
      for (const drop of alter[2].matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?"?(\w+)"?/gi)) {
        t.cols.delete(drop[1]);
        t.required.delete(drop[1]);
      }
    }
  }
  return schema;
}

// ── 2. Collect the SQL files to police ─────────────────────────────────────
function targets() {
  const out = [];
  for (const dir of ['supabase/tests', 'supabase/rollback']) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((x) => x.endsWith('.sql'))) out.push(join(dir, f));
  }
  // Only NEW migrations — the baseline is the source of truth, not a subject.
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && !x.startsWith('00000000000000'))) {
    out.push(join('supabase/migrations', f));
  }
  return out;
}

// Tables whose fixtures we do not police (auth schema is Supabase-owned).
const SKIP_TABLES = new Set(['users']);

/**
 * Ranges of dollar-quoted literals that are ARGUMENTS rather than function
 * bodies — i.e. `throws_ok($$insert into ...$$, '42501', ...)`.
 *
 * A pgTAP negative test deliberately contains an INVALID statement: the whole
 * point of `throws_ok($$insert into public.organizations (name) ...$$)` is that
 * the INSERT is rejected, so its omission of a NOT NULL column is correct and
 * must not be reported. A function body (`... AS $$ ... $$`) is the opposite —
 * its INSERTs are real and must be checked.
 *
 * The two are distinguished by what precedes the opening tag: an argument
 * follows `(` or `,`; a body follows `AS`.
 */
function assertionLiteralRanges(src) {
  const ranges = [];
  const re = /\$(\w*)\$/g;
  let m;
  const opens = [];
  while ((m = re.exec(src)) !== null) opens.push({ tag: m[1], start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < opens.length; i++) {
    const o = opens[i];
    const close = opens.find((c, j) => j > i && c.tag === o.tag);
    if (!close) continue;
    const before = src.slice(Math.max(0, o.start - 40), o.start).replace(/\s+$/, '');
    if (/[(,]$/.test(before)) ranges.push([o.start, close.end]);
    i = opens.indexOf(close);          // don't re-open inside this span
  }
  return ranges;
}

const schema = parseSchema();
const problems = [];
let inserts = 0, filesScanned = 0;

for (const rel of targets()) {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  if (!/INSERT\s+INTO/i.test(raw)) continue;
  filesScanned++;
  const src = stripSql(raw);
  const skipRanges = assertionLiteralRanges(src);
  const inAssertion = (i) => skipRanges.some(([a, b]) => i >= a && i < b);

  // INSERT INTO [public.]table ( col, col, ... )
  const re = /INSERT\s+INTO\s+(?:(\w+)\.)?"?(\w+)"?\s*\(/gi;
  for (const m of src.matchAll(re)) {
    const [, sch, table] = m;
    if (sch === 'auth' || SKIP_TABLES.has(table)) continue;
    if (!schema.has(table)) continue;              // unknown table → not our business
    if (inAssertion(m.index)) continue;            // pgTAP throws_ok payload — invalid on purpose
    const line = src.slice(0, m.index).split('\n').length;

    // Grab the balanced column list.
    let depth = 0, i = m.index + m[0].length - 1, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) continue;
    const list = src.slice(m.index + m[0].length, end);
    if (/\bSELECT\b/i.test(list)) continue;        // INSERT INTO t (SELECT ...) — skip

    const named = list.split(',').map((c) => c.trim().replace(/"/g, '')).filter(Boolean);
    if (!named.length || !named.every((c) => /^[a-z_][a-z0-9_]*$/i.test(c))) continue;
    inserts++;

    const { cols, required } = schema.get(table);
    for (const c of named) {
      if (!cols.has(c)) {
        problems.push({ rel, line, kind: 'PHANTOM COLUMN', detail: `${table}.${c} does not exist` });
      }
    }
    for (const r of required) {
      if (!named.includes(r)) {
        problems.push({
          rel, line, kind: 'MISSING NOT-NULL',
          detail: `${table}.${r} is NOT NULL with no default but is not supplied`,
        });
      }
    }
  }
}

if (problems.length) {
  console.error('✘ SQL fixture does not match the schema:\n');
  for (const p of problems) console.error(`  ${p.rel}:${p.line}  [${p.kind}]  ${p.detail}`);
  console.error(
    `\n${problems.length} problem(s). Each one aborts the suite at the INSERT, so every\n` +
    `assertion after it silently never runs.`,
  );
  process.exit(1);
}

console.log(
  `✓ SQL schema refs: ${inserts} fixture INSERT(s) across ${filesScanned} file(s); ` +
  `every column exists and every NOT NULL column without a default is supplied ` +
  `(${schema.size} tables parsed).`,
);
