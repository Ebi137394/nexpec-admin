-- ════════════════════════════════════════════════════════════════════════════
--  20260801500000_delivery_policy_credit_release.sql
--
--  OWNER DECISION — keep 20/80 fixed; make FINAL DELIVERY flexible.
--
--  Two Admin-controlled delivery modes, per Client with a per-Job override:
--
--    STRICT_PREPAY     20% before dispatch, remaining 80% before final report
--                      delivery. Delivery stays blocked until fully funded.
--                      This is today's behaviour and remains the default.
--
--    CREDIT_RELEASE    20% before dispatch. Admin may release the final report
--                      while the 80% is unpaid; that balance becomes an
--                      invoice due Net-15 / Net-30 / Net-60 after delivery.
--                      Delivery is NOT blocked, and once delivered an overdue
--                      invoice never revokes or hides the report.
--
--  ── EXTENDS THE EXISTING SPINE — NO SECOND PAYMENT SYSTEM ──────────────────
--  Everything here builds on 20260801448000_staged_funding_spine.sql. The
--  20/80 split itself is untouched: funding_term_defaults stays 2000/8000, and
--  nx_admin_set_funding_terms still enforces pct_bps totalling 10000. No
--  arbitrary percentages and no 30/70 are introduced. The ONLY thing made
--  configurable is whether the final tranche GATES DELIVERY, and if not, when
--  its invoice falls due.
--
--  Not to be confused with jobs.payment_mode = 'net_terms', which is a
--  different and pre-existing concept: that governs whether a job may be
--  DISPATCHED against a buyer credit line. This migration governs whether the
--  final report may be DELIVERED with the balance outstanding. A job can be
--  prepay-dispatched and still credit-released, and vice versa. The two are
--  deliberately kept orthogonal and neither guard is relaxed.
--
--  ── THE ONE PREDICATE THAT CHANGES ─────────────────────────────────────────
--  nx_funding_delivery_satisfied previously blocked delivery on ANY unfunded
--  non-retention tranche:
--
--      WHERE job_id = p_job_id AND code <> 'retention'
--        AND status NOT IN ('funded','waived')
--
--  Under that rule a post-delivery Net-30 invoice is itself an unfunded
--  non-retention tranche, so it would block the very delivery that issues it —
--  circular, and the source of the wrong "Final delivery blocked" wording.
--
--  It now counts only tranches whose gates_delivery flag is true. Because the
--  new column is NOT NULL DEFAULT true and every existing row backfills to
--  true, the predicate returns exactly what it returned before for every job
--  that exists today. Strict Prepay is preserved by construction, not by
--  convention — no backfill script can be forgotten.
--
--  ── AUTHORITY ──────────────────────────────────────────────────────────────
--  Only admin / super_admin may set a client default or release a job. Clients
--  and Inspectors get SELECT only; there is no client-writable path to
--  gates_delivery, net_term_days or the invoice dates. Both RPCs are
--  SECURITY DEFINER with a pinned search_path and re-check the caller's role
--  from profiles rather than trusting a claim.
--
--  ── MONEY ──────────────────────────────────────────────────────────────────
--  Nothing here moves money. Releasing a job on credit and collecting the
--  invoice both leave Inspector settlement exactly where it was: a separate,
--  manual Admin action. Selftest 5 asserts no function added by this migration
--  reaches wallets, transactions, earnings or payouts.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The gating flag + invoice fields on the existing spine ──────────────
ALTER TABLE public.job_funding_stages
  ADD COLUMN IF NOT EXISTS gates_delivery boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS net_term_days  integer,
  ADD COLUMN IF NOT EXISTS invoiced_at    timestamp with time zone,
  ADD COLUMN IF NOT EXISTS invoice_due_at timestamp with time zone;

COMMENT ON COLUMN public.job_funding_stages.gates_delivery IS
  'When true (the default, and the backfilled value for every pre-existing '
  'row), this tranche must be funded or waived before the final report may be '
  'delivered. Set false only by nx_admin_release_job_on_credit, which converts '
  'the tranche into a post-delivery invoice. Platform-only: no client-writable '
  'path exists.';

DO $$ BEGIN
  ALTER TABLE public.job_funding_stages
    ADD CONSTRAINT job_funding_stages_net_term_chk
    CHECK (net_term_days IS NULL OR net_term_days IN (15, 30, 60));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--  A released tranche must carry its term; a gating tranche must not.
