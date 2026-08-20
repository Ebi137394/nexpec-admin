-- ════════════════════════════════════════════════════════════════════════════
--  20260801584000_pending_verification_account_state.sql
--
--  OWNER POLICY: a signup may CHOOSE its account type, but choosing it does not
--  confer it. Inspectors, agencies and suppliers arrive PENDING. They may build
--  out a profile and upload verification documents, and nothing else, until an
--  Admin activates them.
--
--  ── WHY A NEW COLUMN AND NOT verification_status ───────────────────────────
--  profiles already carries verification_status ('unverified' by default) and
--  is_verified. Those describe whether someone's DOCUMENTS have been checked.
--  Overloading them with "may this account transact" would have locked out live
--  Production users the moment this shipped: of the 18 accounts on Production,
--  3 inspectors, 1 agency and 1 supplier are still 'unverified' while trading
--  normally. marketplace_activated is a separate, single-purpose fact, which
--  makes the grandfather backfill below unambiguous.
--
--  ── PRESERVING EXISTING USERS ──────────────────────────────────────────────
--  Every profile that exists when this migration runs is activated. The policy
--  is not retroactive: nobody who is working today stops working tomorrow. Only
--  accounts created after this point start pending.
--
--  ── WHICH ROLES ARE GATED ──────────────────────────────────────────────────
--  inspector, agency, supplier — the roles the owner enumerated as
--  pending-restricted. 'client' is NOT gated: gating buyers would close the
--  entire demand side of the marketplace behind manual review, which the policy
--  does not ask for. nx_role_requires_activation() is the single place that
--  decision lives, so adding 'client' later is a one-line change.
--
--  ── ENFORCEMENT IS BY TRIGGER, NOT BY RLS ──────────────────────────────────
--  Same reasoning as the email gate in 20260801582000: most write paths run
--  through SECURITY DEFINER RPCs, which bypass RLS entirely. A trigger fires
--  for those too, so the boundary cannot be stepped around by calling an RPC.
--  Reads are deliberately left open — a pending inspector can still browse the
--  marketplace and see what they are missing; they simply cannot act. They also
--  own no applications, contracts, reports or earnings, so the ownership-based
--  read policies already return them nothing.
--
--  ── SUPPORT STAYS OPEN ─────────────────────────────────────────────────────
--  A pending user must be able to ask why they are pending. The admin and
--  help-support conversation lanes are exempt; the commercial lanes are not.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The fact ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketplace_activated boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketplace_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketplace_activated_by uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.profiles.marketplace_activated IS
  'Admin has activated this account for marketplace participation. Roles listed by nx_role_requires_activation() cannot apply, post, contract, report or chat commercially until this is true. Set only by admin_set_marketplace_activation().';

--  Grandfather everyone who already exists. Runs once: after this migration the
--  column default (false) governs every new row.
UPDATE public.profiles
   SET marketplace_activated    = true,
       marketplace_activated_at = COALESCE(marketplace_activated_at, now())
 WHERE marketplace_activated = false;

