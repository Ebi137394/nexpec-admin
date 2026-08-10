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
//    3. CHECK VIOLATION — a fixture uses a literal the column's CHECK does not
//       permit (moderation_status = 'pending_approval' when only
//       pending_review|approved|edits_requested|rejected are legal). 23514,
//       same fatal effect. Checked in supabase/tests only — see the scope note
//       at the call site.
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
    if (!schema.has(t)) {
      schema.set(t, {
        cols: new Set(), required: new Set(),
        allowed: new Map(),      // col -> Set(permitted literals)
        checkByName: new Map(),  // constraint name -> col, so a later DROP can undo it
      });
    }
    return schema.get(t);
  };

  // CONSTRAINT ... CHECK ((col = ANY (ARRAY['a'::text, 'b'::text])))  →  col: {a,b}
  // Also the inline form: CHECK (col IN ('a','b')).
  const harvestChecks = (t, text, name) => {
    const put = (col, vals) => {
      t.allowed.set(col, new Set(vals));
      if (name) t.checkByName.set(name, col);
    };
    for (const m of text.matchAll(
      /"?(\w+)"?\s*=\s*ANY\s*\(\s*(?:\(\s*)?ARRAY\s*\[([^\]]*)\]/gi,
    )) {
      const vals = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'"));
      if (vals.length) put(m[1], vals);
    }
    for (const m of text.matchAll(/"?(\w+)"?\s+IN\s*\(([^)]*)\)/gi)) {
      const vals = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'"));
      if (vals.length && !t.allowed.has(m[1])) put(m[1], vals);
    }
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
        if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE|LIKE)\b/i.test(line)) {
          if (/\bCHECK\b/i.test(line)) {
            harvestChecks(t, line, (line.match(/^CONSTRAINT\s+"?(\w+)"?/i) || [])[1]);
          }
          continue;
        }
        if (/\bCHECK\b/i.test(line)) harvestChecks(t, line);   // inline column CHECK
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

      // CHECK constraints have a LIFECYCLE. 20260801140000 does
      //   ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
      //   ALTER TABLE transactions ADD  CONSTRAINT transactions_type_check CHECK (...widened...);
      // Reading only the baseline CREATE TABLE therefore reports perfectly
      // legal inserts as violations (it produced 3 such false positives).
      // Statements are visited in file order, so replaying DROP then ADD
      // reproduces the constraint as it actually stands.
      for (const d of alter[2].matchAll(/DROP CONSTRAINT\s+(?:IF EXISTS\s+)?"?(\w+)"?/gi)) {
        const col = t.checkByName.get(d[1]);
        if (col) { t.allowed.delete(col); t.checkByName.delete(d[1]); }
      }
      for (const a of alter[2].matchAll(/ADD CONSTRAINT\s+"?(\w+)"?\s+CHECK\s*([\s\S]*)/gi)) {
        harvestChecks(t, a[2], a[1]);
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
  // The baseline defines the schema, but its FUNCTION BODIES are ordinary code
  // and can be wrong about it. Skipping it was how a whole family of live
  // 42703s survived: file_dispute, invite_inspector_to_job and three payment
  // functions all INSERT columns that do not exist on the target table, and
  // every one of them is reachable from the shipped app. The baseline is
  // therefore scanned too — as a subject, not only as the source of truth.
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql'))) {
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

/**
 * Functions redefined by a LATER migration.
 *
 * A baseline function body that a subsequent migration CREATE OR REPLACEs is
 * dead code — the live definition is the later one. Reporting a defect inside
 * the superseded body is noise, and noise is how a guard earns the right to be
 * ignored. So findings are attributed to the function that contains them, and
 * suppressed when that function has since been replaced.
 */
function supersededFunctions() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const later = new Set();
  for (const f of files) {
    if (f.startsWith('00000000000000')) continue;
    const sql = stripSql(readFileSync(join(MIGRATIONS, f), 'utf8'));
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi)) {
      later.add(m[1]);
    }
  }
  return later;
}

/** name of the function whose body contains `index`, or null. */
function enclosingFunction(src, index) {
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
  let name = null, m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > index) break;
    name = m[1];
  }
  return name;
}

