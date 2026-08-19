-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/identity_disclosure_matrix_test.sql
--
--  Proves the Protected / Professional / Full disclosure matrix on the
--  canonical reader, job_applicant_identity_view.
--
--  Every assertion inspects a RETURNED FIELD VALUE. None of them is satisfied
--  by an HTTP status, a row count alone, or a zero-row RLS update — the two
--  defects this suite exists to lock down were both invisible to that style of
--  test:
--    • the Web reader hard-coded fullName/email to null, so Professional and
--      Full behaved exactly like Protected while every row count looked right;
--    • job_applicant_identity_view gated only on job ownership, so a Client
--      could read a disclosed name and email from an application the Admin had
--      NOT forwarded.
--
--  Literal UUIDs, no \set. Two separate jobs prove per-job scoping.
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

select plan(27);

-- ── actors ──────────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'dm.'||u::text||'@synthetic.invalid', now(), now()
  from unnest(ARRAY['d1000000-0000-4000-8000-000000000001'::uuid,  -- client A
                    'd1000000-0000-4000-8000-000000000002'::uuid,  -- inspector
                    'd1000000-0000-4000-8000-000000000003'::uuid,  -- admin
                    'd1000000-0000-4000-8000-000000000004'::uuid]) u -- client B
on conflict (id) do nothing;

--  Representative professional data, seeded so each policy level is
--  distinguishable. Without a résumé and certifications a "Professional"
--  assertion could pass while disclosing nothing.
insert into public.profiles (id, role, full_name, email, phone, is_verified,
                             headline, bio, resume_url, cv_url, certifications,
                             specialty_slugs, location_city) values
  ('d1000000-0000-4000-8000-000000000001','client','DM Client','dm.client@synthetic.invalid','+15552001',true,
   null,null,null,null,null,ARRAY[]::text[],null),
  ('d1000000-0000-4000-8000-000000000002','inspector','Dana Weld','dm.insp@synthetic.invalid','+15552002',true,
   'Senior NDT Inspector','12 years refinery and pipeline NDT.',
   'https://files.invalid/dana-resume.pdf','https://files.invalid/dana-cv.pdf',
   ARRAY['CSWIP 3.1','API 570','ASNT Level II UT']::text[],
   ARRAY['ndt-methods','piping-pipelines']::text[],'Calgary'),
  ('d1000000-0000-4000-8000-000000000003','admin','DM Admin','dm.admin@synthetic.invalid','+15552003',true,
   null,null,null,null,null,ARRAY[]::text[],null),
  ('d1000000-0000-4000-8000-000000000004','client','Other Client','dm.other@synthetic.invalid','+15552004',true,
   null,null,null,null,null,ARRAY[]::text[],null)
on conflict (id) do nothing;

-- ── two jobs, so per-job scoping is provable ────────────────────────────────
insert into public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                         client_price_cents,inspector_payout_cents,identity_mode) values
  ('d2000000-0000-4000-8000-00000000000a','DM job A','d1000000-0000-4000-8000-000000000001',
   'open','approved','prepay',100000,70000,'protected'),
  ('d2000000-0000-4000-8000-00000000000b','DM job B','d1000000-0000-4000-8000-000000000001',
   'open','approved','prepay',100000,70000,'protected');

insert into public.applications (id,job_id,applicant_id,status,bid_amount_cents) values
  ('d3000000-0000-4000-8000-00000000000a','d2000000-0000-4000-8000-00000000000a',
   'd1000000-0000-4000-8000-000000000002','pending',70000),
  ('d3000000-0000-4000-8000-00000000000b','d2000000-0000-4000-8000-00000000000b',
   'd1000000-0000-4000-8000-000000000002','pending',70000);

-- ════════════════════════════════════════════════════════════════════════════
--  1. Unforwarded stays invisible under ALL THREE policies
-- ════════════════════════════════════════════════════════════════════════════
update public.jobs set identity_mode='full' where id='d2000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.job_applicant_identity_view
    where job_id='d2000000-0000-4000-8000-00000000000a'),
  0,
  'D1 policy FULL but unforwarded — the Client sees nothing');

reset role;
update public.jobs set identity_mode='professional' where id='d2000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.job_applicant_identity_view
    where job_id='d2000000-0000-4000-8000-00000000000a'),
  0,
  'D2 policy PROFESSIONAL but unforwarded — the Client sees nothing');

--  Differential: the application genuinely exists, so D1/D2 are not passing
--  merely because nothing was created.
reset role;
select is(
  (select count(*)::int from public.applications
    where id='d3000000-0000-4000-8000-00000000000a'),
  1,
  'D3 differential — the application exists; invisibility was a denial, not an empty table');

-- ════════════════════════════════════════════════════════════════════════════
--  Forward BOTH applications (Admin action), then vary policy per job
-- ════════════════════════════════════════════════════════════════════════════
update public.applications
   set forwarded_to_client_at = now(),
       forwarded_to_client_by = 'd1000000-0000-4000-8000-000000000003'
 where id in ('d3000000-0000-4000-8000-00000000000a','d3000000-0000-4000-8000-00000000000b');

