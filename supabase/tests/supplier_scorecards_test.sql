-- ════════════════════════════════════════════════════════════════════════════
--  supplier_scorecards_test.sql
--
--  Covers 20260801470000_supplier_scorecards.sql. Two things are on trial:
--
--    P0  CROSS-SUPPLIER / CROSS-ORG LEAKAGE. A supplier must not be able to
--        read another supplier's scorecard, in either direction, through the
--        predicate OR through any of the three RPCs.
--
--    THE OWNER'S PRECISION RULE. A score must never be more precise than its
--        evidence supports, must always travel with its sample size, and must
--        be ABSENT rather than zero when the evidence is thin.
--
--  ── FIXTURES ───────────────────────────────────────────────────────────────
--   SUP1  rich evidence, deliberately arranged to produce RATIOS THAT ARE NOT
--         ROUND NUMBERS, so the coarsening is provable rather than incidental:
--           7 quotes   → 6 not withdrawn      = 85.71%  → must report 90
--           7 quotes   → 5 answered in window = 71.43%  → must report 70
--           5 jobs     → 4 NCR-free           = 80%     → must report 80
--           5 jobs     → 4 started on time    = 80%     → must report 80
--           5 documents→ 4 unexpired          = 80%     → must report 80
--           1 NCR                             = n of 1  → must report NO score
--           0 ITP points                      = n of 0  → must report NO score
--
--   SUP2  THE OWNER'S LITERAL CASE: exactly 3 data points. Every metric must
--         decline to score, and the composite must be withheld entirely.
--
--   BUYER   owns SUP1's RFQs and holds an accepted quote → may read SUP1.
--   BUYER2  unrelated buyer → may NOT read SUP1.
--   TEAM    non-viewer teammate in BUYER's org → may read SUP1.
--   VIEWER  viewer in the same org → may NOT read SUP1.
--
--  Jobs are born status 'in_progress' with contractor_id NULL and
--  client_settled_at unset, and reports are born 'pending', so none of the
--  insert-side guards from 20260801462000 (dispatch funding, delivery gate,
--  funding-column lockdown) is engaged by these fixtures.
-- ════════════════════════════════════════════════════════════════════════════

begin;
-- Repo convention (countersign_lifecycle_test / supplier_chat_access_test):
-- install pgtap inside the rolled-back transaction so the suite is runnable
-- independently on a fresh `supabase db reset` and test ORDER NEVER MATTERS.
create extension if not exists pgtap;
select plan(65);

