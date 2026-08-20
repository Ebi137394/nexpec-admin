-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/senior_review_behaviour_test.sql
--
--  P1-5. The BEHAVIOURAL Senior Review + delivery suite.
--
--  WHY THIS EXISTS. senior_inspector_review_test.sql asserts entirely against
--  pg_proc.prosrc, pg_trigger and pg_indexes. Its admin-only-delivery
--  "proof" regex-matches the error-message string 'only an Admin delivers'
--  inside a function body. That certifies a function CONTAINS some text — not
--  that the system REFUSES anybody. The independent Lane G review confirmed it
--  would not have caught a single one of the three P0s it found:
--    • the direct PATCH delivery bypass (the guard simply never ran)
--    • a 20% payment recorded as full settlement
--    • a client writing jobs.client_settled_at
--  Every assertion below calls the real thing as a real identity and checks
--  what actually happens.
--
--  IDENTITY MODEL. Same as money_flow_test.sql: identity is driven by
--  `set local request.jwt.claims`, which auth.uid() and nx_is_admin() read, so
--  the suite runs as the test superuser and exercises the RPCs and the guard
--  TRIGGERS. Table-level RLS is covered by the RLS deny-matrix suites; what is
--  proved here is the authorisation and gate logic, which is where the P0s were.
--
--  All seeding is txn-scoped and reverted by the final rollback.
--
--  RUN (LOCAL only):
--    supabase test db
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/senior_review_behaviour_test.sql
--
--  ⚠ pgTAP IS NOT INSTALLED IN THE AUTHORING SANDBOX, so this file is
--    UNEXECUTED as written. The equivalent behaviour WAS executed statement for
--    statement on real PostgreSQL 18.4 against a stub reproducing these
--    functions and triggers (see the commit message for the run log). That
--    proves the logic; it does not prove this file's pgTAP syntax, and it does
--    not make full-chain SQL runtime green. Both remain PENDING MAC.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql

select plan(31);

-- ── actors ──────────────────────────────────────────────────────────────────
\set adm    '10000000-0000-0000-0000-000000000001'
\set insp   '10000000-0000-0000-0000-000000000002'
\set senior '10000000-0000-0000-0000-000000000003'
\set senr2  '10000000-0000-0000-0000-000000000004'
\set deact  '10000000-0000-0000-0000-000000000005'
\set coauth '10000000-0000-0000-0000-000000000006'
\set cli    '10000000-0000-0000-0000-000000000007'
\set job    '20000000-0000-0000-0000-000000000001'
\set rep    '30000000-0000-0000-0000-000000000001'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u::text || '@test.local', now(), now()
  from (values (:'adm'::uuid), (:'insp'::uuid), (:'senior'::uuid), (:'senr2'::uuid),
               (:'deact'::uuid), (:'coauth'::uuid), (:'cli'::uuid)) v(u)
on conflict (id) do nothing;

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

--  The buyer carries an AUTHORISED CREDIT LINE. The job below is net_terms, and
--  net_terms is precisely the mode that dispatches against credit rather than
--  against a prepaid tranche: nx_guard_dispatch_requires_funding resolves
--  nx_job_buyer_principal(job) = COALESCE(agency_id, client_id) and refuses the
--  dispatch unless that principal's profiles.client_credit_limit_cents > 0.
--  Seeded here, with no JWT claims set, so auth.uid() is NULL and the profile
--  privileged-column guard treats this as the trusted server context it is —
--  the same standing the platform has when it authorises a credit line.
insert into public.profiles (id, email, role, status, client_credit_limit_cents)
--  0 is the column default and means "no authorised credit"; only the buyer
--  gets a line, so nobody else accidentally becomes dispatchable on credit.
values (:'adm'::uuid,    'adm@test.local',    'admin',     'active',    0),
       (:'insp'::uuid,   'insp@test.local',   'inspector', 'active',    0),
       (:'senior'::uuid, 'senior@test.local', 'senior',    'active',    0),
       (:'senr2'::uuid,  'senr2@test.local',  'senior',    'active',    0),
       (:'deact'::uuid,  'deact@test.local',  'senior',    'suspended', 0),
       (:'coauth'::uuid, 'coauth@test.local', 'senior',    'active',    0),
       (:'cli'::uuid,    'cli@test.local',    'client',    'active',    500000)
