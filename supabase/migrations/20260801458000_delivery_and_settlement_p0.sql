-- ════════════════════════════════════════════════════════════════════════════
--  20260801458000_delivery_and_settlement_p0.sql
--
--  Closes the three P0s the independent Lane G review left open. All three are
--  fixed STRUCTURALLY — BEFORE UPDATE triggers on the tables themselves — so a
--  direct PostgREST PATCH is bound by the same rule as the RPC. None of these
--  relies on a UI control, an RPC error string, or a policy that a column-level
--  grant can sidestep.
--
--  ── P0-1: THE SECOND DELIVERY PATH ─────────────────────────────────────────
--  nx_admin_deliver_report was never the only way to reach status='delivered'.
--  baseline grants ALL on inspection_reports to `authenticated`, and two
--  permissive UPDATE policies admit the report's own inspector
--  ("Inspectors can update reports", baseline:29517) and the job's buyer
--  ("Buyers can update report status", baseline:29379). The only status guard,
--  nx_guard_report_no_self_approval, fires only when
--  nx_report_review_transition(NEW.status) = 'approved' (430000:519) — and that
--  mapping (430000:170-182) has NO case for 'delivered', so it returns 'other'
--  and the guard never runs.
--
--  So `PATCH /rest/v1/inspection_reports?id=eq.X {"status":"delivered"}`
--  succeeded for the inspector AND the client, skipping the senior-approval and
--  remaining-funding gates entirely. The client is the party with the motive:
--  self-delivering clears the report from the Admin queue, so the outstanding
--  tranche is never chased.
--
--  The legacy public.reports table needs no equivalent guard: its
--  reports_status_check (baseline:24269) admits only In_Progress | Submitted |
--  Approved | Rejected | Revision_Requested, so 'delivered' cannot be written
--  there at all. Asserted in §4 rather than assumed.
--
--  ── P0-2: A 20% PAYMENT RECORDED AS FULL SETTLEMENT ────────────────────────
--  settle_client_payment stamps jobs.client_settled_at = now() for ANY amount
--  (446000:216) and, on net_terms, moves the ENTIRE inspector payout from
--  pending to available and writes a 'settlement' transaction (446000:197-210).
--  create-payment-intent performs no payment_mode check, so paying the 20%
--  initial tranche reached that branch. Its idempotent early return
--  (446000:186) then meant the later 80% recorded nothing at all.
--
--  Two separate wrongs, fixed separately:
--    (a) Full settlement must require full funding. When a job HAS a staged
--        schedule, client_settled_at is only stamped once every non-retention
--        tranche is in. Jobs with no schedule keep the legacy behaviour, so
--        nothing pre-spine changes.
--    (b) The automatic payout release is REMOVED. The standing rule is that
--        inspector settlement and payout are manually controlled by Admin, and
--        "the client finished paying" is not an Admin decision. This is the
--        same class of defect as 444000 (automatic credit on confirmation) and
--        432000 (automatic payout on completion); this is the third and last
--        automatic-money path. Advance recovery is preserved — that is
--        bookkeeping against money already advanced, not a new payout.
--
--  ── P0-3: DIRECT client_settled_at WRITE ───────────────────────────────────
--  20260801312000 narrowed only SELECT on jobs; baseline GRANT ALL leaves
--  UPDATE table-wide, policy jobs_update admits auth.uid() = client_id with no
--  column pinning, and no trigger protected the column. A client could PATCH
--  their own job's client_settled_at and satisfy both funding gates for free.
--  Now only an Admin or service_role may change that column.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── shared helper: is this caller the platform, not an end user? ───────────
CREATE OR REPLACE FUNCTION public.nx_actor_is_platform()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_role text;
BEGIN
  v_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');

  -- service_role = the backend (Stripe webhook, edge functions).
  IF v_role = 'service_role' THEN RETURN true; END IF;
  -- anon is never the platform, whatever else is true.
  IF v_role = 'anon' THEN RETURN false; END IF;
  -- no JWT at all = psql / migration / cron running as owner.
  IF auth.uid() IS NULL AND v_role IS NULL THEN RETURN true; END IF;

  RETURN public.nx_is_admin();
