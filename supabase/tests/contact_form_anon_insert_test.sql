-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/contact_form_anon_insert_test.sql
--  Regression for 20260801550000 (D28): the public contact form's anon INSERT.
--  Non-vacuous: with the grant revoked (the lockdown state) A1 fails with 42501.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;
SELECT plan(5);

SET LOCAL role TO anon;

SELECT lives_ok(
  $$ INSERT INTO public.contact_submissions (name,email,channel,message,user_agent,ip_address)
     VALUES ('QA Anon','anon@example.com','support','regression probe message body','qa-agent','127.0.0.1') $$,
  'A1: anonymous visitor CAN submit the contact form (full server-action column set)');

-- anon holds a legacy SELECT grant, but the admin-only RLS policy filters
-- every row: anon sees an EMPTY SET, never data. A5 proves the row exists for
-- postgres in this same run, so this zero is the policy firing, not absence.
SELECT is(
  (SELECT count(*)::int FROM public.contact_submissions),
  0, 'A2: anonymous visitor reads ZERO rows back (RLS-filtered, no leak)');

SELECT throws_ok(
  $$ INSERT INTO public.contact_submissions (name,email,channel,message,status)
     VALUES ('QA Anon','anon@example.com','support','regression probe message body','resolved') $$,
  '42501', NULL,
  'A3: anon cannot write non-public columns (status) — the grant is column-scoped');

SELECT throws_ok(
  $$ INSERT INTO public.contact_submissions (name,email,channel,message)
     VALUES ('QA','not-an-email','support','regression probe message body') $$,
  '23514', NULL,
  'A4: schema CHECKs still reject garbage (email format)');

SET LOCAL role TO postgres;
SELECT is(
  (SELECT count(*)::int FROM public.contact_submissions
    WHERE message='regression probe message body' AND email='anon@example.com'),
  1, 'A5: exactly the one valid submission landed');

SELECT * FROM finish();
ROLLBACK;