on conflict (id) do update set role = excluded.role,
                               status = excluded.status,
                               client_credit_limit_cents = excluded.client_credit_limit_cents;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- ── the job, dispatched CANONICALLY ─────────────────────────────────────────
--  It used to be INSERTed with contractor_id already populated and
--  status='in_progress'. Populating contractor_id IS a dispatch as far as
--  nx_guard_dispatch_requires_funding is concerned (it treats a NULL OLD
--  contractor on INSERT as a dispatch), so the whole suite aborted at setup with
--      FUNDING_REQUIRED: job … is net_terms but has no resolvable buyer principal
--  — because on the INSERT side nx_job_buyer_principal reads public.jobs BY ID
--  and that row does not exist yet inside a BEFORE INSERT trigger. Production
--  never creates a job already dispatched, so the fixture now does what
--  production does: create it UNASSIGNED, then attach the inspector in a
--  separate statement, where the row exists and the credit line resolves.
--
--  net_terms deliberately does NOT take nx_fx_fund_job. Prepaying it would
--  destroy sections E and F: settle_client_payment must return settled=false on
--  the 20% tranche and settled=true only after the 80%, and both are meaningless
--  against a job that was already settled at fixture time.
insert into public.jobs (id, title, client_id, status, moderation_status, payment_mode,
                         client_price_cents, inspector_payout_cents)
values (:'job'::uuid, 'Behavioural suite job', :'cli'::uuid,
        'open', 'approved', 'net_terms', 100000, 70000)
on conflict (id) do nothing;

--  Since 20260801504000 the assign transition also requires a fully executed
--  contract for the selected inspector. Satisfied here through the real RPC
--  chain (generate → client sign → inspector sign) rather than by writing
--  job_contracts.status, which would defeat the gate this suite must not
--  weaken. An application is required because admin_generate_job_contract is
--  keyed on one.
insert into public.applications (id, job_id, applicant_id, status, bid_amount_cents)
values ('20000000-0000-0000-0000-0000000000a1'::uuid, :'job'::uuid, :'insp'::uuid,
        'CLIENT_SELECTED', 70000)
on conflict (id) do nothing;

select nx_fx_execute_contract(:'job'::uuid, '20000000-0000-0000-0000-0000000000a1'::uuid,
         :'cli'::uuid, :'insp'::uuid, :'adm'::uuid, 100000, 70000);

--  open → assigned → in_progress, both legal in guard_jobs_status_transition.
update public.jobs
   set contractor_id = :'insp'::uuid, status = 'assigned'
 where id = :'job'::uuid;
update public.jobs set status = 'in_progress' where id = :'job'::uuid;

insert into public.inspection_reports (id, job_id, inspector_id, status)
values (:'rep'::uuid, :'job'::uuid, :'insp'::uuid, 'submitted')
on conflict (id) do nothing;

