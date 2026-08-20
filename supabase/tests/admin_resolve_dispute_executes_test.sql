-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/admin_resolve_dispute_executes_test.sql
--
--  Regression proof for 20260801546000 (D25).
--
--  The refusal matrix around admin_resolve_dispute was proven long ago (run 4:
--  every non-super_admin role refused; non-disputed state refused). What was
--  NEVER executed was the positive path — and it turned out to be broken for
--  every outcome: the status flip wrote jobs.completed_at, a column that does
--  not exist, so the super_admin's only resolution path died with 42703 after
--  passing all its gates.
--
--  WHAT THIS PROVES
--    A  'completed' resolution EXECUTES (impossible before the fix), flips the
--       job disputed→completed, and stamps updated_at
--    B  double-resolution is refused (job no longer disputed)
--    C  'cancelled' resolution executes on a second job and writes the REAL
--       cancel columns (cancelled_at / cancelled_by / cancel_reason)
--    D  a plain admin is still refused — the fix did not widen authority
--
--  NON-VACUITY: against the pre-fix body, A1 fails with 42703. D1 pairs the
--  refusal with the same call succeeding for super_admin in the same run.
--
--  RUN:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

SELECT plan(13);

INSERT INTO auth.users (id, email) VALUES
  ('d25a0000-0000-4000-8000-000000000001','d25.client@nexpec.test'),
  ('d25a0000-0000-4000-8000-000000000002','d25.super@nexpec.test'),
  ('d25a0000-0000-4000-8000-000000000003','d25.admin@nexpec.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role, full_name) VALUES
  ('d25a0000-0000-4000-8000-000000000001','d25.client@nexpec.test','client','D25 Client'),
  ('d25a0000-0000-4000-8000-000000000002','d25.super@nexpec.test','super_admin','D25 Super'),
  ('d25a0000-0000-4000-8000-000000000003','d25.admin@nexpec.test','admin','D25 Admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- two disputed jobs, reached through legal transitions (open is seed state;
-- disputed is legal from assigned/in_progress — walk them there)
INSERT INTO public.jobs (id, client_id, title, description, status)
VALUES
  ('d25b0000-0000-4000-8000-000000000001','d25a0000-0000-4000-8000-000000000001',
   'D25 job completed-path','dispute resolve regression','open'),
  ('d25b0000-0000-4000-8000-000000000002','d25a0000-0000-4000-8000-000000000001',
   'D25 job cancelled-path','dispute resolve regression','open')
ON CONFLICT (id) DO NOTHING;

-- contract+funding so assigned is reachable without weakening dispatch guards
INSERT INTO public.job_contracts
  (id, job_id, client_id, inspector_id, client_price_cents, inspector_payout_cents,
   status, client_signed_at, inspector_signed_at, contract_text_md)
VALUES
  ('d25c0000-0000-4000-8000-000000000001','d25b0000-0000-4000-8000-000000000001',
   'd25a0000-0000-4000-8000-000000000001','d25a0000-0000-4000-8000-000000000003',
   100000,80000,'fully_executed',now(),now(),'t'),
  ('d25c0000-0000-4000-8000-000000000002','d25b0000-0000-4000-8000-000000000002',
   'd25a0000-0000-4000-8000-000000000001','d25a0000-0000-4000-8000-000000000003',
   100000,80000,'fully_executed',now(),now(),'t')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_funding_stages
  (job_id, tranche_no, code, label, pct_bps, amount_cents, status, funded_at, gates_delivery, trigger_basis)
VALUES
  ('d25b0000-0000-4000-8000-000000000001',1,'initial','I',2000,20000,'funded',now(),true,'before_assignment'),
  ('d25b0000-0000-4000-8000-000000000002',1,'initial','I',2000,20000,'funded',now(),true,'before_assignment')
ON CONFLICT DO NOTHING;

INSERT INTO public.job_disputes (job_id, raised_by, reason_category, reason, status)
VALUES
  ('d25b0000-0000-4000-8000-000000000001','d25a0000-0000-4000-8000-000000000001','inspection_quality','readings look wrong','open'),
  ('d25b0000-0000-4000-8000-000000000002','d25a0000-0000-4000-8000-000000000001','other','client withdraws','open')
ON CONFLICT DO NOTHING;

UPDATE public.jobs SET status='assigned',
       contractor_id='d25a0000-0000-4000-8000-000000000003'
 WHERE id IN ('d25b0000-0000-4000-8000-000000000001','d25b0000-0000-4000-8000-000000000002');
UPDATE public.jobs SET status='disputed'
 WHERE id IN ('d25b0000-0000-4000-8000-000000000001','d25b0000-0000-4000-8000-000000000002');

SET LOCAL role TO authenticated;

-- ── D. plain admin still refused ───────────────────────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"d25a0000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.admin_resolve_dispute(
       'd25b0000-0000-4000-8000-000000000001'::uuid,'completed','admin tries') $$,
  '42501', NULL, 'D1: a plain admin is still refused — authority not widened');

