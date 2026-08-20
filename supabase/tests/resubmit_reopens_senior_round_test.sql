-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/resubmit_reopens_senior_round_test.sql
--
--  Covers TWO things that release qualification found:
--
--  D21 (this migration, 20260801538000) — nx_report_resubmit set the report back
--  to 'submitted' and then notified "the live reviewer" via
--      decision IS NULL AND superseded_at IS NULL
--  without ever opening a new round. The prior round was decided ('returned'),
--  so that matched nothing, nx_notify_lifecycle got a NULL recipient, and the
--  report was stranded: no open round, no notification, no Senior decision form.
--
--  THE TIMESTAMP BRANCH — an earlier stale-token replay was refused by
--  NOT_AWAITING_CORRECTION (the status guard), which SHADOWED the
--  p_expected_updated_at concurrency check. That is not proof of the timestamp
--  branch. Section C isolates it: the status is legitimately
--  'returned_to_inspector' when the stale token is replayed, so only the
--  timestamp comparison can reject it.
--
--  A zero-row UPDATE is explicitly NOT accepted as proof anywhere here — every
--  refusal is asserted by its ERROR, and the surviving row is read back.
--
--  RUN:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

SELECT plan(13);

-- ── fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('dddd0000-0000-4000-8000-000000000001','rs.client@nexpec.test'),
  ('dddd0000-0000-4000-8000-000000000002','rs.insp@nexpec.test'),
  ('dddd0000-0000-4000-8000-000000000003','rs.senior@nexpec.test'),
  ('dddd0000-0000-4000-8000-000000000004','rs.admin@nexpec.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role, full_name) VALUES
  ('dddd0000-0000-4000-8000-000000000001','rs.client@nexpec.test','client','RS Client'),
  ('dddd0000-0000-4000-8000-000000000002','rs.insp@nexpec.test','inspector','RS Inspector'),
  ('dddd0000-0000-4000-8000-000000000003','rs.senior@nexpec.test','senior','RS Senior'),
  ('dddd0000-0000-4000-8000-000000000004','rs.admin@nexpec.test','admin','RS Admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- The job must genuinely be dispatched for nx_report_resubmit to accept the
-- caller (it refuses NOT_ACTIVE_INSPECTOR otherwise). Two real guards protect
-- that transition and NEITHER is weakened here — the fixture satisfies them
-- properly instead:
--   nx_guard_dispatch_requires_contract -> a fully_executed job_contracts row
--   nx_guard_dispatch_requires_funding  -> a funded initial funding stage
INSERT INTO public.jobs (id, client_id, title, description, status,
                         client_price_cents, inspector_payout_cents)
VALUES ('eeee0000-0000-4000-8000-000000000001','dddd0000-0000-4000-8000-000000000001',
        'RS test job','resubmit round regression','open', 480000, 375000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_contracts
  (id, job_id, client_id, inspector_id, client_price_cents, inspector_payout_cents,
   status, client_signed_at, inspector_signed_at, contract_text_md)
VALUES ('aaaa1111-0000-4000-8000-000000000001','eeee0000-0000-4000-8000-000000000001',
        'dddd0000-0000-4000-8000-000000000001','dddd0000-0000-4000-8000-000000000002',
        480000, 375000, 'fully_executed', now(), now(), 'terms')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.job_funding_stages
  (job_id, tranche_no, code, label, pct_bps, amount_cents, status, funded_at,
   gates_delivery, trigger_basis)
VALUES ('eeee0000-0000-4000-8000-000000000001',1,'initial','Initial',2000,96000,'funded',now(),
        true,'before_assignment')
ON CONFLICT DO NOTHING;

UPDATE public.jobs
   SET status='assigned', contractor_id='dddd0000-0000-4000-8000-000000000002',
       hired_inspector_id='dddd0000-0000-4000-8000-000000000002'
 WHERE id='eeee0000-0000-4000-8000-000000000001';

INSERT INTO public.inspection_reports (id, job_id, inspector_id, notes, status)
VALUES ('ffff0000-0000-4000-8000-000000000001','eeee0000-0000-4000-8000-000000000001',
        'dddd0000-0000-4000-8000-000000000002','original findings','returned_to_inspector')
ON CONFLICT (id) DO NOTHING;

-- a CLOSED round 1, exactly like the real 'returned' state
INSERT INTO public.report_senior_reviews
  (inspection_report_id, job_id, round, reviewer_id, assigned_by,
   decision, decided_at, decided_by, comments)
VALUES ('ffff0000-0000-4000-8000-000000000001','eeee0000-0000-4000-8000-000000000001',
        1,'dddd0000-0000-4000-8000-000000000003','dddd0000-0000-4000-8000-000000000004',
        'returned', now(), 'dddd0000-0000-4000-8000-000000000003','please add the CML grid')
ON CONFLICT DO NOTHING;

-- ── A. precondition: exactly one round, and it is CLOSED ───────────────────
SELECT is(
  (SELECT count(*)::int FROM public.report_senior_reviews
    WHERE inspection_report_id='ffff0000-0000-4000-8000-000000000001'
      AND decision IS NULL AND superseded_at IS NULL),
  0, 'A1: before resubmit there is NO open round — the stranding precondition');

-- act as the inspector
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"dddd0000-0000-4000-8000-000000000002","role":"authenticated"}';

-- ── B. resubmit REOPENS a round (the D21 fix) ──────────────────────────────
SELECT lives_ok(
  $$ SELECT public.nx_report_resubmit(
       'eeee0000-0000-4000-8000-000000000001'::uuid,
       'ffff0000-0000-4000-8000-000000000001'::uuid,
       (SELECT updated_at FROM public.inspection_reports
         WHERE id='ffff0000-0000-4000-8000-000000000001'),
       'corrected: CML grid attached', 'addressed your comment') $$,
  'B1: a valid resubmit succeeds');

SELECT is(
  (SELECT count(*)::int FROM public.report_senior_reviews
    WHERE inspection_report_id='ffff0000-0000-4000-8000-000000000001'
      AND decision IS NULL AND superseded_at IS NULL),
  1, 'B2: resubmit OPENS exactly one new review round (was 0 — the defect)');

SELECT is(
  (SELECT max(round)::int FROM public.report_senior_reviews
    WHERE inspection_report_id='ffff0000-0000-4000-8000-000000000001'),
  2, 'B3: the new round is numbered 2');

SELECT is(
  (SELECT reviewer_id FROM public.report_senior_reviews
    WHERE inspection_report_id='ffff0000-0000-4000-8000-000000000001' AND round=2),
  'dddd0000-0000-4000-8000-000000000003'::uuid,
  'B4: it goes back to the SAME reviewer who returned it');

SELECT is(
  (SELECT status FROM public.inspection_reports
    WHERE id='ffff0000-0000-4000-8000-000000000001'),
  'submitted', 'B5: the report is back in submitted state');

SELECT is(
  (SELECT decision FROM public.report_senior_reviews
    WHERE inspection_report_id='ffff0000-0000-4000-8000-000000000001' AND round=1),
  'returned', 'B6: round 1 is untouched — decided rows stay immutable');

-- ── C. THE TIMESTAMP BRANCH, ISOLATED ──────────────────────────────────────
-- Return the report again so the STATUS guard is satisfied. Only then can a
-- stale p_expected_updated_at be the reason for a refusal.
SET LOCAL role TO postgres;
UPDATE public.report_senior_reviews
   SET decision='returned', decided_at=now(),
       decided_by='dddd0000-0000-4000-8000-000000000003',
       comments='second return'
 WHERE inspection_report_id='ffff0000-0000-4000-8000-000000000001' AND round=2;
UPDATE public.inspection_reports
   SET status='returned_to_inspector'
 WHERE id='ffff0000-0000-4000-8000-000000000001';

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"dddd0000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT status FROM public.inspection_reports
    WHERE id='ffff0000-0000-4000-8000-000000000001'),
  'returned_to_inspector',
  'C1: status guard is SATISFIED, so any refusal below is the timestamp branch');