--  ── the SECOND, never-delivered report, for the section G document probes ──
--  It used to be a second row on THIS job by THIS inspector, which is not a
--  thing the product permits: inspection_reports carries
--      UNIQUE (job_id, inspector_id)   -- unique_report_per_job_inspector
--  i.e. ONE report row per (job, inspector). That is not incidental — it is the
--  report-cardinality invariant, and 20260801400000_itp_reporting.sql self-tests
--  for the constraint's continued existence and aborts the migration with
--  "report cardinality changed" if it ever disappears. So the old fixture asked
--  the schema for something it is designed to refuse, and the whole suite died
--  at setup on the duplicate key before a single assertion ran.
--
--  What section G actually needs is a report that (a) is authored by :insp,
--  (b) sits on a job whose client is :cli, and (c) never reaches 'delivered' —
--  nx_client_may_read_report_doc reads exactly r.status, r.inspector_id and
--  j.client_id. None of that requires it to be on the SAME job; it requires a
--  SECOND ENGAGEMENT. So the inspector gets one, built through the canonical
--  path (apply → fund → admin_dispatch_job) rather than hand-assembled, which
--  keeps the dispatch and funding guards armed. It is deliberately left prepay
--  and fully settled: it is scenery for the document probes, and section E/F
--  pin their money assertions to the net_terms job above by id, so this job
--  cannot contaminate them. Verified: dispatching it creates no earning/payout/
--  settlement row for :insp and does not move their wallet.
select nx_fx_dispatched_job(
         :'cli'::uuid, :'insp'::uuid, :'adm'::uuid,
         'Behavioural suite job 2 (document-access scenery)') as job2 \gset

insert into public.inspection_reports (id, job_id, inspector_id, status)
values ('30000000-0000-0000-0000-000000000002', :'job2'::uuid, :'insp'::uuid, 'submitted')
on conflict (id) do nothing;

--  ── an UNPAID job of the Client's, for the P0-3 UPDATE probe in section H ──
--  Section H cannot aim that probe at the main job; see the note there. It needs
--  a job that has NOT been through settle_client_payment, so the Client's
--  attempted stamp is a real state change. nx_fx_unfunded_job presets no
--  contractor and no funding column at all, which is exactly the starting state
--  P0-3 is about.
select nx_fx_unfunded_job(
         :'cli'::uuid, 'Behavioural suite unpaid job (P0-3 probe)') as unpaid \gset

-- A REALISTIC pre-existing inspector balance, so "unchanged" is real evidence.
-- 125.50 available from earlier work, plus one historical settlement row.
insert into public.wallets (user_id, available_balance, pending_amount, total_earned)
values (:'insp'::uuid, 125.50, 40.00, 165.50)
on conflict (user_id) do update
  set available_balance = 125.50, pending_amount = 40.00, total_earned = 165.50;

insert into public.transactions (user_id, inspector_id, job_id, type, amount,
                                 gross_amount_halalas, platform_fee_halalas, status, description)
values (:'insp'::uuid, :'insp'::uuid, null, 'earning', 165.50, 16550, 0, 'paid',
        'Historical earning seeded by the behavioural suite');

-- staged funding schedule, as the platform
set local request.jwt.claims to '{"role":"service_role"}';
select lives_ok(
  $$ select public.nx_funding_ensure_schedule('20000000-0000-0000-0000-000000000001') $$,
  'the platform can materialise a funding schedule'
);

-- ── A. REVIEWER ELIGIBILITY (behavioural) ───────────────────────────────────
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'an ordinary Inspector cannot be assigned as Senior Inspector'
);

select throws_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000007') $$,
  '42501',
  null,
  'the job''s Client cannot be assigned as Senior Inspector'
);

select throws_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000005') $$,
  '42501',
  null,
  'a DEACTIVATED Senior Inspector cannot be assigned'
);

-- the primary author is a senior on paper for this assertion only
update public.profiles set role = 'senior' where id = :'insp'::uuid;
select throws_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'the report AUTHOR cannot review their own report even holding the senior role'
);
update public.profiles set role = 'inspector' where id = :'insp'::uuid;

select lives_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000003') $$,
  'an active, unrelated Senior Inspector IS assignable'
);

select is(
  (select round from public.report_senior_reviews
    where inspection_report_id = :'rep'::uuid and superseded_at is null),
  1,
  'the assignment opened round 1'
);

