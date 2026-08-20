-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/identity_disclosure_test.sql
--  pgTAP for migration 20260801322000 — job-scoped applicant identity
--  disclosure, audit actor resolution, and applicant write containment.
--  Run: supabase test db
--
--  Locks, behaviourally (never by reading DDL text):
--    • PROTECTED     → no name / headline / résumé / certs / contact
--    • PROFESSIONAL  → name + headline + résumé + certs + qualifications,
--                      and STILL no private contact (that is Full's alone)
--    • FULL          → adds email + phone
--    • reputation (rating / reviews / completed jobs) survives every mode —
--      Protected must stay usable, not blank
--    • JOB SCOPING   → Professional on job A discloses nothing on job B, and
--                      an unrelated buyer gets no row for job A at all
--    • GR2           → identity disclosure is not a money channel: the view
--                      carries no payout/price/spread/bid column in any mode
--    • the seller cannot read the buyer-side identity view
--    • audit actor is resolved (admin → NEXPEC/platform, never "Unknown")
--    • a counter-only jobs diff is not reported as "Job details updated"
--    • a marketplace applicant cannot mutate client-owned job fields
--    • ★ DIRECT API ATTACK (20260801324000): a Protected/Professional buyer
--      cannot retrieve full_name / email / phone / résumé / certifications by
--      querying public.profiles directly — RLS returns no row at all
--    • flipping a job back to Protected revokes access immediately
--    • self / admin / seller→buyer profile reads are untouched
--
--  Seed is superuser; role/claims are txn-scoped and rolled back.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(56);

\set CL    'd1111111-1111-1111-1111-111111111111'
\set INSP  'd2222222-2222-2222-2222-222222222222'
\set OTHR  'd3333333-3333-3333-3333-333333333333'
\set ADM   'd4444444-4444-4444-4444-444444444444'
-- ⚠ NEVER put a trailing comment on a \set line. psql's \set concatenates
--   EVERY remaining token into the value, so `-- protected job` became part of
--   the UUID ("…555555--protectedjob") and the fixture aborted before assertion
--   1. Comments for \set go on their own line, above.
-- JOBP = the job whose identity_mode is flipped protected → professional → full
\set JOBP  'd5555555-5555-5555-5555-555555555555'
-- JOBF = the cross-job isolation control
\set JOBF  'd6666666-6666-6666-6666-666666666666'
\set APPP  'd7777777-7777-7777-7777-777777777777'
\set APPF  'd8888888-8888-8888-8888-888888888888'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'CL',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','cl.idy@test.nx', now(),now()),
  (:'INSP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in.idy@test.nx', now(),now()),
  (:'OTHR','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ot.idy@test.nx', now(),now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.idy@test.nx', now(),now());

insert into public.profiles (id, email, role, full_name, headline, bio, resume_url, certifications, specialty_slugs,
                             phone, rating_average, reviews_count, completed_jobs_count) values
  (:'CL',  'cl.idy@test.nx','client',   'Client Two',  null, null, null, '{}'::text[], '{}'::text[], null, null, 0, 0),
  (:'INSP','in.idy@test.nx','inspector','Dana Okafor', 'API 570 Piping Inspector', 'Twelve years of refinery piping.',
           'https://cdn.test/resume.pdf', '{API 570,AWS CWI}'::text[], '{piping}'::text[], '+1-555-0134', 4.8, 21, 17),
  (:'OTHR','ot.idy@test.nx','client',   'Other Buyer', null, null, null, '{}'::text[], '{}'::text[], null, null, 0, 0),
  (:'ADM', 'ad.idy@test.nx','admin',    'Platform Admin', null, null, null, '{}'::text[], '{}'::text[], null, null, 0, 0);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- Two independent jobs owned by the SAME buyer, applied to by the SAME
-- inspector. JOBP starts protected; JOBF stays protected throughout and is the
-- isolation control.
insert into public.jobs (id, title, description, client_id, status, moderation_status, identity_mode,
                         client_price_cents, inspector_payout_cents) values
  (:'JOBP','identity disclosure job','ORIGINAL CLIENT SCOPE', :'CL','open','approved','protected', 230000, 200000),
  (:'JOBF','unrelated control job',  'control scope',        :'CL','open','approved','protected', 100000,  80000);

insert into public.applications (id, job_id, applicant_id, status) values
  (:'APPP', :'JOBP', :'INSP', 'pending'),
  (:'APPF', :'JOBF', :'INSP', 'pending');

--  Forward both to the Client. Since 20260801516000 the disclosure view
--  additionally requires forwarded_to_client_at IS NOT NULL, because it
--  previously gated on job ownership alone and a Client could read a disclosed
--  name and email from an application the Admin had never forwarded.
--
--  This suite proves WHAT each policy discloses, so it must first reach the
--  point in the lifecycle where disclosure is legitimate. Without this the
--  assertions below tested the absent gate rather than the projection.
--  identity_disclosure_matrix_test.sql owns the complementary proof that an
--  UNFORWARDED application stays invisible under all three policies.
update public.applications
   set forwarded_to_client_at = now()
 where id in (:'APPP', :'APPF');

-- ══════════════════════════════════════════════════════════════════════════
--  PROTECTED
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select identity_mode from public.job_applicant_identity_view where application_id = :'APPP'),
  'protected',
  'PROTECTED: the view reports the job-scoped mode');

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'PROTECTED: real name is withheld');

