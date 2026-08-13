-- ════════════════════════════════════════════════════════════════════════════
--  20260801448000_staged_funding_spine.sql
--
--  Lane 5 — one canonical, CONFIGURABLE staged-funding spine for jobs.
--  Default commercial terms 20 / 80 (addendum:49-63, owner decision).
--
--  Allocation note: the addendum allocates `446000` to Lane 5. That number was
--  reassigned to security by 20260801446000 because the anon-RPC lockdown had
--  to precede this lane — this spine builds directly on settle_client_payment,
--  which 446000 made fail-closed. Lane 5 is therefore 448000. Verified free.
--
--  ── THE DEADLOCK, RESOLVED ─────────────────────────────────────────────────
--  PHASE-INVENTORY:745 flags a suspected circular prerequisite. Both halves are
--  confirmed in source at this HEAD:
--
--    supabase/functions/create-payment-intent/index.ts:192
--      refuses to create a PaymentIntent unless jobs.admin_confirmed_at is set
--      ("Job has not been dispatched by admin yet", NOT_DISPATCHED), and
--      requires status ∈ (assigned, in_progress, completed).
--
--    20260801422000:99-106  nx_guard_dispatch_requires_funding
--      BEFORE UPDATE on jobs; for payment_mode='prepay' it refuses dispatch
--      (status -> assigned, or contractor_id NULL -> set) unless
--      jobs.client_settled_at IS NOT NULL.
--
--  So for a prepay card job: paying needs dispatch, dispatch needs payment.
--  Neither can go first. There is NO valid first action today.
--
--  THE FIX IS THE LANE ITSELF, not a weakening. The binary gate asks the wrong
--  question — "has the client paid in full?" — at a point where the contract
--  only requires the FIRST tranche. Replacing "fully settled" with "initial
--  stage funded" gives a valid first action (fund 20%) while *raising* the
--  protection on the back end, because final delivery now also has a gate that
--  did not exist before. Funding protection is strengthened, not relaxed:
--    • dispatch still cannot happen against nothing
--    • net_terms credit-line branch is untouched
--    • unknown payment_mode still fails closed
--    • service_role is still NOT exempt
--
--  ── RECONCILIATION, NOT DUPLICATION ────────────────────────────────────────
--  The addendum requires the existing 30% deals path be reconciled into one
--  configurable spine, not duplicated and not deleted. Two existing shapes:
--
--    deal_payment_schedule (baseline:22437) — tranche_no, code, pct_bps,
--      amount_cents, trigger_basis, status. Keyed by deal_id. This is a real,
--      working staged-funding vocabulary.
--    deals.deposit_funded_at / balance_funded_at (baseline:21957) — the 30/70
--      two-stage model in denormalised form.
--
--  Jobs, by contrast, have only a BINARY signal (client_settled_at). This
--  migration generalises the PROVEN deal_payment_schedule vocabulary onto jobs
--  — same column names, same pct_bps basis-point convention, same
--  scheduled/released semantics — so the platform converges on one funding
--  language instead of gaining a third. `deals` is left untouched; its
--  schedule rows remain valid and readable under the same vocabulary.
--
--  ── LEGACY INTERPRETABILITY, NO BACKFILL ───────────────────────────────────
--  jobs.client_settled_at is NOT dropped, NOT rewritten, and NOT backfilled.
--  Rows predating this spine have no stage rows at all; the dispatch gate
--  accepts legacy client_settled_at as satisfying the initial stage, so every
--  existing job keeps working and every historical row stays interpretable.
--  Nothing is migrated destructively.
--
--  ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ───────────────────────────
--  It moves no money. It has no trigger that writes wallets, transactions,
--  earnings or payouts. Funding a stage records that the CLIENT paid; it never
--  credits the Inspector. Inspector settlement and payout remain manual and
--  Admin-controlled (444000, 446000). Asserted in §7.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Configurable default terms ──────────────────────────────────────────
--  Configurable, not hard-coded (addendum). One active row; Admin may change it
--  and may override per job via nx_admin_set_funding_terms.
CREATE TABLE IF NOT EXISTS public.funding_term_defaults (
  id            integer PRIMARY KEY DEFAULT 1,
  initial_bps   integer NOT NULL,
  final_bps     integer NOT NULL,
  updated_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_by    uuid,
  CONSTRAINT funding_term_defaults_singleton  CHECK (id = 1),
  CONSTRAINT funding_term_defaults_initial_rng CHECK (initial_bps BETWEEN 0 AND 10000),
  CONSTRAINT funding_term_defaults_final_rng   CHECK (final_bps   BETWEEN 0 AND 10000),
  CONSTRAINT funding_term_defaults_sums        CHECK (initial_bps + final_bps = 10000)
);

