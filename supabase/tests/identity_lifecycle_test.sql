-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/identity_lifecycle_test.sql
--  pgTAP for migration 20260801328000 — LIVE identity authority, the audit-only
--  contract snapshot, the terminal-engagement policy freeze, and the résumé
--  engagement cutoff.
--  Run: supabase test db
--
--  Product decision under test: jobs.identity_mode is authoritative at EVERY
--  stage, including a fully-executed contract. job_contracts
--  .effective_identity_mode is audit evidence and must never authorize.
--
--  Statuses used are the REAL ones:
--    jobs             open | in_progress | completed | cancelled  (+ paid)
--    job_contracts    pending_client_signature | fully_executed | voided
--    applications     pending | accepted | rejected | withdrawn
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
select plan(27);

-- Never put a trailing comment on a \set line — psql concatenates the tail.
\set CL   'b1111111-1111-1111-1111-111111111111'
\set INSP 'b2222222-2222-2222-2222-222222222222'
\set ADM  'b3333333-3333-3333-3333-333333333333'
\set JOB  'b4444444-4444-4444-4444-444444444444'
\set JOB2 'b5555555-5555-5555-5555-555555555555'
\set APP  'b6666666-6666-6666-6666-666666666666'
\set APP2 'b7777777-7777-7777-7777-777777777777'
\set CON  'b8888888-8888-8888-8888-888888888888'
\set RESPATH 'b2222222-2222-2222-2222-222222222222/resume-1.pdf'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl.lc@test.nx',now(),now()),
  (:'INSP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in.lc@test.nx',now(),now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.lc@test.nx',now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

insert into public.profiles (id, email, role, full_name, headline, resume_url, phone, specialty_slugs) values
  (:'CL',  'cl.lc@test.nx','client',   'Client LC', null, null, null, '{}'::text[]),
  (:'INSP','in.lc@test.nx','inspector','Dana Okafor','API 570 Inspector',
     'https://x.supabase.co/storage/v1/object/sign/resumes/' || :'RESPATH', '+1-555-0134','{}'::text[]),
  (:'ADM', 'ad.lc@test.nx','super_admin','Platform Admin', null, null, null, '{}'::text[]);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

insert into public.jobs (id, title, client_id, status, moderation_status, identity_mode, replacement_mode) values
  (:'JOB', 'lifecycle job',  :'CL','open','approved','protected','client_reapproval'),
  (:'JOB2','second job',     :'CL','open','approved','protected','client_reapproval');

-- ★ APP is seeded CLIENT_SELECTED, not pending.
--   admin_dispatch_job requires CLIENT_SELECTED, and rightly refuses to
--   dispatch straight from pending. The pending -> CLIENT_SELECTED hop belongs
--   to the proposal-selection workflow (admin_counter_application +
--   the client's acceptance), which this suite does not test — dragging that
--   pricing/negotiation flow in here would add setup, not coverage.
--   Seeding is legitimate: CLIENT_SELECTED is a valid applications_status_check
--   value and the only BEFORE INSERT trigger on applications is the rate
--   limiter, so no insert invariant is bypassed. This is NOT an illegal direct
--   UPDATE past a guard — the row simply starts in the state under test.
--   APP2 stays 'pending'; section F drives it to 'rejected'.
insert into public.applications (id, job_id, applicant_id, status, forwarded_to_client_at) values
  (:'APP',  :'JOB', :'INSP','CLIENT_SELECTED', now()),
  (:'APP2', :'JOB2',:'INSP','pending',         now());

insert into storage.buckets (id, name, public) values ('resumes','resumes',false)
  on conflict (id) do update set public = false;
insert into storage.objects (bucket_id, name, owner) values ('resumes', :'RESPATH', :'INSP')
  on conflict do nothing;

-- ══════════════════════════════════════════════════════════════════════════
--  A. Protected → Professional is live on the next read
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APP'),
  null,
  'BASELINE: protected job withholds the name');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_set_project_policy(
       'b4444444-4444-4444-4444-444444444444','professional','client_reapproval') $$,
  'UPGRADE: admin raises an OPEN job to professional');

set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APP'),
  'Dana Okafor',
  'LIVE UP: the client sees the professional name on the very next read');

-- nx_can_access_doc is service_role-only by GRANT (release invariant).
-- Production path: authenticated client -> mint-doc-url -> service role ->
-- nx_can_access_doc(p_uid = the caller's uid). Drop to the trusted context
-- for the call and keep passing the BUYER's uuid as p_uid, so the assertion
-- means exactly what it did before.
reset role;
select is(
  public.nx_can_access_doc(:'CL', 'resumes', :'RESPATH'),
  true,
  'LIVE UP: résumé becomes mintable immediately');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ══════════════════════════════════════════════════════════════════════════
--  B. Professional → Protected revokes on the next read
-- ══════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode = 'protected' where id = :'JOB';
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APP'),
  null,
  'LIVE DOWN: the name disappears on the next read');

select is_empty(
  $$ select full_name from public.profiles where id = 'b2222222-2222-2222-2222-222222222222' $$,
  'LIVE DOWN: the raw profile row is hidden again (324000 re-evaluates live)');