-- a deliberately stale token: one hour before the real updated_at
SELECT throws_like(
  $$ SELECT public.nx_report_resubmit(
       'eeee0000-0000-4000-8000-000000000001'::uuid,
       'ffff0000-0000-4000-8000-000000000001'::uuid,
       (SELECT updated_at - interval '1 hour' FROM public.inspection_reports
         WHERE id='ffff0000-0000-4000-8000-000000000001'),
       'STALE REPLAY — must be refused', 'stale') $$,
  '%REPORT_CHANGED%',
  'C2: a STALE token is refused by the concurrency branch, not the status guard');

-- the refusal must not be a silent no-op: prove nothing changed
SELECT is(
  (SELECT status FROM public.inspection_reports
    WHERE id='ffff0000-0000-4000-8000-000000000001'),
  'returned_to_inspector', 'C3: status unchanged after the stale attempt');

-- plain ok() rather than unlike(): pgTAP's unlike overloads did not resolve for
-- (text, text, text) here, and the point is the assertion, not the helper.
SELECT ok(
  (SELECT notes FROM public.inspection_reports
    WHERE id='ffff0000-0000-4000-8000-000000000001') NOT LIKE '%STALE REPLAY%',
  'C4: the stale summary was NOT written — refusal is real, not a zero-row write');

-- ── D. and the CURRENT token still works, so C2 was not a blanket wall ─────
SELECT lives_ok(
  $$ SELECT public.nx_report_resubmit(
       'eeee0000-0000-4000-8000-000000000001'::uuid,
       'ffff0000-0000-4000-8000-000000000001'::uuid,
       (SELECT updated_at FROM public.inspection_reports
         WHERE id='ffff0000-0000-4000-8000-000000000001'),
       'valid second correction', 'round two response') $$,
  'D1: the CURRENT token is accepted — the guard is specific, not a wall');

SELECT is(
  (SELECT max(round)::int FROM public.report_senior_reviews
    WHERE inspection_report_id='ffff0000-0000-4000-8000-000000000001'),
  3, 'D2: the second correction opened round 3');

SELECT * FROM finish();
ROLLBACK;