INSERT INTO public.funding_term_defaults (id, initial_bps, final_bps)
VALUES (1, 2000, 8000)
ON CONFLICT (id) DO NOTHING;   -- never overwrite an Admin-tuned value

COMMENT ON TABLE public.funding_term_defaults IS
  'Platform default staged-funding split. Seeded 2000/8000 bps = the canonical 20/80 '
  '(addendum:49-63). Configurable: Admin may retune, and per-job overrides go through '
  'nx_admin_set_funding_terms. Basis points match deal_payment_schedule.pct_bps.';

-- ─── 2. The spine ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_funding_stages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  tranche_no     integer NOT NULL,
  code           text    NOT NULL,
  label          text    NOT NULL,
  pct_bps        integer NOT NULL,
  amount_cents   bigint  NOT NULL DEFAULT 0,
  trigger_basis  text    NOT NULL,
  status         text    NOT NULL DEFAULT 'scheduled',
  funded_at      timestamp with time zone,
  stripe_payment_intent_id text,
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT job_funding_stages_tranche_uq UNIQUE (job_id, tranche_no),
  CONSTRAINT job_funding_stages_code_uq    UNIQUE (job_id, code),
  -- vocabulary deliberately mirrors deal_payment_schedule_code_check
  CONSTRAINT job_funding_stages_code_check CHECK (
    code = ANY (ARRAY['initial','final','retention'])),
  CONSTRAINT job_funding_stages_pct_rng    CHECK (pct_bps BETWEEN 0 AND 10000),
  CONSTRAINT job_funding_stages_amount_chk CHECK (amount_cents >= 0),
  CONSTRAINT job_funding_stages_basis_check CHECK (
    trigger_basis = ANY (ARRAY['before_assignment','after_report_review','manual'])),
  CONSTRAINT job_funding_stages_status_check CHECK (
    status = ANY (ARRAY['scheduled','funded','waived','refunded'])),
  -- a funded stage must say when; a scheduled one must not pretend it did
  CONSTRAINT job_funding_stages_funded_at_chk CHECK (
    (status = 'funded' AND funded_at IS NOT NULL)
    OR (status <> 'funded' AND funded_at IS NULL))
);

-- Webhook idempotency: one PaymentIntent settles at most one stage, ever.
CREATE UNIQUE INDEX IF NOT EXISTS job_funding_stages_pi_uq
  ON public.job_funding_stages (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_funding_stages_job_idx
  ON public.job_funding_stages (job_id);

COMMENT ON TABLE public.job_funding_stages IS
  'Canonical configurable staged-funding schedule for a job. Generalises the proven '
  'deal_payment_schedule vocabulary (tranche_no/code/pct_bps/trigger_basis/status) from '
  'deals onto jobs so the platform has ONE funding language, not a third. Records CLIENT '
  'funding only: it never credits an Inspector and no trigger on it moves money. Inspector '
  'settlement and payout stay manual and Admin-controlled. Contains no platform spread and '
  'no inspector payout figure — see the RLS policies for the privacy split.';

ALTER TABLE public.job_funding_stages ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_job_funding_stages_touch ON public.job_funding_stages;
CREATE TRIGGER trg_job_funding_stages_touch
  BEFORE UPDATE ON public.job_funding_stages
  FOR EACH ROW EXECUTE FUNCTION public.tg_coordination_bridges_set_updated_at();

-- ─── 3. Read model + gate predicates ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_funding_stage_is_funded(p_job_id uuid, p_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.job_funding_stages s
     WHERE s.job_id = p_job_id AND s.code = p_code
       AND s.status IN ('funded','waived')
  );
$$;

--  The authoritative dispatch predicate. Legacy-tolerant by design: a job that
--  predates the spine has no stage rows, and its binary client_settled_at is
--  accepted as evidence the initial tranche is in. No backfill required.
CREATE OR REPLACE FUNCTION public.nx_funding_initial_satisfied(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_has_schedule boolean; v_legacy timestamptz;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.job_funding_stages WHERE job_id = p_job_id)
    INTO v_has_schedule;
  IF v_has_schedule THEN
    RETURN public.nx_funding_stage_is_funded(p_job_id, 'initial');
  END IF;
  SELECT client_settled_at INTO v_legacy FROM public.jobs WHERE id = p_job_id;
  RETURN v_legacy IS NOT NULL;   -- legacy binary funding stays interpretable
END $$;

--  Final signed report delivery predicate: every non-retention tranche in.
CREATE OR REPLACE FUNCTION public.nx_funding_delivery_satisfied(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_has_schedule boolean; v_outstanding int; v_legacy timestamptz;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.job_funding_stages WHERE job_id = p_job_id)
    INTO v_has_schedule;
  IF v_has_schedule THEN
    SELECT count(*) INTO v_outstanding
      FROM public.job_funding_stages
     WHERE job_id = p_job_id AND code <> 'retention'
       AND status NOT IN ('funded','waived');
    RETURN v_outstanding = 0;
  END IF;
  SELECT client_settled_at INTO v_legacy FROM public.jobs WHERE id = p_job_id;
  RETURN v_legacy IS NOT NULL;
END $$;

-- ─── 4. Schedule materialisation + Admin override ───────────────────────────
CREATE OR REPLACE FUNCTION public.nx_funding_ensure_schedule(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_price bigint; v_init int; v_fin int; v_exists boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.job_funding_stages WHERE job_id = p_job_id)
    INTO v_exists;
  IF v_exists THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'job_id', p_job_id);
  END IF;

  SELECT COALESCE(client_price_cents, 0) INTO v_price FROM public.jobs WHERE id = p_job_id;
  SELECT initial_bps, final_bps INTO v_init, v_fin FROM public.funding_term_defaults WHERE id = 1;

  INSERT INTO public.job_funding_stages
    (job_id, tranche_no, code, label, pct_bps, amount_cents, trigger_basis)
  VALUES
    (p_job_id, 1, 'initial', 'Initial funding (before assignment)', v_init,
     (v_price * v_init) / 10000, 'before_assignment'),
    (p_job_id, 2, 'final',   'Remaining funding (after report review)', v_fin,
     v_price - ((v_price * v_init) / 10000), 'after_report_review');

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id,
                            'initial_bps', v_init, 'final_bps', v_fin);
