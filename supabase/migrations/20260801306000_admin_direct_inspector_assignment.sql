-- ════════════════════════════════════════════════════════════════════════════
--  20260801306000_admin_direct_inspector_assignment.sql
--
--  FEATURE — an admin may assign a KNOWN, trusted inspector to a job even though
--  that inspector never applied. Real-world case: the engagement was agreed
--  off-platform and the admin just needs to book someone they already trust.
--
--  ── ARCHITECTURE: manufacture the row the pipeline already expects ──────────
--  Every downstream system in NEXPEC is keyed on an `applications` row —
--  job_contracts.application_id, admin_dispatch_job(p_application_id),
--  admin_replace_inspector(p_new_application_id). A second "assignment" concept
--  beside it would fork the hire pipeline and duplicate identity disclosure,
--  contract issuance, replacement and audit.
--
--  So this introduces NO parallel path. It CREATES the application the pipeline
--  already understands and then DELEGATES to the existing RPCs unchanged:
--
--      admin_assign_inspector_directly()
--         ├─ nx_admin_upsert_direct_application()   ← the only new hire logic
--         ├─ job is 'open'            → admin_dispatch_job()      (untouched)
--         └─ awaiting replacement     → admin_replace_inspector() (untouched)
--
--  Everything after that is byte-for-byte the existing flow: the contract is
--  still issued by admin_generate_job_contract on /admin/contracts, the client
--  still signs (or admin_authorized still stands in for the client per the job's
--  replacement_mode), and the inspector still counter-signs before becoming
--  active. No new approval semantics, no new contract state — the inspector's
--  explicit acceptance is the same signature step it has always been.
--
--  ── CLIENT INVISIBILITY IS STRUCTURAL, NOT COSMETIC ─────────────────────────
--  The provenance marker deliberately does NOT live on public.applications.
--  A column there would be returned by any `SELECT *` — and a client surface
--  already does exactly that (app/(client)/index.tsx). Invisibility that depends
--  on every developer forever avoiding `select('*')` is not invisibility.
--
--  Instead provenance lives in an annex table whose RLS admits ADMINS ONLY.
--  A client cannot read it however they query, so the three routes — inspector
--  applied, admin selected an applicant, admin assigned directly — are
--  indistinguishable at the DATABASE layer, not merely hidden in the UI.
--
--  The manufactured application is otherwise completely ordinary and fires the
--  SAME triggers as a real one:
--    • increment_job_applications_count → the client's "N applications" moves;
--    • tg_notify_applications (INSERT)  → the client receives the identical
--      "New inspector application" notification, emitted by the existing
--      trigger — this migration writes no client-facing notification at all;
--    • tg_app_sync_job_payout_to_bid    → payout syncs exactly as for a real bid.
--
--  ── SAFETY ──────────────────────────────────────────────────────────────────
--    • Additive only. No DROP, no data rewrite, no change to any existing policy.
--    • admin_dispatch_job / admin_replace_inspector / admin_generate_job_contract
--      are NOT modified.
--    • Refuses a job that still has a LIVE contract — displacing a working
--      inspector stays a conscious act in the replacement panel, with a reason.
--    • Refuses RFQ/brokered jobs, mirroring admin_replace_inspector.
--    • Self-hire impossible: the inspector may not be the job's client/agency.
--    • Verification is enforced in the DB, not merely in the admin UI.
--  Idempotent; self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Provenance annex — admin-readable only ───────────────────────────────
--  Absence of a row means "the inspector applied normally". Presence means an
--  admin booked them directly, and records who and why for the Audit Trail.
CREATE TABLE IF NOT EXISTS public.application_assignment_origin (
  application_id uuid PRIMARY KEY
    REFERENCES public.applications(id) ON DELETE CASCADE,
  job_id         uuid NOT NULL,
  inspector_id   uuid NOT NULL,
  assigned_by    uuid NOT NULL,
  reason         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_assignment_origin OWNER TO postgres;
ALTER TABLE public.application_assignment_origin ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.application_assignment_origin IS
  'INTERNAL. One row per application that an admin created on an inspector''s behalf via admin_assign_inspector_directly. Admin-only by RLS so the client can never distinguish a direct assignment from an ordinary application. No row = the inspector applied themselves.';

-- Admin-only read. No INSERT/UPDATE/DELETE policy exists, so the SECURITY
-- DEFINER RPC below is the only writer — same shape as the meeting tables.
DROP POLICY IF EXISTS application_assignment_origin_admin_read ON public.application_assignment_origin;
CREATE POLICY application_assignment_origin_admin_read
  ON public.application_assignment_origin
  FOR SELECT TO authenticated
  USING (public.nx_is_admin());

REVOKE ALL ON TABLE public.application_assignment_origin FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.application_assignment_origin TO authenticated;
GRANT ALL    ON TABLE public.application_assignment_origin TO service_role;

CREATE INDEX IF NOT EXISTS application_assignment_origin_job_idx
  ON public.application_assignment_origin (job_id);

-- ── 2) The daily cap is anti-spam for SELF-SERVICE applications ─────────────
--  An admin-originated assignment is not spam, and a trusted inspector who has
--  been busy today must not become un-assignable. The RPC sets a transaction-
--  local flag; the trigger honours it. A flag (not a column) keeps the
--  provenance signal off public.applications entirely — see the header.
--  Only the exemption is added; every other line is preserved byte-for-byte.
CREATE OR REPLACE FUNCTION public.enforce_application_rate_limit()
RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_limit int;
  v_count int;