const schema = parseSchema();
const superseded = supersededFunctions();
const problems = [];
let inserts = 0, filesScanned = 0, suppressed = 0;

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

    // Skip defects inside a baseline function body that a later migration has
    // already replaced — that code no longer runs.
    if (rel.includes('00000000000000')) {
      const fn = enclosingFunction(src, m.index);
      if (fn && superseded.has(fn)) { suppressed++; continue; }
    }
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

    const { cols, required, allowed } = schema.get(table);

    // ── CHECK-constraint violation in a fixture literal ────────────────────
    //  Catches `moderation_status => 'pending_approval'` when the constraint
    //  permits only pending_review|approved|edits_requested|rejected. This
    //  aborts the INSERT with 23514 and kills the suite, exactly like a phantom
    //  column, and is just as detectable. Only plain string literals are
    //  judged; any expression, cast, variable or function call is skipped.
    //  SCOPE: test fixtures only. Several migrations perform constraint surgery
    //  (20260801140000 drops and re-adds transactions_type_check; the
    //  conversations kind constraint is widened somewhere a regex cannot
    //  follow, e.g. dynamic SQL in a DO block). Judging migrations produced 11
    //  false positives, and a guard that cries wolf gets ignored. Fixtures are
    //  authored here, are static, and are where this bug actually bites — a
    //  violation aborts the suite before a single assertion runs.
    if (allowed.size && rel.startsWith('supabase/tests/')) {
      const after = src.slice(end + 1, end + 4000);
      const vm = after.match(/^\s*VALUES\s*/i);
      if (vm) {
        let p = end + 1 + vm[0].length;
        // Walk each VALUES tuple.
        while (p < src.length && src[p] === '(') {
          let d = 0, q = null, tupleStart = p + 1, tupleEnd = -1;
          for (let k = p; k < src.length; k++) {
            const ch = src[k];
            if (q) { if (ch === q) q = null; continue; }
            if (ch === "'") { q = "'"; continue; }
            if (ch === '(') d++;
            else if (ch === ')') { d--; if (d === 0) { tupleEnd = k; break; } }
          }
          if (tupleEnd === -1) break;
          const tuple = src.slice(tupleStart, tupleEnd);
          // Split on top-level commas, respecting quotes and nesting.
          // Depth must count BRACKETS as well as parens: ARRAY['a','b'] holds a
          // top-level-looking comma that otherwise shifts every subsequent
          // value one column to the left, silently misaligning the whole tuple.
          const vals = []; let cur = '', dd = 0, qq = null;
          for (const ch of tuple) {
            if (qq) { cur += ch; if (ch === qq) qq = null; continue; }
            if (ch === "'") { qq = "'"; cur += ch; continue; }
            if (ch === '(' || ch === '[') dd++;
            if (ch === ')' || ch === ']') dd--;
            if (ch === ',' && dd === 0) { vals.push(cur); cur = ''; continue; }
            cur += ch;
          }
          vals.push(cur);
          if (vals.length === named.length) {
            for (let vi = 0; vi < vals.length; vi++) {
              const col = named[vi];
              const set = allowed.get(col);
              if (!set) continue;
              const lit = vals[vi].trim().match(/^'((?:[^']|'')*)'$/);
              if (!lit) continue;                    // expression/cast/variable — skip
              const v = lit[1].replace(/''/g, "'");
              if (!set.has(v)) {
                problems.push({
                  rel, line: src.slice(0, tupleStart).split('\n').length,
                  kind: 'CHECK VIOLATION',
                  detail: `${table}.${col} = '${v}' is not permitted (allowed: ${[...set].join('|')})`,
                });
              }
            }
          }
          // advance to the next tuple
          p = tupleEnd + 1;
          const nx = src.slice(p).match(/^\s*,\s*/);
          if (!nx) break;
          p += nx[0].length;
        }
      }
    }
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

// ── Known pre-existing defects ─────────────────────────────────────────────
//  Recorded in known-sql-schema-defects.json with a reason and a status, so the
//  guard fails on anything NEW while these stay visible. They are NOT
//  acceptable — six of the eight sit in the frozen payment domain, which is the
//  only reason they are listed rather than repaired. Deleting an entry to
//  silence the guard, rather than because the defect was fixed, defeats the
//  point of having it.
let known = {};
try {
  known = JSON.parse(readFileSync(join(ROOT, 'scripts/qa/known-sql-schema-defects.json'), 'utf8'));
} catch { /* no baseline file — every finding is new */ }

const isKnown = (p) =>
  p.rel.includes('00000000000000') && Object.prototype.hasOwnProperty.call(known, String(p.line));

const knownHits = problems.filter(isKnown);
const newProblems = problems.filter((p) => !isKnown(p));

if (newProblems.length) {
  console.error('✘ SQL fixture does not match the schema:\n');
  for (const p of newProblems) console.error(`  ${p.rel}:${p.line}  [${p.kind}]  ${p.detail}`);
  console.error(
    `\n${newProblems.length} NEW problem(s). Each one aborts at the INSERT, so everything\n` +
    `after it silently never runs. If a finding is a pre-existing baseline defect you\n` +
    `cannot fix yet, record it in scripts/qa/known-sql-schema-defects.json WITH A REASON.`,
  );
  process.exit(1);
}

console.log(
  `✓ SQL schema refs: ${inserts} INSERT(s) across ${filesScanned} file(s); ` +
  `every column exists, every NOT NULL column without a default is supplied, and ` +
  `every test-fixture literal satisfies its CHECK constraint (${schema.size} tables parsed).`,
);
if (suppressed) {
  console.log(`  ${suppressed} finding(s) skipped inside baseline functions a later migration replaces.`);
}
if (knownHits.length) {
  const fns = [...new Set(knownHits.map((p) => known[String(p.line)]?.fn).filter(Boolean))];
  const frozen = fns.filter((f) => /wallet|transaction|milestone|payout/i.test(f) ||
    ['handle_job_completion', 'handle_job_cancellation'].includes(f));
  console.log(
    `  ${knownHits.length} KNOWN pre-existing defect(s) in ${fns.length} baseline function(s), ` +
    `tracked in known-sql-schema-defects.json:`,
  );
  console.log(`      ${fns.join(', ')}`);
  console.log(
    `      ${frozen.length} of these are in the FROZEN PAYMENT DOMAIN and are reported, not fixed.`,
  );
}