DO $$ BEGIN
  ALTER TABLE public.job_funding_stages
    ADD CONSTRAINT job_funding_stages_credit_coherent_chk
    CHECK (
      (gates_delivery = true  AND net_term_days IS NULL)
      OR gates_delivery = false
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. Per-Client default delivery policy ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_delivery_policy (
  client_id       uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode            text NOT NULL DEFAULT 'STRICT_PREPAY',
  net_term_days   integer,
  authorised_by   uuid REFERENCES public.profiles(id),
  authorised_at   timestamp with time zone NOT NULL DEFAULT now(),
  reason          text,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT client_delivery_policy_mode_chk
    CHECK (mode IN ('STRICT_PREPAY','CREDIT_RELEASE')),
  CONSTRAINT client_delivery_policy_term_chk
    CHECK (net_term_days IS NULL OR net_term_days IN (15, 30, 60)),
  -- CREDIT_RELEASE is meaningless without a term, and a term is meaningless
  -- without it. Fail closed rather than silently defaulting a credit term.
  CONSTRAINT client_delivery_policy_coherent_chk
    CHECK ((mode = 'CREDIT_RELEASE') = (net_term_days IS NOT NULL))
);

COMMENT ON TABLE public.client_delivery_policy IS
  'Admin-approved DEFAULT delivery policy per Client. Absent row = '
  'STRICT_PREPAY, so a client with no explicit approval can never be credit '
  'released by omission. Per-job overrides live on job_funding_stages.';

-- ─── 3. Audit — every Admin change, with before and after ───────────────────
CREATE TABLE IF NOT EXISTS public.funding_policy_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope             text NOT NULL,
  client_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  job_id            uuid REFERENCES public.jobs(id)     ON DELETE SET NULL,
  actor_id          uuid NOT NULL,
  actor_role        text NOT NULL,
  previous_policy   jsonb,
  new_policy        jsonb NOT NULL,
  net_term_days     integer,
  invoice_due_at    timestamp with time zone,
  reason            text NOT NULL,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT funding_policy_audit_scope_chk CHECK (scope IN ('client','job')),
  -- A reason is mandatory. An audit row that cannot say WHY is not an audit
  -- row, and this is the record that justifies releasing money control.
  CONSTRAINT funding_policy_audit_reason_chk CHECK (length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS funding_policy_audit_job_idx    ON public.funding_policy_audit (job_id);
CREATE INDEX IF NOT EXISTS funding_policy_audit_client_idx ON public.funding_policy_audit (client_id);

-- ─── 4. The changed predicate ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_funding_delivery_satisfied(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_has_schedule boolean; v_outstanding int; v_legacy timestamptz;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.job_funding_stages WHERE job_id = p_job_id)
    INTO v_has_schedule;
  IF v_has_schedule THEN
    --  Only tranches that GATE delivery are counted. A credit-released
    --  tranche (gates_delivery = false) is a post-delivery invoice and must
    --  not block the delivery that issues it. retention was already exempt
    --  and stays exempt.
    SELECT count(*) INTO v_outstanding
      FROM public.job_funding_stages
     WHERE job_id = p_job_id
       AND code <> 'retention'
       AND gates_delivery
       AND status NOT IN ('funded','waived');
    RETURN v_outstanding = 0;
  END IF;
  SELECT client_settled_at INTO v_legacy FROM public.jobs WHERE id = p_job_id;
  RETURN v_legacy IS NOT NULL;
END $$;

-- ─── 5. Admin: set a Client's default policy ────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_set_client_delivery_policy(
  p_client_id     uuid,
  p_mode          text,
  p_net_term_days integer,
  p_reason        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid; v_role text; v_prev jsonb; v_new jsonb;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only admin or super_admin may set delivery policy'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a delivery-policy change must record why'
      USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('STRICT_PREPAY','CREDIT_RELEASE') THEN
    RAISE EXCEPTION 'INVALID_MODE: %', p_mode USING ERRCODE = '22023';
  END IF;
  IF (p_mode = 'CREDIT_RELEASE') <> (p_net_term_days IS NOT NULL) THEN
    RAISE EXCEPTION
      'INVALID_TERMS: CREDIT_RELEASE requires a Net term, STRICT_PREPAY forbids one'
      USING ERRCODE = '22023';
  END IF;
  IF p_net_term_days IS NOT NULL AND p_net_term_days NOT IN (15,30,60) THEN
    RAISE EXCEPTION 'INVALID_NET_TERM: % (allowed: 15, 30, 60)', p_net_term_days
      USING ERRCODE = '22023';
  END IF;

  SELECT to_jsonb(c) INTO v_prev FROM public.client_delivery_policy c
   WHERE c.client_id = p_client_id;

  INSERT INTO public.client_delivery_policy AS c
    (client_id, mode, net_term_days, authorised_by, authorised_at, reason)
  VALUES (p_client_id, p_mode, p_net_term_days, v_actor, now(), p_reason)
  ON CONFLICT (client_id) DO UPDATE SET
    mode          = EXCLUDED.mode,
    net_term_days = EXCLUDED.net_term_days,
    authorised_by = EXCLUDED.authorised_by,
    authorised_at = EXCLUDED.authorised_at,
    reason        = EXCLUDED.reason,
    updated_at    = now();

  SELECT to_jsonb(c) INTO v_new FROM public.client_delivery_policy c
   WHERE c.client_id = p_client_id;

  INSERT INTO public.funding_policy_audit
    (scope, client_id, actor_id, actor_role, previous_policy, new_policy,
     net_term_days, reason)
  VALUES ('client', p_client_id, v_actor, v_role, v_prev, v_new,
          p_net_term_days, p_reason);

  RETURN v_new;
END $$;

-- ─── 6. Admin: release ONE job on credit ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_release_job_on_credit(
  p_job_id        uuid,
  p_net_term_days integer,
  p_reason        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid; v_role text; v_prev jsonb; v_new jsonb; v_n int;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only admin or super_admin may release a job on credit'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a credit release must record why'
      USING ERRCODE = '22023';
  END IF;
  IF p_net_term_days IS NULL OR p_net_term_days NOT IN (15,30,60) THEN
    RAISE EXCEPTION 'INVALID_NET_TERM: % (allowed: 15, 30, 60)', p_net_term_days
      USING ERRCODE = '22023';
  END IF;

  --  The 20% initial tranche is NEVER releasable — it gates dispatch, not
  --  delivery, and releasing it would hand out an assignment for free.
  --  Only the outstanding final balance may be turned into an invoice.
  SELECT jsonb_agg(to_jsonb(s)) INTO v_prev
    FROM public.job_funding_stages s
   WHERE s.job_id = p_job_id AND s.code = 'final';

  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'FUNDING_STAGE_NOT_FOUND: job % has no final tranche', p_job_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.job_funding_stages
     SET gates_delivery = false,
         net_term_days  = p_net_term_days,
         updated_at     = now()
   WHERE job_id = p_job_id
     AND code   = 'final'
     AND status NOT IN ('funded','waived');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION
      'NOTHING_TO_RELEASE: job % has no outstanding final tranche (already funded or waived)',
      p_job_id USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(to_jsonb(s)) INTO v_new
    FROM public.job_funding_stages s
   WHERE s.job_id = p_job_id AND s.code = 'final';

  INSERT INTO public.funding_policy_audit
    (scope, job_id, actor_id, actor_role, previous_policy, new_policy,
     net_term_days, reason)
  VALUES ('job', p_job_id, v_actor, v_role, v_prev, v_new,
          p_net_term_days, p_reason);

  RETURN v_new;
END $$;

-- ─── 7. Invoice issuance on delivery, and its status ────────────────────────
--  Called when the final report is delivered. Stamps the invoice date and
--  computes the due date from the configured term. Separate from any money
--  movement: this records an obligation, it does not settle one.
CREATE OR REPLACE FUNCTION public.nx_funding_issue_delivery_invoice(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.job_funding_stages
     SET invoiced_at    = COALESCE(invoiced_at, now()),
         invoice_due_at = COALESCE(invoice_due_at,
                                   now() + (net_term_days || ' days')::interval),
         updated_at     = now()
   WHERE job_id = p_job_id
     AND code   = 'final'
     AND NOT gates_delivery
     AND net_term_days IS NOT NULL
     AND status NOT IN ('funded','waived');
END $$;

--  Open / Due Soon / Overdue / Paid / Waived, for Client Finance and the
--  Admin follow-up queue. Due Soon = within 7 days of falling due.
CREATE OR REPLACE FUNCTION public.nx_funding_invoice_status(p_job_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN s.status = 'funded' THEN 'paid'
           WHEN s.status = 'waived' THEN 'waived'
           WHEN s.invoice_due_at IS NULL THEN 'open'
           WHEN now() > s.invoice_due_at THEN 'overdue'
           WHEN now() > s.invoice_due_at - interval '7 days' THEN 'due_soon'
           ELSE 'open'
         END
    FROM public.job_funding_stages s
   WHERE s.job_id = p_job_id AND s.code = 'final'
   LIMIT 1;
$$;

-- ─── 8. RLS — Admin writes, Client/Inspector read only ──────────────────────
ALTER TABLE public.client_delivery_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_policy_audit   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_delivery_policy_admin_write ON public.client_delivery_policy;
CREATE POLICY client_delivery_policy_admin_write ON public.client_delivery_policy
  FOR ALL TO authenticated
  USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS client_delivery_policy_owner_read ON public.client_delivery_policy;
CREATE POLICY client_delivery_policy_owner_read ON public.client_delivery_policy
  FOR SELECT TO authenticated
  USING (public.nx_is_admin() OR client_id = auth.uid());

DROP POLICY IF EXISTS funding_policy_audit_admin_read ON public.funding_policy_audit;
CREATE POLICY funding_policy_audit_admin_read ON public.funding_policy_audit
  FOR SELECT TO authenticated
  USING (public.nx_is_admin());

REVOKE ALL ON public.client_delivery_policy FROM anon, PUBLIC;
REVOKE ALL ON public.funding_policy_audit   FROM anon, PUBLIC;
GRANT SELECT ON public.client_delivery_policy TO authenticated;
GRANT SELECT ON public.funding_policy_audit   TO authenticated;

REVOKE ALL ON FUNCTION public.nx_admin_set_client_delivery_policy(uuid,text,integer,text) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_admin_release_job_on_credit(uuid,integer,text)           FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_funding_issue_delivery_invoice(uuid)                     FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_funding_invoice_status(uuid)                             FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_admin_set_client_delivery_policy(uuid,text,integer,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_admin_release_job_on_credit(uuid,integer,text)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_funding_issue_delivery_invoice(uuid)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.nx_funding_invoice_status(uuid)                             TO authenticated, service_role;

-- ─── Selftest ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_n int; v_bad text;
BEGIN
  -- 1. Backfill preserved Strict Prepay for every existing row.
  SELECT count(*) INTO v_n FROM public.job_funding_stages WHERE NOT gates_delivery;
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % pre-existing tranche(s) are already non-gating — the backfill did not preserve Strict Prepay', v_n;
  END IF;

  -- 2. The predicate actually reads the flag. Asserting BEHAVIOUR, not that a
  --    column exists: a delivery gate that ignores gates_delivery would leave
  --    credit release silently broken while every catalogue check passed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_funding_delivery_satisfied'
       AND p.prosrc ~ 'gates_delivery'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: nx_funding_delivery_satisfied does not consult gates_delivery';
  END IF;

  -- 3. …and it still blocks on genuinely gating, unfunded tranches. The
  --    release must not have widened into "never blocks".
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_funding_delivery_satisfied'
       AND p.prosrc ~ 'status NOT IN \(''funded'',''waived''\)'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: the delivery gate no longer requires gating tranches to be funded or waived';
  END IF;

  -- 4. The 20% initial tranche can never be credit-released.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'nx_admin_release_job_on_credit'
       AND p.prosrc ~ 'code\s*=\s*''final'''
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: nx_admin_release_job_on_credit is not restricted to the final tranche';
  END IF;

  -- 5. MONEY. Nothing added here may move money — Inspector settlement stays a
  --    separate manual Admin action.
  FOR v_bad IN
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('nx_admin_set_client_delivery_policy',
                         'nx_admin_release_job_on_credit',
                         'nx_funding_issue_delivery_invoice',
                         'nx_funding_invoice_status',
                         'nx_funding_delivery_satisfied')
       AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
           '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts|supplier_earnings)\M'
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % reaches money DML — client funding must never pay the Inspector', v_bad;
  END LOOP;

  -- 6. No overdue-driven revocation. Once delivered, an overdue invoice must
  --    never hide the report, so no function may gate report access on
  --    invoice lateness.
  FOR v_bad IN
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('nx_funding_delivery_satisfied','nx_funding_invoice_status')
       AND p.prosrc ~* 'revoke|hide|withdraw_report|unpublish'
  LOOP
    RAISE EXCEPTION
      'SELFTEST: % appears to revoke or hide a delivered report', v_bad;
  END LOOP;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
