-- ============================================================================
-- apply_onboarding_role — SECURITY DEFINER RPC for OAuth signup role recovery
--
-- ## The bug
--
-- Pre-fix flow for an OAuth signup:
--   1. User completes the 4-step onboarding wizard, picks role='agency'.
--   2. signUpWithProfileAndOAuth stashes { role:'agency', ... } in the
--      nx_onboard cookie, then redirects to Google.
--   3. Google bounces back to /auth/callback?code=…
--   4. exchangeCodeForSession creates auth.users. The BEFORE INSERT trigger
--      on public.profiles runs with whatever's in raw_user_meta_data (which
--      for OAuth is empty for `role`), so the profile row lands as
--      role='client' (the trigger's default).
--   5. applyOnboardingCookieToProfile then ran
--          UPDATE public.profiles SET role='agency' WHERE id = auth.uid()
--      …and SILENTLY no-op'd, because the column-level RLS lockdown on
--      profiles.role only allows admins to flip the role column. The user's
--      own UPDATE was filtered out (0 rows affected, no error).
--
-- ## The fix
--
-- This RPC runs SECURITY DEFINER so it can write to profiles.role on behalf
-- of the authenticated user, but inside the function body we enforce that:
--
--   • caller must be authenticated (auth.uid() not null)
--   • the requested role is one of {client, inspector, agency, enterprise}
--   • the caller cannot DOWNGRADE themselves out of {admin, super_admin,
--     inspector} — those are operator/credentialed roles administered out
--     of band. If the current role is one of those AND the requested role
--     differs, the function is a no-op and returns the existing role.
--   • the update is idempotent — re-running with the same role is safe.
--
-- This is the same pattern as nx_notify (SECURITY DEFINER, returns the
-- effective result, propagates errors loudly) — the codebase's house style
-- for any mutation that needs to cross an RLS boundary in a controlled way.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.apply_onboarding_role(
  text, text, text, text, text[], timestamptz, text
) CASCADE;

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
     OR p_role NOT IN ('client', 'inspector', 'agency', 'enterprise')
  THEN
    RAISE EXCEPTION 'apply_onboarding_role: invalid p_role: %', p_role;
  END IF;

  -- Read the existing role (if any). The profile row may not exist yet — the
  -- AFTER-auth.users trigger might still be running on a Postgres replica.
  -- We handle both cases with an UPSERT below.
  SELECT role INTO v_current_role FROM public.profiles WHERE id = v_uid;

  -- One-way guard: do NOT downgrade an existing operator/inspector via the
  -- public onboarding path. Promotions to those roles happen through the
  -- admin Users surface, not through self-service signup.
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

  -- Idempotent upsert. If the profile already exists, we UPDATE the
  -- onboarding-owned columns. If it doesn't, we INSERT — this covers the
  -- race window between auth.users INSERT and the BEFORE INSERT trigger
  -- on profiles completing on a hot replica.
  INSERT INTO public.profiles AS p (
    id,
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
    role                    = EXCLUDED.role,
    onboarding_role         = COALESCE(EXCLUDED.onboarding_role, p.onboarding_role),
    full_name               = COALESCE(EXCLUDED.full_name, p.full_name),
    company_name            = COALESCE(EXCLUDED.company_name, p.company_name),
    contact_person_name     = COALESCE(EXCLUDED.contact_person_name, p.contact_person_name),
    specialty_slugs         = COALESCE(EXCLUDED.specialty_slugs, p.specialty_slugs),
    terms_accepted_at       = COALESCE(EXCLUDED.terms_accepted_at, p.terms_accepted_at),
    terms_version           = COALESCE(EXCLUDED.terms_version, p.terms_version),
    onboarding_completed_at = COALESCE(p.onboarding_completed_at, EXCLUDED.onboarding_completed_at);

  -- Re-read so we return the canonical post-upsert value.
  SELECT role INTO v_final_role FROM public.profiles WHERE id = v_uid;
  RETURN QUERY SELECT v_final_role, v_uid;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.apply_onboarding_role(
  text, text, text, text, text[], timestamptz, text
) TO authenticated;

-- Sanity grant for service_role too (Edge Functions / cron jobs that need
-- to repair a stuck signup out of band).
GRANT EXECUTE ON FUNCTION public.apply_onboarding_role(
  text, text, text, text, text[], timestamptz, text
) TO service_role;

COMMIT;

-- Verify after running:
--   SELECT proname, prosecdef
--     FROM pg_proc
--    WHERE proname = 'apply_onboarding_role';
-- Expect prosecdef = true (SECURITY DEFINER).
--
-- Smoke test as a non-admin authenticated user (in SQL editor with that user's JWT):
--   SELECT * FROM public.apply_onboarding_role('agency', 'Acme LLC');
-- Then:
--   SELECT id, role, onboarding_role, company_name
--     FROM public.profiles
--    WHERE id = auth.uid();
-- Expect role = 'agency'.