END $$;

--  Admin-approved contract-specific terms. Refuses once money is in, so a
--  schedule cannot be rewritten under a client who already paid against it.
CREATE OR REPLACE FUNCTION public.nx_admin_set_funding_terms(p_job_id uuid, p_stages jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role text; v_sum int; v_price bigint; v_n int; r jsonb; v_i int := 0;
BEGIN
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  IF v_jwt_role = 'anon' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_stages) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_STAGES: expected a JSON array';
  END IF;

  SELECT count(*) INTO v_n FROM jsonb_array_elements(p_stages);
  IF v_n = 0 THEN RAISE EXCEPTION 'INVALID_STAGES: at least one stage required'; END IF;

  SELECT COALESCE(sum((e->>'pct_bps')::int), -1) INTO v_sum
    FROM jsonb_array_elements(p_stages) e;
  IF v_sum <> 10000 THEN
    RAISE EXCEPTION 'INVALID_STAGES: pct_bps must total 10000, got %', v_sum;
  END IF;

  IF EXISTS (SELECT 1 FROM public.job_funding_stages
              WHERE job_id = p_job_id AND status IN ('funded','refunded')) THEN
    RAISE EXCEPTION
      'FUNDING_ALREADY_IN_FLIGHT: cannot rewrite a schedule the client has already paid against'
      USING ERRCODE = '22000';
  END IF;

  SELECT COALESCE(client_price_cents, 0) INTO v_price FROM public.jobs WHERE id = p_job_id;
  DELETE FROM public.job_funding_stages WHERE job_id = p_job_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_stages)
  LOOP
    v_i := v_i + 1;
    INSERT INTO public.job_funding_stages
      (job_id, tranche_no, code, label, pct_bps, amount_cents, trigger_basis)
    VALUES (
      p_job_id, v_i,
      COALESCE(r->>'code', CASE WHEN v_i = 1 THEN 'initial' ELSE 'final' END),
      COALESCE(r->>'label', 'Funding tranche ' || v_i),
      (r->>'pct_bps')::int,
      (v_price * (r->>'pct_bps')::int) / 10000,
      COALESCE(r->>'trigger_basis',
               CASE WHEN v_i = 1 THEN 'before_assignment' ELSE 'after_report_review' END));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'stages', v_i);
END $$;

