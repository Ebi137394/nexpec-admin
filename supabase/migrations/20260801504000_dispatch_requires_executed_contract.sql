-- ════════════════════════════════════════════════════════════════════════════
--  20260801504000_dispatch_requires_executed_contract.sql
--
--  P0 — a job can be dispatched with NO contract at all.
--
--  ── REPRODUCED, NOT INFERRED ───────────────────────────────────────────────
--  Canonical path, application already CLIENT_SELECTED, initial funding
--  satisfied, zero rows in job_contracts:
--
--      PROBE contracts before dispatch = 0
--      PROBE RESULT: dispatch SUCCEEDED with NO executed contract
--
--  admin_dispatch_job gates on authentication, admin role, price/payout
--  sanity, "job already has a contractor", and status = 'CLIENT_SELECTED'.
--  Funding is gated separately by trg_jobs_dispatch_requires_funding. Nothing
--  anywhere required a signed contract, so step 14 of the marketplace
--  lifecycle — dispatch only after the required contract is fully executed —
--  was unenforced.
--
--  on_job_hired_generate_contract does NOT cover this: it fires on
--  jobs.status = 'hired', while admin_dispatch_job sets status = 'assigned',
--  so it never runs on the dispatch path.
--
--  ── WHY A TRIGGER RATHER THAN A CHECK INSIDE admin_dispatch_job ────────────
--  The same reason the funding gate is a trigger: the RPC is one door, not the
--  only one. A direct UPDATE that sets status='assigned' and contractor_id
--  bypasses any check living inside the function. Gating the TRANSITION closes
--  every path at once, and mirrors trg_jobs_dispatch_requires_funding so the
--  two preconditions for dispatch are enforced the same way and read the same
--  way.
--
--  ── WHAT COUNTS AS EXECUTED ────────────────────────────────────────────────
--  A job_contracts row for THIS job and THIS inspector with
--  status = 'fully_executed' and voided_at IS NULL. That status is reached
--  only through the canonical both-party chain, which this migration does not
--  touch and does not reimplement:
--      admin_generate_job_contract  -> pending_client_signature
--      client_sign_job_contract     -> pending_inspector_signature
--      inspector_sign_job_contract  -> fully_executed
--  Binding the contract to the inspector matters: a contract executed with a
--  different inspector must not authorise dispatching this one.
--
--  ── LEGACY ─────────────────────────────────────────────────────────────────
--  The guard fires only on the TRANSITION into an assigned contractor, so jobs
--  already dispatched are never re-validated and no backfill is required.
--
--  TG_OP is compared with CASE, never `TG_OP = 'INSERT' OR OLD.x`: SQL does not
--  guarantee short-circuit OR, and reading OLD on INSERT is exactly the defect
--  class 20260801486000 removed from three live triggers.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_guard_dispatch_requires_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_was_assigned boolean;
  v_old_contractor uuid;
BEGIN
  --  CASE, not OR: on INSERT there is no OLD row to read.
  v_was_assigned := CASE WHEN TG_OP = 'INSERT' THEN false
                         ELSE (OLD.status = 'assigned' AND OLD.contractor_id IS NOT NULL) END;
  v_old_contractor := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.contractor_id END;

  --  Only the transition INTO a dispatched state is gated.
  IF NEW.status <> 'assigned' OR NEW.contractor_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_was_assigned AND v_old_contractor IS NOT DISTINCT FROM NEW.contractor_id THEN
    RETURN NEW;   -- already dispatched to this contractor; not a new dispatch
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.job_contracts c
     WHERE c.job_id       = NEW.id
       AND c.inspector_id = NEW.contractor_id
       AND c.status       = 'fully_executed'
       AND c.voided_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'CONTRACT_REQUIRED: job % cannot be dispatched to inspector % without a fully executed contract',
      NEW.id, NEW.contractor_id
      USING ERRCODE = '42501',
            HINT = 'Generate with admin_generate_job_contract, then collect client_sign_job_contract and inspector_sign_job_contract.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jobs_dispatch_requires_contract ON public.jobs;
