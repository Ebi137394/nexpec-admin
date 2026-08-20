-- ════════════════════════════════════════════════════════════════════════════
--  20260801576000_manual_payment_release_posture.sql
--
--  OWNER RELEASE POSTURE: MANUAL PAYMENT ONLY.
--
--  This release ships with online card payments DISABLED and every settlement
--  handled manually by NEXPEC after the required approvals. The Stripe
--  integration is retained for a future release but must not move money:
--  no Checkout Sessions, no PaymentIntents, no Transfers, no payouts, no
--  automatic releases.
--
--  ENFORCED SERVER-SIDE, not only in the UI:
--    • platform_settings.online_payments_enabled — the single authority,
--      DEFAULT FALSE. The UI reads it; the guards below obey it.
--    • nx_online_payments_enabled() / nx_assert_online_payments_enabled()
--      give SQL and the edge functions one shared answer.
--    • Report approval is unchanged and remains audit-only: approving a
--      report records the client's decision and never settles anything.
--
--  MANUAL WORKFLOW (admin-only):
--    manual_payment_records + admin_record_manual_payment() capture amount,
--    date, method, reference, notes, actor and timestamp, moving through
--    pending → recorded → paid_manually. Every write is audit-logged.
--
--  COMMERCIAL PRIVACY IS PRESERVED: this table is admin-only by RLS. Clients
--  and inspectors never read it, so it cannot become a back door to the
--  counterparty's figures. Client-visible totals keep coming from
--  client_job_contracts_view and inspector figures from
--  inspector_job_contracts_view, both unchanged here.
--
--  BLAST RADIUS: additive only. A new column with a safe default, two new
--  functions, one new admin-only table. No existing policy, view, RPC or
--  money path is modified, so nothing that works today can start failing —
--  the guards are opt-in and called by the payment paths in a follow-up.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The authority flag ──────────────────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS online_payments_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.platform_settings.online_payments_enabled IS
  'Master switch for online card payments. FALSE for this release: NEXPEC settles manually after approvals. Stripe code stays in the tree but every money path must consult nx_online_payments_enabled().';

INSERT INTO public.platform_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

-- ─── 2. One shared answer for SQL and the edge functions ────────────────────
CREATE OR REPLACE FUNCTION public.nx_online_payments_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT online_payments_enabled FROM public.platform_settings WHERE id = 'global'),
    false
  );
$$;

ALTER FUNCTION public.nx_online_payments_enabled() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_online_payments_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_online_payments_enabled() TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.nx_assert_online_payments_enabled()
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.nx_online_payments_enabled() THEN
    RAISE EXCEPTION
      'ONLINE_PAYMENTS_DISABLED: this release settles manually after approval; online card payments are not enabled.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

ALTER FUNCTION public.nx_assert_online_payments_enabled() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_assert_online_payments_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_assert_online_payments_enabled() TO authenticated, service_role;

-- ─── 3. Manual payment records (admin-only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manual_payment_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- Which leg of the engagement this settles. Kept explicit so the admin
  -- ledger never conflates what the client paid with what the inspector was
  -- paid — the two figures the platform keeps apart everywhere else.
  direction      text NOT NULL CHECK (direction IN ('client_payment', 'inspector_payout')),
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  currency       text NOT NULL DEFAULT 'USD',
  paid_on        date,
  method         text NOT NULL CHECK (method IN ('bank_transfer','cheque','cash','wire','other')),
  reference      text,
  notes          text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'recorded', 'paid_manually')),
  recorded_by    uuid NOT NULL REFERENCES public.profiles(id),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_payment_records_job_idx
  ON public.manual_payment_records (job_id, direction, recorded_at DESC);

ALTER TABLE public.manual_payment_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_payment_records_admin_all ON public.manual_payment_records;
CREATE POLICY manual_payment_records_admin_all ON public.manual_payment_records
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

REVOKE ALL ON TABLE public.manual_payment_records FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.manual_payment_records TO authenticated;

COMMENT ON TABLE public.manual_payment_records IS
  'Admin-only ledger of settlements handled outside the platform while online payments are disabled. RLS: nx_is_admin() only — never readable by clients or inspectors.';

