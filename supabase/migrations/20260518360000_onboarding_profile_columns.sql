-- ============================================================================
-- Additive columns for the multi-step onboarding wizard.
--
-- Stored on profiles so the role-specific data captured at signup persists
-- after the trigger creates the row from auth.users.raw_user_meta_data.
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_name             text,
  ADD COLUMN IF NOT EXISTS contact_person_name      text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version            text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_role          text;

-- Sync trigger: when a profile is created via auth.users → raw_user_meta_data,
-- copy the onboarding payload (specialty_slugs, company_name, etc.) onto the
-- profiles row. If the project's existing trigger already handles raw_meta,
-- this DO block is a no-op safety net.

CREATE OR REPLACE FUNCTION public.sync_onboarding_metadata_to_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_meta jsonb;
  v_specialties text[];
BEGIN
  SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = NEW.id;
  IF v_meta IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pull role-specific fields out of the metadata blob.
  IF v_meta ? 'full_name' AND NEW.full_name IS NULL THEN
    NEW.full_name := v_meta->>'full_name';
  END IF;
  IF v_meta ? 'company_name' THEN
    NEW.company_name := COALESCE(NEW.company_name, v_meta->>'company_name');
  END IF;
  IF v_meta ? 'contact_person_name' THEN
    NEW.contact_person_name := COALESCE(
      NEW.contact_person_name,
      v_meta->>'contact_person_name'
    );
  END IF;
  IF v_meta ? 'onboarding_role' THEN
    NEW.onboarding_role := COALESCE(NEW.onboarding_role, v_meta->>'onboarding_role');
    IF NEW.role IS NULL OR NEW.role = '' OR NEW.role = 'client' THEN
      -- Promote the role only if it was the default. Admins set role manually.
      NEW.role := COALESCE(v_meta->>'onboarding_role', NEW.role);
    END IF;
  END IF;
  IF v_meta ? 'specialty_slugs' THEN
    BEGIN
      v_specialties := ARRAY(
        SELECT jsonb_array_elements_text(v_meta->'specialty_slugs')
      );
      IF array_length(v_specialties, 1) IS NOT NULL THEN
        NEW.specialty_slugs := v_specialties;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF v_meta ? 'terms_accepted_at' THEN
    NEW.terms_accepted_at := COALESCE(
      NEW.terms_accepted_at,
      (v_meta->>'terms_accepted_at')::timestamptz
    );
  END IF;
  IF v_meta ? 'terms_version' THEN
    NEW.terms_version := COALESCE(NEW.terms_version, v_meta->>'terms_version');
  END IF;

  NEW.onboarding_completed_at := COALESCE(NEW.onboarding_completed_at, NOW());

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sync_onboarding_metadata_to_profile: %', SQLERRM;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sync_onboarding_metadata ON public.profiles;
CREATE TRIGGER trg_sync_onboarding_metadata
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_onboarding_metadata_to_profile();

COMMIT;
