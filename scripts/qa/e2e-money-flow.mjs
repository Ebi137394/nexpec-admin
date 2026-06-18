#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/e2e-money-flow.mjs — Phase 5 staging End-to-End money-flow runner
//
//  pgTAP (supabase/tests/*) proves the DATABASE layer (RLS, constraints, RPC
//  bodies) in isolation. This runner proves the FULL STACK above it: real
//  Supabase auth sessions (real JWT -> real auth.uid()) drive the canonical
//  manual-payout chain end to end, exactly as the web/mobile clients do:
//
//    credit_inspector_earning_on_approval   (admin/service: accrue earning)
//      -> settle_client_payment             (net_terms: pending -> available)
//        -> request_withdrawal              (INSPECTOR session: reserve funds)
//          -> admin_mark_withdrawal_paid     (ADMIN session: Treasury Mark-as-Paid)
//
//  ...plus the supplier (halalas) branch, idempotency replays, and the security
//  negatives (anon blocked, non-admin mark-paid denied, insufficient balance,
//  direct wallet UPDATE inert under RLS).
//
//  100% MANUAL payouts — there is NO Stripe/automated rail in this path, by
//  design. This runner asserts that the only way money moves is through these
//  SECURITY DEFINER RPCs.
//
//  SAFETY: refuses to run against the known production project ref unless
//  ALLOW_PROD=1 is explicitly set. Creates throwaway users with a per-run tag
//  and deletes them (and their rows) in a finally block.
//
//  Usage:
//    SUPABASE_URL=https://<staging-ref>.supabase.co \
//    SUPABASE_SERVICE_ROLE_KEY=<staging service_role> \
//    SUPABASE_ANON_KEY=<staging anon> \
//    node scripts/qa/e2e-money-flow.mjs            # or: npm run qa:e2e:money
//
//  Flags / env:
//    --keep          leave seeded test data in place (debugging)
//    ALLOW_PROD=1    permit running against the production ref (NOT recommended)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const KEEP = process.argv.includes('--keep');
const PROD_REF = 'sxqpjxhslzzcdrdctatm'; // production project ref — must not run here

if (!URL || !SERVICE || !ANON) {
  console.error('FATAL: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (staging).');
  process.exit(2);
}
if (URL.includes(PROD_REF) && process.env.ALLOW_PROD !== '1') {
  console.error(`FATAL: SUPABASE_URL points at the PRODUCTION ref (${PROD_REF}).`);
  console.error('This runner creates and deletes users. Point it at staging, or set ALLOW_PROD=1 to override.');
  process.exit(2);
}

const RUN = Date.now().toString(36);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts); // service_role: bypasses RLS, used for seeding + readback

// ── tiny assertion harness ──────────────────────────────────────────────────
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail !== undefined ? `  (${JSON.stringify(detail)})` : ''}`); }
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
// run an RPC and return {data, errCode, errMsg}
async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  return { data, errCode: error?.code, errMsg: error?.message, error };
}

// ── user provisioning (real auth session) ────────────────────────────────────
const created = []; // {id, email}
async function makeUser(role) {
  const email = `e2e_${role}_${RUN}@nexpec.test`;
  const password = `Pw!${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${role}): ${error.message}`);
  const id = data.user.id;
  created.push({ id, email });
  // profiles may be auto-created by a trigger; upsert the role either way.
  const { error: pErr } = await admin.from('profiles').upsert({ id, email, role }, { onConflict: 'id' });
  if (pErr) throw new Error(`profiles upsert(${role}): ${pErr.message}`);
  const client = createClient(URL, ANON, opts);
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn(${role}): ${sErr.message}`);
  return { id, email, client };
}

