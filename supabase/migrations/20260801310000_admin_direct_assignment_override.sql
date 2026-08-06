-- ════════════════════════════════════════════════════════════════════════════
--  20260801310000_admin_direct_assignment_override.sql
--
--  PRODUCT CHANGE — the admin direct-assignment workflow (306000) refused two
--  things that real NEXPEC operations require:
--    1. an inspector who is not yet globally verified;
--    2. the admin assigning themselves, when the admin is also the inspector.
--  Both restrictions are lifted, but ONLY inside this admin-only RPC. Nothing
--  about the ordinary marketplace path changes: an inspector applying normally
--  still faces every existing verification and eligibility rule, because this
--  migration does not touch a single policy, trigger or application-side gate.
--
--  ── WHY NO NEW ROLE OR CAPABILITY SYSTEM IS NEEDED ─────────────────────────
--  Audited before designing. In this schema, inspector OPERATIONAL access is
--  entirely RELATIONSHIP-based, never role-based:
--    • 0 of 356 RLS policies gate on profiles.role = 'inspector'; the job-party
--      policies match contractor_id / hired_inspector_id / inspector_id
--      = auth.uid();
--    • inspector_sign_job_contract gates on job_contracts.inspector_id = auth.uid()
--      — no role check;
--    • the audit/actor derivation is relationship-FIRST
--      (`IF v_actor = v_job.contractor_id THEN v_actor_role := 'inspector'`),
--      so an admin who is the contractor is already correctly treated as the
--      inspector for that job;
--    • guard_application_self_transition already exempts nx_is_admin().
--
--  Therefore setting jobs.contractor_id to the admin's own id is BY ITSELF the
--  complete, correct representation of "this admin is the inspector on this
--  job". It grants exactly the assigned-inspector surface for THAT ONE JOB —
--  captures, reports, documents, AI Co-Inspector, job messaging, contract
--  signing, deliverables — and nothing anywhere else, because every one of
--  those gates is per-job. It does NOT give admins inspector access to other
--  jobs, and it does not alter the admin's global role, so their admin
--  dashboard is untouched. A capability table or a dual-role column would be
--  strictly redundant machinery.
--
--  ── SELF-ASSIGNMENT AND CONTRACT ACCEPTANCE ────────────────────────────────
--  Nothing is auto-signed. The contract flow is entirely unchanged: the client
--  signs (client_reapproval) or the admin authorisation stands in for the
--  client side (admin_authorized), and then the INSPECTOR counter-signs. When
--  the inspector is the admin, that counter-signature is simply made by the same
--  logged-in account — no account switching is required and nothing is bypassed,
--  so the contractual state machine and the audit trail both stay valid and
--  idempotent. inspector_sign_job_contract already permits this: it checks
--  inspector_id = auth.uid(), not a role.
--
--  ── CLIENT INVISIBILITY ────────────────────────────────────────────────────
--  Unchanged and structural. The override facts live ONLY in
--  application_assignment_origin, whose RLS admits admins only, and which is
--  reachable by no client-facing projection. Nothing is written to
--  public.applications, so a client `select('*')` cannot reveal any of it.
--  No new notification, wording, status, badge or column is introduced.
--  Client-side identity remains governed solely by protected/professional/full.
--
--  ── SAFEGUARDS RETAINED (none of these are relaxed) ─────────────────────────
--    • non-admin callers rejected (nx_is_admin);
--    • RFQ / brokered jobs rejected;
--    • a job with a LIVE contract rejected — replacing a working inspector
--      still requires the void/replacement workflow;
--    • the job's own client/agency can never be the inspector (buyer self-hire);
--    • the inspector must be a real profile whose role can perform inspections
--      (inspector | senior | admin | super_admin) — arbitrary user ids and
--      client/supplier accounts are still refused;
--    • already-assigned inspector rejected;
--    • an internal reason is now MANDATORY for either override.
--  Idempotent; self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Provenance annex gains the override facts (admin-only by RLS) ────────
ALTER TABLE public.application_assignment_origin
  ADD COLUMN IF NOT EXISTS verification_overridden  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS self_assigned            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inspector_was_verified   boolean,
  ADD COLUMN IF NOT EXISTS inspector_role_at_assignment text;

