#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  check-rls-admin-coverage.mjs  ·  NEXPEC god-mode RLS regression fence
 *
 *  WHY THIS EXISTS
 *  ───────────────
 *  Rule: ONE admin role (ebi) = 100% access. A census found 60 RLS-enabled tables
 *  whose policies had NO admin branch — admin was silently locked out. The
 *  god-mode sweep (migration 20260801146000) closed them with nx_is_admin()
 *  overlays. This guard makes it STRUCTURALLY IMPOSSIBLE for a NEW table to ship
 *  RLS-governed but admin-excluded: if a table has RLS + policies but no admin
 *  branch, and it isn't on the intentional-exclusion allowlist, the build fails.
 *
 *  WHAT COUNTS AS "ADMIN-COVERED"
 *    • a static CREATE POLICY whose body calls nx_is_admin() / is_super_admin()
 *      / is_admin()  (future overlays written as plain CREATE POLICY are caught
 *      here automatically), OR
 *    • the table appears in an admin-overlay DO-block ARRAY[...] (how 146000
 *      credits its 47 tables in one loop), OR
 *    • the table is allowlisted (deliberately admin-excluded — money/price-blind,
 *      auth secrets, public reference, legacy RBAC).
 *
 *  USAGE
 *    node scripts/qa/check-rls-admin-coverage.mjs                  # CI, exit 1 on gap
 *    node scripts/qa/check-rls-admin-coverage.mjs --list           # print, exit 0
 *    node scripts/qa/check-rls-admin-coverage.mjs --write-baseline # seed allowlist
 *
 *  Zero dependencies (pure Node ≥16).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const ALLOWLIST_PATH = join(__dirname, 'rls-admin-allowlist.json');

const MODE = process.argv.includes('--write-baseline')
  ? 'baseline'
  : process.argv.includes('--list')
    ? 'list'
    : 'check';

const ADMIN_RE = /nx_is_admin|is_super_admin|(?<![_\w])is_admin\s*\(\)/;

function allMigrationSql() {
  if (!existsSync(MIGRATIONS_DIR)) return '';
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

function stripQuotes(s) {
  return s.replace(/"/g, '').trim();
}

function main() {
  const sql = allMigrationSql();

  // 1. RLS-enabled tables
  const rls = new Set();
  for (const m of sql.matchAll(
    /ALTER TABLE (?:ONLY )?(?:"public"|public)\."?([a-z0-9_]+)"? ENABLE ROW LEVEL SECURITY/gi,
  )) {
    rls.add(m[1]);
  }

  // 2. static policies → table + whether body references an admin helper
  const hasPolicy = new Set();
  const adminCovered = new Set();
  for (const m of sql.matchAll(
    /CREATE POLICY "?[^"\n]+"? ON (?:"public"|public)\."?([a-z0-9_]+)"?([\s\S]*?);/gi,
  )) {
    const tbl = m[1];
    hasPolicy.add(tbl);
    if (ADMIN_RE.test(m[2])) adminCovered.add(tbl);
  }

  // 3. admin-overlay DO-block arrays (one loop credits many tables at once)
  //    Only trust ARRAY[...] that live in a file wiring nx_is_admin overlays.
  for (const m of sql.matchAll(/(?:full_tables|read_tables)\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/gi)) {
    for (const q of m[1].matchAll(/'([a-z0-9_]+)'/gi)) adminCovered.add(q[1]);
  }

  // 4. allowlist (intentional admin-exclusions)
  const allow = existsSync(ALLOWLIST_PATH)
    ? new Set(JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')))
    : new Set();

  // A table is a VIOLATION when: RLS on + has >=1 policy + not admin-covered + not allowlisted
  const violations = [...rls]
    .filter((t) => hasPolicy.has(t) && !adminCovered.has(t) && !allow.has(t))
    .sort();

  if (MODE === 'baseline') {
    const merged = [...new Set([...allow, ...violations])].sort();
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(merged, null, 2) + '\n');
    console.log(`Wrote ${merged.length} entries to rls-admin-allowlist.json`);
    return;
  }

  console.log(
    `RLS tables: ${rls.size} · with policies: ${hasPolicy.size} · admin-covered: ${adminCovered.size} · allowlisted: ${allow.size}`,
  );

  if (violations.length === 0) {
    console.log('ok: every RLS-governed table grants admin access or is explicitly allowlisted.');
    return;
  }

  console.error(`\n${violations.length} RLS table(s) governed but admin-excluded:\n`);
  for (const t of violations) console.error(`  - ${t}`);
  if (MODE === 'list') return;
  console.error(
    '\n::error::God-mode gap. Add an admin overlay (CREATE POLICY <t>_admin_all/_admin_read ' +
      'USING (public.nx_is_admin())) in a migration, or, if the table is intentionally ' +
      'admin-excluded, add it to scripts/qa/rls-admin-allowlist.json with rationale in the PR.',
  );
  process.exit(1);
}

main();