const jobIds = [];
async function seedJob({ clientId, inspectorId, cents, mode }) {
  const id = randomUUID();
  const { error } = await admin.from('jobs').insert({
    id, title: `E2E ${mode} ${RUN}`,
    client_id: clientId, contractor_id: inspectorId,
    inspector_payout_cents: cents, payment_mode: mode,
    admin_confirmed_at: new Date().toISOString(),
  });
  if (error) throw new Error(`seedJob(${mode}): ${error.message}`);
  jobIds.push(id);
  return id;
}
const wallet = async (uid) => (await admin.from('wallets').select('*').eq('user_id', uid).maybeSingle()).data;
const earn = async (uid) => (await admin.from('supplier_earnings').select('*').eq('supplier_id', uid).maybeSingle()).data;

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\nNEXPEC E2E money-flow — run ${RUN} against ${URL}\n`);

  const inspector = await makeUser('inspector');
  const supplier = await makeUser('supplier');
  const client = await makeUser('client');
  const adm = await makeUser('admin');
  const anon = createClient(URL, ANON, opts); // no session

  // ── 1. INSPECTOR accrual: prepay clears straight to available ──────────────
  console.log('\n[1] Inspector accrual (prepay + net_terms)');
  const jobPrepay = await seedJob({ clientId: client.id, inspectorId: inspector.id, cents: 36000, mode: 'prepay' });
  const c1 = await rpc(adm.client, 'credit_inspector_earning_on_approval', { p_job_id: jobPrepay });
  check('prepay accrual ok', c1.data?.ok === true, c1.errMsg);
  const c1b = await rpc(adm.client, 'credit_inspector_earning_on_approval', { p_job_id: jobPrepay });
  check('prepay accrual idempotent', c1b.data?.idempotent === true, c1b.data ?? c1b.errMsg);
  let w = await wallet(inspector.id);
  check('prepay -> available_balance = 360', near(w?.available_balance, 360), w);

  // net_terms accrues to pending until the client settles
  const jobNet = await seedJob({ clientId: client.id, inspectorId: inspector.id, cents: 10000, mode: 'net_terms' });
  const c2 = await rpc(adm.client, 'credit_inspector_earning_on_approval', { p_job_id: jobNet });
  check('net_terms accrual ok', c2.data?.ok === true, c2.errMsg);
  w = await wallet(inspector.id);
  check('net_terms -> pending_amount = 100', near(w?.pending_amount, 100), w);
  check('net_terms does NOT touch available yet', near(w?.available_balance, 360), w);

  // ── 2. settle the net_terms job: pending -> available ──────────────────────
  console.log('\n[2] Client settlement (net_terms clears to available)');
  const s1 = await rpc(adm.client, 'settle_client_payment', { p_job_id: jobNet });
  check('settle ok', s1.data?.ok === true, s1.errMsg);
  const s1b = await rpc(adm.client, 'settle_client_payment', { p_job_id: jobNet });
  check('settle idempotent', s1b.data?.idempotent === true, s1b.data ?? s1b.errMsg);
  w = await wallet(inspector.id);
  check('after settle -> available = 460', near(w?.available_balance, 460), w);
  check('after settle -> pending_amount = 0', near(w?.pending_amount, 0), w);

  // ── 3. security negatives BEFORE opening a request ─────────────────────────
  console.log('\n[3] Withdrawal security negatives');
  // Tax-info-before-money: a payee with no verified tax profile is blocked.
  const taxBlocked = await rpc(inspector.client, 'request_withdrawal',
    { p_amount_cents: 1000, p_method: 'bank_transfer', p_client_op_id: randomUUID() });
  check('withdrawal blocked until tax verified (TAX_NOT_VERIFIED)', /TAX_NOT_VERIFIED/.test(taxBlocked.errMsg || ''), taxBlocked.errMsg);
  // Verify tax (tokenized; no raw PII) so the rest of the flow proceeds.
  const txErr = (await admin.from('tax_profiles')
    .upsert({ user_id: inspector.id, tax_status: 'verified', form_type: 'w9', tax_residency_country: 'US' }, { onConflict: 'user_id' })).error;
  check('seed verified tax_profile (inspector)', !txErr, txErr?.message);

  const insuff = await rpc(inspector.client, 'request_withdrawal',
    { p_amount_cents: 99999900, p_method: 'bank_transfer', p_client_op_id: randomUUID() });
  check('insufficient balance rejected (P0001)', insuff.errCode === 'P0001', insuff.errMsg);
  const anonReq = await rpc(anon, 'request_withdrawal',
    { p_amount_cents: 100, p_method: 'bank_transfer', p_client_op_id: randomUUID() });
  check('anon withdrawal blocked (28000 NOT_AUTHENTICATED)', anonReq.errCode === '28000', anonReq.errMsg);

  // ── 4. INSPECTOR requests a real withdrawal (reserve available->pending) ────
  console.log('\n[4] Inspector withdrawal request');
  const opId = randomUUID();
  const wd = await rpc(inspector.client, 'request_withdrawal',
    { p_amount_cents: 20000, p_method: 'bank_transfer', p_note: 'e2e', p_client_op_id: opId });
  check('withdrawal created', wd.data?.ok === true && !!wd.data?.request_id, wd.errMsg);
  const reqId = wd.data?.request_id;
  w = await wallet(inspector.id);
  check('reserve -> available = 260', near(w?.available_balance, 260), w);
  check('reserve -> pending_payouts = 200', near(w?.pending_payouts, 200), w);

  const wdReplay = await rpc(inspector.client, 'request_withdrawal',
    { p_amount_cents: 20000, p_method: 'bank_transfer', p_note: 'e2e', p_client_op_id: opId });
  check('withdrawal idempotent replay (same op id)', wdReplay.data?.idempotent === true, wdReplay.data ?? wdReplay.errMsg);
  const wdOpen = await rpc(inspector.client, 'request_withdrawal',
    { p_amount_cents: 1000, p_method: 'bank_transfer', p_client_op_id: randomUUID() });
  check('second open request blocked (OPEN_REQUEST_EXISTS)', /OPEN_REQUEST_EXISTS/.test(wdOpen.errMsg || ''), wdOpen.errMsg);

  // direct balance tamper under RLS: no UPDATE policy -> 0 rows, balance unchanged
  await inspector.client.from('wallets').update({ available_balance: 999999 }).eq('user_id', inspector.id);
  w = await wallet(inspector.id);
  check('direct wallet UPDATE is inert under RLS (no mint)', near(w?.available_balance, 260), w);

  // ── 5. non-admin cannot mark paid; admin can (Treasury Mark-as-Paid) ────────
  console.log('\n[5] Admin Mark-as-Paid');
  const badMark = await rpc(inspector.client, 'admin_mark_withdrawal_paid', { p_id: reqId, p_reference: 'nope' });
  check('non-admin mark-paid denied (42501)', badMark.errCode === '42501', badMark.errMsg);
  const mark = await rpc(adm.client, 'admin_mark_withdrawal_paid', { p_id: reqId, p_reference: `E2E-${RUN}` });
  check('admin mark-paid ok', mark.data?.ok === true, mark.errMsg);
  const markAgain = await rpc(adm.client, 'admin_mark_withdrawal_paid', { p_id: reqId, p_reference: `E2E-${RUN}` });
  check('mark-paid idempotent', markAgain.data?.idempotent === true, markAgain.data ?? markAgain.errMsg);
  w = await wallet(inspector.id);
  check('after payout -> pending_payouts = 0', near(w?.pending_payouts, 0), w);
  check('after payout -> total_spent = 200', near(w?.total_spent, 200), w);
  const reqRow = (await admin.from('withdrawal_requests').select('status').eq('id', reqId).single()).data;
  check('withdrawal row status = paid', reqRow?.status === 'paid', reqRow);

  // ── 6. SUPPLIER branch (halalas ledger) ────────────────────────────────────
  console.log('\n[6] Supplier withdrawal branch (halalas)');
  const seErr = (await admin.from('supplier_earnings')
    .upsert({ supplier_id: supplier.id, available_balance_halalas: 50000, pending_halalas: 0 }, { onConflict: 'supplier_id' })).error;
  check('seed supplier_earnings', !seErr, seErr?.message);
  // Supplier must also clear the tax gate before any payout.
  await admin.from('tax_profiles')
    .upsert({ user_id: supplier.id, tax_status: 'verified', form_type: 'w8ben', tax_residency_country: 'CA' }, { onConflict: 'user_id' });
  const sOp = randomUUID();
  const sWd = await rpc(supplier.client, 'request_withdrawal',
    { p_amount_cents: 30000, p_method: 'bank_transfer', p_client_op_id: sOp });
  check('supplier withdrawal created', sWd.data?.ok === true, sWd.errMsg);
  let e = await earn(supplier.id);
  check('supplier reserve -> available_halalas = 20000', Number(e?.available_balance_halalas) === 20000, e);
  check('supplier reserve -> pending_halalas = 30000', Number(e?.pending_halalas) === 30000, e);
  const sMark = await rpc(adm.client, 'admin_mark_withdrawal_paid', { p_id: sWd.data?.request_id, p_reference: `E2E-S-${RUN}` });
  check('supplier mark-paid ok', sMark.data?.ok === true, sMark.errMsg);
  e = await earn(supplier.id);
  check('supplier after payout -> pending_halalas = 0', Number(e?.pending_halalas) === 0, e);

  // ── done ───────────────────────────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (fail) console.log(`FAILED: ${fails.join(', ')}`);
  console.log(`──────────────────────────────────────────────\n`);
}

// ── cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  if (KEEP) { console.log('--keep set: leaving seeded data in place.'); return; }
  const ids = created.map((u) => u.id);
  if (!ids.length) return;
  try {
    for (const id of jobIds) await admin.from('jobs').delete().eq('id', id);
    await admin.from('withdrawal_requests').delete().in('requester_id', ids);
    await admin.from('transactions').delete().in('user_id', ids);
    await admin.from('payout_advances').delete().in('requester_id', ids);
    await admin.from('supplier_earnings').delete().in('supplier_id', ids);
    await admin.from('wallets').delete().in('user_id', ids);
    await admin.from('profiles').delete().in('id', ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
    console.log(`Cleanup: removed ${ids.length} test users + their rows.`);
  } catch (err) {
    console.error(`Cleanup warning: ${err.message}`);
  }
}

let exitCode = 0;
try {
  await main();
  exitCode = fail > 0 ? 1 : 0;
} catch (err) {
  console.error(`\nFATAL: ${err.stack || err.message}`);
  exitCode = 2;
} finally {
  await cleanup();
}
process.exit(exitCode);
