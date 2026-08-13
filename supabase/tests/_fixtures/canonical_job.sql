-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/_fixtures/canonical_job.sql — THE FROZEN FIXTURE CONTRACT
--
--  Include with:   \i supabase/tests/_fixtures/canonical_job.sql
--  (place it after `begin;` and `create extension if not exists pgtap;`)
--
--  ── WHY THIS EXISTS ────────────────────────────────────────────────────────
--  28 of 56 pgTAP suites abort at fixture setup with FUNDING_REQUIRED. They
--  create an already-dispatched job:
--      insert into public.jobs (..., contractor_id, status) values (..., I, 'assigned')
--  Production NEVER does that. Traced and proven:
--    • post-new-job.tsx creates status='pending_approval' with NO contractor.
--    • my-jobs.tsx does set contractor_id, but only behind
--      `if (!__DEV__) return`, commented as stopping "a stray button minting a
--      self-assigned job (contractor_id = self bypasses the admin broker)".
--    • A direct status UPDATE is refused outright:
--          Illegal jobs.status transition: pending_approval → assigned
--          HINT: Use a canonical state-machine RPC (admin_dispatch_job, …)
--
--  So the canonical sequence — and the ONLY one this helper implements — is:
--      create job UNASSIGNED
--        → inspector applies
--        → funding established through the authorized platform path
--        → dispatch through admin_dispatch_job()
--
--  ── WHAT THIS HELPER WILL NOT DO ───────────────────────────────────────────
--  It never presets contractor_id, client_settled_at, or any platform-owned
--  funding column on the INSERT. Those are exactly the fields
--  nx_guard_jobs_funding_columns (20260801462000/478000) exists to keep out of
--  client hands, and bulk-adding them was the invalid shortcut a previous
--  attempt took. Funding here is established by CALLING the platform path, so
--  the guards stay armed and the fixture proves the real workflow.
--
--  ── DO NOT USE THIS IN DENIAL TESTS ────────────────────────────────────────
--  Suites whose PURPOSE is to prove funding denial or a transition refusal must
--  keep building their own unfunded/undispatched jobs. Auto-funding them would
--  delete the thing under test. Use nx_fx_unfunded_job() for those.
--
--  ── FROZEN ─────────────────────────────────────────────────────────────────
--  This contract is shared by every repaired suite. Do not edit it to make one
--  suite pass; fix the suite, or raise the mismatch.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── an UNASSIGNED job, exactly as production creates one ───────────────────
create or replace function nx_fx_unfunded_job(
  p_client        uuid,
  p_title         text    default 'fixture job',
  p_client_price  bigint  default 100000,
  p_payout        bigint  default 70000,
  p_mode          text    default 'prepay',
  p_status        text    default 'open'
) returns uuid
language plpgsql as $fn$
DECLARE v_job uuid := gen_random_uuid();
BEGIN
  -- No contractor_id. No client_settled_at. No funding columns at all.
  INSERT INTO public.jobs (id, title, client_id, status, moderation_status,
                           payment_mode, client_price_cents, inspector_payout_cents)
  VALUES (v_job, p_title, p_client, p_status, 'approved',
          p_mode, p_client_price, p_payout);
  RETURN v_job;
END $fn$;

-- ─── funding, through the AUTHORIZED platform path ──────────────────────────
--  Called with no JWT claims, so nx_actor_is_platform() is true — the same
--  standing the Stripe webhook has. This does NOT write client_settled_at
--  directly; settle_client_payment does, which is the canonical writer.
--  NON-DESTRUCTIVE: it saves the caller's JWT claims and puts them back.
--  Without that, funding a job from inside an admin-context block silently
--  de-authenticated the rest of the block — the next privileged call failed with
--  a bare "admin only" that looked like an authorization defect rather than a
--  fixture side effect. Every suite that funds mid-test hits this, so it is
--  fixed once here rather than worked around per suite.
create or replace function nx_fx_fund_job(p_job uuid)
returns void
language plpgsql as $fn$
DECLARE v_prev text;
BEGIN
  v_prev := current_setting('request.jwt.claims', true);
  PERFORM set_config('request.jwt.claims', '', true);   -- platform standing
  PERFORM public.settle_client_payment(p_job);
  PERFORM set_config('request.jwt.claims', COALESCE(v_prev, ''), true);
END $fn$;

-- ─── the inspector applies (admin_dispatch_job needs an application) ────────
--  Created directly in CLIENT_SELECTED: admin_dispatch_job refuses anything
--  else ("Application is not in CLIENT_SELECTED state"). That state means the
--  buyer has picked this applicant and the Admin is now brokering the dispatch,
--  which is precisely the point in the workflow these fixtures need to reach.
--  'CLIENT_SELECTED' is a real member of applications_status_check.
create or replace function nx_fx_application(
  p_job uuid, p_inspector uuid, p_bid bigint default 70000,
  p_status text default 'CLIENT_SELECTED'
) returns uuid
language plpgsql as $fn$
DECLARE v_app uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.applications (id, job_id, applicant_id, status, bid_amount_cents)
  VALUES (v_app, p_job, p_inspector, p_status, p_bid);
  RETURN v_app;
END $fn$;

-- ─── the whole canonical sequence, end to end ───────────────────────────────
--  Returns the dispatched job id. p_admin MUST be a profile with role
--  'admin' or 'super_admin': admin_dispatch_job authenticates via auth.uid()
--  and refuses anyone else (28000 when unauthenticated, otherwise 'Only
--  super_admin can dispatch').
create or replace function nx_fx_dispatched_job(
  p_client       uuid,
  p_inspector    uuid,
  p_admin        uuid,
  p_title        text   default 'fixture job',
  p_client_price bigint default 100000,
  p_payout       bigint default 70000,
  p_mode         text   default 'prepay'
) returns uuid
language plpgsql as $fn$
DECLARE v_job uuid; v_app uuid; v_prev text;
BEGIN
  v_prev := coalesce(current_setting('request.jwt.claims', true), '');

  -- 1. unassigned
  v_job := nx_fx_unfunded_job(p_client, p_title, p_client_price, p_payout, p_mode);

  -- 2. the inspector applies
  v_app := nx_fx_application(v_job, p_inspector, p_payout);

  -- 3. funding via the authorized platform path (prepay only; net_terms
  --    dispatches on the buyer's credit line instead, so funding is not
  --    established here for it).
  IF coalesce(p_mode, 'prepay') = 'prepay' THEN
    PERFORM nx_fx_fund_job(v_job);
  END IF;

  -- 4. dispatch through the canonical Admin RPC, as the admin
  PERFORM set_config('request.jwt.claims',
    '{"sub":"' || p_admin::text || '","role":"authenticated"}', true);
  PERFORM public.admin_dispatch_job(v_job, v_app, p_client_price, p_payout);

  -- restore whatever claims the suite had
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN v_job;
END $fn$;
