-- ════════════════════════════════════════════════════════════════════════════
--  20260801580000_marketplace_visibility_and_email_verification.sql
--
--  TWO SECURITY/RELEASE ITEMS, both server-enforced.
--
--  1. MARKETPLACE VISIBILITY (App Store reviewer demo).
--     The reviewer account apple_tester@nexpec.com owns
--     "Demo: Pipeline UT Inspection (App Review)". It is status='open' +
--     moderation_status='approved', which is exactly what the authenticated
--     inspector marketplace lists, and the codebase had NO demo-exclusion
--     mechanism — so the demo job was discoverable by real inspectors.
--
--     jobs.public_listable does NOT solve this: that flag governs the
--     ANONYMOUS public demand-feed teasers (20260801172000) and already
--     defaults false; it has no bearing on the authenticated marketplace.
--
--     jobs.marketplace_hidden is therefore added, DEFAULT false so every
--     normal job is unaffected, and enforced inside
--     jobs_inspector_secure_view — the single view behind the web marketplace
--     (openJobs.ts) and the mobile browse/jobs/dashboard screens. Server-side
--     by construction: no client-side hiding is relied upon.
--
--     Hidden ONLY affects open-marketplace discovery. An inspector who has
--     already applied, or who is assigned/hired, still sees the job — losing
--     access to live work would be a worse bug than the one being fixed. The
--     owning client and admins are unaffected.
--
--     Only admin/super_admin may change the flag: a trigger rejects any other
--     writer, and the setter RPC audit-logs every change.
--
--  2. EMAIL-VERIFICATION HELPER.
--     Audit finding: NOTHING in the codebase or RLS consults
--     auth.users.email_confirmed_at — an unverified account had the same
--     rights as a verified one. nx_email_verified() gives SQL, RLS and the
--     application one shared answer. It is introduced here as the authority;
--     wiring it into individual write paths is deliberately NOT bundled into
--     this migration, because gating live production write paths is a
--     behavioural change that must be reviewed against existing users first
--     (see the report: existing unverified accounts must not be locked out).
--
--  BLAST RADIUS: additive. One column with a safe default, one view predicate
--  that only narrows OPEN-marketplace discovery, one trigger, two functions.
--  No existing policy, RPC or money path is modified.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The visibility field ────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS marketplace_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jobs.marketplace_hidden IS
  'TRUE hides the job from authenticated open-marketplace discovery (search, feeds, recommendations) while keeping it fully usable for its owner, assigned inspector and admins. Admin-settable only. Used for App Store / Play reviewer demo jobs.';

-- ─── 2. Only admins may change it ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_guard_marketplace_hidden()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.marketplace_hidden IS DISTINCT FROM OLD.marketplace_hidden
     AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION
      'MARKETPLACE_VISIBILITY_ADMIN_ONLY: only an administrator may change job marketplace visibility'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_marketplace_hidden ON public.jobs;
CREATE TRIGGER trg_guard_marketplace_hidden
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.nx_guard_marketplace_hidden();

