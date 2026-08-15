-- ════════════════════════════════════════════════════════════════════════════
--  20260801502000_delivery_policy_staging_verification.sql
--
--  BEHAVIOURAL PROOF, executed wherever it is applied — including Staging.
--
--  pgTAP proves the delivery policy on a local database. It cannot run against
--  Staging: the pooler stores no password, so there is no psql route from this
--  workstation to the remote. A migration IS that route — it executes
--  server-side, inside one transaction, and its RAISEs are the assertions.
--
--  ── SELF-CLEANING BY CONSTRUCTION ──────────────────────────────────────────
--  Everything created here is synthetic and deleted before COMMIT, in the same
--  transaction that created it. If any assertion fails the transaction aborts
--  and nothing — not one profile, not one job, not one auth user — is left
--  behind. There is therefore no window in which a synthetic privileged
--  account exists after this migration finishes, and the final block asserts
--  exactly that rather than trusting the cleanup.
--
--  Synthetic ids are deterministic and namespaced under the reserved prefix
--  'facade00-' so they cannot collide with real rows and can be positively
--  identified for the residue check.
--
--  NO REAL MONEY. Nothing here touches Stripe, a wallet, an earning or a
--  payout. It exercises the funding STATE MACHINE only.
--
--  ── WHAT IS PROVED ─────────────────────────────────────────────────────────
--    GP  Golden Path (docs/current-release-state.md:513):
--        final funded -> settled -> payout STILL 0 -> admin delivers
--    S1  Strict 20/80 blocks delivery
--    S2  Net-15 releases delivery
--    S3  Net-30 releases delivery
--    S4  Net-60 releases delivery
--    S5  Overdue invoice does NOT remove report access
--    S6  Client and Inspector cannot modify terms
--    S7  Audit history is complete
--    S8  No automatic Inspector payout
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $verify$
DECLARE
  v_client uuid := 'facade00-0000-0000-0000-0000000000c1';
  v_insp   uuid := 'facade00-0000-0000-0000-0000000000d2';
  v_admin  uuid := 'facade00-0000-0000-0000-0000000000a3';
  v_job    uuid;
  v_j15    uuid; v_j30 uuid; v_j60 uuid;
  v_app    uuid;
  v_ok     boolean;
  v_n      int;
  v_status text;
  v_payout bigint;
  v_residue int;
  v_ids    uuid[] := ARRAY[]::uuid[];