BEGIN
  -- Skip if no applicant (admin-injected rows, system imports, etc.)
  IF NEW.applicant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ★ 306000: admin_assign_inspector_directly sets this for the duration of its
  --   own transaction only. It cannot be forged from PostgREST: the flag is
  --   read with is_local semantics and set exclusively inside that SECURITY
  --   DEFINER function.
  IF coalesce(current_setting('nexpec.admin_direct_assignment', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Resolve effective limit (per-user override or system default)
  SELECT COALESCE(daily_application_limit, public._default_daily_application_limit())
    INTO v_limit
  FROM public.profiles
  WHERE id = NEW.applicant_id;

  IF v_limit IS NULL THEN
    v_limit := public._default_daily_application_limit();
  END IF;

  -- Count submissions in rolling 24-hour window.
  -- Counts every row inserted (withdrawn / rejected included) per spec.
  SELECT count(*) INTO v_count
  FROM public.applications
  WHERE applicant_id = NEW.applicant_id
    AND created_at > now() - interval '24 hours';

  IF v_count >= v_limit THEN
    RAISE EXCEPTION
      'Daily application limit reached (% submitted in the last 24 hours, limit %). '
      'Try again later or contact support to request a higher cap.',
      v_count, v_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_application_rate_limit() OWNER TO postgres;

-- ── 3) Admin-only inspector search ──────────────────────────────────────────
--  Deliberately NOT inspectors_directory: that requires a complete published
--  profile, which would hide exactly the trusted-but-quiet inspector this
--  feature exists for. Admin-gated inside the function, so nothing widens for
--  anyone else and the anti-poaching directory rules are untouched.
CREATE OR REPLACE FUNCTION public.admin_search_assignable_inspectors(
  p_query text DEFAULT NULL,
  p_limit int  DEFAULT 20
) RETURNS TABLE (
  id              uuid,
  full_name       text,
  email           text,
  headline        text,
  location_city   text,
  is_verified     boolean,
  rating_average  numeric,
  specialty_slugs text[]
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.email, p.headline, p.location_city,
         COALESCE(p.is_verified, false), p.rating_average, p.specialty_slugs
    FROM public.profiles p
   WHERE p.role IN ('inspector', 'senior')
     AND COALESCE(p.is_verified, false) = true
     AND (
       p_query IS NULL OR btrim(p_query) = ''
       OR p.full_name     ILIKE '%' || btrim(p_query) || '%'
       OR p.email         ILIKE '%' || btrim(p_query) || '%'
       OR p.headline      ILIKE '%' || btrim(p_query) || '%'
       OR p.location_city ILIKE '%' || btrim(p_query) || '%'
     )
   ORDER BY p.full_name NULLS LAST
   LIMIT GREATEST(COALESCE(p_limit, 20), 1);
END $$;

ALTER FUNCTION public.admin_search_assignable_inspectors(text, int) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_search_assignable_inspectors(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_assignable_inspectors(text, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_search_assignable_inspectors(text, int) IS
  'Admin-only search over VERIFIED inspectors eligible for direct assignment (role inspector|senior AND is_verified). Returns PII, so it is admin-gated inside the function body.';

-- ── 4) The only genuinely new hire logic: manufacture the application ───────
CREATE OR REPLACE FUNCTION public.nx_admin_upsert_direct_application(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_payout_cents bigint
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_app_id uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  -- Reuse a live application rather than creating a second one. Covers "they
  -- applied anyway while we were talking to them" and keeps the client's
  -- application list free of duplicates.
  SELECT a.id INTO v_app_id
    FROM public.applications a
   WHERE a.job_id = p_job_id
     AND a.applicant_id = p_inspector_id
     AND a.status NOT IN ('rejected', 'withdrawn')
   ORDER BY a.created_at DESC
   LIMIT 1;

  IF v_app_id IS NOT NULL THEN
    UPDATE public.applications
       SET status           = 'CLIENT_SELECTED',
           bid_amount_cents = COALESCE(bid_amount_cents, p_payout_cents),
           updated_at       = now()
     WHERE id = v_app_id
       AND status <> 'CLIENT_SELECTED';
    RETURN v_app_id;
  END IF;

  -- Manufacture it. Inserted straight at CLIENT_SELECTED because the admin has
  -- already made the selection — that is the state admin_dispatch_job expects,
  -- and it is the same state admin_forward_application_to_client produces on
  -- the ordinary route.
  INSERT INTO public.applications (
    job_id, applicant_id, user_id, status, bid_amount_cents, currency
  ) VALUES (
    p_job_id, p_inspector_id, p_inspector_id, 'CLIENT_SELECTED', p_payout_cents, 'USD'
  )
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END $$;

ALTER FUNCTION public.nx_admin_upsert_direct_application(uuid, uuid, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_admin_upsert_direct_application(uuid, uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_admin_upsert_direct_application(uuid, uuid, bigint) TO service_role;

COMMENT ON FUNCTION public.nx_admin_upsert_direct_application(uuid, uuid, bigint) IS
  'Internal helper for admin_assign_inspector_directly. Returns the application id to hand to the existing dispatch/replacement RPCs, reusing a live application when one exists. NOT granted to authenticated — reachable only through admin_assign_inspector_directly.';

-- ── 5) Entry point — validate, record provenance, then delegate ─────────────
CREATE OR REPLACE FUNCTION public.admin_assign_inspector_directly(
  p_job_id                 uuid,
  p_inspector_id           uuid,
  p_client_price_cents     bigint,
  p_inspector_payout_cents bigint,
  p_reason                 text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_job    RECORD;
  v_insp   RECORD;
  v_app_id uuid;
  v_route  text;
  v_live   int;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a non-empty reason is required for a direct assignment' USING errcode = '22023';
  END IF;
  IF p_client_price_cents IS NULL OR p_client_price_cents <= 0
     OR p_inspector_payout_cents IS NULL OR p_inspector_payout_cents <= 0 THEN
    RAISE EXCEPTION 'client price and inspector payout must both be greater than zero' USING errcode = '22023';
  END IF;
  IF p_inspector_payout_cents > p_client_price_cents THEN
    RAISE EXCEPTION 'inspector payout cannot exceed client price' USING errcode = '22023';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  -- Inspection Marketplace only, exactly as admin_replace_inspector requires.
  IF v_job.source_rfq_id IS NOT NULL THEN
    RAISE EXCEPTION 'job % is a supplier-RFQ (brokered) job; direct assignment is an Inspection Marketplace operation', p_job_id
      USING errcode = '42501';
  END IF;

  -- Eligibility enforced HERE, not only in the admin UI.
  SELECT p.id, p.role, COALESCE(p.is_verified, false) AS is_verified
    INTO v_insp
    FROM public.profiles p WHERE p.id = p_inspector_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspector not found' USING errcode = 'P0002';
  END IF;
  IF v_insp.role NOT IN ('inspector', 'senior') THEN
    RAISE EXCEPTION 'user % is not an inspector', p_inspector_id USING errcode = '22023';
  END IF;
  IF NOT v_insp.is_verified THEN
    RAISE EXCEPTION 'inspector % is not verified and cannot be assigned', p_inspector_id USING errcode = '22023';
  END IF;

  -- Self-hire guard: the buyer may never be the inspector on their own job.
  IF p_inspector_id IN (v_job.client_id, v_job.agency_id) THEN
    RAISE EXCEPTION 'the job owner cannot be assigned as its inspector' USING errcode = '42501';
  END IF;
  IF v_job.contractor_id = p_inspector_id THEN
    RAISE EXCEPTION 'inspector % is already assigned to this job', p_inspector_id USING errcode = '22023';
  END IF;

  -- Never silently displace a working inspector.
  SELECT count(*) INTO v_live
    FROM public.job_contracts c
   WHERE c.job_id = p_job_id AND c.status <> 'voided';
  IF v_live > 0 THEN
    RAISE EXCEPTION 'job % already has a live contract; void or replace it from the replacement panel first', p_job_id
      USING errcode = '42501';
  END IF;

  -- Group everything below under one correlation id in the Audit Trail and
  -- record the admin's stated reason as the intent. This is the only place the
  -- direct route is announced, and it is internal.
  PERFORM public.audit_set_correlation(gen_random_uuid());
  PERFORM public.audit_set_intent('Admin direct assignment: ' || btrim(p_reason));

  -- Transaction-local exemption from the self-service daily cap.
  PERFORM set_config('nexpec.admin_direct_assignment', 'on', true);

  v_app_id := public.nx_admin_upsert_direct_application(
    p_job_id, p_inspector_id, p_inspector_payout_cents
  );

  -- Provenance for Admin + Audit only. ON CONFLICT: re-assigning after a void
  -- reuses the same application row, and the original booking record stands.
  INSERT INTO public.application_assignment_origin (
    application_id, job_id, inspector_id, assigned_by, reason
  ) VALUES (
    v_app_id, p_job_id, p_inspector_id, auth.uid(), btrim(p_reason)
  )
  ON CONFLICT (application_id) DO NOTHING;

  -- ── Delegate. No hire logic is reimplemented here. ──
  IF v_job.status = 'open' THEN
    v_route := 'dispatch';
    PERFORM public.admin_dispatch_job(
      p_job_id, v_app_id, p_client_price_cents, p_inspector_payout_cents, 'unpaid'
    );
  ELSIF public.nx_job_awaiting_replacement(p_job_id) THEN
    -- Lost its inspector to a void, no live contract. Precisely
    -- admin_replace_inspector's job, and it honours the project's
    -- replacement_mode (client_reapproval vs admin_authorized) unchanged.
    v_route := 'replacement';
    PERFORM public.admin_replace_inspector(
      p_job_id, v_app_id, p_client_price_cents, p_inspector_payout_cents, btrim(p_reason)
    );
  ELSE
    RAISE EXCEPTION 'job % is not in an assignable state (status=%)', p_job_id, v_job.status
      USING errcode = '22023';
  END IF;

  PERFORM set_config('nexpec.admin_direct_assignment', 'off', true);

  RETURN jsonb_build_object(
    'ok',             true,
    'job_id',         p_job_id,
    'inspector_id',   p_inspector_id,
    'application_id', v_app_id,
    'route',          v_route
  );
END $$;

ALTER FUNCTION public.admin_assign_inspector_directly(uuid, uuid, bigint, bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_assign_inspector_directly(uuid, uuid, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_inspector_directly(uuid, uuid, bigint, bigint, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_assign_inspector_directly(uuid, uuid, bigint, bigint, text) IS
  'Assign a known verified inspector to a job with no prior application. Manufactures the applications row the hire pipeline already expects, records admin-only provenance, and delegates to admin_dispatch_job (open job) or admin_replace_inspector (awaiting replacement). Adds no new approval semantics: the client experience and the inspector signature step are unchanged, and the route is invisible to the client.';

-- ── 6) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_def text;
  v_pol int;
BEGIN
  -- (a) provenance is NOT on public.applications — that is the whole point.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='applications'
       AND column_name IN ('origin','assignment_origin','is_direct_assignment')
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a provenance column was added to applications — SELECT * would leak it to the client';
  END IF;

  -- (b) the annex exists, has RLS on, is admin-only to read, and has NO write
  --     policy (so the SECURITY DEFINER RPC stays the only writer).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='application_assignment_origin' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: application_assignment_origin missing or RLS disabled';
  END IF;
  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname='public' AND tablename='application_assignment_origin'
     AND cmd IN ('INSERT','UPDATE','DELETE','ALL');
  IF v_pol > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a write policy exists on the provenance annex';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='application_assignment_origin'
       AND cmd='SELECT' AND qual ILIKE '%nx_is_admin%'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: provenance annex is not admin-only on read';
  END IF;

  -- (c) rate-limit exemption present AND the cap itself still fires.
  v_def := pg_get_functiondef('public.enforce_application_rate_limit()'::regprocedure);
  IF position('nexpec.admin_direct_assignment' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: rate-limit exemption missing';
  END IF;
  IF position('Daily application limit reached' IN v_def) = 0
     OR position('IF v_count >= v_limit THEN' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the daily cap was removed — self-service spam control must survive';
  END IF;

  -- (d) DELEGATION, not duplication.
  v_def := pg_get_functiondef('public.admin_assign_inspector_directly(uuid,uuid,bigint,bigint,text)'::regprocedure);
  IF position('admin_dispatch_job' IN v_def) = 0
     OR position('admin_replace_inspector' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: entry point does not delegate to the existing hire RPCs';
  END IF;
  IF v_def ~* 'UPDATE\s+public\.jobs' OR v_def ~* 'INSERT\s+INTO\s+public\.job_contracts' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: entry point writes jobs/job_contracts directly — that logic must stay in the delegated RPCs';
  END IF;
  IF position('already has a live contract' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: live-contract guard missing';
  END IF;
  IF position('is not verified and cannot be assigned' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: verification is not enforced server-side';
  END IF;

  -- (e) the pre-existing hire RPCs were not touched by this migration.
  IF pg_get_functiondef('public.admin_dispatch_job(uuid,uuid,bigint,bigint,text)'::regprocedure)
       ~* 'assignment_origin|admin_direct' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin_dispatch_job was altered — the existing flow must be untouched';
  END IF;

  -- (f) privilege surface
  IF has_function_privilege('authenticated',
       'public.nx_admin_upsert_direct_application(uuid,uuid,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the internal helper is callable by authenticated users';
  END IF;
  IF has_function_privilege('anon', 'public.admin_assign_inspector_directly(uuid,uuid,bigint,bigint,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_search_assignable_inspectors(text,int)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.application_assignment_origin', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can reach the direct-assignment surface';
  END IF;

  RAISE NOTICE 'direct assignment ready: provenance is admin-only by RLS, hire delegated to the existing RPCs, client-visible behaviour unchanged.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
