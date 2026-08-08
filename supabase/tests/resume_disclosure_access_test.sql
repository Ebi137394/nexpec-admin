-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/resume_disclosure_access_test.sql
--  pgTAP for migration 20260801326000 — job-scoped applicant résumé access.
--  Run: supabase test db
--
--  nx_can_access_doc() IS the authorization decision that mint-doc-url makes
--  before it signs anything, so calling it directly tests the real gate rather
--  than a proxy. It is service_role-only by grant; the suite runs as the seed
--  superuser and passes the caller explicitly as p_uid, which is exactly how
--  the edge function invokes it.
--
--  Fixture: ONE inspector with ONE résumé, on THREE jobs owned by TWO buyers.
--     JOB_PRO  (buyer B1) professional, forwarded    → must ALLOW
--     JOB_PROT (buyer B1) protected,    forwarded    → must DENY
--     JOB_NF   (buyer B1) professional, NOT forwarded→ must DENY
--     JOB_OTHR (buyer B2) protected,    forwarded    → must DENY for B2
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
select plan(23);

-- Comments never share a line with \set: psql concatenates the whole tail.
\set B1    'c1111111-1111-1111-1111-111111111111'
\set B2    'c2222222-2222-2222-2222-222222222222'
\set INSP  'c3333333-3333-3333-3333-333333333333'
\set ADM   'c4444444-4444-4444-4444-444444444444'
\set OTHR  'c5555555-5555-5555-5555-555555555555'
\set JOBPRO  'c6666666-6666-6666-6666-666666666666'
\set JOBPROT 'c7777777-7777-7777-7777-777777777777'
\set JOBNF   'c8888888-8888-8888-8888-888888888888'
\set JOBOTHR 'c9999999-9999-9999-9999-999999999999'

-- The résumé object path follows the documented convention {userId}/resume-*.
\set RESPATH 'c3333333-3333-3333-3333-333333333333/resume-1723000000.pdf'
\set VICTIM  'cafe0000-0000-4000-8000-00000000beef/resume-secret.pdf'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'B1',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','b1.res@test.nx',now(),now()),
  (:'B2',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','b2.res@test.nx',now(),now()),
  (:'INSP','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in.res@test.nx',now(),now()),
  (:'ADM', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.res@test.nx',now(),now()),
  (:'OTHR','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ot.res@test.nx',now(),now());

insert into public.profiles (id, email, role, full_name, resume_url, cv_url, phone, specialty_slugs) values
  (:'B1',  'b1.res@test.nx','client',   'Buyer One',  null, null, null, '{}'::text[]),
  (:'B2',  'b2.res@test.nx','client',   'Buyer Two',  null, null, null, '{}'::text[]),
  (:'INSP','in.res@test.nx','inspector','Dana Okafor',
     'https://x.supabase.co/storage/v1/object/sign/resumes/' || :'RESPATH', null, '+1-555-0134', '{}'::text[]),
  (:'ADM', 'ad.res@test.nx','admin',    'Platform Admin', null, null, null, '{}'::text[]),
  (:'OTHR','ot.res@test.nx','client',   'Unrelated Buyer', null, null, null, '{}'::text[]);

insert into public.jobs (id, title, client_id, status, moderation_status, identity_mode) values
  (:'JOBPRO', 'professional forwarded', :'B1','open','approved','professional'),
  (:'JOBPROT','protected forwarded',    :'B1','open','approved','protected'),
  (:'JOBNF',  'professional unforwarded',:'B1','open','approved','professional'),
  (:'JOBOTHR','other buyer protected',  :'B2','open','approved','protected');

insert into public.applications (job_id, applicant_id, status, forwarded_to_client_at) values
  (:'JOBPRO',  :'INSP','pending', now()),
  (:'JOBPROT', :'INSP','pending', now()),
  (:'JOBNF',   :'INSP','pending', null),
  (:'JOBOTHR', :'INSP','pending', now());

-- Real storage rows so the owner branch and the object-ownership proof are exercised.
insert into storage.buckets (id, name, public)
  values ('resumes','resumes',false)
  on conflict (id) do update set public = false;
insert into storage.objects (bucket_id, name, owner)
  values ('resumes', :'RESPATH', :'INSP')
  on conflict do nothing;

-- ══════════════════════════════════════════════════════════════════════════
--  1. The core allow, and PROTECTED denial
-- ══════════════════════════════════════════════════════════════════════════
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  true,
  'PROFESSIONAL: the buyer of the professional, forwarded job CAN mint the résumé');

-- Flip the professional job to protected. B1 still holds JOBPROT (protected +
-- forwarded), so this simultaneously proves that a forwarded application under
-- Protected grants nothing.
update public.jobs set identity_mode = 'protected' where id = :'JOBPRO';
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  false,
  'PROTECTED: forwarded application + protected policy CANNOT mint the résumé');

-- The second résumé column must be gated identically — cv_url was an open back
-- door in the original disclosure view and must not become one here.
update public.profiles
   set resume_url = null,
       cv_url = 'https://x.supabase.co/storage/v1/object/sign/resumes/' || :'RESPATH'
 where id = :'INSP';
update public.jobs set identity_mode = 'professional' where id = :'JOBPRO';
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  true,
  'CV_URL: a résumé stored in cv_url is released on the same terms as resume_url');

update public.jobs set identity_mode = 'protected' where id = :'JOBPRO';
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  false,
  'CV_URL: and is withheld under Protected, exactly like resume_url');