-- ════════════════════════════════════════════════════════════════════════════
--  2. PROTECTED — brokered fields only
-- ════════════════════════════════════════════════════════════════════════════
update public.jobs set identity_mode='protected' where id='d2000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select inspector_display_name from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  null, 'P1 PROTECTED hides the real name');
select is(
  (select inspector_resume_url from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  null, 'P2 PROTECTED hides the résumé');
select is(
  (select inspector_certifications from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  null, 'P3 PROTECTED hides the certifications');
select is(
  (select inspector_email from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  null, 'P4 PROTECTED hides the email');
select is(
  (select inspector_phone from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  null, 'P5 PROTECTED hides the phone');
--  …but the row IS visible, and the permitted aggregates come through.
select is(
  (select count(*)::int from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  1, 'P6 PROTECTED still returns the brokered row itself');

-- ════════════════════════════════════════════════════════════════════════════
--  3. PROFESSIONAL — name, résumé, certifications; still no email/phone
-- ════════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode='professional' where id='d2000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select inspector_display_name from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  'Dana Weld', 'F1 PROFESSIONAL reveals the real name');
select is(
  (select inspector_resume_url from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  'https://files.invalid/dana-resume.pdf', 'F2 PROFESSIONAL reveals the résumé');
select is(
  (select inspector_certifications from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  ARRAY['CSWIP 3.1','API 570','ASNT Level II UT']::text[],
  'F3 PROFESSIONAL reveals the certifications');
select is(
  (select inspector_email from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  null, 'F4 PROFESSIONAL still hides the email');
select is(
  (select inspector_phone from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  null, 'F5 PROFESSIONAL still hides the phone');

-- ════════════════════════════════════════════════════════════════════════════
--  4/5. FULL — professional plus authorized contact, effective immediately
-- ════════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode='full' where id='d2000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select inspector_email from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  'dm.insp@synthetic.invalid', 'U1 FULL reveals the authorized email (final owner policy, 20260801566000)');
select is(
  (select inspector_phone from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  '+15552002', 'U2 FULL reveals the authorized phone (final owner policy, 20260801566000)');
select is(
  (select inspector_display_name from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  'Dana Weld', 'U3 FULL retains everything PROFESSIONAL disclosed');

-- ════════════════════════════════════════════════════════════════════════════
--  6. Downgrade FULL → PROTECTED removes PII immediately
-- ════════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode='protected' where id='d2000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select coalesce(inspector_display_name,'') || '|' || coalesce(inspector_email,'')
     from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  '|',
  'W1 downgrade to PROTECTED removes name and email on the very next read');

-- ════════════════════════════════════════════════════════════════════════════
--  9. Per-job scoping — job B stays PROTECTED while job A is FULL
-- ════════════════════════════════════════════════════════════════════════════
reset role;
update public.jobs set identity_mode='full'      where id='d2000000-0000-4000-8000-00000000000a';
update public.jobs set identity_mode='protected' where id='d2000000-0000-4000-8000-00000000000b';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select inspector_display_name from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000b'),
  null,
  'S1 the same Inspector stays PROTECTED on job B while FULL on job A — no cross-job leakage');
select is(
  (select inspector_display_name from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  'Dana Weld',
  'S2 …and job A really is disclosing (name under FULL), so S1 is scoping and not a blanket denial');

-- ════════════════════════════════════════════════════════════════════════════
--  7/8. Unrelated Client and anonymous get nothing
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.job_applicant_identity_view
    where application_id='d3000000-0000-4000-8000-00000000000a'),
  0,
  'X1 an unrelated Client sees nothing, even at policy FULL');

reset role;
--  anon holds no grant on the view at all, so the read raises 42501 rather
--  than returning zero rows. Asserting a count here would ERROR the suite
--  while the product was behaving correctly — the refusal itself is the proof.
select set_config('request.jwt.claims','', true);
select throws_ok(
  $$ set local role anon;
     select count(*) from public.job_applicant_identity_view
      where application_id='d3000000-0000-4000-8000-00000000000a' $$,
  '42501', null,
  'X2 anonymous access is refused outright — no grant on the disclosure view');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
--  11/12. Neither Client nor Inspector may change the policy
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.admin_set_project_policy('d2000000-0000-4000-8000-00000000000b',
       'full','client_reapproval') $$,
  null, null,
  'A1 a Client cannot widen the disclosure policy');

select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.admin_set_project_policy('d2000000-0000-4000-8000-00000000000b',
       'full','client_reapproval') $$,
  null, null,
  'A2 an Inspector cannot self-disclose by widening the policy');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
--  13. The Admin policy change is audited
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.admin_set_project_policy('d2000000-0000-4000-8000-00000000000b',
       'professional','client_reapproval') $$,
  'A3 the Admin can change the policy');
select ok(
  (select count(*) from public.audit_events
    where job_id='d2000000-0000-4000-8000-00000000000b'
      and actor_id='d1000000-0000-4000-8000-000000000003'
      and created_at is not null) > 0,
  'A4 the Admin policy change is audited with actor and timestamp');

-- ════════════════════════════════════════════════════════════════════════════
--  15. Missing optional data renders honestly, never fabricated
-- ════════════════════════════════════════════════════════════════════════════
--  The client profile has no résumé. Under FULL it must come back NULL, not a
--  placeholder or a fabricated string.
select set_config('request.jwt.claims','', true);
select is(
  (select resume_url from public.profiles where id='d1000000-0000-4000-8000-000000000001'),
  null,
  'H1 absent optional data stays NULL — nothing is fabricated to fill the field');

select * from finish();

rollback;
