-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/credit_release_class_test.sql
--
--  Durable coverage for the Credit Release class, mirroring the Staging lane
--  that proved Net-15/30/60 end-to-end (run 23). The behavioural lane was
--  evidence; THIS is the regression gate.
--
--  WHAT IT PROVES
--    A  role gates: client and inspector cannot grant credit (42501),
--       and the same grant SUCCEEDS for admin in the same run (non-vacuous)
--    B  term gates: Net-45 refused (INVALID_NET_TERM), empty reason refused
--    C  the grant flips ONLY the final tranche: gates_delivery=false,
--       net_term_days set, status STILL 'scheduled' (no fake funding),
--       and the initial tranche remains delivery-gating and untouched
--    D  delivery-unlock semantics: nx_funding_delivery_satisfied becomes true
--       with the final tranche UNFUNDED (that is the whole point of credit)
--    E  invoice: due_at = invoiced_at + exactly N days; re-issue idempotent
--    F  audit: scope='job' row with actor_role, reason and net_term_days
--    G  a job with no final tranche is refused (FUNDING_STAGE_NOT_FOUND)
--
--  RUN:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

SELECT plan(16);

-- ── fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('cbcb0000-0000-4000-8000-000000000001','cr.client@nexpec.test'),
  ('cbcb0000-0000-4000-8000-000000000002','cr.insp@nexpec.test'),
  ('cbcb0000-0000-4000-8000-000000000003','cr.admin@nexpec.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role, full_name) VALUES
  ('cbcb0000-0000-4000-8000-000000000001','cr.client@nexpec.test','client','CR Client'),
  ('cbcb0000-0000-4000-8000-000000000002','cr.insp@nexpec.test','inspector','CR Inspector'),
  ('cbcb0000-0000-4000-8000-000000000003','cr.admin@nexpec.test','admin','CR Admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.jobs (id, client_id, title, description, status, client_price_cents, inspector_payout_cents)
VALUES
  ('cbcb1111-0000-4000-8000-000000000001','cbcb0000-0000-4000-8000-000000000001',
   'CR class job','credit release regression','open',100000,80000),
  ('cbcb1111-0000-4000-8000-000000000002','cbcb0000-0000-4000-8000-000000000001',
   'CR no-final job','credit release regression','open',100000,80000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_funding_stages
  (job_id, tranche_no, code, label, pct_bps, amount_cents, status, funded_at, gates_delivery, trigger_basis)
VALUES
  ('cbcb1111-0000-4000-8000-000000000001',1,'initial','Initial',2000,20000,'funded',now(),true,'before_assignment'),
  ('cbcb1111-0000-4000-8000-000000000001',2,'final','Final',8000,80000,'scheduled',NULL,true,'after_report_review'),
  -- the second job deliberately has ONLY an initial tranche
  ('cbcb1111-0000-4000-8000-000000000002',1,'initial','Initial',2000,20000,'funded',now(),true,'before_assignment')
ON CONFLICT DO NOTHING;

SET LOCAL role TO authenticated;

-- ── A. role gates ──────────────────────────────────────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"cbcb0000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.nx_admin_release_job_on_credit(
       'cbcb1111-0000-4000-8000-000000000001'::uuid, 15, 'client self-grant') $$,
  '42501', NULL, 'A1: a CLIENT cannot grant credit');

SET LOCAL request.jwt.claims TO
  '{"sub":"cbcb0000-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.nx_admin_release_job_on_credit(
       'cbcb1111-0000-4000-8000-000000000001'::uuid, 15, 'inspector self-grant') $$,
  '42501', NULL, 'A2: an INSPECTOR cannot grant credit');

-- ── B. term + reason gates (as admin from here on) ─────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"cbcb0000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT throws_like(
  $$ SELECT public.nx_admin_release_job_on_credit(
       'cbcb1111-0000-4000-8000-000000000001'::uuid, 45, 'bad term') $$,
  '%INVALID_NET_TERM%', 'B1: Net-45 is refused');