-- ─── 3. Admin setter, audit-logged ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_job_marketplace_visibility(
  p_job_id uuid,
  p_hidden boolean,
  p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_old boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT marketplace_hidden INTO v_old FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.jobs SET marketplace_hidden = p_hidden WHERE id = p_job_id;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
  VALUES
    ('job.marketplace_visibility_changed', 'info', v_actor, 'jobs', p_job_id, p_job_id,
     CASE WHEN p_hidden THEN 'Job hidden from open marketplace'
          ELSE 'Job restored to open marketplace' END,
     jsonb_build_object('from', v_old, 'to', p_hidden, 'reason', NULLIF(btrim(COALESCE(p_reason,'')), '')));

  RETURN true;
END;
$fn$;

ALTER FUNCTION public.admin_set_job_marketplace_visibility(uuid, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_job_marketplace_visibility(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_job_marketplace_visibility(uuid, boolean, text) TO authenticated, service_role;

-- ─── 4. Email-verification authority ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_email_verified(p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_uid AND u.email_confirmed_at IS NOT NULL
  );
$fn$;

ALTER FUNCTION public.nx_email_verified(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_email_verified(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_email_verified(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_email_verified(uuid) IS
  'Single authority for "is this account email-verified". Nothing consulted auth.users.email_confirmed_at before this. Wire into write paths only after auditing existing users, so legitimate unverified accounts are not locked out.';

-- ─── 5. Marketplace view honours the flag ───────────────────────────────────
CREATE OR REPLACE VIEW public.jobs_inspector_secure_view AS
SELECT id,
    title,
    description,
    location,
        CASE
            WHEN nx_is_admin() THEN price_cents
            ELSE NULL::bigint
        END AS price_cents,
    status,
    client_id,
    contractor_id,
    created_at,
    updated_at,
    is_senior_review,
    is_featured,
        CASE
            WHEN nx_is_admin() THEN budget_cents
            ELSE NULL::bigint
        END AS budget_cents,
        CASE
            WHEN nx_is_admin() THEN budget_min_cents
            ELSE NULL::bigint
        END AS budget_min_cents,
        CASE
            WHEN nx_is_admin() THEN budget_max_cents
            ELSE NULL::bigint
        END AS budget_max_cents,
    budget_type,
    location_city,
    urgency,
    job_type,
    required_certifications,
    scheduled_date,
    applications_count,
    template_url,
        CASE
            WHEN nx_is_admin() THEN contractor_payout_amount_cents
            ELSE NULL::bigint
        END AS contractor_payout_amount_cents,
    contract_id,
    contract_generated_at,
    inspector_id,
        CASE
            WHEN nx_is_admin() THEN client_price_cents
            ELSE NULL::bigint
        END AS client_price_cents,
    payout_amount_cents,
    latitude,
    longitude,
    inspection_type,
    calendar_event_id,
    calendar_synced_at,
    hired_inspector_id,
    agency_id,
    inspector_payout_cents,
    admin_confirmed_at,
    admin_confirmed_by,
    payout_status,
    currency,
    estimated_duration,
    escrow_status,
    deleted_at,
        CASE
            WHEN nx_is_admin() THEN platform_spread_cents
            ELSE NULL::bigint
        END AS platform_spread_cents,
    geog,
    report_template_id,
    specialty_slugs,
    job_country,
    sponsorship_offered,
    accepts_remote_inspectors,
    scope_template_id,
    claimed_address_text,
    claimed_address_geocoded,
    started_at,
    cancelled_at,
    cancelled_by,
    cancel_reason,
    payout_paid_at,
    payout_reference,
    payout_notes,
    payout_marked_by,
    moderation_status,
    moderation_reviewed_at,
    moderation_reviewed_by,
    moderation_notes,
    requires_cci,
    client_op_id,
    report_signed_docs_url,
    report_signed_docs_notes,
    department_id,
    domain,
    source_rfq_id,
    payment_mode,
    client_invoiced_at,
    client_settled_at,
    public_listable,
    identity_mode,
    replacement_mode
   FROM jobs j
  WHERE nx_is_admin() OR contractor_id = auth.uid() OR hired_inspector_id = auth.uid() OR inspector_id = auth.uid() OR nx_is_inspector() AND ((EXISTS ( SELECT 1
           FROM applications a
          WHERE a.job_id = j.id AND a.applicant_id = auth.uid())) OR deleted_at IS NULL AND status = 'open'::text AND moderation_status = 'approved'::text AND COALESCE(marketplace_hidden, false) = false);

-- ─── 6. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_client uuid := gen_random_uuid(); v_insp uuid := gen_random_uuid();
  v_insp2 uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  v_job uuid := gen_random_uuid(); v_open uuid := gen_random_uuid();
  n int; v_def text;
BEGIN
  SELECT pg_get_viewdef('public.jobs_inspector_secure_view'::regclass, true) INTO v_def;
  IF v_def !~ 'marketplace_hidden' THEN
    RAISE EXCEPTION 'SELFTEST: the marketplace view does not honour marketplace_hidden';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, email_confirmed_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'mv.'||u::text||'@synthetic.invalid', now(), now(),
           CASE WHEN u = v_insp2 THEN NULL ELSE now() END
      FROM unnest(ARRAY[v_client,v_insp,v_insp2,v_admin]) u;
    INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
      (v_client,'client','MV Client','mv.c@synthetic.invalid',true),
      (v_insp,'inspector','MV Inspector','mv.i@synthetic.invalid',true),
      (v_insp2,'inspector','MV Unverified','mv.i2@synthetic.invalid',true),
      (v_admin,'super_admin','MV Admin','mv.a@synthetic.invalid',true)
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

    -- a HIDDEN demo job and a NORMAL open job, both open+approved
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode,marketplace_hidden)
    VALUES (v_job,'MV demo (reviewer)',v_client,'open','approved','prepay',100000,80000,'protected',true),
           (v_open,'MV normal open',   v_client,'open','approved','prepay',100000,80000,'protected',false);

    -- ORDINARY INSPECTOR: sees the normal job, not the hidden one.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_insp::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO n FROM public.jobs_inspector_secure_view WHERE id = v_job;
    IF n <> 0 THEN RAISE EXCEPTION 'SELFTEST: hidden demo job is VISIBLE to an ordinary inspector'; END IF;
    SELECT count(*) INTO n FROM public.jobs_inspector_secure_view WHERE id = v_open;
    IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST: a NORMAL open job disappeared (regression)'; END IF;
    RESET ROLE;

    -- OWNER still sees their own job (client surfaces are unaffected).
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_client::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO n FROM public.jobs WHERE id = v_job;
    IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST: owner lost access to their hidden job'; END IF;
    -- …and cannot flip the flag themselves.
    BEGIN
      UPDATE public.jobs SET marketplace_hidden = false WHERE id = v_job;
      RAISE EXCEPTION 'SELFTEST: a non-admin changed marketplace visibility';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    -- ADMIN sees it and may toggle it, with an audit row.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_admin::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO n FROM public.jobs_inspector_secure_view WHERE id = v_job;
    IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST: admin cannot see the hidden job'; END IF;
    PERFORM public.admin_set_job_marketplace_visibility(v_job, false, 'selftest');
    SELECT count(*) INTO n FROM public.audit_events
      WHERE subject_id = v_job AND event_type = 'job.marketplace_visibility_changed';
    IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST: visibility change was not audit-logged'; END IF;
    PERFORM public.admin_set_job_marketplace_visibility(v_job, true, 'selftest restore');
    RESET ROLE;

    -- Email-verification authority reports truthfully.
    IF NOT public.nx_email_verified(v_insp) THEN
      RAISE EXCEPTION 'SELFTEST: a confirmed user reported unverified';
    END IF;
    IF public.nx_email_verified(v_insp2) THEN
      RAISE EXCEPTION 'SELFTEST: an UNCONFIRMED user reported verified';
    END IF;

    RAISE NOTICE 'SELFTEST ok — hidden job invisible to inspectors, normal jobs unaffected, owner+admin retain access, admin-only toggle audited, email-verification authority correct';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated); catalogue assertions passed';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE 'mv.%@synthetic.invalid') THEN
    RAISE EXCEPTION 'SELFTEST: synthetic fixtures survived';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