END $fn$;

ALTER FUNCTION public.nx_actor_is_platform() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_actor_is_platform() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_actor_is_platform() TO authenticated, service_role;

-- ─── 1. P0-1 — delivery is Admin-only and gated, structurally ───────────────
CREATE OR REPLACE FUNCTION public.nx_guard_report_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_approved boolean;
BEGIN
  -- only interested in the transition INTO delivered
  IF NEW.status IS DISTINCT FROM 'delivered'
     OR OLD.status IS NOT DISTINCT FROM 'delivered' THEN
    RETURN NEW;
  END IF;

  -- (a) AUTHORITY. Not the inspector, not the Senior Inspector, not the client.
  IF NOT public.nx_actor_is_platform() THEN
    RAISE EXCEPTION
      'DELIVERY_IS_ADMIN_ONLY: only an Admin delivers the final signed report to the Client. This applies to direct table updates, not just the RPC.'
      USING ERRCODE = '42501';
  END IF;

  -- (b) SENIOR APPROVAL on the latest, un-superseded round
  SELECT EXISTS (
    SELECT 1 FROM public.report_senior_reviews r
     WHERE r.inspection_report_id = NEW.id
       AND r.decision = 'approved' AND r.superseded_at IS NULL
       AND r.round = (SELECT max(round) FROM public.report_senior_reviews
                       WHERE inspection_report_id = NEW.id)
  ) INTO v_approved;

  IF NOT v_approved THEN
    RAISE EXCEPTION
      'SENIOR_APPROVAL_REQUIRED: the latest review round has not been approved by a Senior Inspector'
      USING ERRCODE = '22000';
  END IF;

  -- (c) REMAINING FUNDING
  IF NOT public.nx_funding_delivery_satisfied(NEW.job_id) THEN
    RAISE EXCEPTION
      'FUNDING_REQUIRED: the remaining funding tranche must be in before the final signed report is delivered'
      USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_guard_report_delivery() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_inspection_reports_delivery_guard ON public.inspection_reports;
CREATE TRIGGER trg_inspection_reports_delivery_guard
  BEFORE UPDATE ON public.inspection_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_report_delivery();

COMMENT ON FUNCTION public.nx_guard_report_delivery() IS
  'BEFORE UPDATE on inspection_reports. Refuses any transition INTO status=''delivered'' '
  'unless the actor is an Admin or service_role AND the latest un-superseded review round '
  'is approved AND the remaining funding tranche is in. Structural, so a direct PostgREST '
  'PATCH is bound by the same rule as nx_admin_deliver_report — which is the hole this '
  'closes. Idempotent: a no-op re-delivery (delivered -> delivered) is not re-gated.';