-- nx_can_access_doc is service_role-only by GRANT (release invariant).
-- Production path: authenticated client -> mint-doc-url -> service role ->
-- nx_can_access_doc(p_uid = the caller's uid). Drop to the trusted context
-- for the call and keep passing the BUYER's uuid as p_uid, so the assertion
-- means exactly what it did before.
reset role;
select is(
  public.nx_can_access_doc(:'CL', 'resumes', :'RESPATH'),
  false,
  'LIVE DOWN: no NEW résumé URL can be minted');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ══════════════════════════════════════════════════════════════════════════
--  C. ACTIVE CONTRACT still follows the live policy (the product decision)
-- ══════════════════════════════════════════════════════════════════════════
-- ★ open -> in_progress is ILLEGAL for a non-service caller: the real state
--   machine is open -> assigned -> in_progress (guard_jobs_status_transition,
--   mirrored by TRANSITIONS in packages/shared-core/src/domain/jobStatus.ts).
--   Walk the SAME path production walks, via the canonical RPCs:
--     admin_dispatch_job(job, application, client_price, payout)  -> assigned
--     inspector_start_job(job)                                    -> in_progress
--   admin_dispatch_job also hires the application and sets contractor_id; it
--   does NOT create a job_contracts row, so the explicit contract below is
--   still the one under test.
reset role;
update public.jobs set identity_mode = 'professional' where id = :'JOB';
-- admin_dispatch_job drives the job to 'assigned', which trips
-- nx_guard_dispatch_requires_funding on a prepay job whose initial tranche is
-- not in. Establish funding through the authorized platform path first — never
-- by presetting client_settled_at, which is platform-only by guard.
select nx_fx_fund_job(:'JOB');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
--  Since 20260801504000 dispatch requires a fully executed contract for the
--  selected inspector. Established through the real RPC chain, never by
--  writing job_contracts.status.
--  reset role first: the helper reads job_contracts to decide whether to adopt
--  an existing contract, and under role `authenticated` RLS hides that row, so
--  it would try to generate a second one. The signature RPCs it calls are
--  SECURITY DEFINER and authorise on the JWT claims, which the helper sets
--  itself, so running it privileged does not bypass any authorization.
reset role;
select nx_fx_execute_contract(:'JOB'::uuid, :'APP'::uuid, :'CL'::uuid, :'INSP'::uuid,
                              :'ADM'::uuid, 230000, 200000);
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';

select public.admin_dispatch_job(:'JOB', :'APP', 230000::bigint, 200000::bigint);

set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select public.inspector_start_job(:'JOB');

reset role;
-- job_contracts REQUIRED columns (NOT NULL, no default):
--   job_id, client_id, inspector_id, client_price_cents, inspector_payout_cents
-- Everything else defaults: status, client_approval_type ('client_signature'),
-- created_at/updated_at, id. The money mirrors the dispatch above — client
-- 230000 / payout 200000 — so the fixture is internally consistent rather than
-- padded with zeros to satisfy a constraint.
-- CHECK job_contracts_client_sig_no_admin_auth is satisfied because
-- client_approval_type defaults to 'client_signature' and the admin_authorized_*
-- columns are left NULL. effective_identity_mode is deliberately NOT set here:
-- trg_job_contracts_identity_snapshot stamps it on entry to fully_executed,
-- which is precisely the audit-snapshot behaviour under test.
--  ADOPT the contract the dispatch step already executed for this job.
--  uniq_job_contracts_active_per_job permits one active contract per job, and
--  hand-writing status='fully_executed' would set the exact column the
--  dispatch gate reads — the shortcut the gate exists to prevent.
select id as "CON" from public.job_contracts
 where job_id = :'JOB' and voided_at is null
 order by created_at desc limit 1 \gset

select isnt(
  (select effective_identity_mode from public.job_contracts where id = :'CON'),
  null,
  'SNAPSHOT: execution stamped effective_identity_mode');

select is(
  (select effective_identity_mode from public.job_contracts where id = :'CON'),
  'professional',
  'SNAPSHOT: it recorded the mode at execution time');

set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select identity_mode from public.client_job_contracts_view where id = :'CON'),
  'professional',
  'ACTIVE CONTRACT: the contract view reports the live mode');

reset role;
update public.jobs set identity_mode = 'full' where id = :'JOB';
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select identity_mode from public.client_job_contracts_view where id = :'CON'),
  'full',
  'ACTIVE CONTRACT: raising disclosure mid-engagement takes effect immediately');
select is(
  (select inspector_email from public.client_job_contracts_view where id = :'CON'),
  'in.lc@test.nx',
  'ACTIVE CONTRACT: full mode releases contact on the live policy (final owner policy, 20260801566000)');

reset role;
update public.jobs set identity_mode = 'protected' where id = :'JOB';
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select identity_mode from public.client_job_contracts_view where id = :'CON'),
  'protected',
  'ACTIVE CONTRACT: lowering disclosure mid-engagement ALSO takes effect immediately');
select is(
  (select inspector_display_name from public.client_job_contracts_view where id = :'CON'),
  null,
  'ACTIVE CONTRACT: the executed snapshot does NOT keep the name visible');