-- ── B. FORGED / WRONG-ROUND DECISIONS ───────────────────────────────────────
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'approved', null, 1) $$,
  '42501',
  null,
  'a Senior Inspector who is NOT the assignee cannot decide the round'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'approved', null, 99) $$,
  '22000',
  null,
  'a decision pinned to a stale round is refused (offline replay protection)'
);

select throws_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'returned', '   ', 1) $$,
  '22000',
  null,
  'a return with no comment is refused'
);

-- ── C. REPLACEMENT / SUPERSESSION ISOLATION ─────────────────────────────────
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.nx_admin_assign_senior_reviewer(
       '30000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000004') $$,
  'an Admin may reassign, which supersedes the live round'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'approved', null, 1) $$,
  '22000',
  null,
  'the SUPERSEDED reviewer can no longer decide — replacement isolation holds'
);

-- ── D. DELIVERY AUTHORITY — the P0 the old suite could not see ──────────────
--  These are DIRECT TABLE UPDATES, deliberately. The bypass was never through
--  the RPC; it was PostgREST writing the column straight.
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok(
  $$ update public.inspection_reports set status = 'delivered'
      where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'the CLIENT cannot self-deliver by direct table update'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ update public.inspection_reports set status = 'delivered'
      where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'the INSPECTOR cannot self-deliver by direct table update'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ update public.inspection_reports set status = 'delivered'
      where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'the SENIOR INSPECTOR cannot deliver to the Client, even holding the live round'
);

-- ── E. FUNDING GATES ────────────────────────────────────────────────────────
--  approve first, so the only thing still missing is the money
select lives_ok(
  $$ select public.nx_senior_review_decide(
       '30000000-0000-0000-0000-000000000001', 'approved', null, 2) $$,
  'the ASSIGNED reviewer on the live round can approve'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_admin_deliver_report('30000000-0000-0000-0000-000000000001') $$,
  '22000',
  null,
  'even an Admin with senior approval cannot deliver before the remaining tranche'
);

-- fund ONLY the initial tranche
set local request.jwt.claims to '{"role":"service_role"}';
select lives_ok(
  $$ select public.nx_funding_mark_stage_funded(
       '20000000-0000-0000-0000-000000000001', 'initial', 'pi_behav_initial') $$,
  'the platform records the initial tranche'
);

select is(
  (select (public.settle_client_payment('20000000-0000-0000-0000-000000000001'))->>'settled'),
  'false',
  'a 20% tranche is NOT recorded as full client settlement'
);

--  A wallet that starts at 0 and ends at 0 proves nothing — it is equally
--  consistent with "nothing paid" and "no wallet exists". The inspector is
--  seeded with a REALISTIC pre-existing balance above, so an unchanged figure
--  is positive evidence that this specific flow moved no money.
select is(
  (select available_balance::text from public.wallets
    where user_id = '10000000-0000-0000-0000-000000000002'),
  '125.50',
  'the initial 20% tranche did not change the inspector balance (seeded 125.50)'
);

select is(
  (select count(*)::int from public.transactions
    where inspector_id = '10000000-0000-0000-0000-000000000002'
      and type in ('earning','payout','settlement')),
  1,
  'no new payout/earning/settlement row — only the seeded historical one'
);

-- ── F. THE COMPLETE GOLDEN PATH ─────────────────────────────────────────────
select lives_ok(
  $$ select public.nx_funding_mark_stage_funded(
       '20000000-0000-0000-0000-000000000001', 'final', 'pi_behav_final');
     select public.settle_client_payment('20000000-0000-0000-0000-000000000001') $$,
  'the remaining tranche lands and full settlement follows'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.nx_admin_deliver_report('30000000-0000-0000-0000-000000000001') $$,
  'GOLDEN PATH: with approval AND full funding, an Admin delivers'
);