COMMENT ON COLUMN public.application_assignment_origin.verification_overridden IS
  'TRUE when an admin assigned an inspector who was not globally verified at assignment time.';
COMMENT ON COLUMN public.application_assignment_origin.self_assigned IS
  'TRUE when the assigning admin assigned themselves as the inspector.';
COMMENT ON COLUMN public.application_assignment_origin.inspector_was_verified IS
  'Snapshot of profiles.is_verified at assignment time — the PREVIOUS verification state, preserved even if the inspector is verified later.';
COMMENT ON COLUMN public.application_assignment_origin.inspector_role_at_assignment IS
  'Snapshot of profiles.role at assignment time (e.g. admin, when an admin performed the inspection personally).';

-- ── 2) The entry point, with the two admin-only overrides ───────────────────
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
  v_job         RECORD;
  v_insp        RECORD;
  v_app_id      uuid;
  v_route       text;
  v_live        int;
  v_actor       uuid := auth.uid();
  v_self        boolean := false;
  v_override    boolean := false;
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

  IF v_job.source_rfq_id IS NOT NULL THEN
    RAISE EXCEPTION 'job % is a supplier-RFQ (brokered) job; direct assignment is an Inspection Marketplace operation', p_job_id
      USING errcode = '42501';
  END IF;

  -- The target must be a REAL profile. Arbitrary uuids are still refused.
  SELECT p.id, p.role, COALESCE(p.is_verified, false) AS is_verified
    INTO v_insp
    FROM public.profiles p WHERE p.id = p_inspector_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspector not found' USING errcode = 'P0002';
  END IF;

  v_self     := (p_inspector_id = v_actor);
  v_override := NOT v_insp.is_verified;

  -- ★ OVERRIDE 1 — role. Previously: role had to be inspector|senior.
  --   Now an admin/super_admin may also be the inspector (the admin who
  --   personally performs the inspection). Buyers and suppliers are still
  --   refused: a client account can never become the inspector.
  IF v_insp.role NOT IN ('inspector', 'senior', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'user % cannot be assigned as an inspector (role=%)', p_inspector_id, v_insp.role
      USING errcode = '22023';
  END IF;

  -- ★ OVERRIDE 2 — verification. Previously: hard refusal when not verified.
  --   Now permitted for an admin caller, but ONLY with a stated internal reason,
  --   which is recorded privately below. The reason requirement is the whole
  --   point: the override is accountable, not silent.
  --   NOTE: this relaxation lives here and nowhere else. No policy, trigger or
  --   marketplace application path is changed, so an inspector applying in the
  --   ordinary way still meets every existing verification rule.
  IF (v_override OR v_self) AND length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION
      'an internal reason of at least 10 characters is required when overriding verification or self-assigning'
      USING errcode = '22023';
  END IF;

  -- RETAINED: the buyer may never inspect their own job. This is NOT the
  -- admin self-assignment case — it blocks the job's client/agency only.
  IF p_inspector_id IN (v_job.client_id, v_job.agency_id) THEN
    RAISE EXCEPTION 'the job owner cannot be assigned as its inspector' USING errcode = '42501';
  END IF;
  IF v_job.contractor_id = p_inspector_id THEN
    RAISE EXCEPTION 'inspector % is already assigned to this job', p_inspector_id USING errcode = '22023';
  END IF;

  -- RETAINED: never silently displace a working inspector.
  SELECT count(*) INTO v_live
    FROM public.job_contracts c
   WHERE c.job_id = p_job_id AND c.status <> 'voided';
  IF v_live > 0 THEN
    RAISE EXCEPTION 'job % already has a live contract; void or replace it from the replacement panel first', p_job_id
      USING errcode = '42501';
  END IF;

  PERFORM public.audit_set_correlation(gen_random_uuid());
  PERFORM public.audit_set_intent('Admin direct assignment: ' || btrim(p_reason));
  PERFORM set_config('nexpec.admin_direct_assignment', 'on', true);

  v_app_id := public.nx_admin_upsert_direct_application(
    p_job_id, p_inspector_id, p_inspector_payout_cents
  );

  -- Private accountability record. Admin-only by RLS; never client-visible.
  INSERT INTO public.application_assignment_origin (
    application_id, job_id, inspector_id, assigned_by, reason,
    verification_overridden, self_assigned,
    inspector_was_verified, inspector_role_at_assignment
  ) VALUES (
    v_app_id, p_job_id, p_inspector_id, v_actor, btrim(p_reason),
    v_override, v_self,
    v_insp.is_verified, v_insp.role
  )
  ON CONFLICT (application_id) DO UPDATE
    SET verification_overridden = EXCLUDED.verification_overridden,
        self_assigned           = EXCLUDED.self_assigned,
        inspector_was_verified  = EXCLUDED.inspector_was_verified,
        inspector_role_at_assignment = EXCLUDED.inspector_role_at_assignment,
        reason                  = EXCLUDED.reason;

  -- Delegate. No hire logic is reimplemented here, and the client-facing
  -- workflow is byte-for-byte the ordinary one.
  IF v_job.status = 'open' THEN
    v_route := 'dispatch';
    PERFORM public.admin_dispatch_job(
      p_job_id, v_app_id, p_client_price_cents, p_inspector_payout_cents, 'unpaid'
    );
  ELSIF public.nx_job_awaiting_replacement(p_job_id) THEN
    v_route := 'replacement';
    PERFORM public.admin_replace_inspector(
      p_job_id, v_app_id, p_client_price_cents, p_inspector_payout_cents, btrim(p_reason)
    );
  ELSE
    RAISE EXCEPTION 'job % is not in an assignable state (status=%)', p_job_id, v_job.status
      USING errcode = '22023';
  END IF;

  PERFORM set_config('nexpec.admin_direct_assignment', 'off', true);

  -- The return value is consumed ONLY by the admin server action. It never
  -- reaches a client surface.
  RETURN jsonb_build_object(
    'ok',                      true,
    'job_id',                  p_job_id,
    'inspector_id',            p_inspector_id,
    'application_id',          v_app_id,
    'route',                   v_route,
    'verification_overridden', v_override,
    'self_assigned',           v_self
  );
END $$;

ALTER FUNCTION public.admin_assign_inspector_directly(uuid, uuid, bigint, bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_assign_inspector_directly(uuid, uuid, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_inspector_directly(uuid, uuid, bigint, bigint, text)
  TO authenticated, service_role;

-- ── 3) Admin-only search, now able to include unverified inspectors ─────────
--  The 306000 version took (text, int) and BOTH of its arguments had defaults.
--  Adding a (text, int, boolean) overload beside it would make a two-argument
--  call ambiguous ("function is not unique"), and the RETURNS TABLE shape also
--  changes here — CREATE OR REPLACE cannot alter a return type. So the previous
--  signature is dropped first. This drops only the function introduced by
--  306000; no pre-existing object is affected.
DROP FUNCTION IF EXISTS public.admin_search_assignable_inspectors(text, int);

CREATE OR REPLACE FUNCTION public.admin_search_assignable_inspectors(
  p_query             text    DEFAULT NULL,
  p_limit             int     DEFAULT 20,
  p_include_unverified boolean DEFAULT false
) RETURNS TABLE (
  id              uuid,
  full_name       text,
  email           text,
  headline        text,
  location_city   text,
  is_verified     boolean,
  rating_average  numeric,
  specialty_slugs text[],
  role            text,
  is_self         boolean
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
         COALESCE(p.is_verified, false), p.rating_average, p.specialty_slugs,
         p.role,
         (p.id = auth.uid())
    FROM public.profiles p
   WHERE (
           p.role IN ('inspector', 'senior')
           -- An admin/super_admin is assignable so the admin can select
           -- themselves (or a colleague admin who performs inspections).
           OR p.role IN ('admin', 'super_admin')
         )
     AND (p_include_unverified OR COALESCE(p.is_verified, false) = true
          OR p.role IN ('admin', 'super_admin'))
     AND (
       p_query IS NULL OR btrim(p_query) = ''
       OR p.full_name     ILIKE '%' || btrim(p_query) || '%'
       OR p.email         ILIKE '%' || btrim(p_query) || '%'
       OR p.headline      ILIKE '%' || btrim(p_query) || '%'
       OR p.location_city ILIKE '%' || btrim(p_query) || '%'
       -- Search by inspector id / NX handle as the admin data model permits.
       OR p.id::text       =      btrim(p_query)
       OR public.nx_handle(p.id) ILIKE '%' || btrim(p_query) || '%'
     )
   ORDER BY (p.id = auth.uid()) DESC, COALESCE(p.is_verified,false) DESC, p.full_name NULLS LAST
   LIMIT GREATEST(COALESCE(p_limit, 20), 1);
END $$;

ALTER FUNCTION public.admin_search_assignable_inspectors(text, int, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_search_assignable_inspectors(text, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_assignable_inspectors(text, int, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_search_assignable_inspectors(text, int, boolean) IS
  'Admin-only search for direct assignment. Searches name / email / headline / city / user id / NX handle. p_include_unverified opts an admin into unverified inspectors; admins are always listed so the caller can select themselves. Returns PII, so it is admin-gated inside the body.';

-- ── 4) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_def text;
BEGIN
  -- (a) annex carries the override facts
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='application_assignment_origin'
         AND column_name IN ('verification_overridden','self_assigned',
                             'inspector_was_verified','inspector_role_at_assignment')) <> 4 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: provenance annex is missing override columns';
  END IF;

  -- (b) still admin-only on read, still no write policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='application_assignment_origin' AND cmd='SELECT' AND qual ILIKE '%nx_is_admin%'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: annex is no longer admin-only on read';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='application_assignment_origin' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a write policy appeared on the annex';
  END IF;

  -- (c) NOTHING was written to public.applications — client SELECT * must stay clean
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='applications'
       AND column_name IN ('origin','verification_overridden','self_assigned',
                           'assignment_origin','is_direct_assignment')
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an override marker leaked onto public.applications';
  END IF;

  v_def := pg_get_functiondef('public.admin_assign_inspector_directly(uuid,uuid,bigint,bigint,text)'::regprocedure);

  -- (d) the two overrides exist
  IF position($q$'inspector', 'senior', 'admin', 'super_admin'$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin-as-inspector override missing';
  END IF;
  IF position('at least 10 characters is required when overriding' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: mandatory override reason missing';
  END IF;
  IF position('is not verified and cannot be assigned' IN v_def) > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the hard verification refusal is still present';
  END IF;

  -- (e) every retained safeguard is still there
  IF position('admin only' IN v_def) = 0
     OR position('brokered) job' IN v_def) = 0
     OR position('already has a live contract' IN v_def) = 0
     OR position('the job owner cannot be assigned as its inspector' IN v_def) = 0
     OR position('is already assigned to this job' IN v_def) = 0
     OR position('inspector not found' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a retained safeguard was dropped';
  END IF;

  -- (f) still delegation, not a second hire pipeline
  IF position('admin_dispatch_job' IN v_def) = 0
     OR position('admin_replace_inspector' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: delegation to the existing hire RPCs was lost';
  END IF;
  IF v_def ~* 'UPDATE\s+public\.jobs' OR v_def ~* 'INSERT\s+INTO\s+public\.job_contracts' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the entry point now writes jobs/job_contracts directly';
  END IF;

  -- (g) the marketplace path is untouched: this migration must not have
  --     redefined any policy, trigger or application-side guard.
  IF pg_get_functiondef('public.guard_application_self_transition()'::regprocedure)
       !~ 'an applicant may only withdraw their own application' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ordinary application self-hire guard was altered';
  END IF;

  -- (h) privilege surface unchanged
  IF has_function_privilege('anon','public.admin_assign_inspector_directly(uuid,uuid,bigint,bigint,text)','EXECUTE')
     OR has_function_privilege('anon','public.admin_search_assignable_inspectors(text,integer,boolean)','EXECUTE')
     OR has_table_privilege('anon','public.application_assignment_origin','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can reach the direct-assignment surface';
  END IF;

  RAISE NOTICE 'admin override live: unverified + self-assignment permitted for admins only, accountable in the admin-only annex, client-visible behaviour unchanged.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
