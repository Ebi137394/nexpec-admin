-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/manual_settlement_finance_test.sql
--  The manual-settlement finance backbone (20260801592000): each side sees its
--  own money, neither side sees the other's, and only an admin can record it.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(16);

create temporary table _f on commit drop as
select gen_random_uuid() as cli, gen_random_uuid() as insp,
       gen_random_uuid() as adm, gen_random_uuid() as job,
       gen_random_uuid() as outsider;
grant select on _f to authenticated;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'fin.'||u::text||'@synthetic.invalid', now(), now(), now()
  from _f, unnest(array[cli, insp, adm, outsider]) u;

insert into public.profiles (id, role, full_name, email, is_verified, marketplace_activated)
select cli,'client','FIN Client','fin.c@synthetic.invalid',true,true from _f
union all select insp,'inspector','FIN Inspector','fin.i@synthetic.invalid',true,true from _f
union all select adm,'super_admin','FIN Admin','fin.a@synthetic.invalid',true,true from _f
union all select outsider,'inspector','FIN Outsider','fin.o@synthetic.invalid',true,true from _f;

-- $1,000 buyer price · $800 payout · $200 NEXPEC spread
-- Use the canonical dispatched-job fixture: it walks the real lifecycle
-- (apply → fund → contract → dual signature → dispatch), so the job under test
-- has a genuine engaged contractor rather than a hand-forced row.
\i supabase/tests/_fixtures/canonical_job.sql
do $$
declare v uuid;
begin
  select nx_fx_dispatched_job(
    (select cli from _f), (select insp from _f), (select adm from _f),
    'FIN settlement job', 100000::bigint, 80000::bigint) into v;
  update _f set job = v;
end $$;

-- admin records a PARTIAL buyer payment (confirmed) + one awaiting confirmation
insert into public.manual_payment_records
  (job_id,direction,amount_cents,method,paid_on,reference,status,recorded_by)
select job,'client_payment',60000,'bank_transfer',current_date,'WIRE-001','paid_manually',adm from _f
union all
select job,'client_payment',40000,'bank_transfer',current_date,'WIRE-002','pending',adm from _f
union all
select job,'inspector_payout',30000,'bank_transfer',current_date,'PAYOUT-001','paid_manually',adm from _f;

-- ─── BUYER SIDE ─────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select cli::text from _f)||'","role":"authenticated"}',true);

select is((select total_cents::bigint from public.my_job_settlement_view where job_id=(select job from _f)),
  100000::bigint, 'F1 buyer sees their own total contract value');
select is((select paid_cents::bigint from public.my_job_settlement_view where job_id=(select job from _f)),
  60000::bigint, 'F2 partial payment is reflected as paid');
select is((select pending_cents::bigint from public.my_job_settlement_view where job_id=(select job from _f)),
  40000::bigint, 'F3 a recorded-but-unconfirmed payment shows as pending confirmation');
select is((select outstanding_cents::bigint from public.my_job_settlement_view where job_id=(select job from _f)),
  40000::bigint, 'F4 outstanding = total - confirmed (partial payments supported)');
select is((select settlement_status from public.my_job_settlement_view where job_id=(select job from _f)),
  'awaiting_confirmation', 'F5 settlement status reflects the awaiting-confirmation state');

-- buyer must NOT see payout or spread anywhere in their finance surface
select is((select count(*)::int from information_schema.columns
            where table_schema='public' and table_name='my_job_settlement_view'
              and column_name in ('inspector_payout_cents','platform_spread_cents',
                                  'earned_cents','due_cents')),
  0, 'F6 the buyer settlement view exposes NO payout/spread column at all');
select is((select count(*)::int from public.my_earnings_view where job_id=(select job from _f)),
  0, 'F7 a buyer reads nothing from the provider earnings view');
select is((select count(*)::int from public.my_settlement_activity
            where job_id=(select job from _f) and direction='inspector_payout'),
  0, 'F8 a buyer cannot see provider payout activity');
select is((select count(*)::int from public.my_settlement_activity
            where job_id=(select job from _f) and direction='client_payment'),
  2, 'F9 a buyer sees their own payment history');
reset role;

-- ─── PROVIDER SIDE ──────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select insp::text from _f)||'","role":"authenticated"}',true);

select is((select earned_cents::bigint from public.my_earnings_view where job_id=(select job from _f)),
  80000::bigint, 'F10 provider sees their own earned amount');
select is((select due_cents::bigint from public.my_earnings_view where job_id=(select job from _f)),
  50000::bigint, 'F11 due = earned - paid (partial payout supported)');
select is((select count(*)::int from information_schema.columns
            where table_schema='public' and table_name='my_earnings_view'
              and column_name in ('client_price_cents','total_cents',
                                  'platform_spread_cents','outstanding_cents')),
  0, 'F12 the earnings view exposes NO buyer price/spread column at all');
select is((select count(*)::int from public.my_job_settlement_view where job_id=(select job from _f)),
  0, 'F13 a provider reads nothing from the buyer settlement view');
select is((select count(*)::int from public.my_settlement_activity
            where job_id=(select job from _f) and direction='client_payment'),
  0, 'F14 a provider cannot see buyer payment activity');
reset role;

-- ─── AUTHORITY ──────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"'||(select cli::text from _f)||'","role":"authenticated"}',true);
select throws_ok(
  $$ insert into public.manual_payment_records
       (job_id,direction,amount_cents,method,status,recorded_by)
     select job,'client_payment',40000,'bank_transfer','paid_manually',cli from _f $$,
  NULL, NULL, 'F15 a buyer cannot mark their own payment received');
reset role;

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='manual_payment_records'
      and grantee in ('authenticated','anon')
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')),
  0, 'F16 no user role holds a write grant on the settlement ledger');

select * from finish();
rollback;
