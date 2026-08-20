-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/inspection_item_ncr_link_test.sql
--
--  Behavioural proof of 20260801366000 — a failed inspection item raises a REAL
--  NCR through the EXISTING flash-report path, and no parallel system appears.
--
--  RUN:  node scripts/qa/run-pgtap.mjs inspection_item_ncr_link
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  ── WHY THIS IS pgTAP AND NOT A DO BLOCK ───────────────────────────────────
--  It used to be one DO $suite$ block signalling failure with RAISE EXCEPTION,
--  which emits no TAP plan, so scripts/qa/run-pgtap.mjs could never score it.
--  Every original check is preserved below as its own TAP assertion.
--
--  ── WHY THE JOB IS BUILT BY THE FIXTURE ────────────────────────────────────
--  It used to INSERT a job with contractor_id set and status 'in_progress'.
--  The dispatch funding gate refuses that shape (FUNDING_REQUIRED) and
--  production never creates it. See _fixtures/canonical_job.sql.
--
--  N1  a passing item cannot raise an NCR
--  N2  a failed item raises one, and it is an ordinary flash_report
--  N3  the item is linked to it
--  N4  raising twice is idempotent
--  N5  the NCR moves through the EXISTING state machine (flash_report_transition)
--  N6  a stranger cannot raise an NCR on someone else's job
--  N7  the NCR carries the item's context (location, description)
--  N8  no money moved
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
select plan(11);

