-- ════════════════════════════════════════════════════════════════════════════
--  20260801566000_full_mode_contact_restoration.sql
--
--  OWNER POLICY CORRECTION — restore the three-tier identity model.
--
--  20260801558000 §"OWNER RULE (2026-08-19)" made inspector email/phone
--  admin-only in EVERY identity mode. That collapsed `full` into
--  `professional` for clients — an over-restriction the owner has now
--  explicitly corrected. The intended NEXPEC hierarchy is:
--
--      protected     → anonymous: NX handle + reputation/capability only
--      professional  → professional identity: name, photo, CV/résumé,
--                      headline, certifications — NO contact
--      full          → COMPLETE identity INCLUDING email + phone, only when
--                      an Admin has explicitly set that job to `full`
--
--  This migration is the correction of record for every statement introduced
--  on 2026-08-19 (in 20260801558000 and 20260801562000 comments) that
--  described contact as admin-only in all modes: those applied migrations are
--  history and are not rewritten; the views below are the live authority.
--
--  What changes: ONLY the inspector_email / inspector_phone projections in
--  client_job_contracts_view and job_applicant_identity_view become
--      admin  → always
--      full   → disclosed (live per-job policy, admin-set, audited)
--      else   → NULL
--  Everything else — the sanitized commercial bodies, the engaged-application
--  history predicate (20260801562000), the forwarding anti-poaching gate, the
--  professional/full gating of name/photo/CV, row-level access — is byte-for-
--  byte identical to the current definitions.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. client_job_contracts_view ───────────────────────────────────────────

CREATE OR REPLACE VIEW public.client_job_contracts_view
WITH (security_barrier = 'true') AS
SELECT
  jc.id,
  jc.job_id,
  jc.application_id,
  jc.client_id,
  jc.inspector_id,
  jc.client_price_cents,
  jc.status,
  CASE WHEN public.nx_is_admin() THEN jc.contract_text_md
       ELSE public.nx_contract_text_for_client(jc.contract_text_md)
  END AS contract_text_md,
  jc.custom_contract_url,
  jc.client_signed_at,
  jc.client_signed_name,
  jc.inspector_signed_at,
  jc.voided_at,
  jc.voided_reason,
  jc.created_at,
  jc.updated_at,
  jc.client_approval_type,
  jc.admin_authorized_at,
  public.nx_job_effective_identity_mode(jc.job_id) AS identity_mode,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  -- OWNER POLICY (final): direct contact is part of FULL disclosure only.
  -- Admin always; client only when the Admin set this job to 'full'.
  CASE WHEN public.nx_is_admin()
         OR public.nx_job_effective_identity_mode(jc.job_id) = 'full'
       THEN p.email END AS inspector_email,
  CASE WHEN public.nx_is_admin()
         OR public.nx_job_effective_identity_mode(jc.job_id) = 'full'
       THEN p.phone END AS inspector_phone,
  jc.effective_identity_mode AS executed_identity_mode
FROM public.job_contracts jc
JOIN public.jobs j ON j.id = jc.job_id
LEFT JOIN public.profiles p ON p.id = jc.inspector_id
WHERE jc.client_id = auth.uid() OR public.nx_is_admin();

-- ─── 2. job_applicant_identity_view ─────────────────────────────────────────

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
        -- OWNER POLICY (final): contact belongs to FULL disclosure.
        CASE
            WHEN public.nx_is_admin() OR m.eff_mode = 'full'::text THEN p.email
            ELSE NULL::text
        END AS inspector_email,
        CASE
            WHEN public.nx_is_admin() OR m.eff_mode = 'full'::text THEN p.phone
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

-- ─── 3. Selftest — the full three-tier matrix, upgrade AND downgrade ────────
DO $selftest$
DECLARE
  v_c uuid := gen_random_uuid(); v_i uuid := gen_random_uuid();
  v_j uuid := gen_random_uuid(); v_a uuid := gen_random_uuid();
  v_jc uuid;
  v_name text; v_email text; v_phone text; v_def text;