-- ── 2. The predicates ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_role_requires_activation(p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_role IN ('inspector', 'agency', 'supplier');
$fn$;

COMMENT ON FUNCTION public.nx_role_requires_activation(text) IS
  'Single source of truth for which self-selected roles arrive pending Admin activation.';

CREATE OR REPLACE FUNCTION public.nx_account_activated(p_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(
    (SELECT NOT public.nx_role_requires_activation(p.role) OR p.marketplace_activated
       FROM public.profiles p WHERE p.id = p_uid),
    false);
$fn$;

COMMENT ON FUNCTION public.nx_account_activated(uuid) IS
  'True when the account may participate commercially: either its role needs no activation, or an Admin has activated it.';

-- ── 3. The boundary ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_require_account_activated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  --  No JWT: service role, cron, edge function. Not a user action.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.nx_is_admin() THEN RETURN NEW; END IF;
  IF public.nx_account_activated() THEN RETURN NEW; END IF;

  RAISE EXCEPTION
    'ACCOUNT_PENDING_VERIFICATION: your account is awaiting NEXPEC verification. You can complete your profile and upload documents; applying, posting, contracting, reporting and finance unlock once an administrator approves you.'
    USING ERRCODE = '42501';
END;
$fn$;

--  Commercial chat only. A pending user must still be able to reach support.
CREATE OR REPLACE FUNCTION public.nx_require_account_activated_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_kind text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.nx_is_admin() THEN RETURN NEW; END IF;
  IF public.nx_account_activated() THEN RETURN NEW; END IF;

  SELECT kind::text INTO v_kind FROM public.conversations WHERE id = NEW.conversation_id;
  --  Admin and help-support lanes stay open: asking why you are pending is not
  --  marketplace participation.
  IF v_kind IN ('help_support','job_client_admin','job_inspector_admin','job_supplier_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ACCOUNT_PENDING_VERIFICATION: commercial messaging unlocks once an administrator approves your account. You can still message NEXPEC support.'
    USING ERRCODE = '42501';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_activated_applications ON public.applications;
CREATE TRIGGER trg_activated_applications BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_account_activated();

DROP TRIGGER IF EXISTS trg_activated_jobs ON public.jobs;
CREATE TRIGGER trg_activated_jobs BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_account_activated();

DROP TRIGGER IF EXISTS trg_activated_reports ON public.inspection_reports;
CREATE TRIGGER trg_activated_reports BEFORE INSERT ON public.inspection_reports
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_account_activated();

DROP TRIGGER IF EXISTS trg_activated_contract_sign ON public.job_contracts;
CREATE TRIGGER trg_activated_contract_sign BEFORE UPDATE ON public.job_contracts
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_account_activated();

DROP TRIGGER IF EXISTS trg_activated_messages ON public.messages;
CREATE TRIGGER trg_activated_messages BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_account_activated_message();

-- ── 4. Only an Admin may activate ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_marketplace_activation(
  p_user      uuid,
  p_activated boolean,
  p_reason    text DEFAULT NULL
) RETURNS TABLE(user_id uuid, activated boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_role  text;
  v_was   boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.nx_is_admin(v_actor) THEN
    RAISE EXCEPTION 'ACTIVATION_DENIED: only Admin or Super Admin may activate an account'
      USING ERRCODE = '42501';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required' USING ERRCODE = '22000';
  END IF;

  SELECT role, marketplace_activated INTO v_role, v_was
    FROM public.profiles WHERE id = p_user;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles
     SET marketplace_activated    = p_activated,
         marketplace_activated_at = CASE WHEN p_activated THEN now() ELSE NULL END,
         marketplace_activated_by = CASE WHEN p_activated THEN v_actor ELSE NULL END
   WHERE id = p_user;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, actor_role, subject_table, subject_id, summary, delta)
  VALUES (
    CASE WHEN p_activated THEN 'account.activated' ELSE 'account.deactivated' END,
    'info', v_actor,
    (SELECT role FROM public.profiles WHERE id = v_actor),
    'profiles', p_user,
    CASE WHEN p_activated
         THEN 'Account activated for marketplace participation'
         ELSE 'Marketplace activation withdrawn' END,
    jsonb_build_object('role', v_role, 'from', v_was, 'to', p_activated, 'reason', p_reason));

  RETURN QUERY SELECT p_user, p_activated;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_set_marketplace_activation(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_marketplace_activation(uuid, boolean, text) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.nx_account_activated(uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_role_requires_activation(text)   TO authenticated, service_role;

-- ── 5. SELFTEST — runs wherever applied, rolls itself back ─────────────────
DO $verify$
DECLARE
  v_ins   uuid := gen_random_uuid();
  v_cli   uuid := gen_random_uuid();
  v_adm   uuid := gen_random_uuid();
  v_job   uuid := gen_random_uuid();
  v_conv  uuid := gen_random_uuid();
  v_sup   uuid := gen_random_uuid();
  v_n     int;
  v_ok    boolean;
  v_err   text;
BEGIN
  -- every pre-existing account must have been preserved
  SELECT count(*) INTO v_n FROM public.profiles WHERE NOT marketplace_activated;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'BACKFILL FAILED: % existing profile(s) left deactivated', v_n;
  END IF;

  BEGIN
    -- '.invalid' is skipped by handle_new_user, so these rows are ours to shape
    INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'pv.'||u::text||'@synthetic.invalid', now(), now(), now()
      FROM unnest(ARRAY[v_ins, v_cli, v_adm]) u;

    INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
      (v_ins,'inspector',  'PV Inspector','pv.i@synthetic.invalid', true),
      (v_cli,'client',     'PV Client',   'pv.c@synthetic.invalid', true),
      (v_adm,'super_admin','PV Admin',    'pv.a@synthetic.invalid', true);

    -- a brand-new gated account is PENDING (the column default, not the backfill)
    IF (SELECT marketplace_activated FROM public.profiles WHERE id = v_ins) THEN
      RAISE EXCEPTION 'P1 FAILED: a new inspector was activated automatically';
    END IF;
    IF public.nx_account_activated(v_ins) THEN
      RAISE EXCEPTION 'P2 FAILED: nx_account_activated() true for a pending inspector';
    END IF;
    -- a client is not gated at all
    IF NOT public.nx_account_activated(v_cli) THEN
      RAISE EXCEPTION 'P3 FAILED: a client was gated — clients are not pending-restricted';
    END IF;

    -- the client posts a job (ungated) so the inspector has something to apply to
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_cli::text||'","role":"authenticated"}', true);
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents)
    VALUES (v_job,'pv job',v_cli,'open','approved','prepay',100000,80000);

    -- ── the pending inspector is refused, by every route ──────────────────
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_ins::text||'","role":"authenticated"}', true);

    v_ok := false;
    BEGIN
      INSERT INTO public.applications (id, job_id, applicant_id, status, bid_amount_cents)
      VALUES (gen_random_uuid(), v_job, v_ins, 'pending', 80000);
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_ok THEN RAISE EXCEPTION 'P4 FAILED: a pending inspector applied to a job'; END IF;
    IF v_err NOT LIKE 'ACCOUNT_PENDING_VERIFICATION%' THEN
      RAISE EXCEPTION 'P4 FAILED: wrong refusal for apply: %', v_err;
    END IF;

    v_ok := false;
    BEGIN
      INSERT INTO public.inspection_reports (id, job_id, inspector_id, notes, status)
      VALUES (gen_random_uuid(), v_job, v_ins, 'pv report', 'draft');
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'P5 FAILED: a pending inspector submitted a report'; END IF;

    v_ok := false;
    BEGIN
      INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                               client_price_cents,inspector_payout_cents)
      VALUES (gen_random_uuid(),'pv posted by pending',v_cli,'open','approved','prepay',1000,800);
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'P6 FAILED: a pending account posted a job'; END IF;

    -- ── but support stays reachable, and the profile stays editable ───────
    PERFORM set_config('request.jwt.claims','', true);
    INSERT INTO public.conversations (id, kind, user_id, title, status)
    VALUES (v_conv, 'help_support', v_ins, 'pv support', 'open');
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_ins::text||'","role":"authenticated"}', true);

    v_ok := false;
    BEGIN
      INSERT INTO public.messages (conversation_id, sender_id, content)
      VALUES (v_conv, v_ins, 'why is my account pending?');
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'P7 FAILED: a pending inspector could not reach support: %', v_err;
    END IF;

    UPDATE public.profiles SET full_name = 'PV Inspector (updated)' WHERE id = v_ins;
    IF (SELECT full_name FROM public.profiles WHERE id = v_ins) <> 'PV Inspector (updated)' THEN
      RAISE EXCEPTION 'P8 FAILED: a pending inspector could not complete their profile';
    END IF;

    -- ── a non-admin cannot activate anyone, including themselves ──────────
    v_ok := false;
    BEGIN
      PERFORM public.admin_set_marketplace_activation(v_ins, true, 'self-serve');
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_ok THEN RAISE EXCEPTION 'P9 FAILED: a pending inspector activated itself'; END IF;
    IF v_err NOT LIKE 'ACTIVATION_DENIED%' THEN
      RAISE EXCEPTION 'P9 FAILED: wrong refusal for self-activation: %', v_err;
    END IF;

    -- ── the Admin activates, and the same actions now succeed ─────────────
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_adm::text||'","role":"authenticated"}', true);
    PERFORM public.admin_set_marketplace_activation(v_ins, true, 'documents verified');

    IF NOT public.nx_account_activated(v_ins) THEN
      RAISE EXCEPTION 'P10 FAILED: activation did not take effect';
    END IF;
    SELECT count(*) INTO v_n FROM public.audit_events
     WHERE event_type = 'account.activated' AND subject_id = v_ins;
    IF v_n <> 1 THEN RAISE EXCEPTION 'P11 FAILED: activation was not audited (% rows)', v_n; END IF;

    PERFORM set_config('request.jwt.claims','{"sub":"'||v_ins::text||'","role":"authenticated"}', true);
    INSERT INTO public.applications (id, job_id, applicant_id, status, bid_amount_cents)
    VALUES (gen_random_uuid(), v_job, v_ins, 'pending', 80000);

    -- ── signup can never mint an administrator ────────────────────────────
    PERFORM set_config('request.jwt.claims','', true);
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    VALUES (v_sup,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'pv.sup.'||v_sup::text||'@nexpec-verify.example.com',
            jsonb_build_object('role','super_admin','full_name','Not An Admin'), now(), now());
    IF (SELECT role FROM public.profiles WHERE id = v_sup) <> 'client' THEN
      RAISE EXCEPTION 'P12 FAILED: signup metadata minted role %',
        (SELECT role FROM public.profiles WHERE id = v_sup);
    END IF;

    RAISE EXCEPTION 'VERIFY_ROLLBACK_SENTINEL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'VERIFY_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims','', true);
  SELECT count(*) INTO v_n FROM public.profiles WHERE id IN (v_ins, v_cli, v_adm, v_sup);
  IF v_n <> 0 THEN RAISE EXCEPTION 'REVOCATION FAILED: % synthetic profile(s) survive', v_n; END IF;
  SELECT count(*) INTO v_n FROM auth.users WHERE id IN (v_ins, v_cli, v_adm, v_sup);
  IF v_n <> 0 THEN RAISE EXCEPTION 'REVOCATION FAILED: % synthetic auth user(s) survive', v_n; END IF;

  RAISE NOTICE '════ pending-verification state proved: new gated accounts refused on apply/post/report/commercial-chat, support and profile open, only Admin activates, signup cannot mint an admin, existing users preserved ════';
END
$verify$;

COMMIT;