\set SUP1   'e1111111-1111-4111-8111-111111111111'
\set SUP2   'e2222222-2222-4222-8222-222222222222'
\set BUYER  'e3333333-3333-4333-8333-333333333333'
\set BUYER2 'e4444444-4444-4444-8444-444444444444'
\set TEAM   'e5555555-5555-4555-8555-555555555555'
\set VIEWER 'e6666666-6666-4666-8666-666666666666'
\set ADMIN  'e7777777-7777-4777-8777-777777777777'
\set INSP   'e8888888-8888-4888-8888-888888888888'
\set ORG    'e9999999-9999-4999-8999-999999999999'

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (:'SUP1',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','s1.sk@test.nx',now(),now()),
  (:'SUP2',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','s2.sk@test.nx',now(),now()),
  (:'BUYER', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','by.sk@test.nx',now(),now()),
  (:'BUYER2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b2.sk@test.nx',now(),now()),
  (:'TEAM',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','tm.sk@test.nx',now(),now()),
  (:'VIEWER','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vw.sk@test.nx',now(),now()),
  (:'ADMIN', '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad.sk@test.nx',now(),now()),
  (:'INSP',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','in.sk@test.nx',now(),now());

insert into public.profiles (id, email, role, full_name, specialty_slugs) values
  (:'SUP1',  's1.sk@test.nx','supplier',   'Acme Forge',   '{}'::text[]),
  (:'SUP2',  's2.sk@test.nx','supplier',   'Rival Forge',  '{}'::text[]),
  (:'BUYER', 'by.sk@test.nx','enterprise', 'Buyer Corp',   '{}'::text[]),
  (:'BUYER2','b2.sk@test.nx','client',     'Other Buyer',  '{}'::text[]),
  (:'TEAM',  'tm.sk@test.nx','enterprise', 'Team Proc',    '{}'::text[]),
  (:'VIEWER','vw.sk@test.nx','enterprise', 'Team Viewer',  '{}'::text[]),
  (:'ADMIN', 'ad.sk@test.nx','super_admin','Ada Admin',    '{}'::text[]),
  (:'INSP',  'in.sk@test.nx','inspector',  'Ivy Inspector','{}'::text[])
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into public.supplier_profiles (id, legal_name, country_code) values
  (:'SUP1','Acme Forge','CA'), (:'SUP2','Rival Forge','CA')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug, kind, is_active, owner_id)
values (:'ORG','Buyer Corp','buyer-corp-sk','enterprise',true,:'BUYER')
on conflict (id) do nothing;
insert into public.org_members (org_id, user_id, role) values
  (:'ORG', :'BUYER',  'owner'),
  (:'ORG', :'TEAM',   'procurement_admin'),
  (:'ORG', :'VIEWER', 'viewer');

-- ── RFQs. 1-7 belong to BUYER (SUP1); 8-10 to BUYER2 (SUP2). ───────────────
insert into public.supplier_rfqs (id, client_id, title, status, requires_source_inspection, created_at) values
  ('eb111111-1111-4111-8111-111111111111', :'BUYER',  'Forged flanges A', 'awarded', true, now() - interval '30 days'),
  ('eb222222-2222-4222-8222-222222222222', :'BUYER',  'Forged flanges B', 'awarded', true, now() - interval '30 days'),
  ('eb333333-3333-4333-8333-333333333333', :'BUYER',  'Forged flanges C', 'awarded', true, now() - interval '30 days'),
  ('eb444444-4444-4444-8444-444444444444', :'BUYER',  'Forged flanges D', 'awarded', true, now() - interval '30 days'),
  ('eb555555-5555-4555-8555-555555555555', :'BUYER',  'Forged flanges E', 'awarded', true, now() - interval '30 days'),
  ('eb666666-6666-4666-8666-666666666666', :'BUYER',  'Valve bodies F',   'closed',  true, now() - interval '30 days'),
  ('eb777777-7777-4777-8777-777777777777', :'BUYER',  'Valve bodies G',   'closed',  true, now() - interval '30 days'),
  ('eb888888-8888-4888-8888-888888888888', :'BUYER2', 'Unrelated H',      'open',    true, now() - interval '30 days'),
  ('eb999999-9999-4999-8999-999999999999', :'BUYER2', 'Unrelated I',      'open',    true, now() - interval '30 days'),
  ('ebaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', :'BUYER2', 'Unrelated J',      'open',    true, now() - interval '30 days');

-- ── SUP1's 7 quotes. Q7 withdrawn (6/7 follow-through = 85.71%).
--    Q6 and Q7 answered LATE, outside the 168h window (5/7 timely = 71.43%).
insert into public.supplier_quotes (id, rfq_id, supplier_id, quote, status, created_at) values
  ('ec111111-1111-4111-8111-111111111111','eb111111-1111-4111-8111-111111111111',:'SUP1','{}'::jsonb,'accepted',  now() - interval '29 days'),
  ('ec222222-2222-4222-8222-222222222222','eb222222-2222-4222-8222-222222222222',:'SUP1','{}'::jsonb,'accepted',  now() - interval '29 days'),
  ('ec333333-3333-4333-8333-333333333333','eb333333-3333-4333-8333-333333333333',:'SUP1','{}'::jsonb,'accepted',  now() - interval '29 days'),
  ('ec444444-4444-4444-8444-444444444444','eb444444-4444-4444-8444-444444444444',:'SUP1','{}'::jsonb,'accepted',  now() - interval '29 days'),
  ('ec555555-5555-4555-8555-555555555555','eb555555-5555-4555-8555-555555555555',:'SUP1','{}'::jsonb,'accepted',  now() - interval '29 days'),
  ('ec666666-6666-4666-8666-666666666666','eb666666-6666-4666-8666-666666666666',:'SUP1','{}'::jsonb,'declined',  now() - interval '20 days'),
  ('ec777777-7777-4777-8777-777777777777','eb777777-7777-4777-8777-777777777777',:'SUP1','{}'::jsonb,'withdrawn', now() - interval '20 days');

-- ── SUP2: EXACTLY THREE data points, the owner's stated case. ──────────────
insert into public.supplier_quotes (id, rfq_id, supplier_id, quote, status, created_at) values
  ('ec888888-8888-4888-8888-888888888888','eb888888-8888-4888-8888-888888888888',:'SUP2','{}'::jsonb,'submitted', now() - interval '29 days'),
  ('ec999999-9999-4999-8999-999999999999','eb999999-9999-4999-8999-999999999999',:'SUP2','{}'::jsonb,'submitted', now() - interval '29 days'),
  ('ecaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ebaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',:'SUP2','{}'::jsonb,'submitted', now() - interval '29 days');

-- ── SUP1's 5 jobs. JOB5 started LATE (4/5 on time = 80%).
--    contractor_id stays NULL and status is never 'assigned', so the dispatch
--    funding gate (20260801462000 §3) is not engaged by a fixture insert.
insert into public.jobs
  (id, title, client_id, status, moderation_status, identity_mode, replacement_mode,
   scheduled_date, started_at)
values
  ('ea111111-1111-4111-8111-111111111111','Source inspection A',:'BUYER','in_progress','approved','full','client_reapproval', now() - interval '20 days', now() - interval '20 days'),
  ('ea222222-2222-4222-8222-222222222222','Source inspection B',:'BUYER','in_progress','approved','full','client_reapproval', now() - interval '19 days', now() - interval '19 days'),
  ('ea333333-3333-4333-8333-333333333333','Source inspection C',:'BUYER','in_progress','approved','full','client_reapproval', now() - interval '18 days', now() - interval '18 days'),
  ('ea444444-4444-4444-8444-444444444444','Source inspection D',:'BUYER','in_progress','approved','full','client_reapproval', now() - interval '17 days', now() - interval '17 days'),
  ('ea555555-5555-4555-8555-555555555555','Source inspection E',:'BUYER','in_progress','approved','full','client_reapproval', now() - interval '16 days', now() - interval '10 days');

-- Executed contracts are what make these SUP1's jobs under nx_is_job_supplier.
insert into public.supplier_contracts (id, quote_id, rfq_id, job_id, supplier_id, status) values
  ('ed111111-1111-4111-8111-111111111111','ec111111-1111-4111-8111-111111111111','eb111111-1111-4111-8111-111111111111','ea111111-1111-4111-8111-111111111111',:'SUP1','executed'),
  ('ed222222-2222-4222-8222-222222222222','ec222222-2222-4222-8222-222222222222','eb222222-2222-4222-8222-222222222222','ea222222-2222-4222-8222-222222222222',:'SUP1','executed'),
  ('ed333333-3333-4333-8333-333333333333','ec333333-3333-4333-8333-333333333333','eb333333-3333-4333-8333-333333333333','ea333333-3333-4333-8333-333333333333',:'SUP1','executed'),
  ('ed444444-4444-4444-8444-444444444444','ec444444-4444-4444-8444-444444444444','eb444444-4444-4444-8444-444444444444','ea444444-4444-4444-8444-444444444444',:'SUP1','executed'),
  ('ed555555-5555-4555-8555-555555555555','ec555555-5555-4555-8555-555555555555','eb555555-5555-4555-8555-555555555555','ea555555-5555-4555-8555-555555555555',:'SUP1','executed');

-- Inspection evidence: without it a job is EXCLUDED from ncr_free_jobs, which
-- is the rule that stops an uninspected job counting as clean. Born 'pending',
-- never 'delivered', so the delivery gate (20260801462000 §1) stays inert.
insert into public.inspection_reports (job_id, inspector_id) values
  ('ea111111-1111-4111-8111-111111111111', :'INSP'),
  ('ea222222-2222-4222-8222-222222222222', :'INSP'),
  ('ea333333-3333-4333-8333-333333333333', :'INSP'),
  ('ea444444-4444-4444-8444-444444444444', :'INSP'),
  ('ea555555-5555-4555-8555-555555555555', :'INSP');

-- ONE NCR — an ordinary flash report, the only NCR carrier this schema has.
-- One is deliberate: n = 1 must produce NO closure score.
insert into public.flash_reports
  (id, job_id, reporter_id, reporter_role, category, severity, title, description, status)
values
  ('ef111111-1111-4111-8111-111111111111','ea555555-5555-4555-8555-555555555555',
   :'INSP','inspector','defect','major','Weld porosity found on flange E',
   'Porosity exceeding the acceptance criteria was observed on the flange weld during source inspection.',
   'open');

-- 5 documents, 1 expired → 80% currency.
insert into public.vendor_documents
  (id, vendor_id, doc_type, storage_path, content_sha256, seal_sha256, status, expires_at)
values
  ('ee111111-1111-4111-8111-111111111111',:'SUP1','iso_cert',     's/1.pdf','a1','b1','active', now() + interval '365 days'),
  ('ee222222-2222-4222-8222-222222222222',:'SUP1','insurance',    's/2.pdf','a2','b2','active', now() + interval '200 days'),
  ('ee333333-3333-4333-8333-333333333333',:'SUP1','accreditation','s/3.pdf','a3','b3','active', now() + interval '100 days'),
  ('ee444444-4444-4444-8444-444444444444',:'SUP1','nda',          's/4.pdf','a4','b4','active', null),
  ('ee555555-5555-4555-8555-555555555555',:'SUP1','msa',          's/5.pdf','a5','b5','active', now() - interval '10 days');

-- ══════════════════════════════════════════════════════════════════════════
--  A. The precision ladder — fake precision must be UNREPRESENTABLE
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_supplier_scorecard_band(0),  'none',
  'LADDER: zero observations map to the "none" band');
select is(public.nx_supplier_scorecard_band(3),  'insufficient',
  'LADDER: THE OWNER''S CASE — 3 observations map to "insufficient"');
select is(public.nx_supplier_scorecard_band(5),  'low',
  'LADDER: 5 observations reach "low"');
select is(public.nx_supplier_scorecard_band(12), 'moderate',
  'LADDER: 12 observations reach "moderate"');
select is(public.nx_supplier_scorecard_band(30), 'high',
  'LADDER: 30 observations reach "high"');

select is((select rounding_step from public.supplier_scorecard_confidence_bands
            where band = public.nx_supplier_scorecard_band(3)), 0,
  'PRECISION: 3 data points carry rounding_step 0 — no score at all, let alone a 2-decimal one');

select is((select count(*)::int from public.supplier_scorecard_confidence_bands
            where rounding_step <> round(rounding_step)), 0,
  'PRECISION: no confidence band carries a fractional rounding step, so no score can carry a decimal');

select is((select count(*)::int from public.supplier_scorecard_metrics
            where btrim(coalesce(evidence_source,'')) = ''), 0,
  'EXPLAINABILITY: every metric declares the table its evidence comes from');
select is((select count(*)::int from public.supplier_scorecard_metrics
            where btrim(coalesce(measures,'')) = ''), 0,
  'EXPLAINABILITY: every metric declares what it actually measures');
select is((select count(*)::int from public.supplier_scorecard_metrics
            where min_sample_size < 3), 0,
  'PRECISION: no metric claims to be scoreable on fewer than 3 observations');

-- ══════════════════════════════════════════════════════════════════════════
--  B. THE P0 — cross-supplier and cross-org visibility, at the predicate
-- ══════════════════════════════════════════════════════════════════════════
select is(public.nx_can_view_supplier_scorecard(:'SUP1', :'SUP1'), true,
  'AUTH: a supplier may read their OWN scorecard');
select is(public.nx_can_view_supplier_scorecard(:'SUP1', :'SUP2'), false,
  'P0: a rival supplier may NOT read SUP1''s scorecard');
select is(public.nx_can_view_supplier_scorecard(:'SUP2', :'SUP1'), false,
  'P0: …and the leak is closed in the other direction too');
select is(public.nx_can_view_supplier_scorecard(:'SUP1', :'ADMIN'), true,
  'AUTH: an admin may read any scorecard');
select is(public.nx_can_view_supplier_scorecard(:'SUP1', :'BUYER'), true,
  'AUTH: a buyer with an accepted quote may read that supplier''s scorecard');
select is(public.nx_can_view_supplier_scorecard(:'SUP1', :'BUYER2'), false,
  'P0: an UNRELATED buyer may not read SUP1''s scorecard');
select is(public.nx_can_view_supplier_scorecard(:'SUP1', :'TEAM'), true,
  'ORG: a non-viewer teammate in the buyer''s org may read it');
select is(public.nx_can_view_supplier_scorecard(:'SUP1', :'VIEWER'), false,
  'ORG: a VIEWER in the same org may not — matching nx_can_team_manage_job');
select is(public.nx_can_view_supplier_scorecard(:'SUP1', null), false,
  'AUTH: an unauthenticated caller may read nothing');

-- ══════════════════════════════════════════════════════════════════════════
--  C. THE P0 — enforced at every RPC, not merely in the predicate
--  psql does not interpolate :variables inside dollar-quoted strings, so the
--  UUIDs below are written out literally (see supplier_chat_access_test).
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.nx_supplier_scorecard('e1111111-1111-4111-8111-111111111111') $$,
  '42501', NULL, 'P0: a rival supplier calling nx_supplier_scorecard is refused');
select throws_ok(
  $$ select public.nx_supplier_scorecard_metric(
       'e1111111-1111-4111-8111-111111111111', 'quote_follow_through') $$,
  '42501', NULL, 'P0: …the per-metric RPC is refused too');
select throws_ok(
  $$ select * from public.nx_supplier_scorecard_evidence(
       'e1111111-1111-4111-8111-111111111111', 'quote_follow_through') $$,
  '42501', NULL, 'P0: …and the evidence RPC is not a way around the read rule');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.nx_supplier_scorecard('e1111111-1111-4111-8111-111111111111') $$,
  'AUTH: the supplier themselves is served');
reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  D. Thin evidence states itself — score ABSENT, never a confident zero
-- ══════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"e7777777-7777-4777-8777-777777777777","role":"authenticated"}';

