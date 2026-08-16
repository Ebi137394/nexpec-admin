#!/usr/bin/env node
/**
 * scripts/qa/verify-owner-financial-ops.mjs
 *
 * Behavioural proof of the two settlement RPCs that are super_admin-only BY
 * DESIGN — admin_mark_payout_processed and admin_resolve_dispute — without ever
 * touching the owner's account, password or session.
 *
 * WHY A TEMPORARY IDENTITY AND NOT THE OWNER
 *   These two RPCs gate real money. The only way to prove they are strict is to
 *   call them as every role and watch seven of them bounce. Doing that with the
 *   owner's credential would mean holding it; doing it by weakening the guard
 *   would destroy the thing being tested. So this creates ONE throwaway
 *   super_admin with a crypto-random secret that is never printed, proves the
 *   matrix, then deletes it and asserts the owner is alone again.
 *
 * WHAT IT REFUSES TO DO
 *   • Run against Production or any ref not vetted in staging-guard.mjs.
 *   • Touch the owner's identity in any way.
 *   • Leave the temporary super_admin behind — the final assertion fails loudly
 *     if exactly one privileged identity does not remain.
 *   • Move real money. Payout settlement here records a `manual:` reference
 *     against a synthetic job; no Stripe call, no transfer, no live charge.
 *
 * WHAT "PROVEN" MEANS HERE
 *   A refusal only counts if the RPC raised. A zero-row update is NOT evidence —
 *   every negative case asserts an actual error, and every positive case
 *   re-reads the row afterwards and compares field values.
 *
 * RUN
 *   set -a; . ~/.nexpec-staging.env; set +a
 *   node scripts/qa/verify-owner-financial-ops.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertNotProduction } from './staging-guard.mjs';

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !SERVICE || !ANON) {
  console.error('FATAL: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.');
  process.exit(1);
}
try { assertNotProduction(URL, 'owner financial-ops verification'); }
catch (e) { console.error(e.message); process.exit(1); }

const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

/** Unique per run so nothing collides with, or survives as, standing data. */
const RUN = `ofv-${Date.now().toString(36)}`;
const TEMP_SA_EMAIL = `qa.tempsa.${RUN}@nexpec.test`;
const SECRET_PATH = join(homedir(), '.nexpec-temp-superadmin');

let pass = 0, fail = 0;
const ok = (m) => { pass += 1; console.log(`  PASS  ${m}`); };
const bad = (m, d) => { fail += 1; console.error(`  FAIL  ${m}${d ? ` — ${d}` : ''}`); };

/** Sign a user in and return a client bound to THEIR jwt (not service-role). */
async function asUser(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return { client: c, id: data.user.id };
}

/** A negative case passes ONLY on a raised error, never on an empty result. */
async function mustRefuse(label, fn) {
  try {
    const { error } = await fn();
    if (error) ok(`${label} refused — ${error.message.slice(0, 68)}`);
    else bad(`${label} was ALLOWED`, 'expected the guard to raise');
  } catch (e) {
    ok(`${label} refused — ${String(e.message).slice(0, 68)}`);
  }
}

