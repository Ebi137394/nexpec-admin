-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/contract_payout_binds_accepted_bid_test.sql
--
--  Regression proof for 20260801536000_contract_payout_binds_accepted_bid.
--
--  RUN:  supabase test db
--
--  WHAT WENT WRONG
--  `admin_generate_job_contract` took the inspector payout as a free parameter.
--  Nothing tied it to the amount the inspector had agreed to, so an admin could
--  counter at X, have the inspector accept X, then generate the contract at
--  X - delta. The inspector signs a number nobody showed them. Found during
--  release qualification: the RPC happily accepted a payout different from the
--  accepted counter.
--
--  WHY BINDING IS THE INTENDED RULE
--  `inspector_respond_to_counter` copies the accepted counter into
--  `bid_amount_cents` and says, in its own comment, that this is so "the rest of
--  the platform (dispatch table, payouts) sees a single canonical price". This
--  suite enforces that promise.
--
--  WHAT THIS SUITE PROVES
--    A  counter_accepted + mismatched payout  -> REFUSED
--    B  counter_accepted + matching payout    -> ALLOWED (guard is not a wall)
--    C  the refusal is specifically about the accepted bid, both directions
--       (paying MORE than agreed is refused too — silent repricing either way)
--    D  no negotiation (NULL / 'none')        -> admin discretion PRESERVED
--    E  'counter_rejected'                    -> discretion preserved
--    F  NULL bid_amount_cents                 -> skipped, nothing to bind to
--    G  a successful generation writes the contract.generated audit row
-- ════════════════════════════════════════════════════════════════════════════

begin;
create extension if not exists pgtap;

SELECT plan(12);

-- ── fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('aaaa0000-0000-4000-8000-000000000001', 'bindtest.admin@nexpec.test'),
  ('aaaa0000-0000-4000-8000-000000000002', 'bindtest.client@nexpec.test'),
  ('aaaa0000-0000-4000-8000-000000000003', 'bindtest.insp@nexpec.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role, full_name) VALUES
  ('aaaa0000-0000-4000-8000-000000000001', 'bindtest.admin@nexpec.test',  'admin',     'Bind Admin'),
  ('aaaa0000-0000-4000-8000-000000000002', 'bindtest.client@nexpec.test', 'client',    'Bind Client'),
  ('aaaa0000-0000-4000-8000-000000000003', 'bindtest.insp@nexpec.test',   'inspector', 'Bind Inspector')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Fixture accounts are ACTIVATED accounts. 20260801584000 starts inspectors,
-- agencies and suppliers pending Admin approval, so a fixture that skips
-- activation is modelling an applicant, not a working professional.
-- Scoped to false so it can never alter an already-activated row.
update public.profiles set marketplace_activated = true where marketplace_activated = false;

-- One job per application. `unique_job_application` allows only one application
-- per (job, inspector), and admin_generate_job_contract voids any prior contract
-- on the SAME job — separate jobs keep the four cases independent.
INSERT INTO public.jobs (id, client_id, title, description, status)
VALUES
  ('bbbb0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000002',
   'Bind test job — accepted counter', 'payout binding regression', 'open'),
  ('bbbb0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000002',
   'Bind test job — no negotiation',   'payout binding regression', 'open'),
  ('bbbb0000-0000-4000-8000-000000000003', 'aaaa0000-0000-4000-8000-000000000002',
   'Bind test job — counter rejected', 'payout binding regression', 'open'),
  ('bbbb0000-0000-4000-8000-000000000004', 'aaaa0000-0000-4000-8000-000000000002',
   'Bind test job — null bid',         'payout binding regression', 'open')
ON CONFLICT (id) DO NOTHING;

-- the negotiated application: inspector ACCEPTED a 375000 counter
INSERT INTO public.applications
  (id, job_id, applicant_id, status, bid_amount_cents, admin_counter_cents,
   negotiation_status, inspector_decision)
VALUES ('cccc0000-0000-4000-8000-000000000001',
        'bbbb0000-0000-4000-8000-000000000001',
        'aaaa0000-0000-4000-8000-000000000003',
        'CLIENT_SELECTED', 375000, 375000, 'counter_accepted', 'accepted')
ON CONFLICT (id) DO NOTHING;

-- a NON-negotiated application on the same job
INSERT INTO public.applications
  (id, job_id, applicant_id, status, bid_amount_cents, negotiation_status)
VALUES ('cccc0000-0000-4000-8000-000000000002',
        'bbbb0000-0000-4000-8000-000000000002',
        'aaaa0000-0000-4000-8000-000000000003',
        'CLIENT_SELECTED', 400000, 'none')
ON CONFLICT (id) DO NOTHING;

-- a rejected-counter application
INSERT INTO public.applications
  (id, job_id, applicant_id, status, bid_amount_cents, admin_counter_cents,
   negotiation_status, inspector_decision)
VALUES ('cccc0000-0000-4000-8000-000000000003',
        'bbbb0000-0000-4000-8000-000000000003',
        'aaaa0000-0000-4000-8000-000000000003',
        'pending', 400000, 350000, 'counter_rejected', 'rejected')
ON CONFLICT (id) DO NOTHING;

-- an accepted counter with a NULL bid (nothing to bind to)
INSERT INTO public.applications
  (id, job_id, applicant_id, status, bid_amount_cents, admin_counter_cents,
   negotiation_status, inspector_decision)
VALUES ('cccc0000-0000-4000-8000-000000000004',
        'bbbb0000-0000-4000-8000-000000000004',
        'aaaa0000-0000-4000-8000-000000000003',
        'CLIENT_SELECTED', NULL, 375000, 'counter_accepted', 'accepted')
ON CONFLICT (id) DO NOTHING;

-- act as the admin
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub":"aaaa0000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ── A. accepted counter + LOWER payout -> refused ──────────────────────────
SELECT throws_ok(
  $$ SELECT public.admin_generate_job_contract(
       'cccc0000-0000-4000-8000-000000000001'::uuid, 480000, 360000, 'terms', NULL) $$,
  '22000',
  NULL,
  'A1: paying LESS than the accepted counter is refused'
);

SELECT throws_like(
  $$ SELECT public.admin_generate_job_contract(
       'cccc0000-0000-4000-8000-000000000001'::uuid, 480000, 360000, 'terms', NULL) $$,
  '%PAYOUT_BINDING_VIOLATION%',
  'A2: the refusal names PAYOUT_BINDING_VIOLATION'
);

SELECT is(
  (SELECT count(*)::int FROM public.job_contracts
    WHERE application_id = 'cccc0000-0000-4000-8000-000000000001'),
  0,
  'A3: the refused attempt created no contract'
);

-- ── C. accepted counter + HIGHER payout -> also refused ────────────────────
SELECT throws_ok(
  $$ SELECT public.admin_generate_job_contract(
       'cccc0000-0000-4000-8000-000000000001'::uuid, 480000, 390000, 'terms', NULL) $$,
  '22000',
  NULL,
  'C1: paying MORE than the accepted counter is refused too — binding is exact'
);

-- ── B. accepted counter + EXACT payout -> allowed ──────────────────────────
SELECT lives_ok(
  $$ SELECT public.admin_generate_job_contract(
       'cccc0000-0000-4000-8000-000000000001'::uuid, 480000, 375000, 'terms', NULL) $$,
  'B1: the exact accepted amount is allowed — the guard is not a blanket wall'
);

SELECT is(
  (SELECT inspector_payout_cents FROM public.job_contracts
    WHERE application_id = 'cccc0000-0000-4000-8000-000000000001'
      AND status <> 'voided'),
  375000::bigint,
  'B2: the stored payout is the accepted counter'
);

SELECT is(
  (SELECT client_price_cents - inspector_payout_cents FROM public.job_contracts
    WHERE application_id = 'cccc0000-0000-4000-8000-000000000001'
      AND status <> 'voided'),
  105000::bigint,
  'B3: the spread is client price minus the bound payout'
);

-- ── G. the audit row exists ────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.audit_events
    WHERE event_type = 'contract.generated'
      AND job_id = 'bbbb0000-0000-4000-8000-000000000001'),
  1,
  'G1: a contract.generated audit event was written'
);

SELECT is(
  (SELECT (metadata->>'payout_bound_to_bid')::boolean FROM public.audit_events
    WHERE event_type = 'contract.generated'
      AND job_id = 'bbbb0000-0000-4000-8000-000000000001'),
  true,
  'G2: the audit row records that the payout was bound to the accepted bid'
);

-- ── D. no negotiation -> admin discretion preserved ────────────────────────
SELECT lives_ok(
  $$ SELECT public.admin_generate_job_contract(
       'cccc0000-0000-4000-8000-000000000002'::uuid, 480000, 300000, 'terms', NULL) $$,
  'D1: with negotiation_status = none, admin pricing discretion is unchanged'
);

-- ── E. counter_rejected -> discretion preserved ────────────────────────────
SELECT lives_ok(
  $$ SELECT public.admin_generate_job_contract(
       'cccc0000-0000-4000-8000-000000000003'::uuid, 480000, 320000, 'terms', NULL) $$,
  'E1: a REJECTED counter does not bind — nothing was agreed'
);

-- ── F. NULL bid under counter_accepted -> skipped ──────────────────────────
SELECT lives_ok(
  $$ SELECT public.admin_generate_job_contract(
       'cccc0000-0000-4000-8000-000000000004'::uuid, 480000, 333000, 'terms', NULL) $$,
  'F1: a NULL bid_amount_cents has nothing to bind to and is skipped'
);

SELECT * FROM finish();
ROLLBACK;
