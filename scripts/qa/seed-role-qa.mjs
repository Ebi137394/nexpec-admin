#!/usr/bin/env node
/**
 * scripts/qa/seed-role-qa.mjs — synthetic Manual QA users for AGENCY and SUPPLIER.
 *
 * WHY THIS EXISTS
 *   `supabase db reset` leaves an empty database, and qa:e2e:money creates then
 *   DELETES its own users. Manual QA therefore had no durable accounts to sign in
 *   with. This seeds two stable ones plus the minimum synthetic data each role
 *   needs to have something to look at.
 *
 * RULES IT OBEYS (the same ones the pgTAP fixtures had to learn)
 *   • NEVER presets contractor_id: attaching an inspector IS a dispatch, and
 *     nx_guard_dispatch_requires_funding refuses an unfunded one. Jobs are created
 *     UNASSIGNED. Nothing here dispatches.
 *   • NEVER presets client_settled_at from a client context. Only the SERVICE-ROLE
 *     client (a platform actor) writes funding columns, and this script does not
 *     fund anything — these are pre-dispatch jobs by design.
 *   • Moves NO money. No payout, settlement, withdrawal or ledger row.
 *   • Idempotent: re-running updates in place rather than duplicating.
 *
 * LOCAL / STAGING ONLY. It refuses to run against a URL it does not recognise as
 * local unless ALLOW_REMOTE_SEED=1 is set explicitly.
 *
 * RUN
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
 *   node scripts/qa/seed-role-qa.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { assertNotProduction } from './staging-guard.mjs';

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error('FATAL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
// Hard guard: local and vetted Staging only. Production throws with no override,
// and an unrecognised ref throws too — "not obviously Production" is not "safe".
try {
  assertNotProduction(URL, 'QA role seeding');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'NexpecQA!2026';
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m, e) => { console.error(`  FAIL ${m}: ${e?.message ?? e}`); process.exitCode = 1; };

/** Create-or-reuse an auth user, then force role + email on the profile. */
async function upsertUser(email, role, fullName) {
  let id;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (error) {
    // Already there from a previous run — find them and reuse.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const found = list?.users?.find((u) => u.email === email);
    if (!found) throw new Error(`createUser(${email}): ${error.message}`);
    id = found.id;
    await admin.auth.admin.updateUserById(id, { password: PASSWORD });
  } else {
    id = created.user.id;
  }
  const { error: pErr } = await admin.from('profiles')
    .upsert({ id, email, role, full_name: fullName }, { onConflict: 'id' });
  if (pErr) throw new Error(`profiles(${role}): ${pErr.message}`);
  return id;
}

async function main() {
  console.log(`\nNEXPEC Manual QA seed — AGENCY + SUPPLIER against ${URL}\n`);

  // ── Agency ────────────────────────────────────────────────────────────────
  console.log('[agency]');
  const agencyId = await upsertUser('qa.agency@nexpec.test', 'agency', 'QA Agency');
  ok(`agency user  qa.agency@nexpec.test  (${agencyId.slice(0, 8)}…)`);

  // An agency-owned job, UNASSIGNED and unfunded. agency_id is what
  // jobs_secure_view scopes on, so this is the row the agency dashboard reads.
  const { data: job, error: jErr } = await admin.from('jobs').insert({
    title: 'QA — Agency pipeline inspection',
    description: 'Synthetic Manual QA job owned by the QA agency.',
    // jobs_owner_xor CHECK: exactly ONE of client_id / agency_id may be set.
    // An agency-owned job therefore sets agency_id and leaves client_id NULL —
    // which is also what jobs_secure_view scopes the agency's rows on.
    agency_id: agencyId,
    status: 'pending_approval', moderation_status: 'approved',
    client_price_cents: 150000, inspector_payout_cents: 100000,
  }).select('id').single();
  if (jErr) fail('agency job', jErr); else ok(`agency job created UNASSIGNED (${job.id.slice(0, 8)}…)`);

  // ── Supplier ──────────────────────────────────────────────────────────────
  console.log('\n[supplier]');
  const supplierId = await upsertUser('qa.supplier@nexpec.test', 'supplier', 'QA Supplier Ltd');
  ok(`supplier user  qa.supplier@nexpec.test  (${supplierId.slice(0, 8)}…)`);

  const { error: spErr } = await admin.from('supplier_profiles').upsert({
    id: supplierId,                 // PK is the profile/user id
    legal_name: 'QA Supplier Ltd',  // NOT NULL
    headline: 'Synthetic Manual QA supplier',
    country_code: 'CA',
    is_active: true,
  }, { onConflict: 'id' });
  if (spErr) fail('supplier_profiles', spErr); else ok('supplier_profiles row');

  // A buyer to raise the RFQ, so the supplier has an opportunity to look at.
  const buyerId = await upsertUser('qa.rfqbuyer@nexpec.test', 'client', 'QA RFQ Buyer');
  ok(`rfq buyer  qa.rfqbuyer@nexpec.test  (${buyerId.slice(0, 8)}…)`);

  const { data: rfq, error: rErr } = await admin.from('supplier_rfqs').insert({
    client_id: buyerId,             // NOT NULL — the buyer raising the RFQ
    title: 'QA — Valve supply RFQ',
    spec: 'Synthetic RFQ so /suppliers/opportunities is not empty.',
    status: 'open',
    public_listable: true,
  }).select('id').single();
  if (rErr) fail('supplier_rfqs', rErr); else ok(`open RFQ created (${rfq.id.slice(0, 8)}…)`);

  console.log('\n──────────────────────────────────────────────');
  console.log('  Agency    qa.agency@nexpec.test');
  console.log('  Supplier  qa.supplier@nexpec.test');
  console.log('  RFQ buyer qa.rfqbuyer@nexpec.test');
  console.log(`  Password  ${PASSWORD}   (all three)`);
  console.log('──────────────────────────────────────────────');
  console.log('  No money moved. No job dispatched. Re-runnable.\n');
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