-- ─── 2. P0-2 — settlement follows the schedule, and pays nobody ─────────────
CREATE OR REPLACE FUNCTION public.settle_client_payment(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_jwt_role text;
  v_job public.jobs%ROWTYPE;
  v_adv record;
  v_has_schedule boolean;
  v_outstanding int;
BEGIN
  -- authorization preserved verbatim from 20260801446000
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  IF v_jwt_role IN ('anon','authenticated') AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF v_job.client_settled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  -- ADDED 20260801458000 (P0-2a). Full settlement means the client has finished
  -- paying. Under staged funding a single tranche is NOT that. Stamping
  -- client_settled_at on the 20% both overstated the position and — via the
  -- idempotent early return above — silently discarded the later 80%.
  SELECT EXISTS (SELECT 1 FROM public.job_funding_stages WHERE job_id = p_job_id)
    INTO v_has_schedule;

  IF v_has_schedule THEN
    SELECT count(*) INTO v_outstanding
      FROM public.job_funding_stages
     WHERE job_id = p_job_id AND code <> 'retention'
       AND status NOT IN ('funded','waived');

    IF v_outstanding > 0 THEN
      -- Not an error: the tranche was recorded by nx_funding_mark_stage_funded.
      -- There is simply nothing to settle yet.
      RETURN jsonb_build_object(
        'ok', true, 'settled', false, 'job_id', p_job_id,
        'outstanding_tranches', v_outstanding,
        'note', 'partial funding recorded; full settlement awaits the remaining tranche');
    END IF;
  END IF;

  UPDATE public.jobs SET client_settled_at = now(), updated_at = now() WHERE id = p_job_id;

  -- REMOVED 20260801458000 (P0-2b). This function used to move the ENTIRE
  -- inspector payout from pending_amount to available_balance and write a
  -- 'settlement' transaction whenever payment_mode = 'net_terms'. That is
  -- automatic inspector payment triggered by a client action, which the
  -- standing rule forbids: settlement and payout are manually controlled by
  -- Admin. It is the same defect class as 20260801432000 (auto payout on
  -- completion) and 20260801444000 (auto credit on confirmation); this was the
  -- third and last automatic-money path.
  --
  -- Advance RECOVERY is kept: that is bookkeeping against money already paid
  -- out, not a new payout.
  SELECT * INTO v_adv
    FROM public.payout_advances
   WHERE job_id = p_job_id AND status = 'funded'
   ORDER BY funded_at DESC LIMIT 1;

  IF v_adv.id IS NOT NULL THEN
    UPDATE public.payout_advances
       SET status = 'recovered', recovered_at = now(), updated_at = now()
     WHERE id = v_adv.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'settled', true, 'job_id', p_job_id,
                            'advance_recovered', v_adv.id IS NOT NULL);
END $fn$;

ALTER FUNCTION public.settle_client_payment(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.settle_client_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_client_payment(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.settle_client_payment(uuid) IS
  'Marks the CLIENT side settled. Under staged funding it refuses to stamp '
  'client_settled_at until every non-retention tranche is funded, so a partial payment is '
  'never recorded as full settlement. Pays NO inspector: the automatic net_terms payout '
  'release was removed by 20260801458000 because settlement and payout are manual and '
  'Admin-controlled. Advance recovery is retained (bookkeeping, not a payout).';

-- ─── 3. P0-3 — client_settled_at is platform-writable only ──────────────────
CREATE OR REPLACE FUNCTION public.nx_guard_jobs_funding_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.client_settled_at IS DISTINCT FROM OLD.client_settled_at
     AND NOT public.nx_actor_is_platform() THEN
    RAISE EXCEPTION
      'FUNDING_COLUMN_IS_PLATFORM_ONLY: jobs.client_settled_at records that money arrived. It is written by the payment path (settle_client_payment / nx_stripe_settle_job) or an Admin — never by a client.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_guard_jobs_funding_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_jobs_funding_columns_guard ON public.jobs;
CREATE TRIGGER trg_jobs_funding_columns_guard
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_jobs_funding_columns();

-- ─── 4. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  -- the legacy table genuinely cannot hold 'delivered'
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reports_status_check'
       AND pg_get_constraintdef(oid) ILIKE '%delivered%') THEN
    RAISE EXCEPTION
      'SELFTEST: public.reports now admits ''delivered'' — it needs the same delivery guard as inspection_reports';
  END IF;

  -- all three guards attached
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_inspection_reports_delivery_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: the delivery guard is not attached — the PATCH bypass is still open';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_jobs_funding_columns_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: the client_settled_at guard is not attached';
  END IF;

  -- the automatic payout release really is gone
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='settle_client_payment'
       AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
           'update\s+public\.wallets') THEN
    RAISE EXCEPTION
      'SELFTEST: settle_client_payment still moves a wallet balance — client settlement must never pay an inspector';
  END IF;

  -- and it consults the schedule before stamping
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='settle_client_payment'
       AND p.prosrc ~* 'job_funding_stages') THEN
    RAISE EXCEPTION
      'SELFTEST: settle_client_payment does not consult the funding schedule — a partial tranche could still be recorded as full settlement';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