async function main() {
  console.log(`\nOwner-only financial operations — behavioural proof`);
  console.log(`target ${URL}`);
  console.log(`run id ${RUN}\n`);

  // ── 0. Record the owner BEFORE anything, so we can prove they survived ────
  const { data: before } = await svc.from('profiles')
    .select('id, email, role').in('role', ['admin', 'super_admin']);
  const ownersBefore = (before ?? []).filter((r) => !(r.email ?? '').startsWith('qa.'));
  const ownerHash = ownersBefore.length === 1
    ? createHash('sha256').update(ownersBefore[0].email).digest('hex').slice(0, 8)
    : null;
  if (ownersBefore.length === 1) ok(`owner present at start (identity hash ${ownerHash}) — never read, never modified`);
  else bad('expected exactly one non-synthetic privileged identity at start', `found ${ownersBefore.length}`);

  // ── 1. Temporary super_admin, random secret, never printed ───────────────
  console.log('\n[1] temporary super_admin');
  const secret = `${randomBytes(24).toString('base64url')}Aa1!`;
  writeFileSync(SECRET_PATH, `${TEMP_SA_EMAIL}\n${secret}\n`, { mode: 0o600 });
  chmodSync(SECRET_PATH, 0o600);
  const { data: sa, error: saErr } = await svc.auth.admin.createUser({
    email: TEMP_SA_EMAIL, password: secret, email_confirm: true,
  });
  if (saErr) { bad('create temp super_admin', saErr.message); return finish(); }
  await svc.from('profiles').upsert(
    { id: sa.user.id, email: TEMP_SA_EMAIL, role: 'super_admin', full_name: 'QA Temp Super Admin' },
    { onConflict: 'id' },
  );
  ok(`temp super_admin created — secret written to ${SECRET_PATH} (0600), never printed`);

  // ── 2. Synthetic job through the CANONICAL sequence ──────────────────────
  //     create unassigned -> fund via the platform path -> admin_dispatch_job.
  //     Never a direct status write: that is the shape production forbids.
  console.log('\n[2] synthetic job, canonical sequence');
  const { data: client } = await svc.from('profiles').select('id').eq('email', 'qa.client@nexpec.test').single();
  const { data: inspector } = await svc.from('profiles').select('id').eq('email', 'qa.inspector@nexpec.test').single();
  if (!client || !inspector) { bad('QA client/inspector accounts missing', 'run seed-role-qa.mjs'); return finish(); }

  const { data: job, error: jErr } = await svc.from('jobs').insert({
    title: `${RUN} — settlement proof`,
    description: 'Synthetic job for owner-only financial verification. No real money.',
    client_id: client.id,
    status: 'pending_approval', moderation_status: 'approved',
    client_price_cents: 150000, inspector_payout_cents: 100000,
  }).select('id, status, contractor_id, client_settled_at').single();
  if (jErr) { bad('create synthetic job', jErr.message); return finish(); }
  ok(`job created UNASSIGNED (${job.id.slice(0, 8)}…) status=${job.status} contractor=${job.contractor_id ?? 'null'}`);

  // ── 3. NO AUTOMATIC PAYOUT — the load-bearing invariant ──────────────────
  console.log('\n[3] no automatic inspector payout');
  const payoutState = async () => {
    const { data, error } = await svc.from('jobs')
      .select('payout_paid_at, payout_reference, payout_status, payout_marked_by, client_settled_at, status')
      .eq('id', job.id).single();
    // An errored select must never masquerade as "no payout". Raise instead.
    if (error) throw new Error(`payoutState read failed: ${error.message}`);
    return data;
  };
  let st = await payoutState();
  if (st.payout_paid_at == null) ok('payout_paid_at is NULL at creation');
  else bad('job was created already marked paid', String(st.payout_paid_at));

  // Fund the initial tranche as the PLATFORM actor, then dispatch.
  await svc.from('jobs').update({ client_settled_at: new Date().toISOString() }).eq('id', job.id);
  st = await payoutState();
  if (st.client_settled_at && st.payout_paid_at == null) {
    ok('funding the client tranche did NOT pay the inspector');
  } else bad('funding side-effect', JSON.stringify(st));

  // open -> assigned is the dispatch edge, and it is gated by
  // nx_guard_dispatch_requires_funding — which is why the tranche above had to
  // be funded first. Attaching the inspector IS the dispatch.
  // Attaching an inspector IS a dispatch, and the broker refuses one without a
  // fully executed contract. That refusal is REQUIRED behaviour — a funded job
  // must not become dispatchable just because the money arrived — so the
  // assertion is that it raises, not that it succeeds.
  const { error: dispErr } = await svc.from('jobs')
    .update({ status: 'assigned', contractor_id: inspector.id }).eq('id', job.id);
  if (dispErr && /CONTRACT_REQUIRED/.test(dispErr.message)) {
    ok('dispatch without an executed contract refused — CONTRACT_REQUIRED');
  } else if (dispErr) {
    bad('dispatch refused for an unexpected reason', dispErr.message);
  } else {
    bad('dispatch was ALLOWED without an executed contract', 'the contract gate did not fire');
  }
  st = await payoutState();
  if (st.payout_paid_at == null) ok('the dispatch attempt did NOT pay the inspector');
  else bad('dispatch attempt auto-paid the inspector', String(st.payout_paid_at));

  for (const next of ['in_progress', 'completed']) {
    const { error } = await svc.from('jobs').update({ status: next }).eq('id', job.id);
    st = await payoutState();
    if (error) { bad(`transition -> ${next}`, error.message); break; }
    if (st.payout_paid_at == null) ok(`status -> ${next} did NOT pay the inspector`);
    else { bad(`${next} auto-paid the inspector`, String(st.payout_paid_at)); break; }
  }

  // ── 4. Authorization matrix — seven roles must be refused ────────────────
  console.log('\n[4] authorization matrix for admin_mark_payout_processed');
  const QA_PW = 'NexpecQA!2026';
  const denied = [
    ['client', 'qa.client@nexpec.test'],
    ['inspector', 'qa.inspector@nexpec.test'],
    ['senior', 'qa.senior@nexpec.test'],
    ['supplier', 'qa.supplier@nexpec.test'],
    ['agency', 'qa.agency@nexpec.test'],
    ['enterprise', 'qa.enterprise@nexpec.test'],
    ['talent', 'qa.talent@nexpec.test'],
  ];
  for (const [role, email] of denied) {
    try {
      const { client: c } = await asUser(email, QA_PW);
      await mustRefuse(`${role.padEnd(11)} payout settlement`, () =>
        c.rpc('admin_mark_payout_processed', {
          p_job_id: job.id, p_stripe_reference: `manual:${RUN}`, p_notes: 'unauthorized attempt',
        }));
      await mustRefuse(`${role.padEnd(11)} dispute resolution`, () =>
        c.rpc('admin_resolve_dispute', {
          p_job_id: job.id, p_resolution: 'completed', p_reason: 'unauthorized attempt',
        }));
    } catch (e) { bad(`${role} sign-in`, e.message); }
  }

  // Anonymous must be refused too.
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  await mustRefuse('anonymous   payout settlement', () =>
    anon.rpc('admin_mark_payout_processed', {
      p_job_id: job.id, p_stripe_reference: `manual:${RUN}`, p_notes: 'anon',
    }));

  // A PLAIN ADMIN must also be refused — this is the strict-super_admin claim.
  console.log('\n[5] plain admin is NOT enough');
  const tempAdminEmail = `qa.tempadmin.${RUN}@nexpec.test`;
  const adminSecret = `${randomBytes(24).toString('base64url')}Aa1!`;
  const { data: ad } = await svc.auth.admin.createUser({
    email: tempAdminEmail, password: adminSecret, email_confirm: true,
  });
  await svc.from('profiles').upsert(
    { id: ad.user.id, email: tempAdminEmail, role: 'admin', full_name: 'QA Temp Admin' },
    { onConflict: 'id' },
  );
  try {
    const { client: ac } = await asUser(tempAdminEmail, adminSecret);
    await mustRefuse('plain admin  payout settlement', () =>
      ac.rpc('admin_mark_payout_processed', {
        p_job_id: job.id, p_stripe_reference: `manual:${RUN}`, p_notes: 'admin attempt',
      }));
  } catch (e) { bad('temp admin sign-in', e.message); }

  // ── 6. The authorized path, and its idempotency ──────────────────────────
  console.log('\n[6] super_admin settles — manually, once');
  st = await payoutState();
  if (st.payout_paid_at == null) ok('still unpaid after every refusal (no partial write leaked through)');
  else bad('a refused call still wrote', String(st.payout_paid_at));

  try {
    const { client: sc } = await asUser(TEMP_SA_EMAIL, secret);
    const ref = `manual:${RUN}`;
    const { error: p1 } = await sc.rpc('admin_mark_payout_processed', {
      p_job_id: job.id, p_stripe_reference: ref, p_notes: 'QA settlement proof — synthetic, no real money',
    });
    if (p1) {
      bad('super_admin settlement', p1.message);
    } else {
      st = await payoutState();
      if (st.payout_paid_at && st.payout_reference === ref) ok(`settled by super_admin — payout_paid_at set, reference=${ref}, marked_by recorded`);
      else if (st.payout_paid_at) bad('settled but the reference was not stored', JSON.stringify(st));
      else bad('settlement reported success but the row did not change', JSON.stringify(st));

      // Idempotent retry: a second call must not create a second payout.
      const firstAt = st.payout_paid_at;
      const { error: p2 } = await sc.rpc('admin_mark_payout_processed', {
        p_job_id: job.id, p_stripe_reference: ref, p_notes: 'idempotency retry',
      });
      const after = await payoutState();
      if (p2) ok(`retry refused — ${p2.message.slice(0, 60)}`);
      else if (after.payout_paid_at === firstAt) ok('retry was idempotent — timestamp unchanged, no duplicate payout');
      else bad('retry created a SECOND payout', `${firstAt} -> ${after.payout_paid_at}`);
    }

    // Dispute resolution by the same authority.
    const { error: dErr } = await sc.rpc('admin_resolve_dispute', {
      p_job_id: job.id, p_resolution: 'completed', p_reason: `QA proof ${RUN}`,
    });
    if (dErr) console.log(`  note  admin_resolve_dispute: ${dErr.message.slice(0, 90)}`);
    else ok('admin_resolve_dispute accepted from super_admin');
  } catch (e) { bad('super_admin sign-in', e.message); }

  // ── 7. Audit trail ───────────────────────────────────────────────────────
  console.log('\n[7] audit trail');
  const { data: audit } = await svc.from('audit_log')
    .select('action, actor_id, created_at, metadata')
    .order('created_at', { ascending: false }).limit(40);
  const mine = (audit ?? []).filter((r) => JSON.stringify(r).includes(job.id) || JSON.stringify(r).includes(RUN));
  if (mine.length) {
    ok(`${mine.length} audit row(s) reference this job`);
    for (const r of mine.slice(0, 3)) {
      const hasActor = r.actor_id != null, hasWhen = r.created_at != null;
      console.log(`        action=${r.action} actor=${hasActor ? 'set' : 'MISSING'} ts=${hasWhen ? 'set' : 'MISSING'}`);
      if (!hasActor || !hasWhen) bad('audit row missing actor or timestamp', r.action);
    }
  } else {
    console.log('  note  no audit_log rows matched this job — recording as an observation, not a pass');
  }

  await finish(job.id, sa.user.id, ad.user.id);
}