CREATE TRIGGER trg_jobs_dispatch_requires_contract
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_dispatch_requires_contract();

REVOKE ALL ON FUNCTION public.nx_guard_dispatch_requires_contract() FROM anon, PUBLIC;

-- ─── Selftest — behavioural, both directions ────────────────────────────────
--  Exercises the TRANSITION directly rather than routing through
--  admin_dispatch_job. That RPC has its own state machine (it promotes the
--  application and refuses a job that is not 'open'), which makes a
--  refuse-then-retry selftest fight the fixture rather than test the guard.
--  The guard's contract is about the transition, so the transition is what is
--  asserted — and a raw UPDATE is also the bypass path a trigger exists to
--  close, so this is the stronger test.
DO $selftest$
DECLARE
  v_c uuid := gen_random_uuid(); v_i uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid(); v_j uuid := gen_random_uuid();
  v_app uuid := gen_random_uuid(); v_con uuid; v_blocked boolean := false;
BEGIN
 BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'st.'||u::text||'@synthetic.invalid', now(), now()
    FROM unnest(ARRAY[v_c,v_i,v_a]) u;
  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_c,'client','st c','st.c@synthetic.invalid',true),
    (v_i,'inspector','st i','st.i@synthetic.invalid',true),
    (v_a,'super_admin','st a','st.a@synthetic.invalid',true);
  INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                           client_price_cents,inspector_payout_cents)
  VALUES (v_j,'selftest',v_c,'open','approved','prepay',100000,70000);
  INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents)
  VALUES (v_app,v_j,v_i,'CLIENT_SELECTED',70000);

  --  Satisfy the FUNDING gate so the contract gate is the only thing left to
  --  fail. Otherwise a refusal proves nothing about contracts.
  PERFORM set_config('request.jwt.claims','',true);
  PERFORM public.settle_client_payment(v_j);

  -- 1. NEGATIVE — the transition must be refused with no executed contract.
  BEGIN
    UPDATE public.jobs SET status='assigned', contractor_id=v_i WHERE id=v_j;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'SELFTEST: the assign transition succeeded without an executed contract — the guard is not armed';
  END IF;

  -- 2. POSITIVE — the canonical signature chain must reach dispatch. A guard
  --    that only ever refuses is indistinguishable from a broken product.
  PERFORM set_config('request.jwt.claims','{"sub":"'||v_a::text||'","role":"authenticated"}',true);
  PERFORM public.admin_generate_job_contract(v_app, 100000, 70000, 'selftest terms', NULL);
  SELECT id INTO v_con FROM public.job_contracts
   WHERE job_id = v_j ORDER BY created_at DESC LIMIT 1;
  IF v_con IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: admin_generate_job_contract created no contract row';
  END IF;

  PERFORM set_config('request.jwt.claims','{"sub":"'||v_c::text||'","role":"authenticated"}',true);
  PERFORM public.client_sign_job_contract(v_con, 'ST Client', '127.0.0.1');
  PERFORM set_config('request.jwt.claims','{"sub":"'||v_i::text||'","role":"authenticated"}',true);
  PERFORM public.inspector_sign_job_contract(v_con, 'ST Inspector', '127.0.0.1');

  IF (SELECT status FROM public.job_contracts WHERE id = v_con) <> 'fully_executed' THEN
    RAISE EXCEPTION 'SELFTEST: both signatures did not produce fully_executed';
  END IF;

  PERFORM set_config('request.jwt.claims','',true);
  UPDATE public.jobs SET status='assigned', contractor_id=v_i WHERE id=v_j;
  IF (SELECT status FROM public.jobs WHERE id = v_j) <> 'assigned' THEN
    RAISE EXCEPTION 'SELFTEST: the transition did not assign the job after the contract was executed';
  END IF;

  RAISE NOTICE 'SELFTEST ok — assign refused without an executed contract, allowed with one';
  RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
 END;

 IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE '%@synthetic.invalid') THEN
   RAISE EXCEPTION 'SELFTEST: synthetic profiles survived the rollback';
 END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
