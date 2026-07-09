-- ════════════════════════════════════════════════════════════════════════════
--  20260801256000_apply_onboarding_role_add_supplier.sql
--
--  Mobile onboarding now offers Enterprise + Vendor(supplier) lanes. Enterprise
--  was already accepted; this widens apply_onboarding_role's role allow-list to
--  also accept 'supplier' so a self-service Vendor signup can save its role.
--
--  profiles.role already permits 'supplier' (profiles_role_allowed CHECK), so
--  no table change is needed — only the function's internal guard.
--
--  Identical to 254000 (email-on-insert fix) except the allow-list. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_onboarding_role(
  p_role                text,
  p_full_name           text DEFAULT NULL,
  p_company_name        text DEFAULT NULL,
  p_contact_person_name text DEFAULT NULL,
  p_specialty_slugs     text[] DEFAULT NULL,
  p_terms_accepted_at   timestamp with time zone DEFAULT NULL,
  p_terms_version       text DEFAULT NULL
) RETURNS TABLE(applied_role text, profile_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_current_role text;
  v_final_role   text;
  v_email        text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'apply_onboarding_role: no auth.uid() — caller is not authenticated';
  END IF;

  -- Self-service onboarding lanes. 'supplier' added 2026-07 (mobile Vendor card).
  IF p_role IS NULL
     OR p_role NOT IN ('client', 'inspector', 'agency', 'enterprise', 'supplier')
  THEN
    RAISE EXCEPTION 'apply_onboarding_role: invalid p_role: %', p_role;
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  SELECT role INTO v_current_role FROM public.profiles WHERE id = v_uid;

  -- One-way guard: do NOT downgrade an existing operator/inspector via the
  -- public onboarding path.
  IF v_current_role IS NOT NULL
     AND v_current_role IN ('admin', 'super_admin', 'inspector')
     AND v_current_role <> p_role
  THEN
    RAISE NOTICE
      'apply_onboarding_role: refusing to flip protected role % -> % for uid %',
      v_current_role, p_role, v_uid;
    RETURN QUERY SELECT v_current_role, v_uid;
    RETURN;
  END IF;

  INSERT INTO public.profiles AS p (
    id,
    email,
    role,
    onboarding_role,
    full_name,
    company_name,
    contact_person_name,
    specialty_slugs,
    terms_accepted_at,
    terms_version,
    onboarding_completed_at
  ) VALUES (
    v_uid,
    v_email,
    p_role,
    p_role,
    NULLIF(trim(coalesce(p_full_name, '')), ''),
    NULLIF(trim(coalesce(p_company_name, '')), ''),
    NULLIF(trim(coalesce(p_contact_person_name, '')), ''),
    p_specialty_slugs,
    p_terms_accepted_at,
    p_terms_version,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email                   = COALESCE(p.email, EXCLUDED.email),
    role                    = EXCLUDED.role,
    onboarding_role         = COALESCE(EXCLUDED.onboarding_role, p.onboarding_role),
    full_name               = COALESCE(EXCLUDED.full_name, p.full_name),
    company_name            = COALESCE(EXCLUDED.company_name, p.company_name),
    contact_person_name     = COALESCE(EXCLUDED.contact_person_name, p.contact_person_name),
    specialty_slugs         = COALESCE(EXCLUDED.specialty_slugs, p.specialty_slugs),
    terms_accepted_at       = COALESCE(EXCLUDED.terms_accepted_at, p.terms_accepted_at),
    terms_version           = COALESCE(EXCLUDED.terms_version, p.terms_version),
    onboarding_completed_at = COALESCE(p.onboarding_completed_at, EXCLUDED.onboarding_completed_at);

  SELECT role INTO v_final_role FROM public.profiles WHERE id = v_uid;
  RETURN QUERY SELECT v_final_role, v_uid;
END
$$;

ALTER FUNCTION public.apply_onboarding_role(text, text, text, text, text[], timestamp with time zone, text) OWNER TO postgres;

-- Self-test: the allow-list must include 'supplier' (and still email-on-insert).
DO $test$
DECLARE
  v_def text := regexp_replace(
    pg_get_functiondef('public.apply_onboarding_role(text,text,text,text,text[],timestamp with time zone,text)'::regprocedure),
    '--.*', '', 'g');
BEGIN
  IF position('''supplier''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: apply_onboarding_role does not accept supplier';
  END IF;
  IF position('v_email' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: apply_onboarding_role lost the email-on-insert fix';
  END IF;
  RAISE NOTICE 'apply_onboarding_role now accepts supplier + still inserts email — mobile Vendor onboarding enabled.';
END
$test$;

COMMIT;
