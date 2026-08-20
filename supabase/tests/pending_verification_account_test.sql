-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/pending_verification_account_test.sql
--
--  The owner's signup policy, proved at the database layer:
--    a signup may CHOOSE its account type; choosing it does not confer it.
--
--  Inspectors, agencies and suppliers arrive PENDING. While pending they may
--  complete a profile and upload verification documents, and nothing else.
--  Only an Admin or Super Admin can activate them, signup can never mint an
--  administrator, and everyone who already existed keeps working.
--
--  NOTE: this suite deliberately does NOT carry the
--  "update public.profiles set marketplace_activated = true" line the other
--  fixtures use — the pending state is the thing under test here.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/pending_verification_account_test.sql
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(20);

create temporary table _pv on commit drop as
select gen_random_uuid() as insp,
       gen_random_uuid() as agcy,
       gen_random_uuid() as supp,
       gen_random_uuid() as cli,
       gen_random_uuid() as adm,
       gen_random_uuid() as job,
       gen_random_uuid() as conv_support,
       gen_random_uuid() as conv_comm,
       gen_random_uuid() as sup_signup,
       gen_random_uuid() as adm_signup;
grant select on _pv to authenticated;

-- '@synthetic.invalid' is skipped by handle_new_user (20260801586000), so these
-- rows keep the roles this suite gives them.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'pva.'||u::text||'@synthetic.invalid', now(), now(), now()
  from _pv, unnest(array[insp, agcy, supp, cli, adm]) u;

insert into public.profiles (id, role, full_name, email, is_verified)
select insp,'inspector',  'PVA Inspector','pva.i@synthetic.invalid', true from _pv
union all select agcy,'agency',     'PVA Agency',   'pva.g@synthetic.invalid', true from _pv
union all select supp,'supplier',   'PVA Supplier', 'pva.s@synthetic.invalid', true from _pv
union all select cli, 'client',     'PVA Client',   'pva.c@synthetic.invalid', true from _pv
union all select adm, 'super_admin','PVA Admin',    'pva.a@synthetic.invalid', true from _pv;

-- the client is ungated, so it can create the job everyone else acts against
insert into public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                         client_price_cents,inspector_payout_cents)
select job,'pva job',cli,'open','approved','prepay',100000,80000 from _pv;

insert into public.conversations (id, kind, user_id, title, status)
select conv_support,'help_support', insp,'pva support','open' from _pv;
insert into public.conversations (id, job_id, client_id, contractor_id, kind, user_id, title, status)
select conv_comm, job, cli, insp,'job_client_inspector', cli,'pva commercial','open' from _pv;

-- ─── 1-4  the gate keys on the ROLE, and clients are not gated ──────────────
select is(public.nx_account_activated((select insp from _pv)), false,
  'V1 a newly signed-up inspector is PENDING, not active');
select is(public.nx_account_activated((select agcy from _pv)), false,
  'V2 a newly signed-up agency is PENDING');
select is(public.nx_account_activated((select supp from _pv)), false,
  'V3 a newly signed-up supplier is PENDING');
select is(public.nx_account_activated((select cli from _pv)), true,
  'V4 a client is NOT pending-restricted — the demand side stays open');

-- ─── 5-8  what PENDING refuses ──────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select insp::text from _pv) || '","role":"authenticated"}', true);

select throws_like(
  $$ insert into public.applications (id, job_id, applicant_id, status, bid_amount_cents)
     select gen_random_uuid(), job, insp, 'pending', 80000 from _pv $$,
  '%ACCOUNT_PENDING_VERIFICATION%',
  'V5 a pending inspector cannot apply to a job');

select throws_like(
  $$ insert into public.inspection_reports (id, job_id, inspector_id, notes, status)
     select gen_random_uuid(), job, insp, 'pva report', 'draft' from _pv $$,
  '%ACCOUNT_PENDING_VERIFICATION%',
  'V6 a pending inspector cannot submit an inspection report');

