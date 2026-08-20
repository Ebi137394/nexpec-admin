-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/report_and_application_history_test.sql
--
--  OWNER-REVIEW lifecycle locks (20260801562000 + report permanence):
--    submitted → vetted/forwarded → selected → hired → completed
--  must leave BOTH permanent records readable:
--    • the inspector's submitted report (after approval/delivery/completion)
--    • the client's view of the hired application (even if never forwarded)
--  while the pre-engagement anti-poaching gate stays shut.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/report_and_application_history_test.sql
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;
select plan(12);

create temporary table _ids on commit drop as
select gen_random_uuid() as client_id,
       gen_random_uuid() as inspector_id,   -- hired, never forwarded
       gen_random_uuid() as pending_id,     -- pending, never forwarded
       gen_random_uuid() as job_id,
       gen_random_uuid() as app_hired,
       gen_random_uuid() as app_pending;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'rah.' || u::text || '@synthetic.invalid', now(), now()
  from _ids, unnest(array[client_id, inspector_id, pending_id]) u;

insert into public.profiles (id, role, full_name, email, phone, is_verified)
select client_id, 'client', 'RAH Client', 'rah.c@synthetic.invalid', '+15550501', true from _ids
union all
select inspector_id, 'inspector', 'RAH Hired Inspector', 'rah.i@synthetic.invalid', '+15550502', true from _ids
union all
select pending_id, 'inspector', 'RAH Pending Inspector', 'rah.p@synthetic.invalid', '+15550503', true from _ids
on conflict (id) do update set email = excluded.email, role = excluded.role,
  full_name = excluded.full_name;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- Completed job whose inspector was hired without a forwarding stamp (the
-- admin direct-assignment shape that used to erase the history).
insert into public.jobs (id, title, client_id, contractor_id, status, moderation_status,
                         payment_mode, client_price_cents, inspector_payout_cents,
                         identity_mode, client_settled_at, admin_confirmed_at)
select job_id, 'rah lifecycle', client_id, inspector_id, 'completed', 'approved',
       'prepay', 100000, 80000, 'professional', now(), now()
  from _ids;

insert into public.applications (id, job_id, applicant_id, status, bid_amount_cents)
select app_hired, job_id, inspector_id, 'hired', 80000 from _ids;
insert into public.applications (id, job_id, applicant_id, status, bid_amount_cents)
select app_pending, job_id, pending_id, 'pending', 70000 from _ids;

insert into public.inspection_reports (job_id, inspector_id, notes, status,
                                       technical_approved, financial_approved,
                                       is_published, is_client_approved)
select job_id, inspector_id,
       'RAH permanent report body — weld seams inspected, no recordable indications.',
       'approved', true, true, true, true
  from _ids;

grant select on _ids to authenticated;

-- ─── Inspector: the submitted report never disappears ───────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"' || (select inspector_id::text from _ids) || '","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.inspection_reports
    where job_id = (select job_id from _ids)),
  1, 'R1 inspector reopens their report on a COMPLETED job');
select ok(
  (select notes like 'RAH permanent report body%'
     and is_published and is_client_approved
     from public.inspection_reports where job_id = (select job_id from _ids)),
  'R2 …and it is the exact submitted report, in its delivered/approved state');
select lives_ok(
  $$ select * from public.report_senior_reviews
      where inspection_report_id in
        (select id from public.inspection_reports
          where inspector_id = auth.uid()) $$,
  'R3 the author can read the revision-history surface');

-- ─── Client: the hired application is permanent history ─────────────────────
select set_config('request.jwt.claims',
  '{"sub":"' || (select client_id::text from _ids) || '","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.applications
    where job_id = (select job_id from _ids)),
  1, 'C1 client sees exactly one application on the completed job');
select is(
  (select status from public.applications
    where job_id = (select job_id from _ids)),
  'hired', 'C2 …and it is the HIRED record, despite never being forwarded');
select is(
  (select count(*)::int from public.applications
    where id = (select app_pending from _ids)),
  0, 'C3 the pending, never-forwarded proposal stays hidden (anti-poaching gate intact)');
select is(
  (select inspector_display_name from public.job_applicant_identity_view
    where application_id = (select app_hired from _ids)),
  'RAH Hired Inspector',
  'C4 identity view surfaces the hired record with the mode-gated name');
select ok(
  (select inspector_email is null and inspector_phone is null
     from public.job_applicant_identity_view
    where application_id = (select app_hired from _ids)),
  'C5 …without contact — this job is PROFESSIONAL, and contact rides FULL only (20260801566000)');
select is(
  (select count(*)::int from public.job_applicant_identity_view
    where application_id = (select app_pending from _ids)),
  0, 'C6 identity view hides the unforwarded pending proposal');
select ok(
  (select is_published from public.inspection_reports
    where job_id = (select job_id from _ids)),
  'C7 client retains access to the delivered report');

-- ─── Stranger: no cross-job leakage ─────────────────────────────────────────
select set_config('request.jwt.claims',
  '{"sub":"' || (select pending_id::text from _ids) || '","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.applications
    where id = (select app_hired from _ids)),
  0, 'S1 another inspector cannot read the hired application');
select is(
  (select count(*)::int from public.inspection_reports
    where job_id = (select job_id from _ids)),
  0, 'S2 another inspector cannot read the report');

reset role;
select * from finish();
rollback;
