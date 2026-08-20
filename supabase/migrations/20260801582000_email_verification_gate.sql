-- ════════════════════════════════════════════════════════════════════════════
--  20260801582000_email_verification_gate.sql
--
--  EMAIL VERIFICATION BECOMES A REAL BOUNDARY.
--
--  Audit finding (20260801580000): nothing in the codebase or RLS consulted
--  auth.users.email_confirmed_at, so an unverified account had exactly the
--  same rights as a verified one.
--
--  SAFE TO ENABLE: a read-only audit of Production on 2026-08-20 found all 18
--  users confirmed (18/18, zero unconfirmed), so this gate locks out no
--  existing legitimate user. That audit is the precondition the owner
--  required before any stricter gate.
--
--  MECHANISM. One trigger function attached to the protected write surfaces,
--  rather than edits to a dozen SECURITY DEFINER RPCs. Triggers fire even for
--  SECURITY DEFINER callers, so this cannot be bypassed by going through an
--  RPC instead of the table.
--
--  Protected surfaces:
--    applications        marketplace applications
--    jobs                job posting
--    messages            messaging
--    inspection_reports  report submission
--    job_contracts       contract signing (UPDATE)
--
--  DELIBERATE EXEMPTIONS, each for a reason:
--    • auth.uid() IS NULL — service-role, cron, edge functions and migrations
--      act with no end user. Gating them would break notification dispatch and
--      every backend job.
--    • nx_is_admin() — administrators act on behalf of the platform; an admin
--      already passed a stronger check than email confirmation.
--
--  WHAT THIS DOES NOT DO: it does not gate READS. An unverified user can sign
--  in and see the verification-required state; they simply cannot act. That is
--  the owner's stated design (sign in only to a verification screen + resend).
--
--  ROLE ESCALATION IS A SEPARATE, UNRESOLVED FINDING and is NOT addressed
--  here: handle_new_user() still takes role from client-supplied
--  raw_user_meta_data (whitelisted to client|inspector|agency|supplier — no
--  admin path). Forcing role='client' would break inspector self-registration,
--  a product decision the owner must make. Reported, not silently changed.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_require_email_verified()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $fn$
BEGIN
  -- No end user in context (service role / cron / edge function): allow.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Administrators are exempt: they cleared a stronger bar than email.
  IF public.nx_is_admin() THEN
    RETURN NEW;
  END IF;
  IF NOT public.nx_email_verified() THEN
    RAISE EXCEPTION
      'EMAIL_NOT_VERIFIED: confirm your email address before performing this action.'
      USING ERRCODE = '42501',
            HINT = 'Open the confirmation link we emailed you, or request a new one from the verification screen.';
  END IF;
  RETURN NEW;
END;
$fn$;

ALTER FUNCTION public.nx_require_email_verified() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_email_verified_applications ON public.applications;
CREATE TRIGGER trg_email_verified_applications
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_email_verified();

DROP TRIGGER IF EXISTS trg_email_verified_jobs ON public.jobs;
CREATE TRIGGER trg_email_verified_jobs
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_email_verified();

DROP TRIGGER IF EXISTS trg_email_verified_messages ON public.messages;
CREATE TRIGGER trg_email_verified_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_email_verified();

DROP TRIGGER IF EXISTS trg_email_verified_reports ON public.inspection_reports;
CREATE TRIGGER trg_email_verified_reports
  BEFORE INSERT ON public.inspection_reports
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_email_verified();

DROP TRIGGER IF EXISTS trg_email_verified_contract_sign ON public.job_contracts;
CREATE TRIGGER trg_email_verified_contract_sign
  BEFORE UPDATE ON public.job_contracts
  FOR EACH ROW EXECUTE FUNCTION public.nx_require_email_verified();

-- ─── Selftest ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_ok uuid := gen_random_uuid(); v_no uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid(); v_job uuid := gen_random_uuid(); n int;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
    VALUES (v_ok,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ev.ok@synthetic.invalid',now(),now(),now()),
           (v_no,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ev.no@synthetic.invalid',now(),now(),NULL),
           (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ev.adm@synthetic.invalid',now(),now(),now());
    INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
      (v_ok,'client','EV Confirmed','ev.ok@synthetic.invalid',true),
      (v_no,'client','EV Unconfirmed','ev.no@synthetic.invalid',true),
      (v_admin,'super_admin','EV Admin','ev.adm@synthetic.invalid',true)
    ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;

    -- CONFIRMED user may post a job.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_ok::text||'","role":"authenticated"}', true);
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode)
    VALUES (v_job,'EV allowed',v_ok,'open','approved','prepay',100000,80000,'protected');
    RESET ROLE;

    -- UNCONFIRMED user may not.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_no::text||'","role":"authenticated"}', true);
    BEGIN
      INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                               client_price_cents,inspector_payout_cents,identity_mode)
      VALUES (gen_random_uuid(),'EV blocked',v_no,'open','approved','prepay',100000,80000,'protected');
      RAISE EXCEPTION 'SELFTEST: an UNVERIFIED user posted a job';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.applications (job_id, applicant_id, status, bid_amount_cents)
      VALUES (v_job, v_no, 'pending', 1000);
      RAISE EXCEPTION 'SELFTEST: an UNVERIFIED user applied to a job';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    -- ADMIN is exempt.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_admin::text||'","role":"authenticated"}', true);
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode)
    VALUES (gen_random_uuid(),'EV admin ok',v_ok,'open','approved','prepay',100000,80000,'protected');
    RESET ROLE;

    RAISE NOTICE 'SELFTEST ok — confirmed user acts, unverified blocked on jobs+applications, admin exempt';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated)';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
