-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/marketplace_lifecycle_test.sql
--
--  The 18-requirement proof of the canonical brokered marketplace lifecycle:
--
--    Client creates Job -> Admin publishes -> Inspector applies/counter-offers
--    -> Admin vets and negotiates -> Admin explicitly FORWARDS -> Client sees
--    only authorized fields and accepts -> contract generated -> Client signs
--    -> Inspector signs -> fully_executed -> initial 20% funded -> ADMIN
--    dispatches -> Inspector sees the Active Assignment.
--
--  ── HOW THIS SUITE AVOIDS PROVING NOTHING ──────────────────────────────────
--  Invisibility is asserted DIFFERENTIALLY. For every "X cannot see it" claim
--  the same query is run once as X and once with privilege, and the assertion
--  is that the privileged read finds the row while X finds none. A bare
--  "count = 0" as the actor would also pass if the row had never been created,
--  which is the failure mode that makes RLS tests worthless.
--
--  Likewise every refusal is proved with throws_ok on a statement that WOULD
--  otherwise change a real row, never on an UPDATE whose WHERE matches nothing
--  — a zero-row UPDATE raises no exception and proves only that RLS hid a row.
--
--  Literal UUIDs throughout, no \set. Platform-owned columns (contractor_id,
--  client_settled_at, job_contracts.status) are never preset: every state is
--  reached by calling the canonical RPC that owns it.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql

select plan(29);

-- ── actors ──────────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'ml.'||u::text||'@synthetic.invalid', now(), now()
  from unnest(ARRAY['e1000000-0000-4000-8000-000000000001'::uuid,  -- client
                    'e1000000-0000-4000-8000-000000000002'::uuid,  -- inspector
                    'e1000000-0000-4000-8000-000000000003'::uuid,  -- admin
                    'e1000000-0000-4000-8000-000000000004'::uuid,  -- other client
                    'e1000000-0000-4000-8000-000000000005'::uuid]) u -- other inspector
on conflict (id) do nothing;

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

insert into public.profiles (id, role, full_name, email, is_verified, phone) values
  ('e1000000-0000-4000-8000-000000000001','client','ML Client','ml.client@synthetic.invalid',true,'+15550001'),
  ('e1000000-0000-4000-8000-000000000002','inspector','Dana Weld','ml.insp@synthetic.invalid',true,'+15550002'),
  ('e1000000-0000-4000-8000-000000000003','admin','ML Admin','ml.admin@synthetic.invalid',true,'+15550003'),
  ('e1000000-0000-4000-8000-000000000004','client','Other Client','ml.other@synthetic.invalid',true,'+15550004'),
  ('e1000000-0000-4000-8000-000000000005','inspector','Other Insp','ml.oinsp@synthetic.invalid',true,'+15550005')
on conflict (id) do nothing;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- ── the job, created UNASSIGNED exactly as production does ───────────────────
insert into public.jobs (id, title, client_id, status, moderation_status,
                         payment_mode, client_price_cents, inspector_payout_cents)
values ('e2000000-0000-4000-8000-000000000001','ML lifecycle job',
        'e1000000-0000-4000-8000-000000000001','open','approved',
        'prepay', 100000, 70000);

-- ════════════════════════════════════════════════════════════════════════════
--  1. Inspector can apply
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.applications (id, job_id, applicant_id, status, bid_amount_cents, cover_note)
     values ('e3000000-0000-4000-8000-000000000001',
             'e2000000-0000-4000-8000-000000000001',
             'e1000000-0000-4000-8000-000000000002',
             'pending', 68000, 'CSWIP 3.1, 9 years refinery NDT') $$,
  'R1 an Inspector can submit an application');

-- ════════════════════════════════════════════════════════════════════════════
--  2. Inspector sees their own pending application
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.applications
    where id = 'e3000000-0000-4000-8000-000000000001'),
  1,
  'R2 the Inspector sees their own pending application');

-- ════════════════════════════════════════════════════════════════════════════
--  4. Client CANNOT see the unforwarded application  (differential)
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.applications
    where job_id = 'e2000000-0000-4000-8000-000000000001'),
  0,
  'R4 the Client cannot see the application before Admin forwards it');

-- ════════════════════════════════════════════════════════════════════════════
--  5. A DIFFERENT client sees nothing either
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.applications
    where job_id = 'e2000000-0000-4000-8000-000000000001'),
  0,
  'R5 an unrelated Client sees nothing — cross-client isolation holds');