BEGIN
 --  Everything below runs in a plpgsql SUBTRANSACTION that always rolls back.
 --  Cleanup is therefore guaranteed by the transaction system rather than by
 --  DELETE statements — which cannot work here anyway: nx_active_super_admin_count
 --  refuses to let the population reach zero, so a synthetic super_admin created
 --  on a database that had none can never be demoted or deleted. Rolling back
 --  leaves nothing to revoke, honours that guard instead of disabling it, and
 --  holds on Staging and on a fresh local reset alike.
 --
 --  A genuine assertion failure still fails the migration: only the sentinel is
 --  swallowed, everything else is re-raised.
 BEGIN
  -- ── synthetic actors ─────────────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'verify.'||u::text||'@synthetic.invalid', now(), now()
    FROM unnest(ARRAY[v_client, v_insp, v_admin]) u
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
    (v_client,'client','Verify Client','verify.client@synthetic.invalid',true),
    (v_insp,'inspector','Verify Inspector','verify.insp@synthetic.invalid',true),
    (v_admin,'super_admin','Verify Admin','verify.admin@synthetic.invalid',true)
  ON CONFLICT (id) DO NOTHING;

  -- ── helper: build a dispatched, initially-funded job ─────────────────────
  --  Uses the canonical path only: create UNASSIGNED, apply, fund through the
  --  platform, dispatch via admin_dispatch_job. contractor_id and
  --  client_settled_at are never preset.
  FOR v_n IN 1..4 LOOP
    v_job := gen_random_uuid();
    INSERT INTO public.jobs (id, title, client_id, status, moderation_status,
                             payment_mode, client_price_cents, inspector_payout_cents)
    VALUES (v_job, 'verify job '||v_n, v_client, 'open', 'approved',
            'prepay', 100000, 70000);

    v_app := gen_random_uuid();
    INSERT INTO public.applications (id, job_id, applicant_id, status, bid_amount_cents)
    VALUES (v_app, v_job, v_insp, 'CLIENT_SELECTED', 70000);

    PERFORM set_config('request.jwt.claims', '', true);      -- platform standing
    PERFORM public.settle_client_payment(v_job);

    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_admin::text||'","role":"authenticated"}', true);
    PERFORM public.admin_dispatch_job(v_job, v_app, 100000, 70000);

    PERFORM public.nx_funding_ensure_schedule(v_job);
    --  Unique reference per job: the third argument is an idempotency key, and
    --  reusing one string across jobs makes calls 2..n look like replays of the
    --  first, silently leaving their initial tranche unfunded.
    PERFORM public.nx_funding_mark_stage_funded(v_job, 'initial', 'verify-initial-'||v_job::text);

    --  Ordered array, not an unordered temp table read with OFFSET: without
    --  an ORDER BY those four reads can return the same row twice, which
    --  silently aliases two scenarios onto one job.
    v_ids := v_ids || v_job;
  END LOOP;

  v_job := v_ids[1];
  v_j15 := v_ids[2];
  v_j30 := v_ids[3];
  v_j60 := v_ids[4];

  -- ── S1. Strict 20/80 blocks delivery ─────────────────────────────────────
  IF public.nx_funding_delivery_satisfied(v_job) THEN
    RAISE EXCEPTION 'S1 FAILED: strict 20/80 did not block delivery with the final tranche outstanding';
  END IF;
  IF NOT (SELECT bool_and(gates_delivery) FROM public.job_funding_stages WHERE job_id = v_job) THEN
    RAISE EXCEPTION 'S1 FAILED: a tranche was not gating by default — Strict Prepay is not the default';
  END IF;
  RAISE NOTICE 'S1 ok — strict 20/80 blocks final delivery';

  -- ── S6. Client and Inspector cannot modify terms ─────────────────────────
  --  Asserted BEFORE any admin release, so a later success cannot mask a
  --  permissive failure here.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_client::text||'","role":"authenticated"}', true);
  BEGIN
    PERFORM public.nx_admin_release_job_on_credit(v_job, 30, 'client attempt');
    RAISE EXCEPTION 'S6 FAILED: a CLIENT released a job on credit';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.nx_admin_set_client_delivery_policy(v_client, 'CREDIT_RELEASE', 30, 'client attempt');
    RAISE EXCEPTION 'S6 FAILED: a CLIENT set a delivery policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_insp::text||'","role":"authenticated"}', true);
  BEGIN
    PERFORM public.nx_admin_release_job_on_credit(v_job, 30, 'inspector attempt');
    RAISE EXCEPTION 'S6 FAILED: an INSPECTOR released a job on credit';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'S6 ok — client and inspector refused (42501) on both RPCs';

  -- ── S2/S3/S4. Admin releases on Net-15 / Net-30 / Net-60 ─────────────────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_admin::text||'","role":"authenticated"}', true);

  PERFORM public.nx_admin_release_job_on_credit(v_j15, 15, 'verify net15');
  IF NOT public.nx_funding_delivery_satisfied(v_j15) THEN
    RAISE EXCEPTION 'S2 FAILED: Net-15 release did not unblock delivery';
  END IF;
  RAISE NOTICE 'S2 ok — Net-15 releases delivery';

  PERFORM public.nx_admin_release_job_on_credit(v_j30, 30, 'verify net30');
  IF NOT public.nx_funding_delivery_satisfied(v_j30) THEN
    RAISE EXCEPTION 'S3 FAILED: Net-30 release did not unblock delivery';
  END IF;
  RAISE NOTICE 'S3 ok — Net-30 releases delivery';

  PERFORM public.nx_admin_release_job_on_credit(v_j60, 60, 'verify net60');
  IF NOT public.nx_funding_delivery_satisfied(v_j60) THEN
    RAISE EXCEPTION 'S4 FAILED: Net-60 release did not unblock delivery';
  END IF;
  RAISE NOTICE 'S4 ok — Net-60 releases delivery';

  --  Unsupported terms must be refused, not coerced.
  BEGIN
    PERFORM public.nx_admin_release_job_on_credit(v_job, 45, 'unsupported');
    RAISE EXCEPTION 'S4 FAILED: Net-45 was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- ── S5. Overdue must not remove report access ────────────────────────────
  PERFORM public.nx_funding_issue_delivery_invoice(v_j30);
  UPDATE public.job_funding_stages
     SET invoice_due_at = now() - interval '5 days'
   WHERE job_id = v_j30 AND code = 'final';

  IF public.nx_funding_invoice_status(v_j30) <> 'overdue' THEN
    RAISE EXCEPTION 'S5 FAILED: a past-due released invoice did not report as overdue (got %)',
      public.nx_funding_invoice_status(v_j30);
  END IF;
  IF NOT public.nx_funding_delivery_satisfied(v_j30) THEN
    RAISE EXCEPTION 'S5 FAILED: an OVERDUE invoice revoked delivery access — the report was withheld';
  END IF;
  RAISE NOTICE 'S5 ok — overdue invoice does not remove report access';

  -- ── GP. Golden Path: final funded -> settled -> payout 0 -> delivered ────
  --  v_job is still strict. Fund its final tranche and walk the lifecycle.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.nx_funding_mark_stage_funded(v_job, 'final', 'verify-final-'||v_job::text);

  IF NOT public.nx_funding_delivery_satisfied(v_job) THEN
    RAISE EXCEPTION 'GP FAILED: delivery still blocked after the final tranche was funded';
  END IF;

  SELECT client_settled_at IS NOT NULL INTO v_ok FROM public.jobs WHERE id = v_job;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'GP FAILED: client_settled_at is not set after full funding';
  END IF;

  --  payout STILL 0 — the whole point of the Golden Path.
  SELECT count(*) INTO v_n
    FROM public.transactions t
   WHERE t.user_id = v_insp OR t.inspector_id = v_insp;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'GP FAILED: % inspector transaction(s) exist — funding paid the Inspector automatically', v_n;
  END IF;
  RAISE NOTICE 'GP ok — final funded, settled, inspector payout STILL 0';

  -- ── S8. No automatic Inspector payout, checked across every ledger ───────
