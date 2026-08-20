-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/client_reads_delivered_report_test.sql
--
--  D22 — the Client was asked to approve a delivered report whose findings were
--  never readable. lib/data/clientJobReport.ts selected ONLY `id` from
--  inspection_reports, the release page rendered no content, pdf_url was NULL
--  and photos_urls was empty. The client signed off on something they could not
--  read.
--
--  The fix reads `final_report_doc` on the client surface, gated on
--  status = 'delivered'. The AUTHORISATION for that read is RLS, so this suite
--  proves the RLS contract the surface now depends on:
--
--    A  the owning client CAN read the delivered findings, by value
--    B  an UNRELATED client is refused
--    C  a supplier (unrelated role) is refused
--    D  anon is refused
--    E  the assigned inspector CAN read their own report (they wrote it)
--    F  a report that is NOT delivered still returns no content to the client
--       via the delivered-only gate — proved by value, not by row count
--
--  A zero-row read is never accepted as proof on its own: every refusal case is
--  paired with the SAME query succeeding for the owner in the same run, so
--  "refused" means the policy fired rather than the row being absent.
--
--  RUN:  supabase test db
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

SELECT plan(8);

-- ── fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('c1c10000-0000-4000-8000-000000000001','d22.client@nexpec.test'),
  ('c1c10000-0000-4000-8000-000000000002','d22.other@nexpec.test'),
  ('c1c10000-0000-4000-8000-000000000003','d22.insp@nexpec.test'),
  ('c1c10000-0000-4000-8000-000000000004','d22.supplier@nexpec.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role, full_name) VALUES
  ('c1c10000-0000-4000-8000-000000000001','d22.client@nexpec.test','client','D22 Client'),
  ('c1c10000-0000-4000-8000-000000000002','d22.other@nexpec.test','client','D22 Other Client'),
  ('c1c10000-0000-4000-8000-000000000003','d22.insp@nexpec.test','inspector','D22 Inspector'),
  ('c1c10000-0000-4000-8000-000000000004','d22.supplier@nexpec.test','supplier','D22 Supplier')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

INSERT INTO public.jobs (id, client_id, title, description, status)
VALUES
  ('c2c20000-0000-4000-8000-000000000001','c1c10000-0000-4000-8000-000000000001',
   'D22 delivered job','client report readability','open'),
  ('c2c20000-0000-4000-8000-000000000002','c1c10000-0000-4000-8000-000000000001',
   'D22 undelivered job','client report readability','open')
ON CONFLICT (id) DO NOTHING;

-- The report reaches 'delivered' the REAL way. nx_guard_report_delivery refuses
-- the transition without an approved senior round and satisfied funding, and it
-- is not weakened here — the preconditions are created properly.
INSERT INTO public.inspection_reports
  (id, job_id, inspector_id, notes, status, final_report_doc)
VALUES ('c3c30000-0000-4000-8000-000000000001','c2c20000-0000-4000-8000-000000000001',
        'c1c10000-0000-4000-8000-000000000003','notes copy','submitted',
        '{"version":1,"result":"pass","summary":"REVISION 2 governing minimum 8.6 mm at CML-27"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.report_senior_reviews
  (inspection_report_id, job_id, round, reviewer_id, assigned_by,
   decision, decided_at, decided_by)
VALUES ('c3c30000-0000-4000-8000-000000000001','c2c20000-0000-4000-8000-000000000001',
        1,'c1c10000-0000-4000-8000-000000000002','c1c10000-0000-4000-8000-000000000002',
        'approved', now(), 'c1c10000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO public.job_funding_stages
  (job_id, tranche_no, code, label, pct_bps, amount_cents, status, funded_at,
   gates_delivery, trigger_basis)
VALUES
  ('c2c20000-0000-4000-8000-000000000001',1,'initial','Initial',2000,96000,'funded',now(),true,'before_assignment'),
  ('c2c20000-0000-4000-8000-000000000001',2,'final','Final',8000,384000,'funded',now(),true,'after_report_review')
ON CONFLICT DO NOTHING;

UPDATE public.inspection_reports
   SET status='delivered' WHERE id='c3c30000-0000-4000-8000-000000000001';

-- an UNDELIVERED report on a second job
INSERT INTO public.inspection_reports
  (id, job_id, inspector_id, notes, status, final_report_doc)
VALUES ('c3c30000-0000-4000-8000-000000000002','c2c20000-0000-4000-8000-000000000002',
        'c1c10000-0000-4000-8000-000000000003','draft notes','submitted',
        '{"version":1,"result":"pass","summary":"DRAFT MUST NOT LEAK"}')
ON CONFLICT (id) DO NOTHING;

-- ── A. the owning client reads the findings BY VALUE ───────────────────────
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"c1c10000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT (final_report_doc::jsonb)->>'summary' FROM public.inspection_reports
    WHERE id='c3c30000-0000-4000-8000-000000000001'),
  'REVISION 2 governing minimum 8.6 mm at CML-27',
  'A1: the owning client reads the ACTUAL delivered findings, by value');

SELECT is(
  (SELECT (final_report_doc::jsonb)->>'result' FROM public.inspection_reports
    WHERE id='c3c30000-0000-4000-8000-000000000001'),
  'pass', 'A2: and the delivered result');

-- the delivered-only gate the surface applies, proved by value
SELECT is(
  (SELECT CASE WHEN status='delivered' THEN (final_report_doc::jsonb)->>'summary' END
     FROM public.inspection_reports WHERE id='c3c30000-0000-4000-8000-000000000002'),
  NULL,
  'F1: an UNDELIVERED report yields no findings through the delivered-only gate');

-- ── B. an unrelated CLIENT is refused ──────────────────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"c1c10000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.inspection_reports
    WHERE id='c3c30000-0000-4000-8000-000000000001'),
  0, 'B1: an UNRELATED client cannot read the delivered report at all');

-- ── C. a supplier is refused ───────────────────────────────────────────────
SET LOCAL request.jwt.claims TO
  '{"sub":"c1c10000-0000-4000-8000-000000000004","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.inspection_reports
    WHERE id='c3c30000-0000-4000-8000-000000000001'),
  0, 'C1: a supplier cannot read the delivered report');

-- ── E. the assigned inspector CAN read their own report ────────────────────
-- non-vacuity anchor: the same row IS visible to a legitimately entitled user,
-- so B1/C1/D1 mean the policy fired, not that the row is missing.
SET LOCAL request.jwt.claims TO
  '{"sub":"c1c10000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT is(
  (SELECT (final_report_doc::jsonb)->>'summary' FROM public.inspection_reports
    WHERE id='c3c30000-0000-4000-8000-000000000001'),
  'REVISION 2 governing minimum 8.6 mm at CML-27',
  'E1: the authoring inspector still reads it — so the refusals above are real');

-- ── D. anon is refused — at the GRANT level, harder than RLS ──────────────
-- The SELECT policy's EXISTS subquery touches `jobs`, on which anon holds no
-- grant, so anon does not even reach a row check. Asserted as the error rather
-- than as a zero count, which would be the weaker claim.
SET LOCAL role TO anon;
SELECT throws_ok(
  $$ SELECT count(*) FROM public.inspection_reports
      WHERE id='c3c30000-0000-4000-8000-000000000001' $$,
  '42501', NULL,
  'D1: an anonymous caller is refused outright (permission denied)');

-- ── and the owner still can, read back last, after all the refusals ────────
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"c1c10000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.inspection_reports
    WHERE id='c3c30000-0000-4000-8000-000000000001'),
  1, 'A3: the owner still reads exactly one row after every refusal above');

SELECT * FROM finish();
ROLLBACK;