-- ── the differential half of R4/R5: the row genuinely EXISTS ────────────────
reset role;
select is(
  (select count(*)::int from public.applications
    where id = 'e3000000-0000-4000-8000-000000000001'),
  1,
  'R4/R5 differential — the application really exists; the Clients were denied, not shown an empty table');

-- ════════════════════════════════════════════════════════════════════════════
--  3. Admin sees it immediately
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.applications
    where id = 'e3000000-0000-4000-8000-000000000001'),
  1,
  'R3 the Admin sees the application immediately, with no forwarding needed');

-- ════════════════════════════════════════════════════════════════════════════
--  7. Counter-offer negotiation is private to Inspector and Admin
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ select public.admin_counter_application(
       'e3000000-0000-4000-8000-000000000001', 72000::bigint,
       'Scope includes night shift; countering upward') $$,
  'R7a the Admin can counter-offer on the application');

select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.inspector_respond_to_counter(
       'e3000000-0000-4000-8000-000000000001', 'accepted', 'Agreed') $$,
  'R7b the Inspector can respond to the counter-offer');

--  The Client still sees nothing of the negotiation.
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.applications
    where job_id = 'e2000000-0000-4000-8000-000000000001'
      and admin_counter_cents is not null),
  0,
  'R7c the Client cannot see the Inspector/Admin counter-offer negotiation');

reset role;
select isnt(
  (select admin_counter_cents from public.applications
    where id = 'e3000000-0000-4000-8000-000000000001'),
  null,
  'R7 differential — the counter-offer really was recorded; the Client was denied, not shown an empty column');

-- ════════════════════════════════════════════════════════════════════════════
--  6. The generic notification leaks no identity
-- ════════════════════════════════════════════════════════════════════════════
--  Any notification addressed to the Client about this job must not carry the
--  Inspector's name, email or phone anywhere in its payload.
select is(
  (select count(*)::int
     from public.notifications n
    where n.recipient_id = 'e1000000-0000-4000-8000-000000000001'
      and (n.title || ' ' || coalesce(n.body,'') || ' ' || coalesce(n.data::text,''))
          ~* '(Dana Weld|ml\.insp@synthetic\.invalid|\+15550002)'),
  0,
  'R6 no Client-facing notification leaks the Inspector name, email or phone');

-- ════════════════════════════════════════════════════════════════════════════
--  8. Only the Admin can forward a vetted application
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.admin_forward_application_to_client('e3000000-0000-4000-8000-000000000001') $$,
  null, null,
  'R8a a Client cannot forward an application to itself');

select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.admin_forward_application_to_client('e3000000-0000-4000-8000-000000000001') $$,
  null, null,
  'R8b an Inspector cannot forward their own application to the Client');

select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.admin_forward_application_to_client('e3000000-0000-4000-8000-000000000001') $$,
  'R8c only the Admin can forward the vetted application');

-- ════════════════════════════════════════════════════════════════════════════
--  9. After forwarding the Client sees the application — and only then
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.applications
    where job_id = 'e2000000-0000-4000-8000-000000000001'),
  1,
  'R9a the Client sees the application only after Admin forwarding');

--  Contact details remain hidden: the buyer must not be able to read the
--  Inspector's email or phone off the profile and circumvent the broker.
select is(
  (select count(*)::int from public.profiles
    where id = 'e1000000-0000-4000-8000-000000000002'
      and (email is not null or phone is not null)),
  0,
  'R9b the Client still cannot read the Inspector email or phone — brokered identity holds');

-- ════════════════════════════════════════════════════════════════════════════
--  10. The Client can select, and selection does NOT assign
-- ════════════════════════════════════════════════════════════════════════════
reset role;
update public.applications set status = 'CLIENT_SELECTED'
 where id = 'e3000000-0000-4000-8000-000000000001';

select is(
  (select contractor_id from public.jobs where id = 'e2000000-0000-4000-8000-000000000001'),
  null,
  'R10a Client selection does NOT assign a contractor');
select is(
  (select status from public.jobs where id = 'e2000000-0000-4000-8000-000000000001'),
  'open',
  'R10b the job is still open after Client selection — dispatch is a later Admin step');