-- Never put a trailing comment on a \set line — psql concatenates the tail.
\set CL    'd1111111-1111-1111-1111-111111111111'
\set INSP  'd2222222-2222-2222-2222-222222222222'
\set RANDO 'd3333333-3333-3333-3333-333333333333'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL',   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','nl.client@test.nx',now(),now()),
  (:'INSP', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','nl.insp@test.nx',  now(),now()),
  (:'RANDO','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nl.rando@test.nx', now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

insert into public.profiles (id, role, full_name, email, is_verified) values
  (:'CL',   'client',   'NL Client',   'nl.client@test.nx',true),
  (:'INSP', 'inspector','NL Inspector','nl.insp@test.nx',  true),
  (:'RANDO','inspector','NL Rando',    'nl.rando@test.nx', true);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- The inspector is put on the job the only way production does it: apply →
-- fund via the platform path → admin_dispatch_job. The suite needs an admin
-- profile for that broker step, so RANDO doubles as nothing here — a dedicated
-- admin is seeded because admin_dispatch_job authenticates via auth.uid().
\set ADM 'd4444444-4444-4444-4444-444444444444'
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'ADM','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nl.admin@test.nx',now(),now());

-- Fixture users are CONFIRMED users. The email-verification gate
-- (20260801582000) refuses gated writes from an unconfirmed account, so a
-- fixture that skips confirmation is not modelling a real signed-up user.
-- Scoped to NULLs so it can never touch an already-confirmed row.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
insert into public.profiles (id, role, full_name, email, is_verified) values
  (:'ADM','admin','NL Admin','nl.admin@test.nx',true);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

select nx_fx_dispatched_job(:'CL', :'INSP', :'ADM', 'NCR LINK TEST',
                            100000, 70000, 'prepay') as "JOB" \gset
update public.jobs set status = 'in_progress' where id = :'JOB';

insert into public.inspection_reports (job_id, inspector_id, notes, status)
values (:'JOB', :'INSP', 'structured inspection', 'pending')
returning id as "REPORT" \gset

insert into public.inspection_items (report_id, description, status, location, notes)
values (:'REPORT', 'Weld cap profile within tolerance', 'pass', 'Spool 4', null)
returning id as "PASSITEM" \gset

insert into public.inspection_items (report_id, description, status, location, notes)
values (:'REPORT', 'Undercut exceeds acceptance criteria', 'fail', 'Spool 7 / Weld 12',
        'Depth measured 0.9mm against 0.5mm allowable')
returning id as "FAILITEM" \gset

select count(*)::int as txn_before from public.transactions where user_id = :'INSP' \gset

-- act as the inspector (a job party)
set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- ── N1 — a passing item is not a non-conformance ────────────────────────────
select throws_like(
  format($$ select public.nx_raise_ncr_from_inspection_item(%L) $$, :'PASSITEM'),
  '%only a failed inspection item%',
  'N1: a passing item cannot raise an NCR');

-- ── N2 — a failed item raises a real flash report ───────────────────────────
select (public.nx_raise_ncr_from_inspection_item(
          :'FAILITEM', 'major', 'defect', 'raised from structured inspection')
        ->>'flash_report_id') as "NCR" \gset

select isnt(
  nullif(:'NCR','')::uuid,
  null,
  'N2: the RPC returns a flash_report_id');

select is(
  (select count(*)::int from public.flash_reports where id = :'NCR'::uuid),
  1,
  'N2: an ordinary flash_reports row was created');

select is(
  (select status from public.flash_reports where id = :'NCR'::uuid),
  'open',
  'N2: the NCR opened in status open');

-- ── N3 — the item is linked ─────────────────────────────────────────────────
select is(
  (select flash_report_id from public.inspection_items where id = :'FAILITEM'),
  :'NCR'::uuid,
  'N3: the failed item is linked to its NCR');

-- ── N4 — idempotent ─────────────────────────────────────────────────────────
select is(
  (select (public.nx_raise_ncr_from_inspection_item(:'FAILITEM')->>'flash_report_id')::uuid),
  :'NCR'::uuid,
  'N4: raising the same item again returns the SAME NCR');

select is(
  (select count(*)::int from public.flash_reports where job_id = :'JOB'),
  1,
  'N4: exactly one flash report exists for the one failed item');

-- ── N5 — it flows through the EXISTING state machine ────────────────────────
--  SEPARATION OF DUTIES. open → acknowledged is guarded in
--  flash_report_transition: "Reporters cannot acknowledge their own report".
--  INSP raised this NCR, so flash_reports.reporter_id = INSP and INSP is
--  refused here — correctly. Acknowledging as INSP would be asking the product
--  to let one principal both raise and clear a non-conformance, so the fix is a
--  SECOND, distinct, legitimately-authorized principal, not a weaker guard.
--  ADM (already seeded above, profiles.role='admin') is that principal: the
--  guard resolves admin/super_admin to 'super_admin' standing, which is a job
--  party for this purpose and is not the reporter. The claims are restored to
--  INSP immediately afterwards so the rest of the suite runs as before.
set local request.jwt.claims to '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}';

select public.flash_report_transition(:'NCR'::uuid, 'acknowledged', 'seen by admin');

set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select status from public.flash_reports where id = :'NCR'::uuid),
  'acknowledged',
  'N5: the NCR moves through the existing flash-report state machine');

-- ── N6 — a stranger cannot raise one ────────────────────────────────────────
insert into public.inspection_items (report_id, description, status, location)
values (:'REPORT', 'Second failure', 'fail', 'Spool 9')
returning id as "FAILITEM2" \gset

set local role authenticated;
set local request.jwt.claims to '{"sub":"d3333333-3333-3333-3333-333333333333","role":"authenticated"}';

select throws_like(
  format($$ select public.nx_raise_ncr_from_inspection_item(%L) $$, :'FAILITEM2'),
  '%',
  'N6: a non-party is refused by the existing delegated authorization');

reset role;
set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- ── N7 — the NCR carries the item context ───────────────────────────────────
select ok(
  (select description ilike '%Undercut exceeds acceptance criteria%'
      and description ilike '%Spool 7 / Weld 12%'
     from public.flash_reports where id = :'NCR'::uuid),
  'N7: the NCR carries the item description and location');

-- ── N8 — no money moved ─────────────────────────────────────────────────────
select is(
  (select count(*)::int from public.transactions where user_id = :'INSP'),
  :txn_before,
  'N8: raising an NCR moved no money');

select * from finish();
rollback;