-- ─── 5. Settlement of a stage — service_role only, idempotent ───────────────
--  Records that the CLIENT funded a tranche. It does not, and must never,
--  credit the Inspector: that stays manual (444000/446000).
CREATE OR REPLACE FUNCTION public.nx_funding_mark_stage_funded(
  p_job_id uuid, p_code text, p_payment_intent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_jwt_role text; v_id uuid; v_status text;
BEGIN
  v_jwt_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  -- client roles may never settle funding; only the backend or an admin session
  IF v_jwt_role IN ('anon','authenticated') AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  -- Idempotent on the PaymentIntent: Stripe retries webhooks.
  IF p_payment_intent IS NOT NULL THEN
    SELECT id, status INTO v_id, v_status
      FROM public.job_funding_stages
     WHERE stripe_payment_intent_id = p_payment_intent;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'stage_id', v_id);
    END IF;
  END IF;

  SELECT id, status INTO v_id, v_status
    FROM public.job_funding_stages
   WHERE job_id = p_job_id AND code = p_code
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FUNDING_STAGE_NOT_FOUND: job % has no % tranche', p_job_id, p_code
      USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'funded' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'stage_id', v_id);
  END IF;

  UPDATE public.job_funding_stages
     SET status = 'funded', funded_at = now(),
         stripe_payment_intent_id = COALESCE(p_payment_intent, stripe_payment_intent_id)
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'stage_id', v_id, 'code', p_code);
END $$;

-- ─── 6. Dispatch gate reconciliation — the deadlock break ───────────────────
--  Only the prepay branch changes: "fully settled" becomes "initial tranche in".
--  net_terms, unknown-mode fail-closed, and the no-service_role-exemption
--  posture from 20260801422000 are reproduced verbatim.
CREATE OR REPLACE FUNCTION public.nx_guard_dispatch_requires_funding()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_mode text; v_dispatch boolean; v_buyer uuid; v_limit bigint;
BEGIN
  v_dispatch :=
       (NEW.status = 'assigned' AND OLD.status IS DISTINCT FROM 'assigned')
    OR (NEW.contractor_id IS NOT NULL AND OLD.contractor_id IS NULL);

  IF NOT v_dispatch THEN
    RETURN NEW;
  END IF;

  v_mode := COALESCE(NEW.payment_mode, 'prepay');

  -- ── PREPAY: the CONTRACTED FIRST TRANCHE must be in ───────────────────────
  IF v_mode = 'prepay' THEN
    IF NOT public.nx_funding_initial_satisfied(NEW.id) THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is prepay and its initial funding tranche is not in. Dispatching would send an inspector to site against nothing.',
        NEW.id
        USING ERRCODE = '22000',
              HINT = 'Client funds the initial tranche first (nx_funding_mark_stage_funded via the Stripe webhook, or an Admin waiver). Legacy jobs with jobs.client_settled_at set already satisfy this.';
    END IF;
    RETURN NEW;
  END IF;

  -- ── NET_TERMS: unchanged from 20260801422000 ──────────────────────────────
  IF v_mode = 'net_terms' THEN
    v_buyer := public.nx_job_buyer_principal(NEW.id);
    IF v_buyer IS NULL THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is net_terms but has no resolvable buyer principal, so no credit authority can be established.',
        NEW.id USING ERRCODE = '22000';
    END IF;
    SELECT COALESCE(p.client_credit_limit_cents, 0) INTO v_limit
      FROM public.profiles p WHERE p.id = v_buyer;
    IF COALESCE(v_limit, 0) <= 0 THEN
      RAISE EXCEPTION
        'FUNDING_REQUIRED: job % is net_terms but buyer principal % holds no authorised credit line (profiles.client_credit_limit_cents = 0 means prepay only).',
        NEW.id, v_buyer
        USING ERRCODE = '22000',
              HINT = 'Grant an explicit credit limit to the buyer, or set the job to prepay and collect payment.';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'FUNDING_REQUIRED: job % has unrecognised payment_mode %; refusing dispatch rather than guessing that it is funded.',
    NEW.id, v_mode USING ERRCODE = '22000';
END $fn$;

ALTER FUNCTION public.nx_guard_dispatch_requires_funding() OWNER TO postgres;

COMMENT ON FUNCTION public.nx_guard_dispatch_requires_funding() IS
  'BEFORE UPDATE trigger on jobs. Refuses dispatch (status -> assigned, or contractor_id '
  'NULL -> set) unless the job is funded for its payment_mode. prepay now requires the '
  'INITIAL staged-funding tranche (20260801448000) rather than full settlement — this is '
  'what breaks the create-payment-intent <-> dispatch deadlock, and it is stricter overall '
  'because final delivery gained its own gate. Legacy jobs with client_settled_at set still '
  'pass, so no backfill is needed. net_terms requires client_credit_limit_cents > 0. '
  'Unknown payment_mode fails closed. Does NOT exempt service_role. Triggers no payout.';

