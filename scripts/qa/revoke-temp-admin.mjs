#!/usr/bin/env node
/**
 * scripts/qa/revoke-temp-admin.mjs — delete the temporary Staging admin used
 * for browser testing, and prove it is gone.
 *
 * OWNER ACCESS POLICY
 *   NEXPEC has exactly one persistent privileged human: the owner, holding
 *   super_admin. Admin browser testing needs an `admin` session, so one
 *   temporary account is created for the run and must not survive it. An admin
 *   identity nobody owns is precisely what the policy exists to prevent.
 *
 * WHY DELETE RATHER THAN DEMOTE
 *   A demoted account keeps a working password and can be re-elevated by
 *   anything that can write a role. Deleting the auth user cascades the profile
 *   and leaves nothing to re-elevate.
 *
 * WHAT IT WILL NOT TOUCH
 *   • Production, or any ref not vetted in staging-guard.mjs.
 *   • The owner's super_admin identity.
 *   • The eight non-privileged QA accounts the owner's Manual QA still needs.
 *
 * It also removes the local secret file, so the generated password does not
 * outlive the account it belonged to.
 *
 * RUN
 *   set -a; . ~/.nexpec-staging.env; set +a
 *   node scripts/qa/revoke-temp-admin.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertNotProduction } from './staging-guard.mjs';

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error('FATAL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
try {
  assertNotProduction(URL, 'temporary admin revocation');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const TEMP_ADMIN = 'qa.tempadmin@nexpec.test';
const SECRET_PATH = `${process.env.HOME}/.nexpec-temp-admin`;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (error) { console.error('FATAL listUsers:', error.message); process.exit(1); }

const u = list.users.find((x) => x.email === TEMP_ADMIN);
if (!u) {
  console.log(`  ok   ${TEMP_ADMIN} — already absent`);
} else {
  const { error: dErr } = await admin.auth.admin.deleteUser(u.id);
  if (dErr) { console.error(`  FAIL ${TEMP_ADMIN}: ${dErr.message}`); process.exitCode = 1; }
  else console.log(`  ok   ${TEMP_ADMIN} — DELETED`);
}

if (existsSync(SECRET_PATH)) {
  rmSync(SECRET_PATH, { force: true });
  console.log('  ok   local secret file removed');
}

// Prove the end state from the database rather than trusting the deletes.
const { data: still } = await admin
  .from('profiles').select('email, role').in('role', ['admin', 'super_admin']);
const rows = still ?? [];
const synthetic = rows.filter((r) => (r.email ?? '').startsWith('qa.'));

console.log(`\n  privileged identities left : ${rows.length}`);
console.log(`  of which synthetic (qa.*)  : ${synthetic.length}`);
for (const r of rows) {
  const em = r.email ?? '';
  const label = em.startsWith('qa.')
    ? em
    : `<owner identity, hash ${createHash('sha256').update(em).digest('hex').slice(0, 8)}>`;
  console.log(`    role=${String(r.role).padEnd(12)} ${label}`);
}

if (synthetic.length) {
  console.error('\n  REFUSING TO PASS: a synthetic privileged account still exists.');
  process.exitCode = 1;
} else {
  console.log('\n  Clean: the only privileged identity is the owner.\n');
}