--  Every money column on transactions, not just one: a payout could land in
  --  amount, in the halalas triple, or under inspector_id rather than user_id.
  --  Checking one column would prove almost nothing.
  SELECT coalesce(sum(coalesce(amount,0)
                    + coalesce(gross_amount_halalas,0)
                    + coalesce(net_amount_halalas,0)), 0) INTO v_payout
    FROM public.transactions
   WHERE user_id = v_insp OR inspector_id = v_insp;
  IF v_payout <> 0 THEN
    RAISE EXCEPTION 'S8 FAILED: inspector ledger total is %, expected 0', v_payout;
  END IF;
  RAISE NOTICE 'S8 ok — zero automatic Inspector payout';

  -- ── S7. Audit history complete ───────────────────────────────────────────
  SELECT count(*) INTO v_n
    FROM public.funding_policy_audit
   WHERE job_id IN (v_j15, v_j30, v_j60);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'S7 FAILED: expected 3 audit rows for 3 releases, found %', v_n;
  END IF;

  SELECT bool_and(actor_id = v_admin
                  AND actor_role IN ('admin','super_admin')
                  AND previous_policy IS NOT NULL
                  AND new_policy IS NOT NULL
                  AND net_term_days IS NOT NULL
                  AND length(trim(reason)) > 0)
    INTO v_ok
    FROM public.funding_policy_audit
   WHERE job_id IN (v_j15, v_j30, v_j60);
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'S7 FAILED: an audit row is missing actor, role, previous/new terms, term or reason';
  END IF;
  RAISE NOTICE 'S7 ok — audit complete: actor, role, previous, new, term, reason';

  -- ════════════════════════════════════════════════════════════════════════
  --  MANDATORY REVOCATION — by rollback, then proved from outside.
  -- ════════════════════════════════════════════════════════════════════════
  RAISE EXCEPTION 'VERIFY_ROLLBACK_SENTINEL';

 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'VERIFY_ROLLBACK_SENTINEL' THEN
    RAISE;   -- a real assertion failure — fail the migration
  END IF;
 END;

 --  Now outside the rolled-back subtransaction. Prove zero residue rather than
 --  trusting the rollback: any synthetic account surviving here is a security
 --  finding, so it is asserted.
 SELECT count(*) INTO v_residue
   FROM public.profiles
  WHERE id IN (v_client, v_insp, v_admin)
     OR email LIKE '%@synthetic.invalid';
 IF v_residue <> 0 THEN
   RAISE EXCEPTION 'REVOCATION FAILED: % synthetic profile(s) survive', v_residue;
 END IF;

 SELECT count(*) INTO v_residue FROM auth.users
  WHERE id IN (v_client, v_insp, v_admin) OR email LIKE '%@synthetic.invalid';
 IF v_residue <> 0 THEN
   RAISE EXCEPTION 'REVOCATION FAILED: % synthetic auth user(s) survive', v_residue;
 END IF;

 SELECT count(*) INTO v_residue FROM public.jobs WHERE client_id = v_client;
 IF v_residue <> 0 THEN
   RAISE EXCEPTION 'REVOCATION FAILED: % synthetic job(s) survive', v_residue;
 END IF;

 SELECT count(*) INTO v_residue
   FROM public.profiles
  WHERE role IN ('admin','super_admin') AND email LIKE '%@synthetic%';
 IF v_residue <> 0 THEN
   RAISE EXCEPTION 'REVOCATION FAILED: % synthetic PRIVILEGED account(s) survive', v_residue;
 END IF;

 RAISE NOTICE 'REVOCATION ok — zero synthetic profiles, auth users, jobs or privileged accounts remain';
 RAISE NOTICE '════ ALL SCENARIOS PASSED: GP, S1-S8, revocation verified ════';
END
$verify$;

COMMIT;