select is(
  (select inspector_resume_url from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'PROTECTED: résumé is withheld');

select is(
  (select inspector_certifications from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'PROTECTED: certifications are withheld');

select is(
  (select inspector_email from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'PROTECTED: private contact is withheld');

-- Protected must remain USABLE — reputation is not identity.
select is(
  (select completed_jobs_count from public.job_applicant_identity_view where application_id = :'APPP'),
  17,
  'PROTECTED: reputation still reaches the buyer (Protected is not blank)');

-- ══════════════════════════════════════════════════════════════════════════
--  PROFESSIONAL — flip ONLY JOBP
-- ══════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode = 'professional' where id = :'JOBP';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPP'),
  'Dana Okafor',
  'PROFESSIONAL: the real professional name is released');

select is(
  (select inspector_headline from public.job_applicant_identity_view where application_id = :'APPP'),
  'API 570 Piping Inspector',
  'PROFESSIONAL: professional headline is released');

select is(
  (select inspector_resume_summary from public.job_applicant_identity_view where application_id = :'APPP'),
  'Twelve years of refinery piping.',
  'PROFESSIONAL: résumé summary is released');

select is(
  (select inspector_resume_url from public.job_applicant_identity_view where application_id = :'APPP'),
  'https://cdn.test/resume.pdf',
  'PROFESSIONAL: résumé document is released');

select is(
  (select inspector_certifications from public.job_applicant_identity_view where application_id = :'APPP'),
  '{API 570,AWS CWI}'::text[],
  'PROFESSIONAL: certifications are released');

select is(
  (select inspector_qualifications from public.job_applicant_identity_view where application_id = :'APPP'),
  '{piping}'::text[],
  'PROFESSIONAL: qualifications are released');

-- ★ The over-disclosure guard the product depends on.
select is(
  (select inspector_email from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'PROFESSIONAL: email stays hidden — private contact belongs to Full only');

select is(
  (select inspector_phone from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'PROFESSIONAL: phone stays hidden — private contact belongs to Full only');

-- ══════════════════════════════════════════════════════════════════════════
--  JOB SCOPING — the same inspector on the untouched control job
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select identity_mode from public.job_applicant_identity_view where application_id = :'APPF'),
  'protected',
  'ISOLATION: the unrelated job keeps its own mode');

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPF'),
  null,
  'ISOLATION: disclosure on job A does NOT disclose the same inspector on job B');

-- ══════════════════════════════════════════════════════════════════════════
--  FULL
-- ══════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode = 'full' where id = :'JOBP';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPP'),
  'Dana Okafor',
  'FULL: professional name is still released');

select is(
  (select inspector_email from public.job_applicant_identity_view where application_id = :'APPP'),
  'in.idy@test.nx',
  'FULL: private contact email is released (final owner policy, 20260801566000)');

select is(
  (select inspector_phone from public.job_applicant_identity_view where application_id = :'APPP'),
  '+1-555-0134',
  'FULL: private contact phone is released (final owner policy, 20260801566000)');

-- ══════════════════════════════════════════════════════════════════════════
--  GR2 — identity disclosure must never become a money channel
-- ══════════════════════════════════════════════════════════════════════════
select is_empty(
  $$ select column_name from information_schema.columns
      where table_schema='public' and table_name='job_applicant_identity_view'
        and (column_name ilike '%payout%' or column_name ilike '%price%'
             or column_name ilike '%spread%' or column_name ilike '%bid%'
             or column_name ilike '%budget%') $$,
  'GR2: the identity view exposes no payout / price / spread / bid column in ANY mode');

-- Full disclosure is the most permissive mode; payout must still be unreachable.
select throws_ok(
  $$ select inspector_payout_cents from public.jobs where id = 'd5555555-5555-5555-5555-555555555555' $$,
  '42501',
  null,
  'GR2: even in FULL identity mode the buyer cannot read inspector payout');

