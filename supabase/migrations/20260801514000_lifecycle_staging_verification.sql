-- ════════════════════════════════════════════════════════════════════════════
--  20260801514000_lifecycle_staging_verification.sql
--
--  The 18-requirement marketplace lifecycle, proved SERVER-SIDE wherever this
--  is applied — including NEXPEC-Staging.
--
--  pgTAP proves it locally; it cannot reach Staging, because the pooler stores
--  no password and there is no psql route from the workstation. A migration is
--  that route: it executes on the server, in one transaction, and its RAISEs
--  are the assertions.
--
--  ── SELF-CLEANING BY CONSTRUCTION ──────────────────────────────────────────
--  All work runs in a plpgsql subtransaction that always rolls back, so no
--  synthetic row can survive — not by DELETE, which cannot work here anyway:
--  nx_active_super_admin_count refuses to let the privileged population reach
--  zero, so a synthetic admin created on a database that had none could never
--  be removed. Rolling back honours that guard instead of disabling it.
--  Residue is then ASSERTED from outside the subtransaction, not assumed.
--
--  Real assertion failures still fail the migration: only the sentinel is
--  swallowed, everything else is re-raised.
--
--  NO REAL MONEY. Nothing here touches Stripe, a wallet, an earning or a
--  payout; it exercises the lifecycle state machine only.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $verify$
DECLARE
  v_cl    uuid := 'fade0000-0000-4000-8000-000000000001';
  v_in    uuid := 'fade0000-0000-4000-8000-000000000002';
  v_ad    uuid := 'fade0000-0000-4000-8000-000000000003';
  v_cl2   uuid := 'fade0000-0000-4000-8000-000000000004';
  v_job   uuid := 'fade0000-0000-4000-8000-00000000000a';
  v_app   uuid := 'fade0000-0000-4000-8000-00000000000b';
  v_con   uuid;
  v_n     int;
  v_ok    boolean;
  v_res   int;
