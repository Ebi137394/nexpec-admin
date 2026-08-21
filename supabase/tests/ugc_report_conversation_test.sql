-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/ugc_report_conversation_test.sql
--  Store-compliance UGC reporting (20260801590000), proved at the DB layer.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(8);

create temporary table _u on commit drop as
select gen_random_uuid() as a, gen_random_uuid() as b, gen_random_uuid() as room;
grant select on _u to authenticated;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'ugct.'||u::text||'@synthetic.invalid', now(), now(), now()
  from _u, unnest(array[a,b]) u;

-- Fixture users are CONFIRMED and ACTIVATED (see 20260801582000 / 20260801584000).
insert into public.profiles (id, role, full_name, email, is_verified, marketplace_activated)
select a,'client','UGCT A','ugct.a@synthetic.invalid', true, true from _u
union all select b,'inspector','UGCT B','ugct.b@synthetic.invalid', true, true from _u;

insert into public.conversations (id, kind, user_id, client_id, title, status)
select room,'help_support', a, a, 'ugct room','open' from _u;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"'||(select a::text from _u)||'","role":"authenticated"}', true);

select lives_ok(
  $$ select public.report_conversation((select room from _u), 'pgTAP: objectionable content') $$,
  'T1 a participant can file a report');

select is(
  (select count(*)::int from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.kind='help_support' and c.user_id=(select a from _u)
     and m.content like '⚑ CONTENT REPORT%'),
  1, 'T2 the report lands in the reporter''s staffed support lane');

select throws_like(
  $$ select public.report_conversation((select room from _u), '  ') $$,
  '%REPORT_REASON_REQUIRED%', 'T4 an empty reason is refused');

select throws_like(
  $$ select public.report_conversation(gen_random_uuid(), 'ghost room') $$,
  '%CONVERSATION_NOT_FOUND%', 'T5 a nonexistent room is refused');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"'||(select b::text from _u)||'","role":"authenticated"}', true);
select throws_like(
  $$ select public.report_conversation((select room from _u), 'not my room') $$,
  '%NOT_A_PARTICIPANT%', 'T6 a non-participant cannot report someone else''s room');
reset role;

-- audit visibility is admin-side: assert the row exists from outside RLS
select is(
  (select count(*)::int from public.audit_events
    where event_type='ugc.conversation_reported' and subject_id=(select room from _u)),
  1, 'T3 the report is audited (read outside RLS — audit is an admin surface)');

select is(
  (select has_function_privilege('anon','public.report_conversation(uuid,text)','EXECUTE')),
  false, 'T7 anon cannot execute the report RPC');
select is(
  (select has_function_privilege('authenticated','public.report_conversation(uuid,text)','EXECUTE')),
  true, 'T8 authenticated can execute the report RPC');

select * from finish();
rollback;
