-- ════════════════════════════════════════════════════════════════════════════
--  20260801518000_disclosure_matrix_staging_verification.sql
--
--  Proves the Protected / Professional / Full disclosure matrix SERVER-SIDE
--  wherever applied, including NEXPEC-Staging, by inspecting RETURNED FIELD
--  VALUES — not row counts, not HTTP status.
--
--  ── WHY THIS WORKS WHERE SET ROLE DOES NOT ─────────────────────────────────
--  job_applicant_identity_view is security_barrier but NOT security_invoker,
--  so it always executes as its owner and its predicate is evaluated against
--  auth.uid(). auth.uid() reads request.jwt.claims, which any caller may set.
--  So impersonating the Client for the purposes of this view needs only
--  set_config — no SET ROLE, which the Staging migration role cannot perform.
--  This is exactly the path the view gates on, so the proof is genuine.
--
--  ── SELF-CLEANING ──────────────────────────────────────────────────────────
--  All work runs in a subtransaction that always rolls back; residue is then
--  asserted from outside rather than assumed.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $verify$
DECLARE
  v_cl  uuid := 'dabb1e00-0000-4000-8000-000000000001';
  v_in  uuid := 'dabb1e00-0000-4000-8000-000000000002';
  v_cl2 uuid := 'dabb1e00-0000-4000-8000-000000000003';
  v_jA  uuid := 'dabb1e00-0000-4000-8000-00000000000a';
  v_jB  uuid := 'dabb1e00-0000-4000-8000-00000000000b';
  v_aA  uuid := 'dabb1e00-0000-4000-8000-00000000001a';
  v_aB  uuid := 'dabb1e00-0000-4000-8000-00000000001b';
  v_name text; v_email text; v_phone text; v_resume text; v_certs text[];
  v_n int; v_res int;