-- ── G. DOCUMENT ACCESS — the P0 the delivery-status gate did not cover ──────
--  Gating status is not gating the FILE. nx_can_access_doc granted the client
--  the report on job membership alone, so the deliverable was downloadable
--  before review, before the remaining tranche and before delivery.
--
--  EACH PROBE RUNS AS THE IDENTITY IT PASSES. That is not decoration. The
--  predicate takes p_uid, but its second branch is `IF nx_is_admin() THEN RETURN
--  true`, and nx_is_admin() reads the CALLER's JWT, not p_uid. Section F ends
--  under the Admin's claims for the golden-path delivery, and this section used
--  to inherit them — so the predicate returned true for every p_uid and these
--  three assertions were answering "is the caller an admin?" instead of "may
--  this user read the file?". Production reaches this through
--  nx_gate_report_doc_for_client(report, p_uid) with p_uid = the requesting
--  user (466000:167), i.e. caller and subject are the SAME principal. The
--  claims below restore that, which is what makes these answers mean anything.
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated"}';
select ok(
  not public.nx_client_may_read_report_doc(
    '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000007'),
  'the CLIENT cannot read an undelivered report document'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(
  public.nx_client_may_read_report_doc(
    '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'),
  'the report AUTHOR can always read their own draft'
);

set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(
  not public.nx_client_may_read_report_doc(
    '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004'),
  'an UNRELATED user (a Senior Inspector on another report) cannot read it'
);

-- ── H. P0-3: the client cannot stamp their own settlement ───────────────────
--  THIS PROBE MUST NOT BE AIMED AT THE MAIN JOB. Section F has already driven
--  that job through settle_client_payment, so jobs.client_settled_at is stamped
--  — and now() is transaction_timestamp(), CONSTANT for the whole transaction.
--  `set client_settled_at = now()` therefore rewrites the byte-identical value
--  the payment path wrote moments earlier. nx_guard_jobs_funding_columns fires
--  on `NEW.client_settled_at IS DISTINCT FROM OLD.client_settled_at`, so it
--  stayed silent and the assertion caught no exception.
--
--  That is a fixture defect, NOT a hole in the guard, and it was proved both
--  ways before this was touched: on an already-settled job the identical-value
--  write is permitted (it changes nothing, so it escalates nothing), while
--  `now() + interval '1 day'` on that same job as that same Client is refused
--  with FUNDING_COLUMN_IS_PLATFORM_ONLY / 42501. The guard is healthy; the
--  probe was pointed at a no-op.
--
--  So P0-3 is proved where it actually lives — a Client FABRICATING a settlement
--  on a job of theirs that has NOT been paid, which is a genuine state change.
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok(
  format($$ update public.jobs set client_settled_at = now() where id = %L $$, :'unpaid'),
  '42501',
  null,
  'the CLIENT cannot write jobs.client_settled_at (P0-3, UPDATE side)'
);

select throws_ok(
  $$ insert into public.jobs (id, title, client_id, client_price_cents, payment_mode,
                              status, client_settled_at)
     values ('20000000-0000-0000-0000-0000000000ff', 'forged', 
             '10000000-0000-0000-0000-000000000007', 50000, 'prepay',
             'pending_approval', now()) $$,
  '42501',
  null,
  'the CLIENT cannot create a job already settled (P0-3, INSERT side)'
);

select throws_ok(
  $$ insert into public.inspection_reports (id, job_id, inspector_id, status)
     values ('30000000-0000-0000-0000-0000000000ff',
             '20000000-0000-0000-0000-000000000001',
             '10000000-0000-0000-0000-000000000007', 'delivered') $$,
  '42501',
  null,
  'nobody can create a report already DELIVERED (P0-1, INSERT side)'
);

-- after legitimate delivery the client CAN read it
select ok(
  public.nx_client_may_read_report_doc(
    '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007'),
  'after Admin delivery the CLIENT can read the report document'
);

select is(
  (select available_balance::text from public.wallets
    where user_id = '10000000-0000-0000-0000-000000000002'),
  '125.50',
  'after full funding, approval AND delivery the inspector balance is STILL unchanged'
);

select * from finish();

rollback;