BEGIN
  -- Catalogue: full-mode contact must be present, professional/protected not.
  SELECT pg_get_viewdef('public.client_job_contracts_view'::regclass, true) INTO v_def;
  IF v_def !~ 'full''::text THEN p.email' OR v_def !~ 'nx_is_admin\(\)' THEN
    RAISE EXCEPTION 'SELFTEST: contract view email is not admin-or-full gated';
  END IF;
  IF v_def !~ 'nx_contract_text_for_client' THEN
    RAISE EXCEPTION 'SELFTEST: commercial body sanitization was lost';
  END IF;
  SELECT pg_get_viewdef('public.job_applicant_identity_view'::regclass, true) INTO v_def;
  IF v_def !~ 'full''::text THEN p.email' THEN
    RAISE EXCEPTION 'SELFTEST: applicant view email is not admin-or-full gated';
  END IF;
  IF v_def !~ 'forwarded_to_client_at IS NOT NULL' OR v_def !~ 'CLIENT_SELECTED' THEN
    RAISE EXCEPTION 'SELFTEST: engaged-history / anti-poaching predicate was lost';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'fm.'||u::text||'@synthetic.invalid', now(), now()
      FROM unnest(ARRAY[v_c,v_i]) u;
    INSERT INTO public.profiles (id, role, full_name, email, phone, is_verified) VALUES
      (v_c,'client','FM Client','fm.c@synthetic.invalid','+15550601',true),
      (v_i,'inspector','FM Real Name','fm.i@synthetic.invalid','+15550602',true)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role;
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode)
    VALUES (v_j,'fm matrix',v_c,'open','approved','prepay',100000,80000,'protected');
    INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents,forwarded_to_client_at)
    VALUES (v_a,v_j,v_i,'accepted',80000,now());
    INSERT INTO public.job_contracts (job_id, application_id, client_id, inspector_id,
                                      client_price_cents, inspector_payout_cents,
                                      status, contract_text_md)
    VALUES (v_j, v_a, v_c, v_i, 100000, 80000, 'pending_client_signature', 'fm body')
    RETURNING id INTO v_jc;

    -- PROTECTED: anonymous.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT inspector_display_name, inspector_email, inspector_phone
      INTO v_name, v_email, v_phone
      FROM public.client_job_contracts_view WHERE id = v_jc;
    RESET ROLE;
    IF v_name IS NOT NULL OR v_email IS NOT NULL OR v_phone IS NOT NULL THEN
      RAISE EXCEPTION 'SELFTEST protected leaked (name=%, email=%)', v_name, v_email;
    END IF;

    -- PROFESSIONAL: identity, no contact.
    UPDATE public.jobs SET identity_mode = 'professional' WHERE id = v_j;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT inspector_display_name, inspector_email, inspector_phone
      INTO v_name, v_email, v_phone
      FROM public.client_job_contracts_view WHERE id = v_jc;
    RESET ROLE;
    IF v_name IS DISTINCT FROM 'FM Real Name' OR v_email IS NOT NULL OR v_phone IS NOT NULL THEN
      RAISE EXCEPTION 'SELFTEST professional wrong (name=%, email=%)', v_name, v_email;
    END IF;

    -- FULL: identity + contact.
    UPDATE public.jobs SET identity_mode = 'full' WHERE id = v_j;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT inspector_display_name, inspector_email, inspector_phone
      INTO v_name, v_email, v_phone
      FROM public.client_job_contracts_view WHERE id = v_jc;
    IF v_name IS DISTINCT FROM 'FM Real Name'
       OR v_email IS DISTINCT FROM 'fm.i@synthetic.invalid'
       OR v_phone IS DISTINCT FROM '+15550602' THEN
      RAISE EXCEPTION 'SELFTEST full wrong (name=%, email=%, phone=%)', v_name, v_email, v_phone;
    END IF;
    -- …and the applicant surface agrees under the same claims.
    SELECT inspector_email INTO v_email
      FROM public.job_applicant_identity_view WHERE application_id = v_a;
    RESET ROLE;
    IF v_email IS DISTINCT FROM 'fm.i@synthetic.invalid' THEN
      RAISE EXCEPTION 'SELFTEST applicant surface disagrees under full (email=%)', v_email;
    END IF;

    -- DOWNGRADE full → professional → protected revokes at read time.
    UPDATE public.jobs SET identity_mode = 'professional' WHERE id = v_j;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT inspector_display_name, inspector_email, inspector_phone
      INTO v_name, v_email, v_phone
      FROM public.client_job_contracts_view WHERE id = v_jc;
    RESET ROLE;
    IF v_email IS NOT NULL OR v_phone IS NOT NULL OR v_name IS DISTINCT FROM 'FM Real Name' THEN
      RAISE EXCEPTION 'SELFTEST downgrade to professional did not revoke contact';
    END IF;
    UPDATE public.jobs SET identity_mode = 'protected' WHERE id = v_j;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT inspector_display_name, inspector_email
      INTO v_name, v_email
      FROM public.client_job_contracts_view WHERE id = v_jc;
    RESET ROLE;
    IF v_name IS NOT NULL OR v_email IS NOT NULL THEN
      RAISE EXCEPTION 'SELFTEST downgrade to protected did not anonymize';
    END IF;

    RAISE NOTICE 'SELFTEST ok — protected/professional/full are three distinct levels; contact rides FULL only';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated); catalogue assertions passed';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE 'fm.%@synthetic.invalid') THEN
    RAISE EXCEPTION 'SELFTEST: synthetic fixtures survived';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