select is((public.nx_supplier_scorecard_metric(:'SUP2','quote_follow_through')->>'sample_size')::int, 3,
  'THIN: SUP2''s sample size is reported as 3 — the figure is never hidden');
select ok((public.nx_supplier_scorecard_metric(:'SUP2','quote_follow_through')->>'score') is null,
  'THE OWNER''S RULE: 3 data points produce NO score at all');
select is(public.nx_supplier_scorecard_metric(:'SUP2','quote_follow_through')->>'confidence', 'insufficient',
  'THIN: …and the thinness is stated as a confidence band, not left to the reader');
select ok((public.nx_supplier_scorecard_metric(:'SUP2','quote_follow_through')->>'reason') is not null,
  'THIN: …with a reason explaining why no score was emitted');

select is((public.nx_supplier_scorecard_metric(:'SUP1','inspection_pass_rate')->>'sample_size')::int, 0,
  'NO DATA: a metric with no rows reports sample size 0');
select ok((public.nx_supplier_scorecard_metric(:'SUP1','inspection_pass_rate')->>'score') is null,
  'NO DATA: …and scores NULL, NOT 0 — absent evidence must not read as bad performance');
select is(public.nx_supplier_scorecard_metric(:'SUP1','inspection_pass_rate')->>'confidence', 'none',
  'NO DATA: …under the "none" band');