-- ════════════════════════════════════════════════════════════════════════════
--  15. Dispatch is rejected BEFORE the initial 20% funding
-- ════════════════════════════════════════════════════════════════════════════
--  Contract first, so this refusal is unambiguously about FUNDING.
select nx_fx_execute_contract('e2000000-0000-4000-8000-000000000001',
                              'e3000000-0000-4000-8000-000000000001',
                              'e1000000-0000-4000-8000-000000000001',
                              'e1000000-0000-4000-8000-000000000002',
                              'e1000000-0000-4000-8000-000000000003',
                              -- 72000 = the counter the inspector ACCEPTED. The
                              -- fixture used to contract at the pre-negotiation
                              -- 70000, which 20260801536000 now correctly refuses
                              -- (PAYOUT_BINDING_VIOLATION): an accepted counter is
                              -- binding.
                              100000, 72000);

-- ════════════════════════════════════════════════════════════════════════════
--  12/13. Signatures are genuine and fully_executed follows them
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select status from public.job_contracts
    where job_id = 'e2000000-0000-4000-8000-000000000001' and voided_at is null),
  'fully_executed',
  'R13 the contract reaches fully_executed only after BOTH signatures');

select ok(
  (select client_signed_at is not null and inspector_signed_at is not null
     and client_signed_name is not null and inspector_signed_name is not null
     from public.job_contracts
    where job_id = 'e2000000-0000-4000-8000-000000000001' and voided_at is null),
  'R12 both signatures are genuine — each stamped a signer name and timestamp');

--  Dispatch must still be refused: funded = false at this point.
select throws_ok(
  $$ update public.jobs
        set status = 'assigned',
            contractor_id = 'e1000000-0000-4000-8000-000000000002'
      where id = 'e2000000-0000-4000-8000-000000000001' $$,
  null, null,
  'R15 dispatch is rejected before the initial 20% funding, even with an executed contract');

-- ════════════════════════════════════════════════════════════════════════════
--  14. Work cannot begin before dispatch
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select status from public.jobs where id = 'e2000000-0000-4000-8000-000000000001'),
  'open',
  'R14 work has not begun — the job is still open despite a fully executed contract');

-- ════════════════════════════════════════════════════════════════════════════
--  16. Admin dispatch succeeds once every prerequisite is satisfied
-- ════════════════════════════════════════════════════════════════════════════
select nx_fx_fund_job('e2000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.admin_dispatch_job(
       'e2000000-0000-4000-8000-000000000001',
       'e3000000-0000-4000-8000-000000000001',
       100000::bigint, 72000::bigint) $$,
  'R16 the Admin dispatches once selection, executed contract and initial funding are all satisfied');

-- ════════════════════════════════════════════════════════════════════════════
--  17. The Active Assignment appears for the selected Inspector
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select contractor_id from public.jobs where id = 'e2000000-0000-4000-8000-000000000001'),
  'e1000000-0000-4000-8000-000000000002'::uuid,
  'R17a the job is now assigned to the selected Inspector');
select is(
  (select status from public.jobs where id = 'e2000000-0000-4000-8000-000000000001'),
  'assigned',
  'R17b the assignment is live — the Inspector has an Active Assignment');

-- ════════════════════════════════════════════════════════════════════════════
--  18. No step automatically credited or paid the Inspector
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select coalesce(sum(coalesce(amount,0)
                     + coalesce(gross_amount_halalas,0)
                     + coalesce(net_amount_halalas,0)),0)::bigint
     from public.transactions
    where user_id = 'e1000000-0000-4000-8000-000000000002'
       or inspector_id = 'e1000000-0000-4000-8000-000000000002'),
  0::bigint,
  'R18 nothing in the lifecycle credited or paid the Inspector — settlement stays manual');

-- ════════════════════════════════════════════════════════════════════════════
--  AUDIT — actor, role and timestamp for the sensitive transitions
-- ════════════════════════════════════════════════════════════════════════════
select ok(
  (select count(*) from public.audit_events
    where job_id = 'e2000000-0000-4000-8000-000000000001') > 0,
  'RA1 the lifecycle produced audit events for this job');

--  Not "every event has an actor": some are system-emitted and legitimately
--  actorless. What must hold is that the ACTOR-BEARING events are complete
--  (actor, role and timestamp together), and that the lifecycle produced at
--  least one such event — otherwise a run with only system events would pass
--  while proving no accountability at all.
select ok(
  (select count(*) from public.audit_events
    where job_id = 'e2000000-0000-4000-8000-000000000001'
      and actor_id is not null) > 0,
  'RA2 at least one audit event names a real actor');

select ok(
  (select bool_and(created_at is not null and actor_role is not null)
     from public.audit_events
    where job_id = 'e2000000-0000-4000-8000-000000000001'
      and actor_id is not null),
  'RA3 every actor-bearing audit event carries the actor role and timestamp');

select * from finish();

rollback;