BEGIN
 BEGIN
  -- ── actors: separate Client, Inspector, Admin (+ an unrelated Client) ────
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'lc.'||u::text||'@synthetic.invalid', now(), now()
    FROM unnest(ARRAY[v_cl,v_in,v_ad,v_cl2]) u;
  INSERT INTO public.profiles (id, role, full_name, email, is_verified, phone) VALUES
    (v_cl ,'client'   ,'LC Client'   ,'lc.client@synthetic.invalid' ,true,'+15551101'),
    (v_in ,'inspector','Dana Weld'   ,'lc.insp@synthetic.invalid'   ,true,'+15551102'),
    (v_ad ,'admin'    ,'LC Admin'    ,'lc.admin@synthetic.invalid'  ,true,'+15551103'),
    (v_cl2,'client'   ,'Other Client','lc.other@synthetic.invalid'  ,true,'+15551104');

  -- ── 1. Client creates the job UNASSIGNED ─────────────────────────────────
  INSERT INTO public.jobs (id,title,client_id,status,moderation_status,
                           payment_mode,client_price_cents,inspector_payout_cents)
  VALUES (v_job,'LC lifecycle job',v_cl,'open','approved','prepay',100000,70000);

  -- ── R1. Inspector applies ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_in::text||'","role":"authenticated"}', true);
  INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents,cover_note)
  VALUES (v_app,v_job,v_in,'pending',68000,'CSWIP 3.1, 9 years refinery NDT');
  RAISE NOTICE 'R1 ok — inspector submitted an application';

  -- ── R4/R5. Client and an unrelated Client cannot see it (DIFFERENTIAL) ───
  --  Proved as authenticated with each subject's claims, then re-read with
  --  privilege. A bare zero as the actor would also pass if the row had never
  --  been created.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_cl::text||'","role":"authenticated"}', true);
  SELECT count(*) INTO v_n FROM public.applications WHERE job_id = v_job;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R4 FAILED: the Client saw % unforwarded application(s)', v_n;
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_cl2::text||'","role":"authenticated"}', true);
  SELECT count(*) INTO v_n FROM public.applications WHERE job_id = v_job;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R5 FAILED: an unrelated Client saw % application(s)', v_n;
  END IF;
  RESET ROLE;

  SELECT count(*) INTO v_n FROM public.applications WHERE id = v_app;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R4/R5 DIFFERENTIAL FAILED: the application does not exist, so invisibility proved nothing';
  END IF;
  RAISE NOTICE 'R4/R5 ok — invisible to both Clients, and the row provably exists';

  -- ── R3. Admin sees it immediately ────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_ad::text||'","role":"authenticated"}', true);
  SELECT count(*) INTO v_n FROM public.applications WHERE id = v_app;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R3 FAILED: the Admin cannot see the application';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'R3 ok — admin sees the application with no forwarding';

  -- ── R7. Counter-offer negotiation, private to Inspector and Admin ────────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_ad::text||'","role":"authenticated"}', true);
  PERFORM public.admin_counter_application(v_app, 72000::bigint, 'Night shift scope');

  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_in::text||'","role":"authenticated"}', true);
  PERFORM public.inspector_respond_to_counter(v_app, 'accepted', 'Agreed');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_cl::text||'","role":"authenticated"}', true);
  SELECT count(*) INTO v_n FROM public.applications
   WHERE job_id = v_job AND admin_counter_cents IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R7 FAILED: the Client can see the Inspector/Admin negotiation';
  END IF;
  RESET ROLE;
  IF (SELECT admin_counter_cents FROM public.applications WHERE id = v_app) IS NULL THEN
    RAISE EXCEPTION 'R7 DIFFERENTIAL FAILED: no counter-offer was recorded, so privacy proved nothing';
  END IF;
  RAISE NOTICE 'R7 ok — negotiation recorded and private to inspector/admin';

  -- ── R6. The generic notification leaks no identity ───────────────────────
  SELECT count(*) INTO v_n FROM public.notifications n
   WHERE n.recipient_id = v_cl
     AND (n.title||' '||coalesce(n.body,'')||' '||coalesce(n.data::text,''))
         ~* '(Dana Weld|lc\.insp@synthetic\.invalid|\+15551102)';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R6 FAILED: % client notification(s) leak the inspector identity', v_n;
  END IF;
  RAISE NOTICE 'R6 ok — no client notification leaks inspector name, email or phone';

  -- ── R8. Only the Admin may forward ───────────────────────────────────────
  v_ok := false;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_cl::text||'","role":"authenticated"}', true);
  BEGIN
    PERFORM public.admin_forward_application_to_client(v_app);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'R8 FAILED: a Client forwarded an application to itself'; END IF;

  v_ok := false;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_in::text||'","role":"authenticated"}', true);
  BEGIN
    PERFORM public.admin_forward_application_to_client(v_app);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF v_ok THEN RAISE EXCEPTION 'R8 FAILED: an Inspector forwarded their own application'; END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_ad::text||'","role":"authenticated"}', true);
  PERFORM public.admin_forward_application_to_client(v_app);
  RAISE NOTICE 'R8 ok — only the admin can forward';

  -- ── R9. Only after forwarding does the Client see it ─────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_cl::text||'","role":"authenticated"}', true);
  SELECT count(*) INTO v_n FROM public.applications WHERE job_id = v_job;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R9 FAILED: the Client sees % applications after forwarding (expected 1)', v_n;
  END IF;
  --  …and still cannot read the inspector's contact details.
  SELECT count(*) INTO v_n FROM public.profiles
   WHERE id = v_in AND (email IS NOT NULL OR phone IS NOT NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R9 FAILED: the Client can read the inspector email/phone — brokered identity broken';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'R9 ok — client sees the forwarded application, contact details still withheld';

  -- ── R10. Client selection does NOT assign ────────────────────────────────
  UPDATE public.applications SET status = 'CLIENT_SELECTED' WHERE id = v_app;
  IF (SELECT contractor_id FROM public.jobs WHERE id = v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'R10 FAILED: client selection assigned a contractor';
  END IF;
  IF (SELECT status FROM public.jobs WHERE id = v_job) <> 'open' THEN
    RAISE EXCEPTION 'R10 FAILED: client selection moved the job out of open';
  END IF;
  RAISE NOTICE 'R10 ok — client selection does not assign or dispatch';

  -- ── R11/R12/R13. Contract generated, both signatures, fully_executed ─────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_ad::text||'","role":"authenticated"}', true);
  PERFORM public.admin_generate_job_contract(v_app, 100000, 70000, 'lifecycle terms', NULL);
  SELECT id INTO v_con FROM public.job_contracts
   WHERE job_id = v_job AND voided_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v_con IS NULL THEN RAISE EXCEPTION 'R11 FAILED: no contract was generated'; END IF;
  IF (SELECT status FROM public.job_contracts WHERE id = v_con) <> 'pending_client_signature' THEN
    RAISE EXCEPTION 'R11 FAILED: a freshly generated contract is not pending_client_signature';
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_cl::text||'","role":"authenticated"}', true);
  PERFORM public.client_sign_job_contract(v_con, 'LC Client', '127.0.0.1');
  IF (SELECT status FROM public.job_contracts WHERE id = v_con) <> 'pending_inspector_signature' THEN
    RAISE EXCEPTION 'R12 FAILED: the client signature did not advance the contract';
  END IF;
  --  …and signing did not dispatch.
  IF (SELECT contractor_id FROM public.jobs WHERE id = v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'R12 FAILED: the client signature assigned a contractor';
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_in::text||'","role":"authenticated"}', true);
  PERFORM public.inspector_sign_job_contract(v_con, 'Dana Weld', '127.0.0.1');
  IF (SELECT status FROM public.job_contracts WHERE id = v_con) <> 'fully_executed' THEN
    RAISE EXCEPTION 'R13 FAILED: both signatures did not produce fully_executed';
  END IF;
  IF NOT (SELECT client_signed_at IS NOT NULL AND inspector_signed_at IS NOT NULL
            AND client_signed_name IS NOT NULL AND inspector_signed_name IS NOT NULL
            FROM public.job_contracts WHERE id = v_con) THEN
    RAISE EXCEPTION 'R12 FAILED: a signature is missing its signer name or timestamp';
  END IF;
  RAISE NOTICE 'R11/R12/R13 ok — contract generated, both signatures genuine, fully_executed';

  -- ── R14. Contract execution did not start work ───────────────────────────
  IF (SELECT status FROM public.jobs WHERE id = v_job) <> 'open' THEN
    RAISE EXCEPTION 'R14 FAILED: contract execution moved the job out of open';
  END IF;
  RAISE NOTICE 'R14 ok — work has not begun; execution alone does not dispatch';

  -- ── R15. Dispatch refused before the initial 20% funding ─────────────────
  v_ok := false;
  BEGIN
    UPDATE public.jobs SET status='assigned', contractor_id=v_in WHERE id=v_job;
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'R15 FAILED: dispatch succeeded before the initial 20%% funding';
  END IF;
  RAISE NOTICE 'R15 ok — dispatch refused before initial funding, even with an executed contract';

  -- ── R16. Admin dispatch succeeds once every prerequisite holds ───────────
  PERFORM set_config('request.jwt.claims','',true);            -- platform standing
  PERFORM public.settle_client_payment(v_job);

  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_ad::text||'","role":"authenticated"}', true);
  PERFORM public.admin_dispatch_job(v_job, v_app, 100000::bigint, 70000::bigint);
  RAISE NOTICE 'R16 ok — admin dispatched with selection, executed contract and funding all satisfied';

  -- ── R17. Active Assignment for the selected Inspector ────────────────────
  IF (SELECT contractor_id FROM public.jobs WHERE id = v_job) IS DISTINCT FROM v_in THEN
    RAISE EXCEPTION 'R17 FAILED: the job is not assigned to the selected inspector';
  END IF;
  IF (SELECT status FROM public.jobs WHERE id = v_job) <> 'assigned' THEN
    RAISE EXCEPTION 'R17 FAILED: the job status is not assigned';
  END IF;
  RAISE NOTICE 'R17 ok — the selected inspector has an active assignment';

  -- ── R18. Nothing paid the Inspector ──────────────────────────────────────
  SELECT coalesce(sum(coalesce(amount,0)
                    + coalesce(gross_amount_halalas,0)
                    + coalesce(net_amount_halalas,0)),0) INTO v_n
    FROM public.transactions WHERE user_id = v_in OR inspector_id = v_in;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'R18 FAILED: the inspector ledger total is %, expected 0', v_n;
  END IF;
  RAISE NOTICE 'R18 ok — zero automatic inspector credit or payout';

  -- ── Audit evidence ───────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.audit_events
   WHERE job_id = v_job AND actor_id IS NOT NULL;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'AUDIT FAILED: no actor-bearing audit event for the lifecycle';
  END IF;
  IF NOT (SELECT bool_and(created_at IS NOT NULL AND actor_role IS NOT NULL)
            FROM public.audit_events WHERE job_id = v_job AND actor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'AUDIT FAILED: an actor-bearing event lacks role or timestamp';
  END IF;
  RAISE NOTICE 'AUDIT ok — % actor-bearing events, all with role and timestamp', v_n;

  RAISE NOTICE '════ STAGING LIFECYCLE: R1-R18 + audit ALL PASSED ════';
  RAISE EXCEPTION 'LIFECYCLE_ROLLBACK_SENTINEL';

 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'LIFECYCLE_ROLLBACK_SENTINEL' THEN RAISE; END IF;
 END;

 -- ── revocation proved from outside the rolled-back subtransaction ─────────
 SELECT count(*) INTO v_res FROM public.profiles
  WHERE id IN (v_cl,v_in,v_ad,v_cl2) OR email LIKE '%@synthetic.invalid';
 IF v_res <> 0 THEN
   RAISE EXCEPTION 'RESIDUE: % synthetic profile(s) survive', v_res;
 END IF;
 SELECT count(*) INTO v_res FROM auth.users
  WHERE id IN (v_cl,v_in,v_ad,v_cl2) OR email LIKE '%@synthetic.invalid';
 IF v_res <> 0 THEN
   RAISE EXCEPTION 'RESIDUE: % synthetic auth user(s) survive', v_res;
 END IF;
 SELECT count(*) INTO v_res FROM public.profiles
  WHERE role IN ('admin','super_admin') AND email LIKE '%synthetic%';
 IF v_res <> 0 THEN
   RAISE EXCEPTION 'RESIDUE: % synthetic PRIVILEGED account(s) survive', v_res;
 END IF;
 SELECT count(*) INTO v_res FROM public.jobs WHERE id = v_job;
 IF v_res <> 0 THEN RAISE EXCEPTION 'RESIDUE: the synthetic job survives'; END IF;

 RAISE NOTICE 'RESIDUE ok — zero synthetic profiles, auth users, privileged accounts or jobs remain';
END
$verify$;

COMMIT;
