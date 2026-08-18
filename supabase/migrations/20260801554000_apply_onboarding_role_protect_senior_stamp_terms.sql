-- ════════════════════════════════════════════════════════════════════════════
--  20260801554000_apply_onboarding_role_protect_senior_stamp_terms.sql
--
--  D31 — two defects in the mobile onboarding role gate, found by the iOS role
--  matrix (run 29):
--
--  (a) 'senior' was NOT in the one-way protected-role guard. A senior reviewer
--      signing into Mobile for the first time hits the "Choose your stance"
--      AuthGate (no Senior card exists), and confirming ANY card silently
--      DEMOTED the account (role = EXCLUDED.role on the upsert). Privilege
--      loss via onboarding.
--
--  (b) the protected-role refusal path RETURNed before the upsert, so a
--      protected account (admin / super_admin / inspector re-confirming a
--      different lane) could NEVER record its ToS/Privacy acceptance via the
--      mobile gate — terms_accepted_at stayed NULL and the AuthGate kept
--      bouncing the user into the chooser on every launch, forever.
--
--  Fix: add 'senior' to the guard, and make the refusal path stamp
--  terms_accepted_at / terms_version / onboarding_completed_at (COALESCE — a
--  re-confirm never overwrites an earlier acceptance) while leaving role and
--  every other column untouched.
--
--  Regression proof: supabase/tests/apply_onboarding_role_guard_test.sql
--  (senior keeps role — fails on the old body with 'client';
--   admin refusal stamps terms — fails on the old body with NULL).
--  Idempotent: CREATE OR REPLACE + self-test.
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

  -- Self-service onboarding lanes (Vendor lane added 2026-07).
  IF p_role IS NULL
     OR p_role NOT IN ('client', 'inspector', 'agency', 'enterprise', 'supplier')
  THEN
    RAISE EXCEPTION 'apply_onboarding_role: invalid p_role: %', p_role;
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  SELECT role INTO v_current_role FROM public.profiles WHERE id = v_uid;

  -- One-way guard: never downgrade an existing privileged/operator identity via
  -- the public onboarding path. 'senior' added (D31a): it has no stance card,
  -- so any confirm would have silently demoted a senior reviewer.
  IF v_current_role IS NOT NULL
     AND v_current_role IN ('admin', 'super_admin', 'inspector', 'senior')
     AND v_current_role <> p_role
  THEN
    RAISE NOTICE
      'apply_onboarding_role: refusing to flip protected role % -> % for uid %',
      v_current_role, p_role, v_uid;
    -- D31b: the refusal must still record the legal-gateway acceptance, or a
    -- protected account can never pass the terms AuthGate on Mobile. Role and
    -- all other profile columns stay untouched; COALESCE keeps the earliest
    -- acceptance if one already exists.
    UPDATE public.profiles
       SET terms_accepted_at       = COALESCE(terms_accepted_at, p_terms_accepted_at),
           terms_version           = COALESCE(terms_version, p_terms_version),
           onboarding_completed_at = COALESCE(onboarding_completed_at, now())
     WHERE id = v_uid;
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
    -- specialty_slugs is NOT NULL (default '{}'). choose-role omits it, so the
    -- param is NULL — coalesce to an empty array so the INSERT path satisfies
    -- the constraint.
    COALESCE(p_specialty_slugs, '{}'::text[]),
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
    -- Raw param (NULL when not supplied), NOT the coalesced INSERT value, so a
    -- re-confirm never wipes an existing user's specialties.
    specialty_slugs         = COALESCE(p_specialty_slugs, p.specialty_slugs),
    terms_accepted_at       = COALESCE(EXCLUDED.terms_accepted_at, p.terms_accepted_at),
    terms_version           = COALESCE(EXCLUDED.terms_version, p.terms_version),
    onboarding_completed_at = COALESCE(p.onboarding_completed_at, EXCLUDED.onboarding_completed_at);

  SELECT role INTO v_final_role FROM public.profiles WHERE id = v_uid;
  RETURN QUERY SELECT v_final_role, v_uid;
END
$$;

ALTER FUNCTION public.apply_onboarding_role(text, text, text, text, text[], timestamp with time zone, text) OWNER TO postgres;

-- Self-test: senior must be in the guard; the refusal path must stamp terms.
DO $test$
DECLARE
  v_def text := pg_get_functiondef('public.apply_onboarding_role(text,text,text,text,text[],timestamp with time zone,text)'::regprocedure);
BEGIN
  IF position('''senior''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: senior is not in the protected-role guard (D31a)';
  END IF;
  IF position('COALESCE(terms_accepted_at, p_terms_accepted_at)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: refusal path does not stamp terms (D31b)';
  END IF;
  IF position('''supplier''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: supplier lane regressed';
  END IF;
  RAISE NOTICE 'apply_onboarding_role: senior protected, refusal path stamps terms.';
END
$test$;

COMMIT;