select is((public.nx_supplier_scorecard_metric(:'SUP1','ncr_closure')->>'sample_size')::int, 1,
  'THIN: a single NCR is reported as a sample of 1');
select ok((public.nx_supplier_scorecard_metric(:'SUP1','ncr_closure')->>'score') is null,
  'THIN: …and one data point produces no closure score');

-- ══════════════════════════════════════════════════════════════════════════
--  E. Real evidence is scored — and COARSENED to what it supports
-- ══════════════════════════════════════════════════════════════════════════
select is((public.nx_supplier_scorecard_metric(:'SUP1','quote_follow_through')->>'sample_size')::int, 7,
  'SCORED: follow-through sample size is 7');
select is((public.nx_supplier_scorecard_metric(:'SUP1','quote_follow_through')->>'numerator')::int, 6,
  'SCORED: …with 6 of them counted in the numerator');
select is((public.nx_supplier_scorecard_metric(:'SUP1','quote_follow_through')->>'score')::int, 90,
  'COARSENING: 6/7 is 85.71% and is reported as 90 — the nearest 10, not two decimals');
select is(public.nx_supplier_scorecard_metric(:'SUP1','quote_follow_through')->>'confidence', 'low',
  'COARSENING: …under the "low" band that n=7 earns');
select is((public.nx_supplier_scorecard_metric(:'SUP1','quote_follow_through')->>'score')::int % 10, 0,
  'COARSENING: …and the score is a whole multiple of the band''s rounding step');