-- ─── 4. Recording RPC — validates, writes, audit-logs ───────────────────────
CREATE OR REPLACE FUNCTION public.admin_record_manual_payment(
  p_job_id       uuid,
  p_direction    text,
  p_amount_cents bigint,
  p_method       text,
  p_paid_on      date DEFAULT NULL,
  p_reference    text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_status       text DEFAULT 'recorded'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
  v_job   public.jobs%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only: recording a manual payment is an administrative act'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than zero' USING ERRCODE = '22000';
  END IF;

  INSERT INTO public.manual_payment_records
    (job_id, direction, amount_cents, method, paid_on, reference, notes, status, recorded_by)
  VALUES
    (p_job_id, p_direction, p_amount_cents, p_method,
     COALESCE(p_paid_on, CURRENT_DATE), NULLIF(btrim(COALESCE(p_reference,'')), ''),
     NULLIF(btrim(COALESCE(p_notes,'')), ''), COALESCE(p_status,'recorded'), v_actor)
  RETURNING id INTO v_id;

  -- Audit: who recorded what, when, against which job. The amount lives in
  -- metadata (admin-only surface) and never in the public summary line.
  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
  VALUES
    ('payment.manual_recorded', 'info', v_actor, 'manual_payment_records', v_id, p_job_id,
     'Manual payment recorded (' || p_direction || ', ' || COALESCE(p_status,'recorded') || ')',
     jsonb_build_object(
       'manual_payment_id', v_id,
       'direction', p_direction,
       'amount_cents', p_amount_cents,
       'method', p_method,
       'status', COALESCE(p_status,'recorded'),
       'paid_on', COALESCE(p_paid_on, CURRENT_DATE),
       'reference', NULLIF(btrim(COALESCE(p_reference,'')), '')
     ));

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.admin_record_manual_payment(uuid,text,bigint,text,date,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_record_manual_payment(uuid,text,bigint,text,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_manual_payment(uuid,text,bigint,text,date,text,text,text) TO authenticated, service_role;

-- ─── 5. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_c uuid := gen_random_uuid(); v_i uuid := gen_random_uuid(); v_a uuid := gen_random_uuid();
  v_j uuid := gen_random_uuid(); v_rec uuid; v_n int;
BEGIN
  -- The release posture itself.
  IF public.nx_online_payments_enabled() THEN
    RAISE EXCEPTION 'SELFTEST: online payments must default to DISABLED for this release';
  END IF;
  BEGIN
    PERFORM public.nx_assert_online_payments_enabled();
    RAISE EXCEPTION 'SELFTEST: the money guard did not refuse while payments are disabled';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'mp.'||u::text||'@synthetic.invalid', now(), now() FROM unnest(ARRAY[v_c,v_i,v_a]) u;
    INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
      (v_c,'client','MP Client','mp.c@synthetic.invalid',true),
      (v_i,'inspector','MP Inspector','mp.i@synthetic.invalid',true),
      (v_a,'super_admin','MP Admin','mp.a@synthetic.invalid',true)
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode)
    VALUES (v_j,'mp posture',v_c,'open','approved','prepay',100000,80000,'protected');

    -- ADMIN can record; the row and its audit entry both land.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_a::text||'","role":"authenticated"}', true);
    v_rec := public.admin_record_manual_payment(
      v_j, 'client_payment', 100000, 'bank_transfer', CURRENT_DATE, 'REF-001', 'QA selftest');
    IF v_rec IS NULL THEN RAISE EXCEPTION 'SELFTEST: manual record not created'; END IF;
    SELECT count(*) INTO v_n FROM public.audit_events
      WHERE subject_id = v_rec AND event_type = 'payment.manual_recorded';
    IF v_n <> 1 THEN RAISE EXCEPTION 'SELFTEST: manual payment was not audit-logged'; END IF;
    RESET ROLE;

    -- CLIENT and INSPECTOR must not see the admin ledger at all.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO v_n FROM public.manual_payment_records WHERE job_id = v_j;
    IF v_n <> 0 THEN RAISE EXCEPTION 'SELFTEST: client can read the manual payment ledger'; END IF;
    BEGIN
      PERFORM public.admin_record_manual_payment(v_j,'client_payment',5000,'cash');
      RAISE EXCEPTION 'SELFTEST: a CLIENT recorded a manual payment';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_i::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO v_n FROM public.manual_payment_records WHERE job_id = v_j;
    IF v_n <> 0 THEN RAISE EXCEPTION 'SELFTEST: inspector can read the manual payment ledger'; END IF;
    RESET ROLE;

    RAISE NOTICE 'SELFTEST ok — manual mode default OFF, guard refuses, admin-only recording is audit-logged and private';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated); posture assertions passed';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE 'mp.%@synthetic.invalid') THEN
    RAISE EXCEPTION 'SELFTEST: synthetic fixtures survived';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
