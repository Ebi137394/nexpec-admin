-- ════════════════════════════════════════════════════════════════════════════
--  20260801123000_apply_onboarding_role_supplier.sql
--
--  Allow 'supplier' through the OAuth onboarding role-apply path. The web
--  sign-up wizard now offers a Vendor card; email/password + magic-link signups
--  persist via handle_new_user (already supplier-aware since 122200), but the
--  OAuth callback applies the chosen role via apply_onboarding_role(), whose
--  whitelist excluded 'supplier' — silently rejecting vendor OAuth signups.
--  Reproduces 20260519010000's function verbatim with 'supplier' added to the
--  allow-list (line marked ★). Idempotent CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_onboarding_role(
  p_role                  text,
  p_full_name             text       DEFAULT NULL,
  p_company_name          text       DEFAULT NULL,
  p_contact_person_name   text       DEFAULT NULL,
  p_specialty_slugs       text[]     DEFAULT NULL,
  p_terms_accepted_at     timestamptz DEFAULT NULL,
  p_terms_version         text       DEFAULT NULL
)
RETURNS TABLE(applied_role text, profile_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_current_role text;
  v_final_role   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'apply_onboarding_role: no auth.uid() — caller is not authenticated';
  END IF;

  IF p_role IS NULL
     OR p_role NOT IN ('client', 'inspector', 'agency', 'enterprise', 'supplier')  -- ★ supplier added
  THEN
    RAISE EXCEPTION 'apply_onboarding_role: invalid p_role: %', p_role;
  END IF;

  SELECT role INTO v_current_role FROM public.profiles WHERE id = v_uid;

  -- One-way guard: never downgrade an operator/inspector via public onboarding.
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
    id, role, onboarding_role, full_name, company_name, contact_person_name,
    specialty_slugs, terms_accepted_at, terms_version, onboarding_completed_at
  ) VALUES (
    v_uid, p_role, p_role,
    NULLIF(trim(coalesce(p_full_name, '')), ''),
    NULLIF(trim(coalesce(p_company_name, '')), ''),
    NULLIF(trim(coalesce(p_contact_person_name, '')), ''),
    p_specialty_slugs, p_terms_accepted_at, p_terms_version, now()
  )
  ON CONFLICT (id) DO UPDATE SET
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
$fn$;

GRANT EXECUTE ON FUNCTION public.apply_onboarding_role(
  text, text, text, text, text[], timestamptz, text
) TO authenticated;

DO $$ BEGIN RAISE NOTICE 'apply_onboarding_role now accepts the supplier role (vendor OAuth signup).'; END $$;

COMMIT;
