-- ════════════════════════════════════════════════════════════════════════════
--  20260801562000_client_engaged_application_history.sql
--
--  OWNER-REVIEW — the hired inspector's application vanished from the client
--  after hiring/completion.
--
--  ── ROOT CAUSE (traced in the live policies) ────────────────────────────────
--  Both client-facing SELECT policies on public.applications
--  (applications_client_select_own_jobs, and the client branch of
--  applications_read) hard-require forwarded_to_client_at IS NOT NULL — the
--  anti-poaching gate from 20260801272000. That gate is correct for
--  PRE-ENGAGEMENT proposals: a client must never browse bids an admin has not
--  vetted and forwarded. But it was also applied to ENGAGED applications
--  (CLIENT_SELECTED / hired / accepted). An application hired through a path
--  that never stamped the forwarding timestamp (e.g. admin direct assignment)
--  was therefore permanently invisible to the very client who signed the
--  engagement — "Review 1 application" (denormalized count) over an
--  Applications page truthfully rendering zero rows, and the historical
--  record disappeared after completion.
--
--  ── FIX ─────────────────────────────────────────────────────────────────────
--  Visibility for the client on their own job becomes:
--      forwarded_to_client_at IS NOT NULL          (vetted proposals — as before)
--      OR status IN ('CLIENT_SELECTED','hired','accepted')   (engaged record)
--  An engaged status is client-caused or contract-backed — it cannot exist
--  without the client already knowing the counterparty, so nothing new can
--  leak. Pre-engagement, unforwarded proposals stay hidden exactly as 272000 /
--  516000 demand. The same predicate lands on job_applicant_identity_view so
--  the identity projection (still mode-gated; contact still admin-only per
--  20260801558000) covers the hired record too.
--
--  History is append-only truth: hired/completed applications never disappear.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. applications: client SELECT policies ────────────────────────────────