-- ══════════════════════════════════════════════════════════════════════════
--  Cross-tenant + seller containment
-- ══════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"d3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is_empty(
  $$ select 1 from public.job_applicant_identity_view
      where application_id = 'd7777777-7777-7777-7777-777777777777' $$,
  'TENANCY: an unrelated buyer sees no row, even in FULL mode');

set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is_empty(
  $$ select 1 from public.job_applicant_identity_view
      where application_id = 'd7777777-7777-7777-7777-777777777777' $$,
  'SELLER: the inspector cannot read the buyer-side identity view');

-- ══════════════════════════════════════════════════════════════════════════
--  APPLICANT WRITE CONTAINMENT (the "Job details updated" investigation)
-- ══════════════════════════════════════════════════════════════════════════
-- Still acting as INSP, who has an application on JOBP.
select lives_ok(
  $$ update public.jobs set description = 'inspector tried to rewrite scope'
      where id = 'd5555555-5555-5555-5555-555555555555' $$,
  'APPLICANT: an UPDATE statement is accepted syntactically (RLS filters rows, it does not raise)');

reset role;
select is(
  (select description from public.jobs where id = :'JOBP'),
  'ORIGINAL CLIENT SCOPE',
  'APPLICANT: ...but ZERO rows changed — a marketplace applicant cannot mutate client-owned job scope');

-- ══════════════════════════════════════════════════════════════════════════
--  AUDIT — actor resolution + truthful counter labelling
-- ══════════════════════════════════════════════════════════════════════════
insert into public.audit_events (event_type, severity, actor_id, subject_table, subject_id, job_id, summary)
values ('job.policy.updated','info', :'ADM', 'jobs', :'JOBP', :'JOBP', 'Project policy updated');

select isnt(
  (select actor_role from public.audit_events
    where job_id = :'JOBP' and event_type = 'job.policy.updated' order by created_at desc limit 1),
  null,
  'AUDIT: a direct RPC-style insert now gets actor_role back-filled (was NULL → "Unknown")');

select is(
  (select actor_label from public.audit_events
    where job_id = :'JOBP' and event_type = 'job.policy.updated' order by created_at desc limit 1),
  'Platform Admin',
  'AUDIT: actor_label is back-filled from the actor profile');

-- The buyer must see the platform pseudonym, never the admin's personal name.
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select actor_label from public.audit_events_public
    where job_id = :'JOBP' and event_type = 'job.policy.updated' order by created_at desc limit 1),
  'NEXPEC',
  'AUDIT: the buyer sees NEXPEC — resolved, anonymised, and not "Unknown"');

select is(
  (select actor_role from public.audit_events_public
    where job_id = :'JOBP' and event_type = 'job.policy.updated' order by created_at desc limit 1),
  'platform',
  'AUDIT: the admin actor is published as the platform role');

select is(
  public.audit_public_summary('Job fields updated: applications_count', true),
  'Application received',
  'AUDIT: a counter-only bump is not reported to the buyer as a job edit');

select is(
  public.audit_public_summary('Job fields updated: description, location', true),
  'Job details updated',
  'AUDIT: a REAL client-owned field change still reports as Job details updated');

-- ══════════════════════════════════════════════════════════════════════════
--  DIRECT API ATTACK — migration 20260801324000
--
--  This is the section that decides whether identity_mode is REAL. Before
--  324000 every assertion below failed: profiles_read_related →
--  nx_can_read_profile granted a buyer the applicant's whole row the moment
--  an application existed, so `select full_name, email, phone from profiles`
--  defeated Protected regardless of what the UI chose to render.
--
--  Note the shape: RLS is ROW level, so a forbidden read returns NO ROW
--  rather than a masked value. is_empty is therefore the correct assertion —
--  and it is strictly stronger than "the column came back NULL".
-- ══════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode = 'protected' where id in (:'JOBP', :'JOBF');
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is_empty(
  $$ select full_name from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'ATTACK/PROTECTED: direct profiles SELECT cannot retrieve the real name');

select is_empty(
  $$ select email from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'ATTACK/PROTECTED: direct profiles SELECT cannot retrieve email');

select is_empty(
  $$ select phone from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'ATTACK/PROTECTED: direct profiles SELECT cannot retrieve phone');

select is_empty(
  $$ select resume_url, cv_url from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'ATTACK/PROTECTED: neither résumé column is reachable');

select is_empty(
  $$ select certifications from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'ATTACK/PROTECTED: certification identity data is not reachable');

-- PROFESSIONAL still grants NO raw row: name/résumé/certs are served only by
-- the masked projection, which is what keeps contact out of Professional.
reset role;
update public.jobs set identity_mode = 'professional' where id = :'JOBP';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is_empty(
  $$ select email, phone from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'ATTACK/PROFESSIONAL: contact is unreachable on the base table');

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPP'),
  'Dana Okafor',
  'ATTACK/PROFESSIONAL: the lawful projection still serves the professional name');

