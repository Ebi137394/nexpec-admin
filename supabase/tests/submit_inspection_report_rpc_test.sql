-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/submit_inspection_report_rpc_test.sql
--
--  Regression proof for 20260801544000 (D24).
--
--  The old body could NEVER succeed: it ended with
--  `UPDATE jobs SET status='under_review'`, a state the job machine does not
--  have, so guard_jobs_status_transition raised and rolled everything back.
--  And it was SECURITY DEFINER with NO authorization check — the only thing
--  keeping "any authenticated user upserts a report onto any job" from being
--  exploitable was that accidental rollback. Fixing the status write without
--  adding authorization would have OPENED the hole; this suite pins both.
--
--  NON-VACUITY: against the old body, B1 (contractor submit succeeds) FAILS
--  with the canonical-state-machine error. Against a fix that forgot the
--  authorization branch, A1 (stranger refused) FAILS. Either regression flips
--  at least one test.
--
--  RUN:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

SELECT plan(9);

INSERT INTO auth.users (id, email) VALUES
  ('d24a0000-0000-4000-8000-000000000001','d24.client@nexpec.test'),
  ('d24a0000-0000-4000-8000-000000000002','d24.insp@nexpec.test'),
  ('d24a0000-0000-4000-8000-000000000003','d24.stranger@nexpec.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role, full_name) VALUES
  ('d24a0000-0000-4000-8000-000000000001','d24.client@nexpec.test','client','D24 Client'),
  ('d24a0000-0000-4000-8000-000000000002','d24.insp@nexpec.test','inspector','D24 Inspector'),
  ('d24a0000-0000-4000-8000-000000000003','d24.stranger@nexpec.test','inspector','D24 Stranger')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- dispatched job, built by satisfying the REAL guards (contract + funding)
INSERT INTO public.jobs (id, client_id, title, description, status, client_price_cents, inspector_payout_cents)
VALUES ('d24b0000-0000-4000-8000-000000000001','d24a0000-0000-4000-8000-000000000001',
        'D24 job','submit rpc regression','open',100000,80000)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_contracts
  (id, job_id, client_id, inspector_id, client_price_cents, inspector_payout_cents,
   status, client_signed_at, inspector_signed_at, contract_text_md)
VALUES ('d24c0000-0000-4000-8000-000000000001','d24b0000-0000-4000-8000-000000000001',
        'd24a0000-0000-4000-8000-000000000001','d24a0000-0000-4000-8000-000000000002',
        100000, 80000, 'fully_executed', now(), now(), 'terms')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_funding_stages
  (job_id, tranche_no, code, label, pct_bps, amount_cents, status, funded_at, gates_delivery, trigger_basis)
VALUES ('d24b0000-0000-4000-8000-000000000001',1,'initial','Initial',2000,20000,'funded',now(),true,'before_assignment')
ON CONFLICT DO NOTHING;
UPDATE public.jobs
   SET status='assigned', contractor_id='d24a0000-0000-4000-8000-000000000002',
       hired_inspector_id='d24a0000-0000-4000-8000-000000000002'
 WHERE id='d24b0000-0000-4000-8000-000000000001';

SET LOCAL role TO authenticated;

-- ── A. the security branch the old body never had ──────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"d24a0000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.submit_inspection_report(
       'd24b0000-0000-4000-8000-000000000001'::uuid, NULL, 'stranger notes') $$,
  '42501', NULL,
  'A1: a stranger (not the job contractor) is refused');

SELECT is(
  (SELECT count(*)::int FROM public.inspection_reports
    WHERE job_id='d24b0000-0000-4000-8000-000000000001'),
  0, 'A2: the refused attempt inserted nothing');

-- ── B. the contractor path that could never work before ────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"d24a0000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT public.submit_inspection_report(
       'd24b0000-0000-4000-8000-000000000001'::uuid, NULL, 'first findings') $$,
  'B1: the assigned contractor CAN submit (impossible under the old body)');

SELECT is(
  (SELECT status FROM public.inspection_reports
    WHERE job_id='d24b0000-0000-4000-8000-000000000001'
      AND inspector_id='d24a0000-0000-4000-8000-000000000002'),
  'pending', 'B2: the report lands as pending — web-path parity');

SELECT is(
  (SELECT status FROM public.jobs WHERE id='d24b0000-0000-4000-8000-000000000001'),
  'assigned', 'B3: jobs.status is NOT touched — no under_review write');

-- resubmission updates the same row
SELECT lives_ok(
  $$ SELECT public.submit_inspection_report(
       'd24b0000-0000-4000-8000-000000000001'::uuid, NULL, 'revised findings') $$,
  'B4: resubmitting while pending updates in place');
SELECT is(
  (SELECT count(*)::int FROM public.inspection_reports
    WHERE job_id='d24b0000-0000-4000-8000-000000000001'),
  1, 'B5: still exactly one report row (upsert, not duplicate)');
SELECT is(
  (SELECT notes FROM public.inspection_reports
    WHERE job_id='d24b0000-0000-4000-8000-000000000001'),
  'revised findings', 'B6: the resubmission actually replaced the notes');

-- ── C. a locked report cannot be silently replaced ─────────────────────────
SET LOCAL role TO postgres;
UPDATE public.inspection_reports
   SET status='returned_to_inspector'
 WHERE job_id='d24b0000-0000-4000-8000-000000000001';
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"d24a0000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_like(
  $$ SELECT public.submit_inspection_report(
       'd24b0000-0000-4000-8000-000000000001'::uuid, NULL, 'sneaky overwrite') $$,
  '%REPORT_LOCKED%',
  'C1: a report in review flow is not silently replaceable via this RPC');

SELECT * FROM finish();
ROLLBACK;