DROP POLICY IF EXISTS applications_client_select_own_jobs ON public.applications;
CREATE POLICY applications_client_select_own_jobs ON public.applications
FOR SELECT USING (
  (
    forwarded_to_client_at IS NOT NULL
    OR status = ANY (ARRAY['CLIENT_SELECTED'::text, 'hired'::text, 'accepted'::text])
  )
  AND EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = applications.job_id
      AND (j.client_id = auth.uid() OR j.agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS applications_read ON public.applications;
CREATE POLICY applications_read ON public.applications
FOR SELECT USING (
  ((deleted_at IS NULL) OR public.nx_is_admin())
  AND (
    public.nx_is_admin()
    OR applicant_id = auth.uid()
    OR (
      (
        forwarded_to_client_at IS NOT NULL
        OR status = ANY (ARRAY['CLIENT_SELECTED'::text, 'hired'::text, 'accepted'::text])
      )
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = applications.job_id
          AND (auth.uid() = j.client_id OR auth.uid() = j.agency_id)
      )
    )
  )
);

-- ─── 2. job_applicant_identity_view — same lifecycle predicate ──────────────
--  Identical to the 20260801558000 definition except the client/agency branch
--  now also admits the engaged record. The projection itself is untouched:
--  name/résumé stay mode-gated, email/phone stay admin-only.

CREATE OR REPLACE VIEW public.job_applicant_identity_view
WITH (security_barrier = true) AS
SELECT a.id AS application_id,
    a.job_id,
    a.applicant_id,
    a.status AS application_status,
    a.created_at,
    m.eff_mode AS identity_mode,
    p.rating_average,
    p.reviews_count,
    p.completed_jobs_count,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.full_name
            ELSE NULL::text
        END AS inspector_display_name,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.headline
            ELSE NULL::text
        END AS inspector_headline,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.bio
            ELSE NULL::text
        END AS inspector_resume_summary,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.resume_url
            ELSE NULL::text
        END AS inspector_resume_url,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.certifications
            ELSE NULL::text[]
        END AS inspector_certifications,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.specialty_slugs
            ELSE NULL::text[]
        END AS inspector_qualifications,
        -- OWNER RULE (20260801558000): private contact is admin-only in every
        -- identity mode. Unchanged here.
        CASE
            WHEN public.nx_is_admin() THEN p.email
            ELSE NULL::text
        END AS inspector_email,
        CASE
            WHEN public.nx_is_admin() THEN p.phone
            ELSE NULL::text
        END AS inspector_phone,
    p.rating,
    p.total_jobs,
    p.professional_title,
    p.title,
    p.experience_years,
    p.specialty_slugs,
    p.ndt_methods,
    p.location_city,
    p.location_province,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.avatar_url
            ELSE NULL::text
        END AS inspector_avatar_url,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.first_name
            ELSE NULL::text
        END AS inspector_first_name,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.last_name
            ELSE NULL::text
        END AS inspector_last_name,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.cv_url
            ELSE NULL::text
        END AS inspector_cv_url
   FROM public.applications a
     JOIN public.jobs j ON j.id = a.job_id
     LEFT JOIN public.profiles p ON p.id = a.applicant_id
     CROSS JOIN LATERAL ( SELECT public.nx_job_effective_identity_mode(a.job_id) AS eff_mode) m
  WHERE public.nx_is_admin()
     OR ( (j.client_id = auth.uid() OR j.agency_id = auth.uid())
          AND ( a.forwarded_to_client_at IS NOT NULL
                OR a.status = ANY (ARRAY['CLIENT_SELECTED'::text, 'hired'::text, 'accepted'::text]) ) );

-- ─── 3. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  v_c uuid := gen_random_uuid(); v_i uuid := gen_random_uuid();
  v_j uuid := gen_random_uuid();
  v_ap uuid := gen_random_uuid();  -- pending, never forwarded  → stays hidden
  v_ah uuid := gen_random_uuid();  -- hired,   never forwarded  → now visible
  v_n int; v_email text; v_def text;
BEGIN
  -- Catalogue: the anti-poaching gate must survive in both policies and the
  -- view — engaged-status OR forwarding, never unconditional.
  SELECT pg_get_viewdef('public.job_applicant_identity_view'::regclass, true) INTO v_def;
  IF v_def !~ 'forwarded_to_client_at IS NOT NULL' OR v_def !~ 'CLIENT_SELECTED' THEN
    RAISE EXCEPTION 'SELFTEST: identity view lost the forwarding/engaged predicate';
  END IF;
  IF v_def ~ '''full''::text THEN p.email' THEN
    RAISE EXCEPTION 'SELFTEST: identity view regressed to disclosing contact by mode';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE tablename='applications' AND cmd='SELECT'
         AND policyname IN ('applications_client_select_own_jobs','applications_read')
         AND qual LIKE '%forwarded_to_client_at IS NOT NULL%'
         AND qual LIKE '%CLIENT_SELECTED%') <> 2 THEN
    RAISE EXCEPTION 'SELFTEST: applications client policies missing the lifecycle predicate';
  END IF;

  -- Behavioural (local; skipped where SET ROLE authenticated is not granted).
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'eh.'||u::text||'@synthetic.invalid', now(), now()
      FROM unnest(ARRAY[v_c,v_i]) u;
    INSERT INTO public.profiles (id, role, full_name, email, phone, is_verified) VALUES
      (v_c,'client','EH Client','eh.c@synthetic.invalid','+15550301',true),
      (v_i,'inspector','EH Hired Inspector','eh.i@synthetic.invalid','+15550302',true)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role;
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode)
    VALUES (v_j,'eh lifecycle',v_c,'completed','approved','prepay',100000,80000,'professional');
    -- (two applications from the same inspector are not allowed on one job in
    --  some schemas; use one hired and one pending from synthetic second user)
    INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents)
    VALUES (v_ah,v_j,v_i,'hired',80000);
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (v_ap,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'eh.p@synthetic.invalid', now(), now());
    INSERT INTO public.profiles (id, role, full_name, email, is_verified)
    VALUES (v_ap,'inspector','EH Pending Inspector','eh.p2@synthetic.invalid',true)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
    INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents)
    VALUES (gen_random_uuid(),v_j,v_ap,'pending',70000);

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO v_n FROM public.applications WHERE job_id = v_j;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'SELFTEST: client should see exactly the hired record (saw %)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM public.applications
      WHERE job_id = v_j AND status = 'hired';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'SELFTEST: the hired, never-forwarded application is still invisible';
    END IF;
    SELECT count(*), max(inspector_email) INTO v_n, v_email
      FROM public.job_applicant_identity_view WHERE application_id = v_ah;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'SELFTEST: identity view does not surface the hired record';
    END IF;
    IF v_email IS NOT NULL THEN
      RAISE EXCEPTION 'SELFTEST: contact leaked through the hired record';
    END IF;
    RESET ROLE;

    RAISE NOTICE 'SELFTEST ok — engaged application history visible, pre-engagement gate intact';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated); catalogue assertions passed';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE 'eh.%@synthetic.invalid') THEN
    RAISE EXCEPTION 'SELFTEST: synthetic fixtures survived';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