select is((public.nx_supplier_scorecard_metric(:'SUP1','rfq_response_timeliness')->>'score')::int, 70,
  'COARSENING: 5/7 timely is 71.43% and is reported as 70');
select is((public.nx_supplier_scorecard_metric(:'SUP1','ncr_free_jobs')->>'score')::int, 80,
  'DERIVED: 4 of 5 inspected jobs raised no NCR → 80');
select is((public.nx_supplier_scorecard_metric(:'SUP1','ncr_free_jobs')->>'sample_size')::int, 5,
  'DERIVED: …over the 5 jobs that actually carry inspection evidence');
select is((public.nx_supplier_scorecard_metric(:'SUP1','delivery_timeliness')->>'score')::int, 80,
  'DERIVED: 4 of 5 jobs started on schedule → 80');
select is((public.nx_supplier_scorecard_metric(:'SUP1','document_currency')->>'score')::int, 80,
  'DERIVED: 4 of 5 active documents are unexpired → 80');

select ok((public.nx_supplier_scorecard_metric(:'SUP1','quote_follow_through')->>'interval_low')::int
          < (public.nx_supplier_scorecard_metric(:'SUP1','quote_follow_through')->>'interval_high')::int,
  'HONESTY: a Wilson interval is emitted, so remaining uncertainty is visible as a width');