-- FULL is the one mode defined to release contact, so the row becomes visible.
reset role;
update public.jobs set identity_mode = 'full' where id = :'JOBP';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select isnt_empty(
  $$ select full_name, email, phone from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'ATTACK/FULL: the buyer may reach the profile row — Full is defined to release it');

-- ── REVOCATION: flipping back must not leave a standing unlock ───────────
reset role;
update public.jobs set identity_mode = 'protected' where id = :'JOBP';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is_empty(
  $$ select full_name from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'REVOCATION: dropping a job back to Protected immediately re-hides the row');

-- ── CROSS-JOB: Professional on one job unlocks nothing anywhere ──────────
reset role;
update public.jobs set identity_mode = 'professional' where id = :'JOBF';   -- control job only
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is_empty(
  $$ select full_name from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'CROSS-JOB: Professional on job B grants no raw profile access at all');

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'CROSS-JOB: job A stays Protected in the projection while job B is Professional');

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPF'),
  'Dana Okafor',
  'CROSS-JOB: job B discloses on its own terms, independently');

-- ── SELF + ADMIN must be untouched ───────────────────────────────────────
set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select isnt_empty(
  $$ select full_name, email, phone from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'SELF: the inspector can still read their own profile');

set local request.jwt.claims to '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select isnt_empty(
  $$ select full_name, email, phone from public.profiles
      where id = 'd2222222-2222-2222-2222-222222222222' $$,
  'ADMIN: platform admin retains full profile access');

-- ── SELLER → BUYER must be untouched (inspector must see who hired them) ──
set local request.jwt.claims to '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select isnt_empty(
  $$ select full_name from public.profiles
      where id = 'd1111111-1111-1111-1111-111111111111' $$,
  'SELLER→BUYER: the applicant can still read the job poster''s profile');

-- ── FINANCIAL ISOLATION survives the identity change ─────────────────────
select throws_ok(
  $$ select client_price_cents from public.jobs where id = 'd5555555-5555-5555-5555-555555555555' $$,
  '42501',
  null,
  'GR2: the inspector still cannot read buyer pricing after the lockdown');

set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select inspector_payout_cents from public.jobs where id = 'd5555555-5555-5555-5555-555555555555' $$,
  '42501',
  null,
  'GR2: the buyer still cannot read inspector payout after the lockdown');

-- ══════════════════════════════════════════════════════════════════════════
--  7. FULL-MODE CONTACT: release, revoke, and job isolation
--
--  Runtime QA found Full looking identical to Professional. The DB was right
--  all along — the client screen simply had no Contact block — but nothing
--  here proved contact SURVIVES a downgrade or stays confined to its own job,
--  so those two gaps are closed now.
-- ══════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode = 'full'      where id = :'JOBP';
update public.jobs set identity_mode = 'protected' where id = :'JOBF';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select inspector_email from public.job_applicant_identity_view where application_id = :'APPP'),
  'in.idy@test.nx',
  'FULL CONTACT: email is released on the full-mode job (final owner policy, 20260801566000)');

select is(
  (select inspector_phone from public.job_applicant_identity_view where application_id = :'APPP'),
  '+1-555-0134',
  'FULL CONTACT: phone is released on the full-mode job (final owner policy, 20260801566000)');

-- ★ JOB ISOLATION: the SAME inspector on a protected job must stay silent
--   while job A is fully disclosed. Contact is now withheld everywhere, so
--   the scoping proof rides on the display name instead.
select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPF'),
  null,
  'FULL CONTACT: an unrelated PROTECTED job discloses no name for the same inspector');

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPP'),
  'Dana Okafor',
  'FULL CONTACT: …while the full-mode job does disclose the name, so the isolation check is not vacuous');

-- ★ DOWNGRADE Full -> Protected must revoke contact on the very next read.
reset role;
update public.jobs set identity_mode = 'protected' where id = :'JOBP';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select inspector_email from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'DOWNGRADE: Full -> Protected revokes email immediately');

select is(
  (select inspector_phone from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'DOWNGRADE: Full -> Protected revokes phone immediately');

-- And Professional must NOT re-open contact on the way back up.
reset role;
update public.jobs set identity_mode = 'professional' where id = :'JOBP';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select inspector_display_name from public.job_applicant_identity_view where application_id = :'APPP'),
  'Dana Okafor',
  'DOWNGRADE: Professional restores the NAME');

select is(
  (select inspector_email from public.job_applicant_identity_view where application_id = :'APPP'),
  null,
  'DOWNGRADE: ...but Professional still withholds contact');

select * from finish();
rollback;