-- ══════════════════════════════════════════════════════════════════════════
--  D. VOIDING must not resurrect the snapshot  ★ the reported defect
-- ══════════════════════════════════════════════════════════════════════════
reset role;
update public.job_contracts set status = 'voided', voided_at = now() where id = :'CON';
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select identity_mode from public.client_job_contracts_view where id = :'CON'),
  'protected',
  'VOID: the stale professional snapshot does NOT become authoritative again');

select is(
  (select inspector_display_name from public.client_job_contracts_view where id = :'CON'),
  null,
  'VOID: revoked identity stays revoked after the contract is voided');

select is(
  (select executed_identity_mode from public.client_job_contracts_view where id = :'CON'),
  'professional',
  'AUDIT: the execution snapshot is still readable as evidence, clearly named');

-- ══════════════════════════════════════════════════════════════════════════
--  E. TERMINAL ENGAGEMENT — policy freeze + résumé cutoff
-- ══════════════════════════════════════════════════════════════════════════
reset role;
update public.job_contracts set status = 'fully_executed', voided_at = null where id = :'CON';
update public.jobs set identity_mode = 'professional' where id = :'JOB';
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- nx_can_access_doc is service_role-only by GRANT (release invariant).
-- Production path: authenticated client -> mint-doc-url -> service role ->
-- nx_can_access_doc(p_uid = the caller's uid). Drop to the trusted context
-- for the call and keep passing the BUYER's uuid as p_uid, so the assertion
-- means exactly what it did before.
reset role;
select is(
  public.nx_can_access_doc(:'CL', 'resumes', :'RESPATH'),
  true,
  'IN PROGRESS: résumé is mintable during a live engagement');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ★ ORDER MATTERS. completed is TERMINAL in guard_jobs_status_transition, so
--   the old completed -> disputed step was illegal. The real machine allows
--   in_progress -> disputed -> completed, so exercise DISPUTED first and reach
--   completed from there. Both hops below are legal transitions.

-- in_progress -> disputed, via the canonical RPC a job party actually calls.
-- flag_job_dispute authorizes client_id / contractor_id / agency_id — NOT an
-- admin. Raise it as the CLIENT, who is a genuine party to this job.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.flag_job_dispute(
  :'JOB', 'lifecycle probe: disclosure must stay adjustable while disputed',
  'other', ARRAY[]::text[]);

-- back to the admin for the policy assertion
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_set_project_policy(
       'b4444444-4444-4444-4444-444444444444','full','client_reapproval') $$,
  'FREEZE: DISPUTED is recoverable, not terminal — policy stays adjustable');

-- disputed -> completed. The guard permits this hop directly; the canonical
-- completion RPC (approve_job_and_pay) also moves money, which would drag
-- payments into an identity test for no added coverage.
reset role;
update public.jobs set identity_mode = 'professional' where id = :'JOB';
update public.jobs set status = 'completed' where id = :'JOB';

select is(
  public.nx_can_access_doc(:'CL', 'resumes', :'RESPATH'),
  false,
  'CUTOFF: a COMPLETED engagement mints no new résumé URLs, even in professional');

set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APP'),
  'Dana Okafor',
  'CUTOFF: historical identity PRESENTATION is preserved — only document access stops');

set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.admin_set_project_policy(
       'b4444444-4444-4444-4444-444444444444','protected','client_reapproval') $$,
  '42501',
  null,
  'FREEZE: policy cannot be changed once the engagement is completed');

select lives_ok(
  $$ select public.admin_set_project_policy(
       'b4444444-4444-4444-4444-444444444444','professional','client_reapproval') $$,
  'FREEZE: re-asserting the SAME policy stays idempotent (no spurious error)');

-- ══════════════════════════════════════════════════════════════════════════
--  F. Rejected applicant loses document access; admin/self keep theirs
-- ══════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set status = 'open', identity_mode = 'professional' where id = :'JOB2';
update public.applications set status = 'rejected' where id = :'APP2';
select is(
  public.nx_can_access_doc(:'CL', 'resumes', :'RESPATH'),
  false,
  'CUTOFF: a REJECTED applicant''s résumé is no longer mintable by the buyer');

select is(
  public.nx_can_access_doc(:'INSP', 'resumes', :'RESPATH'),
  true,
  'SELF: the inspector still reaches their own résumé');

select is(
  public.nx_can_access_doc(:'ADM', 'resumes', :'RESPATH'),
  true,
  'ADMIN: platform admin document access is preserved');

-- ★ CANCELLED freeze is asserted on JOB2, which is still 'open' here, via the
--   canonical admin_cancel_job (open -> cancelled is legal). Asserting it on
--   JOB was impossible: JOB is already terminal at 'completed'.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select public.admin_cancel_job(:'JOB2', 'lifecycle probe: close the engagement');

select throws_ok(
  $$ select public.admin_set_project_policy(
       'b5555555-5555-5555-5555-555555555555','protected','client_reapproval') $$,
  '42501',
  null,
  'FREEZE: CANCELLED is terminal — policy is frozen');

select * from finish();
rollback;