-- ══════════════════════════════════════════════════════════════════════════
--  F. The composite is withheld unless the evidence earns it
-- ══════════════════════════════════════════════════════════════════════════
select is((public.nx_supplier_scorecard(:'SUP1')->>'overall_score')::int, 80,
  'COMPOSITE: SUP1 scores 80 overall, weighted over its qualifying metrics');
select is(public.nx_supplier_scorecard(:'SUP1')->>'overall_confidence', 'low',
  'COMPOSITE: …at the confidence of its WEAKEST contributor, never better');
select is((public.nx_supplier_scorecard(:'SUP1')->>'metrics_scored')::int, 5,
  'COMPOSITE: 5 of the metrics reached their evidence minimum');
select is((public.nx_supplier_scorecard(:'SUP1')->>'metrics_total')::int, 7,
  'COMPOSITE: …out of 7 attempted, and the shortfall is reported');

select ok((public.nx_supplier_scorecard(:'SUP2')->>'overall_score') is null,
  'COMPOSITE: SUP2, on 3 data points, gets NO overall score');
select is((public.nx_supplier_scorecard(:'SUP2')->>'metrics_scored')::int, 0,
  'COMPOSITE: …because no metric of theirs reached its minimum');
select ok((public.nx_supplier_scorecard(:'SUP2')->>'reason') is not null,
  'COMPOSITE: …and the refusal is explained rather than rendered as a zero');