select throws_like(
  $$ insert into public.messages (conversation_id, sender_id, content)
     select conv_comm, insp, 'commercial approach' from _pv $$,
  '%ACCOUNT_PENDING_VERIFICATION%',
  'V7 a pending inspector cannot use commercial chat');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select agcy::text from _pv) || '","role":"authenticated"}', true);
select throws_like(
  $$ insert into public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                              client_price_cents,inspector_payout_cents)
     select gen_random_uuid(),'pva agency job',cli,'open','approved','prepay',1000,800 from _pv $$,
  '%ACCOUNT_PENDING_VERIFICATION%',
  'V8 a pending agency cannot post an operational job');
reset role;

-- ─── 9-11  what PENDING still allows ────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select insp::text from _pv) || '","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.messages (conversation_id, sender_id, content)
     select conv_support, insp, 'why is my account pending?' from _pv $$,
  'V9 a pending inspector CAN reach NEXPEC support');

select lives_ok(
  $$ update public.profiles set headline = 'API 570 Piping Inspector'
      where id = (select insp from _pv) $$,
  'V10 a pending inspector CAN complete their profile');

select lives_ok(
  $$ update public.profiles set certifications = '{API 570}'::text[]
      where id = (select insp from _pv) $$,
  'V11 a pending inspector CAN record verification credentials');

-- ─── 12  nobody activates themselves ────────────────────────────────────────
select throws_like(
  $$ select public.admin_set_marketplace_activation((select insp from _pv), true, 'self') $$,
  '%ACTIVATION_DENIED%',
  'V12 a pending inspector cannot activate itself');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select cli::text from _pv) || '","role":"authenticated"}', true);
select throws_like(
  $$ select public.admin_set_marketplace_activation((select insp from _pv), true, 'friend') $$,
  '%ACTIVATION_DENIED%',
  'V13 an ordinary client cannot activate an inspector');
reset role;

-- ─── 14-17  the Admin activates, and the gate opens ─────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select adm::text from _pv) || '","role":"authenticated"}', true);

select lives_ok(
  $$ select public.admin_set_marketplace_activation((select insp from _pv), true, 'documents verified') $$,
  'V14 an Admin CAN activate a pending account');
reset role;

select is(public.nx_account_activated((select insp from _pv)), true,
  'V15 the inspector is active once the Admin approves');

select is(
  (select count(*)::int from public.audit_events
    where event_type = 'account.activated' and subject_id = (select insp from _pv)),
  1, 'V16 activation is written to the audit trail');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select insp::text from _pv) || '","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.applications (id, job_id, applicant_id, status, bid_amount_cents)
     select gen_random_uuid(), job, insp, 'pending', 80000 from _pv $$,
  'V17 the same application that was refused now succeeds');
reset role;

-- ─── 18-19  signup can never mint an administrator ──────────────────────────
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select sup_signup,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'pva.sup.'||sup_signup::text||'@nexpec-verify.example.com',
       jsonb_build_object('role','super_admin','full_name','Not An Admin'), now(), now() from _pv;
select is(
  (select role from public.profiles where id = (select sup_signup from _pv)),
  'client', 'V18 signup metadata role=super_admin collapses to client');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select adm_signup,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'pva.adm.'||adm_signup::text||'@nexpec-verify.example.com',
       jsonb_build_object('role','admin','full_name','Also Not An Admin'), now(), now() from _pv;
select is(
  (select role from public.profiles where id = (select adm_signup from _pv)),
  'client', 'V19 signup metadata role=admin collapses to client');

-- ─── 20  the policy is not retroactive ──────────────────────────────────────
--  Every profile this suite did not itself create must still be active: the
--  policy applies to new signups, never retroactively to people already working.
select is(
  (select count(*)::int from public.profiles p
    where not p.marketplace_activated
      and p.id not in (
        select unnest(array[insp, agcy, supp, cli, adm, sup_signup, adm_signup]) from _pv)),
  0, 'V20 every account that predates the policy is still active');

select * from finish();
rollback;