BEGIN
 BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
         'dx.'||u::text||'@synthetic.invalid', now(), now()
    FROM unnest(ARRAY[v_cl,v_in,v_cl2]) u;

  INSERT INTO public.profiles (id, role, full_name, email, phone, is_verified,
                               headline, bio, resume_url, certifications, specialty_slugs)
  VALUES
    (v_cl ,'client','DX Client','dx.client@synthetic.invalid','+15553001',true,
     NULL,NULL,NULL,NULL,ARRAY[]::text[]),
    (v_in ,'inspector','Dana Weld','dx.insp@synthetic.invalid','+15553002',true,
     'Senior NDT Inspector','12 years refinery NDT.',
     'https://files.invalid/dana.pdf',
     ARRAY['CSWIP 3.1','API 570']::text[], ARRAY['ndt-methods']::text[]),
    (v_cl2,'client','DX Other','dx.other@synthetic.invalid','+15553003',true,
     NULL,NULL,NULL,NULL,ARRAY[]::text[]);

  INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                           client_price_cents,inspector_payout_cents,identity_mode)
  VALUES (v_jA,'DX job A',v_cl,'open','approved','prepay',100000,70000,'protected'),
         (v_jB,'DX job B',v_cl,'open','approved','prepay',100000,70000,'protected');

  INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents)
  VALUES (v_aA,v_jA,v_in,'pending',70000),
         (v_aB,v_jB,v_in,'pending',70000);

  --  Impersonate the owning Client for every read below.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_cl::text||'","role":"authenticated"}', true);

  -- ── 1. UNFORWARDED is invisible under all three policies ─────────────────
  FOREACH v_name IN ARRAY ARRAY['protected','professional','full'] LOOP
    UPDATE public.jobs SET identity_mode = v_name WHERE id = v_jA;
    SELECT count(*) INTO v_n FROM public.job_applicant_identity_view WHERE job_id = v_jA;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'D FAILED: policy % but unforwarded — the Client saw % row(s)', v_name, v_n;
    END IF;
  END LOOP;
  --  Differential: the rows really exist.
  SELECT count(*) INTO v_n FROM public.applications WHERE id IN (v_aA, v_aB);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'D DIFFERENTIAL FAILED: applications missing, so invisibility proved nothing';
  END IF;
  RAISE NOTICE 'D ok — unforwarded invisible under protected, professional and full';

  -- ── forward both (the Admin action) ──────────────────────────────────────
  UPDATE public.applications SET forwarded_to_client_at = now() WHERE id IN (v_aA, v_aB);

  -- ── 2. PROTECTED ─────────────────────────────────────────────────────────
  UPDATE public.jobs SET identity_mode='protected' WHERE id = v_jA;
  SELECT inspector_display_name, inspector_email, inspector_phone,
         inspector_resume_url, inspector_certifications, count(*) OVER ()
    INTO v_name, v_email, v_phone, v_resume, v_certs, v_n
    FROM public.job_applicant_identity_view WHERE application_id = v_aA;
  IF v_n <> 1 THEN RAISE EXCEPTION 'P FAILED: the brokered row itself is not visible'; END IF;
  IF v_name IS NOT NULL OR v_email IS NOT NULL OR v_phone IS NOT NULL
     OR v_resume IS NOT NULL OR v_certs IS NOT NULL THEN
    RAISE EXCEPTION 'P FAILED: PROTECTED leaked (name=%, email=%, phone=%, resume=%)',
      coalesce(v_name,'<null>'), coalesce(v_email,'<null>'),
      coalesce(v_phone,'<null>'), coalesce(v_resume,'<null>');
  END IF;
  RAISE NOTICE 'P ok — PROTECTED: brokered row only, no name/résumé/certs/email/phone';

  -- ── 3. PROFESSIONAL ──────────────────────────────────────────────────────
  UPDATE public.jobs SET identity_mode='professional' WHERE id = v_jA;
  SELECT inspector_display_name, inspector_email, inspector_phone,
         inspector_resume_url, inspector_certifications
    INTO v_name, v_email, v_phone, v_resume, v_certs
    FROM public.job_applicant_identity_view WHERE application_id = v_aA;
  IF v_name IS DISTINCT FROM 'Dana Weld' THEN
    RAISE EXCEPTION 'F FAILED: PROFESSIONAL did not release the real name (got %)',
      coalesce(v_name,'<null>');
  END IF;
  IF v_resume IS DISTINCT FROM 'https://files.invalid/dana.pdf' THEN
    RAISE EXCEPTION 'F FAILED: PROFESSIONAL did not release the résumé';
  END IF;
  IF v_certs IS NULL OR array_length(v_certs,1) <> 2 THEN
    RAISE EXCEPTION 'F FAILED: PROFESSIONAL did not release the certifications';
  END IF;
  IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
    RAISE EXCEPTION 'F FAILED: PROFESSIONAL leaked contact details (email=%, phone=%)',
      coalesce(v_email,'<null>'), coalesce(v_phone,'<null>');
  END IF;
  RAISE NOTICE 'F ok — PROFESSIONAL: name, résumé and certifications; contact still withheld';

  -- ── 4/5. FULL, effective immediately after the policy change ─────────────
  UPDATE public.jobs SET identity_mode='full' WHERE id = v_jA;
  SELECT inspector_display_name, inspector_email, inspector_phone
    INTO v_name, v_email, v_phone
    FROM public.job_applicant_identity_view WHERE application_id = v_aA;
  IF v_email IS DISTINCT FROM 'dx.insp@synthetic.invalid'
     OR v_phone IS DISTINCT FROM '+15553002'
     OR v_name IS DISTINCT FROM 'Dana Weld' THEN
    RAISE EXCEPTION 'U FAILED: FULL did not disclose contact (name=%, email=%, phone=%)',
      coalesce(v_name,'<null>'), coalesce(v_email,'<null>'), coalesce(v_phone,'<null>');
  END IF;
  RAISE NOTICE 'U ok — FULL: professional fields plus authorized email and phone, immediately';

  -- ── 6. Downgrade removes PII immediately ─────────────────────────────────
  UPDATE public.jobs SET identity_mode='protected' WHERE id = v_jA;
  SELECT inspector_display_name, inspector_email
    INTO v_name, v_email
    FROM public.job_applicant_identity_view WHERE application_id = v_aA;
  IF v_name IS NOT NULL OR v_email IS NOT NULL THEN
    RAISE EXCEPTION 'W FAILED: downgrade to PROTECTED left PII visible (name=%, email=%)',
      coalesce(v_name,'<null>'), coalesce(v_email,'<null>');
  END IF;
  RAISE NOTICE 'W ok — FULL -> PROTECTED removes name and contact on the next read';

  -- ── 9. Per-job scoping, asserted in BOTH directions ──────────────────────
  UPDATE public.jobs SET identity_mode='full'      WHERE id = v_jA;
  UPDATE public.jobs SET identity_mode='protected' WHERE id = v_jB;
  SELECT inspector_email INTO v_email
    FROM public.job_applicant_identity_view WHERE application_id = v_aB;
  IF v_email IS NOT NULL THEN
    RAISE EXCEPTION 'S FAILED: job B inherited disclosure from job A (email=%)', v_email;
  END IF;
  SELECT inspector_email INTO v_email
    FROM public.job_applicant_identity_view WHERE application_id = v_aA;
  IF v_email IS DISTINCT FROM 'dx.insp@synthetic.invalid' THEN
    RAISE EXCEPTION 'S FAILED: job A is not disclosing, so the scoping check proved nothing';
  END IF;
  RAISE NOTICE 'S ok — same Inspector FULL on job A and PROTECTED on job B, no cross-job leakage';

  -- ── 7. An unrelated Client sees nothing, even at FULL ────────────────────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"'||v_cl2::text||'","role":"authenticated"}', true);
  SELECT count(*) INTO v_n FROM public.job_applicant_identity_view WHERE application_id = v_aA;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'X FAILED: an unrelated Client saw % row(s) at policy FULL', v_n;
  END IF;

  -- ── 8. No claims at all (anonymous) sees nothing ─────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM public.job_applicant_identity_view WHERE application_id = v_aA;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'X FAILED: an unauthenticated caller saw % row(s)', v_n;
  END IF;
  RAISE NOTICE 'X ok — unrelated Client and unauthenticated caller both see nothing';

  RAISE NOTICE '════ STAGING DISCLOSURE MATRIX: protected / professional / full ALL PROVED ════';
  RAISE EXCEPTION 'DISCLOSURE_ROLLBACK_SENTINEL';

 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'DISCLOSURE_ROLLBACK_SENTINEL' THEN RAISE; END IF;
 END;

 SELECT count(*) INTO v_res FROM public.profiles
  WHERE id IN (v_cl,v_in,v_cl2) OR email LIKE '%@synthetic.invalid';
 IF v_res <> 0 THEN RAISE EXCEPTION 'RESIDUE: % synthetic profile(s) survive', v_res; END IF;
 SELECT count(*) INTO v_res FROM auth.users
  WHERE id IN (v_cl,v_in,v_cl2) OR email LIKE '%@synthetic.invalid';
 IF v_res <> 0 THEN RAISE EXCEPTION 'RESIDUE: % synthetic auth user(s) survive', v_res; END IF;
 SELECT count(*) INTO v_res FROM public.jobs WHERE id IN (v_jA,v_jB);
 IF v_res <> 0 THEN RAISE EXCEPTION 'RESIDUE: % synthetic job(s) survive', v_res; END IF;

 RAISE NOTICE 'RESIDUE ok — zero synthetic profiles, auth users or jobs remain';
END
$verify$;

COMMIT;