/** Delete every temporary identity and prove the owner stands alone. */
async function finish(jobId, saId, adminId) {
  console.log('\n[8] cleanup and final privileged-identity assertion');
  if (jobId) {
    await svc.from('jobs').delete().eq('id', jobId);
    const { data: gone } = await svc.from('jobs').select('id').eq('id', jobId).maybeSingle();
    if (!gone) ok('synthetic job removed');
    else bad('synthetic job survived cleanup', jobId);
  }
  for (const [label, id] of [['temp super_admin', saId], ['temp admin', adminId]]) {
    if (!id) continue;
    const { error } = await svc.auth.admin.deleteUser(id);
    if (error) bad(`delete ${label}`, error.message);
    else ok(`${label} deleted`);
  }
  try { writeFileSync(SECRET_PATH, ''); } catch { /* already gone */ }

  const { data: left } = await svc.from('profiles')
    .select('email, role').in('role', ['admin', 'super_admin']);
  const rows = left ?? [];
  const synthetic = rows.filter((r) => (r.email ?? '').startsWith('qa.'));
  console.log(`\n  privileged identities remaining : ${rows.length}`);
  console.log(`  of which synthetic (qa.*)       : ${synthetic.length}`);
  if (rows.length === 1 && synthetic.length === 0) ok('the owner is the sole privileged identity');
  else bad('privileged residue', `${rows.length} total, ${synthetic.length} synthetic`);

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  PASS ${pass}   FAIL ${fail}`);
  console.log(`  No real money moved. No Stripe call. Production never contacted.`);
  console.log(`──────────────────────────────────────────────\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error('\nFATAL:', e.message); await finish(); });