-- ─── 7. Privacy RLS ─────────────────────────────────────────────────────────
--  Client sees its own funding obligations. Inspector sees NOTHING here: the
--  table carries client-side amounts, and inspector payout terms live on their
--  own surface. Platform spread appears nowhere in this table by construction.
DROP POLICY IF EXISTS job_funding_stages_admin_all  ON public.job_funding_stages;
DROP POLICY IF EXISTS job_funding_stages_client_read ON public.job_funding_stages;

CREATE POLICY job_funding_stages_admin_all ON public.job_funding_stages
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

CREATE POLICY job_funding_stages_client_read ON public.job_funding_stages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.jobs j
             WHERE j.id = job_funding_stages.job_id
               AND j.client_id = auth.uid())
  );

REVOKE ALL ON TABLE public.job_funding_stages   FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.funding_term_defaults FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.job_funding_stages   TO authenticated;
GRANT SELECT ON TABLE public.funding_term_defaults TO authenticated;
GRANT ALL    ON TABLE public.job_funding_stages   TO service_role;
GRANT ALL    ON TABLE public.funding_term_defaults TO service_role;

REVOKE ALL ON FUNCTION public.nx_funding_mark_stage_funded(uuid,text,text) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_admin_set_funding_terms(uuid,jsonb)       FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_funding_ensure_schedule(uuid)             FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_funding_initial_satisfied(uuid)           FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_funding_delivery_satisfied(uuid)          FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.nx_funding_stage_is_funded(uuid,text)        FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_funding_mark_stage_funded(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nx_admin_set_funding_terms(uuid,jsonb)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_funding_ensure_schedule(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_funding_initial_satisfied(uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_funding_delivery_satisfied(uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nx_funding_stage_is_funded(uuid,text)        TO authenticated, service_role;

-- ─── 8. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_n int; v_bad text;
BEGIN
  -- 8a. default terms are the canonical 20/80 and sum correctly
  IF NOT EXISTS (SELECT 1 FROM public.funding_term_defaults
                  WHERE id = 1 AND initial_bps + final_bps = 10000) THEN
    RAISE EXCEPTION 'SELFTEST: funding_term_defaults is missing or does not total 10000 bps';
  END IF;

  -- 8b. the deadlock is actually broken: the gate no longer reads client_settled_at
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname='public' AND p.proname='nx_guard_dispatch_requires_funding'
                AND p.prosrc ~* 'NEW\.client_settled_at\s+IS\s+NULL') THEN
    RAISE EXCEPTION
      'SELFTEST: the dispatch gate still requires full settlement — the create-payment-intent deadlock is not broken';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='nx_guard_dispatch_requires_funding'
                    AND p.prosrc ~* 'nx_funding_initial_satisfied') THEN
    RAISE EXCEPTION 'SELFTEST: the dispatch gate does not consult the staged-funding spine';
  END IF;

  -- 8c. the gate is still installed and still binds service_role
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_jobs_dispatch_requires_funding' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: trg_jobs_dispatch_requires_funding is not attached — dispatch is ungated';
  END IF;

  -- 8d. ZERO automatic money movement anywhere in this spine
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname LIKE 'nx\_funding\_%'
     AND regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g') ~*
         '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts|supplier_earnings)\M';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'SELFTEST: % staged-funding function(s) move money (%) — funding records that the CLIENT paid and must never credit the Inspector', v_n, v_bad;
  END IF;

  -- 8e. no trigger on the spine reaches money DML
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal
       AND c.relname = 'job_funding_stages'
       AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?(wallets|transactions|earnings|payouts)\M'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: a trigger on job_funding_stages moves money';
  END IF;

  -- 8f. anon cannot reach the spine at all
  IF has_table_privilege('anon','public.job_funding_stages','SELECT')
     OR has_function_privilege('anon','public.nx_funding_mark_stage_funded(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon can reach the staged-funding spine';
  END IF;

  -- 8g. legacy interpretability: client_settled_at survives untouched
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='jobs'
                    AND column_name='client_settled_at') THEN
    RAISE EXCEPTION 'SELFTEST: jobs.client_settled_at was removed — legacy funding rows would become uninterpretable';
  END IF;

  -- 8h. no duplicate ledger: deals stay on their own schedule table
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='deal_payment_schedule') THEN
    RAISE EXCEPTION 'SELFTEST: deal_payment_schedule was removed — reconciliation must not delete the deals path';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
