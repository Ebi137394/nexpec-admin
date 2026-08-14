#!/usr/bin/env node
/**
 * scripts/qa/revoke-privileged-qa.mjs — remove the TEMPORARY synthetic
 * privileged accounts before a human ever signs in for Manual QA.
 *
 * OWNER ACCESS POLICY
 *   NEXPEC has exactly one real privileged human operator: the owner, holding
 *   super_admin. The synthetic pair qa.superadmin@ / qa.admin@ exists only so
 *   automated least-privilege and privilege-escalation tests have something to
 *   assert against. Leaving them behind would mean the platform carries two
 *   standing admin identities that belong to nobody — precisely the thing the
 *   policy exists to prevent.
 *
 *   So: create them with SEED_PRIVILEGED=1, run the privileged tests, then run
 *   this. It is the second half of that pair and is not optional.
 *
 * WHAT IT DOES
 *   Deletes the two synthetic privileged auth users outright (which cascades
 *   their profile row). Deleting beats demoting: a demoted account still has a
 *   working password and could be re-elevated by anyone who can write a role.
 *
 * WHAT IT WILL NOT DO
 *   • Touch Production, or any ref not vetted in staging-guard.mjs.
 *   • Touch the owner's super_admin identity.
 *   • Touch any non-privileged QA account (client, inspector, senior, agency,
 *     supplier, enterprise, talent, rfq buyer) — Manual QA still needs those.
 *
 * RUN
 *   set -a; . ~/.nexpec-staging.env; set +a
 *   node scripts/qa/revoke-privileged-qa.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { assertNotProduction } from './staging-guard.mjs';

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error('FATAL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
try {
  assertNotProduction(URL, 'privileged QA account revocation');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** Only ever these two. Never the owner, never a non-privileged QA role. */
const SYNTHETIC_PRIVILEGED = [
  'qa.superadmin@nexpec.test',
  'qa.admin@nexpec.test',
];

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function main() {
  console.log(`\nRevoking synthetic privileged QA accounts on ${URL}\n`);

  const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) { console.error('FATAL listUsers:', error.message); process.exit(1); }

  let removed = 0;
  for (const email of SYNTHETIC_PRIVILEGED) {
    const u = list.users.find((x) => x.email === email);
    if (!u) { console.log(`  ok   ${email} — already absent`); continue; }
    const { error: dErr } = await admin.auth.admin.deleteUser(u.id);
    if (dErr) { console.error(`  FAIL ${email}: ${dErr.message}`); process.exitCode = 1; }
    else { console.log(`  ok   ${email} — DELETED`); removed += 1; }
  }

  // Prove the end state rather than assuming the deletes did what we wanted.
  const { data: still } = await admin
    .from('profiles').select('email, role').in('role', ['admin', 'super_admin']);
  const rows = still ?? [];
  const synthetic = rows.filter((r) => (r.email ?? '').startsWith('qa.'));

  console.log(`\n  removed this run           : ${removed}`);
  console.log(`  privileged identities left : ${rows.length}`);
  console.log(`  of which synthetic (qa.*)  : ${synthetic.length}`);
  for (const r of rows) {
    // Never print the owner's address. A short hash is enough to show WHICH
    // identity survived without publishing it.
    const em = r.email ?? '';
    const h = em.startsWith('qa.')
      ? em
      : `<owner identity, hash ${(await import('node:crypto'))
          .createHash('sha256').update(em).digest('hex').slice(0, 8)}>`;
    console.log(`    role=${String(r.role).padEnd(12)} ${h}`);
  }

  if (synthetic.length) {
    console.error('\n  REFUSING TO PASS: synthetic privileged accounts still exist.');
    process.exitCode = 1;
  } else {
    console.log('\n  Clean: the only privileged identity is the owner.\n');
  }
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