-- ══════════════════════════════════════════════════════════════════════════
--  G. Traceability — every score expands to the rows that produced it
-- ══════════════════════════════════════════════════════════════════════════
select is((select count(*)::int from public.nx_supplier_scorecard_evidence(:'SUP1','quote_follow_through')), 7,
  'TRACEABILITY: the evidence rows number exactly the metric''s sample size');
select is((select count(*)::int from public.nx_supplier_scorecard_evidence(:'SUP1','quote_follow_through')
            where counted_in_numerator), 6,
  'TRACEABILITY: …and exactly the numerator counted toward it');
select is((select count(*)::int from public.nx_supplier_scorecard_evidence(:'SUP1','ncr_closure')), 1,
  'TRACEABILITY: an unscored metric still exposes its single row');
select is((select count(*)::int from public.nx_supplier_scorecard_evidence(:'SUP1','document_currency')
            where not counted_in_numerator), 1,
  'TRACEABILITY: the one expired document is identifiable, not merely counted');
select ok((select bool_and(evidence_id is not null)
             from public.nx_supplier_scorecard_evidence(:'SUP1','ncr_free_jobs')),
  'TRACEABILITY: every evidence row carries the id of the row it came from');

select ok((select bool_and(coalesce(m->>'measures','') <> '')
             from jsonb_array_elements(public.nx_supplier_scorecard(:'SUP1')->'metrics') m),
  'EXPLAINABILITY: every metric in the scorecard carries its plain-English definition');
select ok((select bool_and(m ? 'sample_size')
             from jsonb_array_elements(public.nx_supplier_scorecard(:'SUP1')->'metrics') m),
  'EXPLAINABILITY: …and no metric can be emitted without its sample size');
select ok((select bool_and(coalesce(m->>'evidence_source','') <> '')
             from jsonb_array_elements(public.nx_supplier_scorecard(:'SUP1')->'metrics') m),
  'EXPLAINABILITY: …or without naming the table it was derived from');
reset role;

-- ══════════════════════════════════════════════════════════════════════════
--  H. No money, no V2, no anon
-- ══════════════════════════════════════════════════════════════════════════
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public'
              and table_name like 'supplier\_scorecard\_%'
              and column_name ~* '(cents|halalas|amount|price|payout|spread|margin|balance)'), 0,
  'MONEY: no scorecard table carries a money column');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname like 'nx\_supplier\_scorecard%'
              and regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
                  '(wallets|transactions|earnings|payouts|_cents|_halalas|escrow|settle)'), 0,
  'MONEY: no scorecard function touches a wallet, ledger, payout or settlement surface');

select ok(not has_table_privilege('anon','public.supplier_scorecard_metrics','SELECT'),
  'ANON: cannot read the metric registry');
select ok(not has_function_privilege('anon','public.nx_supplier_scorecard(uuid)','EXECUTE'),
  'ANON: cannot execute the scorecard RPC');

select ok(to_regclass('public.supplier_scorecards') is null,
  'NO V2: no stored scorecard table exists — scores are derived at read time');
select ok(to_regclass('public.supplier_directory') is not null,
  'NO V2: the existing supplier directory is still the only one');
select ok(to_regclass('public.ncr_reports') is null,
  'NO V2: no second NCR table — an NCR is an ordinary flash report');

select * from finish();
rollback;
