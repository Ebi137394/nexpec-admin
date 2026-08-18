-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/apply_onboarding_role_guard_test.sql
--
--  Regression proof for 20260801554000 (D31), found by the iOS role matrix:
--
--  A  senior is PROTECTED: confirming a stance card no longer demotes the
--     account (old body: role flipped to the card's role — A1/A2 fail on it)
--  B  the refusal path still STAMPS the legal acceptance (old body returned
--     early → terms stayed NULL forever for protected roles — B1 fails on it)
--  C  a refusal never overwrites an EARLIER acceptance (COALESCE semantics)
--  D  the normal self-service lane is unchanged (client onboards as client)
--  E  admin / super_admin remain protected (pre-existing guard not narrowed)
--
--  RUN:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

SELECT plan(10);

INSERT INTO auth.users (id, email) VALUES
  ('d31a0000-0000-4000-8000-000000000001','d31.senior@nexpec.test'),
  ('d31a0000-0000-4000-8000-000000000002','d31.admin@nexpec.test'),
  ('d31a0000-0000-4000-8000-000000000003','d31.newclient@nexpec.test'),
  ('d31a0000-0000-4000-8000-000000000004','d31.super@nexpec.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role, full_name) VALUES
  ('d31a0000-0000-4000-8000-000000000001','d31.senior@nexpec.test','senior','D31 Senior'),
  ('d31a0000-0000-4000-8000-000000000002','d31.admin@nexpec.test','admin','D31 Admin'),
  ('d31a0000-0000-4000-8000-000000000004','d31.super@nexpec.test','super_admin','D31 Super')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, terms_accepted_at = NULL, terms_version = NULL;

SET LOCAL role TO authenticated;

-- ── A. senior survives a stance confirm ─────────────────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"d31a0000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT applied_role FROM public.apply_onboarding_role(
     'client', NULL, NULL, NULL, NULL, now(), 'v1-2026-07')),
  'senior',
  'A1: RPC returns the protected senior role, not the requested card');
SELECT is(
  (SELECT role FROM public.profiles
    WHERE id='d31a0000-0000-4000-8000-000000000001'),
  'senior', 'A2: profiles.role is still senior (was demoted before the fix)');

-- ── B. the refusal stamped the legal acceptance ─────────────────────────────
SELECT ok(
  (SELECT terms_accepted_at IS NOT NULL FROM public.profiles
    WHERE id='d31a0000-0000-4000-8000-000000000001'),
  'B1: refusal path recorded terms_accepted_at (stayed NULL before the fix)');
SELECT is(
  (SELECT terms_version FROM public.profiles
    WHERE id='d31a0000-0000-4000-8000-000000000001'),
  'v1-2026-07', 'B2: terms_version recorded');

-- ── C. a second confirm keeps the FIRST acceptance ──────────────────────────
SELECT is(
  (SELECT terms_version FROM (
     SELECT public.apply_onboarding_role(
       'inspector', NULL, NULL, NULL, NULL, now(), 'v9-9999-99')
   ) _, public.profiles p
    WHERE p.id='d31a0000-0000-4000-8000-000000000001'),
  'v1-2026-07',
  'C1: re-confirm does not overwrite the earlier acceptance');

-- ── D. normal self-service lane unchanged ───────────────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"d31a0000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT is(
  (SELECT applied_role FROM public.apply_onboarding_role(
     'client', 'D31 New', NULL, NULL, NULL, now(), 'v1-2026-07')),
  'client', 'D1: a brand-new account onboards as client');
SELECT is(
  (SELECT role FROM public.profiles
    WHERE id='d31a0000-0000-4000-8000-000000000003'),
  'client', 'D2: the new profile row landed with role client');

-- ── E. admin / super_admin still protected, and now get terms stamped ───────
SET LOCAL request.jwt.claims TO
  '{"sub":"d31a0000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT applied_role FROM public.apply_onboarding_role(
     'inspector', NULL, NULL, NULL, NULL, now(), 'v1-2026-07')),
  'admin', 'E1: admin keeps admin');
SELECT ok(
  (SELECT terms_accepted_at IS NOT NULL FROM public.profiles
    WHERE id='d31a0000-0000-4000-8000-000000000002'),
  'E2: the admin refusal stamped terms too');
SET LOCAL request.jwt.claims TO
  '{"sub":"d31a0000-0000-4000-8000-000000000004","role":"authenticated"}';
SELECT is(
  (SELECT applied_role FROM public.apply_onboarding_role(
     'agency', NULL, NULL, NULL, NULL, now(), 'v1-2026-07')),
  'super_admin', 'E3: super_admin keeps super_admin');

SELECT * FROM finish();
ROLLBACK;