SELECT throws_like(
  $$ SELECT public.nx_admin_release_job_on_credit(
       'cbcb1111-0000-4000-8000-000000000001'::uuid, 15, '   ') $$,
  '%REASON_REQUIRED%', 'B2: a blank reason is refused');

-- ── C. the grant, and what it may and may not touch ────────────────────────
SELECT lives_ok(
  $$ SELECT public.nx_admin_release_job_on_credit(
       'cbcb1111-0000-4000-8000-000000000001'::uuid, 15, 'regression grant Net-15') $$,
  'C1: the SAME grant succeeds for admin — the refusals above are real');

SELECT is(
  (SELECT gates_delivery FROM public.job_funding_stages
    WHERE job_id='cbcb1111-0000-4000-8000-000000000001' AND code='final'),
  false, 'C2: the final tranche stops gating delivery');

SELECT is(
  (SELECT net_term_days FROM public.job_funding_stages
    WHERE job_id='cbcb1111-0000-4000-8000-000000000001' AND code='final'),
  15, 'C3: the net term is recorded on the tranche');

SELECT is(
  (SELECT status FROM public.job_funding_stages
    WHERE job_id='cbcb1111-0000-4000-8000-000000000001' AND code='final'),
  'scheduled', 'C4: the final tranche is NOT marked funded — no fake funding');

SELECT is(
  (SELECT gates_delivery FROM public.job_funding_stages
    WHERE job_id='cbcb1111-0000-4000-8000-000000000001' AND code='initial'),
  true, 'C5: the INITIAL tranche is untouched — 20% is never releasable');

-- ── D. delivery-unlock semantics ───────────────────────────────────────────
SELECT is(
  (SELECT public.nx_funding_delivery_satisfied('cbcb1111-0000-4000-8000-000000000001'::uuid)),
  true, 'D1: delivery is satisfied with the final tranche UNFUNDED — credit works');

-- ── E. invoice due-date math + idempotency ─────────────────────────────────
SELECT lives_ok(
  $$ SELECT public.nx_funding_issue_delivery_invoice('cbcb1111-0000-4000-8000-000000000001'::uuid) $$,
  'E1: the delivery invoice issues');

SELECT is(
  (SELECT (invoice_due_at - invoiced_at) FROM public.job_funding_stages
    WHERE job_id='cbcb1111-0000-4000-8000-000000000001' AND code='final'),
  interval '15 days',
  'E2: due date is invoiced_at + exactly the net term');

-- capture, re-issue, compare — the second call must change nothing
CREATE TEMP TABLE _inv AS
  SELECT invoiced_at, invoice_due_at FROM public.job_funding_stages
   WHERE job_id='cbcb1111-0000-4000-8000-000000000001' AND code='final';
SELECT lives_ok(
  $$ SELECT public.nx_funding_issue_delivery_invoice('cbcb1111-0000-4000-8000-000000000001'::uuid) $$,
  'E3: re-issue does not error');
SELECT is(
  (SELECT count(*)::int FROM public.job_funding_stages s JOIN _inv i
      ON s.invoiced_at = i.invoiced_at AND s.invoice_due_at = i.invoice_due_at
    WHERE s.job_id='cbcb1111-0000-4000-8000-000000000001' AND s.code='final'),
  1, 'E4: re-issue left both timestamps exactly as they were — idempotent');

-- ── F. the audit row ───────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.funding_policy_audit
    WHERE scope='job' AND job_id='cbcb1111-0000-4000-8000-000000000001'
      AND actor_role='admin' AND net_term_days=15
      AND reason='regression grant Net-15'),
  1, 'F1: the grant wrote a job-scope audit row with actor role, term and reason');

-- ── G. no final tranche ────────────────────────────────────────────────────
SELECT throws_like(
  $$ SELECT public.nx_admin_release_job_on_credit(
       'cbcb1111-0000-4000-8000-000000000002'::uuid, 15, 'no final here') $$,
  '%FUNDING_STAGE_NOT_FOUND%', 'G1: a job without a final tranche is refused');

SELECT * FROM finish();
ROLLBACK;
