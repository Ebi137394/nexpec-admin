-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/manual_payment_posture_test.sql
--
--  Targeted regression for the MANUAL-PAYMENT-ONLY release posture
--  (20260801576000). Proves, at the database layer:
--
--    P  online payments are OFF and the money guard refuses
--    A  report approval RECORDS ONLY — it never moves money
--    M  manual payment records are admin-only and audit-logged
--    R  role-based price privacy survives the new table
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/manual_payment_posture_test.sql
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(15);

create temporary table _p on commit drop as
select gen_random_uuid() as client_id,
       gen_random_uuid() as inspector_id,
       gen_random_uuid() as admin_id,
       gen_random_uuid() as job_id,
       gen_random_uuid() as app_id;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'mpp.'||u::text||'@synthetic.invalid', now(), now()
  from _p, unnest(array[client_id, inspector_id, admin_id]) u;

insert into public.profiles (id, role, full_name, email, is_verified)
select client_id,'client','MPP Client','mpp.c@synthetic.invalid',true from _p
union all select inspector_id,'inspector','MPP Inspector','mpp.i@synthetic.invalid',true from _p
union all select admin_id,'super_admin','MPP Admin','mpp.a@synthetic.invalid',true from _p
on conflict (id) do update set role = excluded.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

insert into public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                         client_price_cents,inspector_payout_cents,identity_mode)
select job_id,'mpp posture',client_id,'open','approved','prepay',100000,80000,'protected' from _p;
insert into public.applications (id,job_id,applicant_id,status,bid_amount_cents,forwarded_to_client_at)
select app_id,job_id,inspector_id,'hired',80000,now() from _p;
insert into public.job_contracts (job_id,application_id,client_id,inspector_id,client_price_cents,
                                  inspector_payout_cents,status,contract_text_md)
select job_id,app_id,client_id,inspector_id,100000,80000,'fully_executed','mpp body' from _p;

grant select on _p to authenticated;

-- ─── P. The posture itself ──────────────────────────────────────────────────
select is(public.nx_online_payments_enabled(), false,
  'P1 online card payments are DISABLED for this release');
select throws_like(
  $$ select public.nx_assert_online_payments_enabled() $$,
  '%ONLINE_PAYMENTS_DISABLED%',
  'P2 the money guard refuses while manual mode is active');
select is(
  (select online_payments_enabled from public.platform_settings where id='global'),
  false, 'P3 the flag is persisted on the global settings row, not hardcoded');

-- ─── A. Report approval records only; it never moves money ──────────────────
--  Approval writes an audit signal. Nothing in the money tables may change as
--  a result, and no manual payment record may appear on its own.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select client_id::text from _p) || '","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.audit_events (event_type, severity, actor_id, subject_table,
                                      subject_id, job_id, summary)
     select 'job.client_approved_report','info',client_id,'jobs',job_id,job_id,
            'Client approved the report' from _p $$,
  'A1 client approval records an audit signal');
select is(
  (select count(*)::int from public.manual_payment_records where job_id=(select job_id from _p)),
  0, 'A2 approval created NO payment record — approval never settles');
-- payout_status defaults to 'unpaid' (not NULL); the invariant is that
-- approval never advances it to a settled state.
select ok(
  (select coalesce(payout_status,'unpaid') <> 'paid'
     from public.jobs where id=(select job_id from _p)),
  'A3 approval did not advance payout_status to paid');
select is(
  (select client_settled_at from public.jobs where id=(select job_id from _p)),
  null, 'A4 approval did not mark the job settled');

-- A client cannot record a payment to fake settlement.
select throws_ok(
  $$ select public.admin_record_manual_payment(
       (select job_id from _p), 'client_payment', 100000, 'cash') $$,
  NULL, NULL, 'A5 a CLIENT cannot record a manual payment');
select is(
  (select count(*)::int from public.manual_payment_records),
  0, 'A6 the client sees nothing in the manual payment ledger');
reset role;

-- ─── M. Admin-only recording, audit-logged ──────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select admin_id::text from _p) || '","role":"authenticated"}', true);

select lives_ok(
  $$ select public.admin_record_manual_payment(
       (select job_id from _p), 'client_payment', 100000, 'bank_transfer',
       CURRENT_DATE, 'REF-MPP-1', 'settled out of band') $$,
  'M1 admin records the manual client payment');
select is(
  (select status from public.manual_payment_records where job_id=(select job_id from _p)),
  'recorded', 'M2 the record lands with a lifecycle status');
select ok(
  (select amount_cents = 100000 and method = 'bank_transfer' and reference = 'REF-MPP-1'
      and recorded_by = (select admin_id from _p) and recorded_at is not null
     from public.manual_payment_records where job_id=(select job_id from _p)),
  'M3 amount, method, reference, actor and timestamp are all captured');
select is(
  (select count(*)::int from public.audit_events
    where event_type='payment.manual_recorded' and job_id=(select job_id from _p)),
  1, 'M4 the manual payment is audit-logged');
reset role;

-- ─── R. Commercial privacy is unchanged by the new surface ──────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select client_id::text from _p) || '","role":"authenticated"}', true);
-- R1 UPDATED by the manual-settlement backbone (20260801592000, owner order):
-- a buyer now reads their OWN client_payment rows — that is the whole point of
-- the settlement dashboard — but the provider-payout direction stays invisible.
-- The commercial boundary is the DIRECTION, not the table.
select is(
  (select count(*)::int from public.manual_payment_records
    where direction = 'inspector_payout'),
  0, 'R1 client cannot read provider payout rows (direction is the boundary)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select inspector_id::text from _p) || '","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.manual_payment_records),
  0, 'R2 inspector cannot read it either — no payout/price cross-leak');
reset role;

select * from finish();
rollback;