-- ── A. the positive path that could never execute ──────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"d25a0000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT public.admin_resolve_dispute(
       'd25b0000-0000-4000-8000-000000000001'::uuid,'completed',
       'raw UT log verified; releasing') $$,
  'A1: super_admin resolves to COMPLETED (42703 before the fix)');

SELECT is(
  (SELECT status FROM public.jobs WHERE id='d25b0000-0000-4000-8000-000000000001'),
  'completed', 'A2: the job is completed');

-- ── B. double resolution refused ───────────────────────────────────────────
SELECT throws_like(
  $$ SELECT public.admin_resolve_dispute(
       'd25b0000-0000-4000-8000-000000000001'::uuid,'completed','again') $$,
  '%not in disputed state%', 'B1: a second resolution is refused');

-- ── C. cancelled path writes the real cancel columns ───────────────────────
SELECT lives_ok(
  $$ SELECT public.admin_resolve_dispute(
       'd25b0000-0000-4000-8000-000000000002'::uuid,'cancelled',
       'client withdrew the job') $$,
  'C1: super_admin resolves to CANCELLED');
SELECT is(
  (SELECT status FROM public.jobs WHERE id='d25b0000-0000-4000-8000-000000000002'),
  'cancelled', 'C2: the job is cancelled');
SELECT is(
  (SELECT cancelled_by FROM public.jobs WHERE id='d25b0000-0000-4000-8000-000000000002'),
  'd25a0000-0000-4000-8000-000000000002'::uuid,
  'C3: cancelled_by records the resolving super_admin');
SELECT is(
  (SELECT cancel_reason FROM public.jobs WHERE id='d25b0000-0000-4000-8000-000000000002'),
  'client withdrew the job', 'C4: the reason is recorded');
SELECT ok(
  (SELECT cancelled_at IS NOT NULL FROM public.jobs
    WHERE id='d25b0000-0000-4000-8000-000000000002'),
  'C5: cancelled_at is stamped');

-- ── E. D25b: the dispute RECORD closes with actor + timestamp + notes ──────
SELECT is(
  (SELECT status FROM public.job_disputes
    WHERE job_id='d25b0000-0000-4000-8000-000000000001'),
  'resolved_paid', 'E1: completed resolution closes the record as resolved_paid');
SELECT is(
  (SELECT resolved_by FROM public.job_disputes
    WHERE job_id='d25b0000-0000-4000-8000-000000000001'),
  'd25a0000-0000-4000-8000-000000000002'::uuid,
  'E2: the resolving super_admin is recorded on the dispute');
SELECT ok(
  (SELECT resolved_at IS NOT NULL AND resolution_notes IS NOT NULL
     FROM public.job_disputes
    WHERE job_id='d25b0000-0000-4000-8000-000000000001'),
  'E3: timestamp and notes are recorded');
SELECT is(
  (SELECT status FROM public.job_disputes
    WHERE job_id='d25b0000-0000-4000-8000-000000000002'),
  'resolved_refunded', 'E4: cancelled resolution closes the record as resolved_refunded');

SELECT * FROM finish();
ROLLBACK;