-- restore the canonical fixture (résumé in resume_url)
update public.profiles
   set resume_url = 'https://x.supabase.co/storage/v1/object/sign/resumes/' || :'RESPATH',
       cv_url = null
 where id = :'INSP';

-- ══════════════════════════════════════════════════════════════════════════
--  2. PROFESSIONAL grants — and only via the forwarded application
-- ══════════════════════════════════════════════════════════════════════════
update public.jobs set identity_mode = 'professional' where id = :'JOBPRO';
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  true,
  'PROFESSIONAL: access is restored the moment the job policy is professional');

-- Un-forward every application for this buyer: professional must not be enough.
update public.applications set forwarded_to_client_at = null
 where applicant_id = :'INSP' and job_id in (:'JOBPRO', :'JOBPROT', :'JOBNF');
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  false,
  'FORWARD GATE: professional + UNFORWARDED application does NOT grant access');

update public.applications set forwarded_to_client_at = now()
 where applicant_id = :'INSP' and job_id = :'JOBPRO';
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  true,
  'FORWARD GATE: forwarding the professional application restores access');

-- ══════════════════════════════════════════════════════════════════════════
--  3. CROSS-JOB / CROSS-TENANT isolation
-- ══════════════════════════════════════════════════════════════════════════
select is(
  public.nx_can_access_doc(:'B2', 'resumes', :'RESPATH'),
  false,
  'CROSS-JOB: B2 holds only a PROTECTED job with the same inspector — denied while B1 is professional');

select is(
  public.nx_can_access_doc(:'OTHR', 'resumes', :'RESPATH'),
  false,
  'CROSS-TENANT: a buyer with no job involving this inspector is denied');

-- B2 going professional must grant B2 — and must not have depended on B1.
update public.jobs set identity_mode = 'professional' where id = :'JOBOTHR';
select is(
  public.nx_can_access_doc(:'B2', 'resumes', :'RESPATH'),
  true,
  'JOB SCOPING: each buyer''s access follows their OWN job policy, independently');
update public.jobs set identity_mode = 'protected' where id = :'JOBOTHR';
select is(
  public.nx_can_access_doc(:'B2', 'resumes', :'RESPATH'),
  false,
  'REVOCATION: B2 loses access again immediately, while B1 keeps it');
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  true,
  'JOB SCOPING: B2''s revocation did not disturb B1''s lawful access');

-- ══════════════════════════════════════════════════════════════════════════
--  4. NO PATH / BUCKET BYPASS
-- ══════════════════════════════════════════════════════════════════════════
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'VICTIM'),
  false,
  'BYPASS: the buyer cannot mint an unrelated third party''s résumé path');

select is(
  public.nx_can_access_doc(:'B1', 'inspector-docs', :'RESPATH'),
  false,
  'BYPASS: the branch is pinned to the resumes bucket — no other PII bucket opens');

select is(
  public.nx_can_access_doc(:'B1', 'certifications', :'RESPATH'),
  false,
  'BYPASS: certifications bucket stays closed to the buyer');

select is(
  public.nx_can_access_doc(:'B1', 'resumes', ''),
  false,
  'BYPASS: an empty path cannot wildcard-match a résumé pointer');

-- ══════════════════════════════════════════════════════════════════════════
--  5. FULL, SELF, ADMIN
-- ══════════════════════════════════════════════════════════════════════════
update public.jobs set identity_mode = 'full' where id = :'JOBPRO';
select is(
  public.nx_can_access_doc(:'B1', 'resumes', :'RESPATH'),
  true,
  'FULL: existing full-mode disclosure keeps résumé access');

select is(
  public.nx_can_access_doc(:'INSP', 'resumes', :'RESPATH'),
  true,
  'SELF: the inspector still reaches their own résumé (storage-owner branch)');

select is(
  public.nx_can_access_doc(:'ADM', 'resumes', :'RESPATH'),
  true,
  'ADMIN: platform admin access is preserved');

-- ══════════════════════════════════════════════════════════════════════════
--  6. DISPUTE BRANCH — regression guard for the 252000 heal
--
--  20260801252000 rewired the dispute-reports branch from public.projects
--  (org/budget table, no client_id/inspector_id) to public.work_orders, which
--  is what disputes.project_id actually references. 326000/328000 rebuilt the
--  function and must not resurrect the old wiring. plpgsql only PLANS a branch
--  when control reaches it, so the first assertion forces a full fall-through;
--  a stale column reference throws 42703 instead of returning false.
-- ══════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ select public.nx_can_access_doc(
       'c5555555-5555-5555-5555-555555555555'::uuid,
       'dispute-reports', 'no-such-dispute/report.pdf') $$,
  'DISPUTE BRANCH: a full fall-through PLANS every branch without throwing');

select is(
  public.nx_can_access_doc(:'OTHR', 'dispute-reports', 'no-such-dispute/report.pdf'),
  false,
  'DISPUTE BRANCH: an unrelated caller is denied a dispute report');

-- prosrc contains COMMENTS as well as SQL, so match a real FROM/JOIN clause
-- rather than the bare table name; otherwise a comment mentioning the old
-- wiring fails the test (it did).
select is(
  (select prosrc ~* '(FROM|JOIN)[[:space:]]+public\.projects\M'
     from pg_proc where oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure),
  false,
  'DISPUTE BRANCH: no real FROM/JOIN public.projects clause exists');

select is(
  (select prosrc ~* 'JOIN[[:space:]]+public\.work_orders\M'
     from pg_proc where oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure),
  true,
  'DISPUTE BRANCH: a real JOIN public.work_orders clause is present (252000 heal)');

select * from finish();
rollback;
