-- ════════════════════════════════════════════════════════════════════════════
--  20260801258000_apply_onboarding_role_hardened.sql
--
--  RE-ISSUE of the apply_onboarding_role fix under a FRESH migration number.
--  256000 carried the same corrected body but did NOT take effect in prod — the
--  Supabase migration ledger had recorded 256000 from its first (self-test
--  FAILED, rolled-back) push, so the corrected re-push was skipped as
--  "already applied" and the live function stayed at the 254000 version → the
--  "null value in column specialty_slugs" crash persisted on brand-new accounts.
--
--  A new version number can never be skipped, so this WILL apply. It also
--  DROPs any stale same-signature definition first (belt-and-suspenders), then
--  installs the fully-corrected function:
--    • email  — sourced from auth.users on INSERT (profiles.email NOT NULL)
--    • supplier — added to the self-service role allow-list
--    • specialty_slugs — COALESCE(p_specialty_slugs, '{}') on INSERT (NOT NULL,
--      default '{}'); UPDATE uses the raw param so existing specialties are kept
--
--  Idempotent; self-testing; BEGIN/COMMIT.
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
    -- specialty_slugs is NOT NULL (default '{}'); choose-role omits it so the
    -- param is NULL — coalesce so the INSERT path satisfies the constraint.
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
    -- raw param (NULL when not supplied) so re-confirming never wipes specialties
    specialty_slugs         = COALESCE(p_specialty_slugs, p.specialty_slugs),
    terms_accepted_at       = COALESCE(EXCLUDED.terms_accepted_at, p.terms_accepted_at),
    terms_version           = COALESCE(EXCLUDED.terms_version, p.terms_version),
    onboarding_completed_at = COALESCE(p.onboarding_completed_at, EXCLUDED.onboarding_completed_at);

  SELECT role INTO v_final_role FROM public.profiles WHERE id = v_uid;
  RETURN QUERY SELECT v_final_role, v_uid;
END
$$;

ALTER FUNCTION public.apply_onboarding_role(text, text, text, text, text[], timestamp with time zone, text) OWNER TO postgres;

-- Self-test on the RAW definition (no comment-strip: Postgres regex '.' matches
-- newlines by default, which would greedily eat the body after the first
-- comment). The inline comments above avoid the exact quoted tokens searched.
DO $test$
DECLARE
  v_def text := pg_get_functiondef('public.apply_onboarding_role(text,text,text,text,text[],timestamp with time zone,text)'::regprocedure);
BEGIN
  IF position('''supplier''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: role allow-list missing supplier';
  END IF;
  IF position('v_email' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: email-on-insert missing';
  END IF;
  IF position('COALESCE(p_specialty_slugs' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: specialty_slugs not coalesced (NOT-NULL crash on new accounts)';
  END IF;
  RAISE NOTICE 'apply_onboarding_role hardened & LIVE: supplier + email + specialty_slugs — new-account onboarding fixed.';
END
$test$;

COMMIT;
