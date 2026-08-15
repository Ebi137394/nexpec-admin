-- ════════════════════════════════════════════════════════════════════════════
--  20260801516000_disclosure_view_requires_forwarding.sql
--
--  P0 PII LEAK — the Client could read a disclosed Inspector identity from an
--  application the Admin had NOT forwarded.
--
--  ── REPRODUCED, NOT INFERRED ───────────────────────────────────────────────
--  Job with identity_mode='full', application left unforwarded, read as the
--  owning Client:
--
--      PROBE unforwarded rows=1 name=Real Name Here email=real@insp.inv
--
--  job_applicant_identity_view gated only on ownership:
--      WHERE j.client_id = auth.uid() OR j.agency_id = auth.uid() OR nx_is_admin()
--  and it is a security_barrier view WITHOUT security_invoker, so it runs as
--  its owner and RLS on public.applications — which DOES require
--  forwarded_to_client_at IS NOT NULL — never applied. The one predicate that
--  enforces the brokerage was therefore bypassed by the very surface built to
--  disclose identity.
--
--  This mattered immediately: the Web Client reader is being switched onto
--  this view in the same change, so shipping it unfixed would have turned a
--  dormant leak into a live one.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  The Client/agency branch now additionally requires
--  a.forwarded_to_client_at IS NOT NULL. Admin is unchanged and keeps the
--  authorized internal review view — that branch is deliberately first, so an
--  Admin still sees pre-forwarding applications for vetting.
--
--  Nothing else changes. The disclosure projection itself was already correct:
--      professional|full -> name, headline, bio, résumé, CV, certifications,
--                           qualifications, avatar, first/last name
--      full              -> + email, phone
--  and it stays exactly as it was. This migration narrows WHO may read a row,
--  not WHAT a row exposes.
--
--  ── NOT A WEAKENING ────────────────────────────────────────────────────────
--  Strictly fewer rows are visible than before. No policy is relaxed, no RLS
--  is disabled, and the base profiles table is not exposed.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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
        CASE
            WHEN m.eff_mode = 'full'::text THEN p.email
            ELSE NULL::text
        END AS inspector_email,
        CASE
            WHEN m.eff_mode = 'full'::text THEN p.phone
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
   FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN profiles p ON p.id = a.applicant_id
     CROSS JOIN LATERAL ( SELECT nx_job_effective_identity_mode(a.job_id) AS eff_mode) m
  WHERE nx_is_admin()
     OR ( (j.client_id = auth.uid() OR j.agency_id = auth.uid())
          AND a.forwarded_to_client_at IS NOT NULL );

-- ─── Selftest — behavioural, both directions ────────────────────────────────
DO $selftest$
DECLARE
  v_c uuid := gen_random_uuid(); v_i uuid := gen_random_uuid();
  v_j uuid := gen_random_uuid(); v_a uuid := gen_random_uuid();
  v_n int; v_name text; v_email text;
BEGIN
 BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'st.'||u::text||'@synthetic.invalid', now(), now()
    FROM unnest(ARRAY[v_c,v_i]) u;
  INSERT INTO public.profiles (id, role, full_name, email, phone, is_verified) VALUES
    (v_c,'client','ST Client','st.c@synthetic.invalid','+15550001',true),
    (v_i,'inspector','ST Real Name','st.i@synthetic.invalid','+15550002',true);
  INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                           client_price_cents,inspector_payout_cents,identity_mode)
  VALUES (v_j,'selftest',v_c,'open','approved','prepay',100000,70000,'full');
  INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents)
  VALUES (v_a,v_j,v_i,'pending',70000);

  -- 1. NEGATIVE — unforwarded, policy FULL: the Client must see nothing.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
  SELECT count(*), max(inspector_display_name), max(inspector_email)
    INTO v_n, v_name, v_email
    FROM public.job_applicant_identity_view WHERE job_id = v_j;
  RESET ROLE;
  IF v_n <> 0 OR v_name IS NOT NULL OR v_email IS NOT NULL THEN
    RAISE EXCEPTION
      'SELFTEST: unforwarded application leaked to the Client (rows=%, name=%, email=%)',
      v_n, coalesce(v_name,'<null>'), coalesce(v_email,'<null>');
  END IF;

  -- 2. POSITIVE — once forwarded, FULL really does disclose. A view that only
  --    ever hides is indistinguishable from a broken feature, so the
  --    disclosing direction is proved too.
  UPDATE public.applications SET forwarded_to_client_at = now() WHERE id = v_a;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
  SELECT count(*), max(inspector_display_name), max(inspector_email)
    INTO v_n, v_name, v_email
    FROM public.job_applicant_identity_view WHERE job_id = v_j;
  RESET ROLE;
  IF v_n <> 1 OR v_name IS DISTINCT FROM 'ST Real Name'
     OR v_email IS DISTINCT FROM 'st.i@synthetic.invalid' THEN
    RAISE EXCEPTION
      'SELFTEST: after forwarding, FULL did not disclose (rows=%, name=%, email=%)',
      v_n, coalesce(v_name,'<null>'), coalesce(v_email,'<null>');
  END IF;

  RAISE NOTICE 'SELFTEST ok — hidden before forwarding, disclosed after, under policy FULL';
  RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
 END;

 IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE '%@synthetic.invalid') THEN
   RAISE EXCEPTION 'SELFTEST: synthetic profiles survived the rollback';
 END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
