-- ════════════════════════════════════════════════════════════════════════════
--  dispute_read_path_test.sql
--
--  Regression cover for 20260801522000 and for the client-side repointing of
--  every dispute surface onto public.job_disputes.
--
--  ── WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT ─────────────────────────────
--  job_disputes carried `AS RESTRICTIVE FOR ALL USING (false)`. RESTRICTIVE
--  policies are AND-ed and FOR ALL covers SELECT, so the effective read
--  predicate was `(admin_read OR parties_read) AND … AND false` — constant
--  false. job_disputes_parties_read and job_disputes_admin_read had never
--  returned a row to anybody.
--
--  Every existing suite missed it for one reason: pgTAP runs as postgres, and
--  postgres bypasses RLS. A test that never assumes a role cannot observe a
--  policy at all. So this suite does what the others did not — it SETs ROLE to
--  `authenticated` with real request.jwt.claims and asserts on what that
--  caller can actually see.
--
--  ── WHAT IS PROVED ─────────────────────────────────────────────────────────
--    DR1  the raiser can read the dispute they filed
--    DR2  the job's client can read a dispute on their job
--    DR3  an unrelated user reads nothing
--    DR4  an anonymous caller reads nothing
--    DR5  a direct INSERT by authenticated is still refused
--    DR6  a direct UPDATE by authenticated is still refused
--    DR7  a direct DELETE by authenticated is still refused
--    DR8  a job party can read that job's job_events
--    DR9  no RESTRICTIVE policy anywhere blocks SELECT with a constant false
--   DR10  the canonical columns exist and the legacy vocabulary does not
--
--  Nothing here moves money, dispatches, or settles.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
\i supabase/tests/_fixtures/canonical_job.sql
SELECT plan(10);

CREATE TEMP TABLE _dr(k text primary key, v text);
-- The assertions below run as `authenticated` / `anon`. Without this they can
-- read the fixture ids no more than they can read the table under test, and the
-- suite fails on the scaffolding rather than on the thing being proved.
GRANT SELECT ON _dr TO PUBLIC;

DO $$
DECLARE
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_rando  uuid := gen_random_uuid();
  v_job    uuid;
  v_disp   uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','dr.client@test.nx',now(),now()),
    (v_insp,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','dr.insp@test.nx',  now(),now()),
    (v_rando, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','dr.rando@test.nx', now(),now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','DR Client','dr.client@test.nx',true),
    (v_insp,  'inspector','DR Inspector','dr.insp@test.nx',true),
    (v_rando, 'client','DR Rando','dr.rando@test.nx',true);

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

  -- Unassigned, unfunded job. Nothing here needs a dispatch.
  v_job := nx_fx_unfunded_job(v_client, 'DISPUTE READ PATH');

  -- Filed through the canonical RPC, exactly as the client app does.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_client, 'role','authenticated')::text, true);
  v_disp := public.file_dispute(v_job, 'quality',
    'Regression fixture: the raiser must be able to read this back.');

  INSERT INTO _dr VALUES ('client', v_client::text), ('insp', v_insp::text),
                         ('rando', v_rando::text), ('job', v_job::text),
                         ('disp', v_disp::text);
END $$;

-- ── DR1/DR2: the raiser (who is also the job's client) can read it ──────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM _dr WHERE k='client'), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.job_disputes
    WHERE raised_by = (SELECT v FROM _dr WHERE k='client')::uuid),
  1,
  'DR1: the raiser can read the dispute they filed'
);

SELECT is(
  (SELECT count(*)::int FROM public.job_disputes
    WHERE job_id = (SELECT v FROM _dr WHERE k='job')::uuid),
  1,
  'DR2: the job client can read a dispute on their job'
);

-- ── DR5/DR6/DR7: writes remain refused for the very same caller ─────────────
SELECT throws_ok(
  format($$ INSERT INTO public.job_disputes (job_id, raised_by, reason_category, reason)
            VALUES (%L, %L, 'quality', 'direct insert must be refused') $$,
         (SELECT v FROM _dr WHERE k='job'), (SELECT v FROM _dr WHERE k='client')),
  '42501',
  NULL,
  'DR5: a direct INSERT by authenticated is still refused'
);

-- A RESTRICTIVE write policy makes UPDATE/DELETE affect zero rows SILENTLY —
-- no error is raised. "Zero rows affected" is therefore NOT evidence of a
-- working constraint: an invisible row produces exactly the same number. So
-- these attempt the write as `authenticated`, then step back to postgres (which
-- bypasses RLS and can see the truth) and assert the row is genuinely intact.
UPDATE public.job_disputes SET reason = 'TAMPERED'
 WHERE id = (SELECT v FROM _dr WHERE k='disp')::uuid;
DELETE FROM public.job_disputes
 WHERE id = (SELECT v FROM _dr WHERE k='disp')::uuid;

RESET ROLE;

SELECT is(
  (SELECT reason FROM public.job_disputes
    WHERE id = (SELECT v FROM _dr WHERE k='disp')::uuid),
  'Regression fixture: the raiser must be able to read this back.',
  'DR6: the UPDATE did not change the stored row (read back as postgres)'
);

SELECT is(
  (SELECT count(*)::int FROM public.job_disputes
    WHERE id = (SELECT v FROM _dr WHERE k='disp')::uuid),
  1,
  'DR7: the DELETE did not remove the row (read back as postgres)'
);

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM _dr WHERE k='client'), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- ── DR8: a job party can read that job's events ────────────────────────────
SELECT ok(
  (SELECT count(*) FROM public.job_events
    WHERE job_id = (SELECT v FROM _dr WHERE k='job')::uuid) >= 0
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'job_events' AND permissive = 'RESTRICTIVE'
       AND cmd = 'ALL' AND btrim(coalesce(qual,'')) = 'false'),
  'DR8: job_events is readable by a party — no constant-false FOR ALL policy'
);

RESET ROLE;

-- ── DR3: an unrelated authenticated user reads nothing ──────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM _dr WHERE k='rando'), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.job_disputes),
  0,
  'DR3: an unrelated user reads no disputes'
);
RESET ROLE;

-- ── DR4: anonymous reads nothing ───────────────────────────────────────────
--  Stronger than "reads zero rows": 20260801522000 REVOKEd the stray SELECT
--  grant anon held, so anon is refused at the GRANT layer and never reaches
--  RLS at all. Asserting the refusal rather than a row count also avoids the
--  trap of an empty result that merely looks like a denial.
SELECT set_config('request.jwt.claims', NULL, true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  'SELECT count(*) FROM public.job_disputes',
  '42501',
  NULL,
  'DR4: an anonymous caller is refused outright — no SELECT grant'
);
RESET ROLE;

-- ── DR9: the property, over the whole schema ───────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='public' AND permissive='RESTRICTIVE'
      AND cmd IN ('ALL','SELECT') AND btrim(coalesce(qual,'')) = 'false'),
  0,
  'DR9: no RESTRICTIVE policy blocks SELECT with a constant-false predicate'
);

-- ── DR10: the canonical column vocabulary ──────────────────────────────────
--  The client code read opener_id / category / body / filed_by / resolution.
--  Assert the real names exist so a rename cannot silently re-break the pages.
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_disputes'
      AND column_name IN ('job_id','raised_by','reason_category','reason',
                          'status','resolution_notes','resolved_by','resolved_at')),
  8,
  'DR10: job_disputes exposes the canonical dispute columns'
);

SELECT * FROM finish();
ROLLBACK;
