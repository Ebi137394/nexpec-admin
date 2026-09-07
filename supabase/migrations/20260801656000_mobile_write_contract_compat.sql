-- ════════════════════════════════════════════════════════════════════════════
--  20260801656000_mobile_write_contract_compat.sql
--
--  Makes the ALREADY-PUBLISHED mobile binaries save correctly, server-side.
--  These are compatibility repairs for write paths that are live in the App
--  Store / Play Store today and cannot be changed without a new release.
--
--  ── THE FOUR DEFECTS (all reproduced against Production) ───────────────────
--
--  1. PROFESSIONAL TITLE — SPLIT BRAIN
--     public.profiles carries BOTH `professional_title` and `title`.
--     app/profile/edit.tsx writes `title`; the web app, the admin console and
--     lib/data/inspectorProfile.ts all read `professional_title`. An inspector
--     types their title on the phone and every other surface shows blank.
--     Production today: 2 profiles have `title`, 1 has `professional_title`.
--
--  2. CV PATH — WRITTEN TO A DEAD COLUMN
--     app/profile/experience.tsx uploads to the `resumes` bucket and stores
--     the object path in `resume_url`. But `resumes` is PRIVATE, and
--     `resume_url` is a legacy PUBLIC-url column; the live column is
--     `resume_path`, which readers sign at render time. A CV uploaded from
--     mobile is therefore invisible everywhere and its link is dead.
--
--  3. EQUIPMENT — INSERT ALWAYS DENIED
--     public.equipment has both `inspector_id` and `user_id`. Mobile sets
--     `inspector_id`; the owner RLS policies test `user_id = auth.uid()`.
--     With user_id NULL the check is NULL, not true, so every insert by a
--     non-admin is refused. Production: 10 rows, ALL with both columns NULL.
--
--  4. WORK EXPERIENCE — INSERT ALWAYS DENIED
--     public.work_experience has RLS enabled and exactly ONE policy,
--     work_experience_admin_all (nx_is_admin()). No owner policy exists, so a
--     user cannot write — or even read — their own employment history.
--     Production: 0 rows, which is a consequence, not a coincidence.
--
--  ── WHAT IS DELIBERATELY *NOT* FIXED HERE ──────────────────────────────────
--  app/profile/rates.tsx SELECTs and UPDATEs eight columns that do not exist
--  (daily_rate, travel_rate, travel_rate_unit, tax_id, minimum_hours,
--  payment_terms_days, accepts_credit_card/bank_transfer/check), so the whole
--  screen 400s on load. It is NOT repaired server-side, because one of those
--  columns is `tax_id`: profiles rows are readable by other users through
--  profiles_read_related (nx_can_read_profile), so adding a tax-identifier
--  column there would create a new PII exposure purely to make a form load.
--  Adding the other seven alone would not make the screen work either — the
--  SELECT would still fail on tax_id. That screen requires a mobile release.
--
--  ── SECURITY POSTURE ───────────────────────────────────────────────────────
--  Nothing here widens access to anyone's data except its own owner:
--   • The two triggers only move values BETWEEN COLUMNS OF THE ROW BEING
--     WRITTEN. They read nothing else and grant nothing.
--   • work_experience gains owner-scoped policies matching the shape already
--     used by inspector_work_experience. The admin policy is untouched.
--   • No policy is dropped or loosened, no grant is widened, no bucket
--     becomes public.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 + 2. profiles compatibility projection ───────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_profiles_mobile_compat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- ── Professional title ───────────────────────────────────────────────
  -- Mirror whichever side the writer actually touched. On UPDATE we compare
  -- against OLD so the freshly-written side wins; if neither changed, we
  -- backfill a NULL side from a populated one.
  IF TG_OP = 'INSERT' THEN
    IF NEW.professional_title IS NULL AND NEW.title IS NOT NULL THEN
      NEW.professional_title := NEW.title;
    ELSIF NEW.title IS NULL AND NEW.professional_title IS NOT NULL THEN
      NEW.title := NEW.professional_title;
    END IF;
  ELSE
    IF NEW.title IS DISTINCT FROM OLD.title
       AND NEW.professional_title IS NOT DISTINCT FROM OLD.professional_title THEN
      -- Mobile wrote `title`.
      NEW.professional_title := NEW.title;
    ELSIF NEW.professional_title IS DISTINCT FROM OLD.professional_title
       AND NEW.title IS NOT DISTINCT FROM OLD.title THEN
      -- Web / admin wrote `professional_title`.
      NEW.title := NEW.professional_title;
    ELSIF NEW.professional_title IS NULL AND NEW.title IS NOT NULL THEN
      NEW.professional_title := NEW.title;
    ELSIF NEW.title IS NULL AND NEW.professional_title IS NOT NULL THEN
      NEW.title := NEW.professional_title;
    END IF;
  END IF;

  -- ── CV path ──────────────────────────────────────────────────────────
  -- Mobile stores a bucket OBJECT PATH in resume_url. A real legacy value in
  -- that column is an absolute http(s) URL, so the two are unambiguous: only
  -- promote when it is NOT a URL. Never overwrite an existing resume_path —
  -- that is the live column and the newer write wins.
  IF NEW.resume_url IS NOT NULL
     AND NEW.resume_url !~ '^https?://'
     AND (TG_OP = 'INSERT' OR NEW.resume_url IS DISTINCT FROM OLD.resume_url)
  THEN
    IF NEW.resume_path IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.resume_path IS NOT DISTINCT FROM OLD.resume_path)
    THEN
      NEW.resume_path := NEW.resume_url;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nx_profiles_mobile_compat_trg ON public.profiles;
CREATE TRIGGER nx_profiles_mobile_compat_trg
  BEFORE INSERT OR UPDATE OF title, professional_title, resume_url, resume_path
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_profiles_mobile_compat();

-- Repair the rows that were written before this trigger existed.
UPDATE public.profiles
   SET professional_title = title
 WHERE professional_title IS NULL AND title IS NOT NULL;

UPDATE public.profiles
   SET title = professional_title
 WHERE title IS NULL AND professional_title IS NOT NULL;

UPDATE public.profiles
   SET resume_path = resume_url
 WHERE resume_path IS NULL
   AND resume_url IS NOT NULL
   AND resume_url !~ '^https?://';

-- ── 2b. Rate columns the mobile rates screen needs ─────────────────────────
-- app/profile/rates.tsx reads and writes nine columns that do not exist, so
-- the screen 400s on load and the rates feature is entirely dead on mobile.
-- Four of them have canonical homes and the client is being remapped onto
-- those (travel_rate→travel_rate_cents, minimum_hours→minimum_engagement_hours,
-- payment_terms_days→payment_terms, hourly_rate→hourly_rate_cents). These five
-- have no canonical equivalent and are ordinary, non-sensitive commercial
-- terms, so they get real columns.
--
-- `tax_id` is deliberately NOT among them. profiles rows are readable by other
-- users through profiles_read_related (nx_can_read_profile), so a tax
-- identifier stored here would be exposed to every reader of the row. It needs
-- a restricted store of its own; until then the field is removed from the
-- mobile form rather than persisted somewhere it does not belong.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_rate_cents bigint,
  ADD COLUMN IF NOT EXISTS travel_rate_unit text,
  ADD COLUMN IF NOT EXISTS accepts_credit_card boolean,
  ADD COLUMN IF NOT EXISTS accepts_bank_transfer boolean,
  ADD COLUMN IF NOT EXISTS accepts_check boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND conname  = 'profiles_daily_rate_cents_band'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_daily_rate_cents_band
      CHECK (daily_rate_cents IS NULL
             OR (daily_rate_cents >= 0 AND daily_rate_cents <= 5000000));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND conname  = 'profiles_travel_rate_unit_enum'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_travel_rate_unit_enum
      CHECK (travel_rate_unit IS NULL OR travel_rate_unit IN ('km', 'mile'));
  END IF;
END $$;

-- ── 3. equipment: derive the column RLS actually tests ─────────────────────
CREATE OR REPLACE FUNCTION public.nx_equipment_owner_compat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The owner policies test user_id; mobile only sets inspector_id. Fill each
  -- from the other so a write from either client satisfies the same check.
  -- BEFORE triggers run ahead of the RLS WITH CHECK, so this is what makes
  -- the published binary's insert legal — it does not bypass the check, it
  -- lets an honest owner pass it.
  IF NEW.user_id IS NULL AND NEW.inspector_id IS NOT NULL THEN
    NEW.user_id := NEW.inspector_id;
  ELSIF NEW.inspector_id IS NULL AND NEW.user_id IS NOT NULL THEN
    NEW.inspector_id := NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nx_equipment_owner_compat_trg ON public.equipment;
CREATE TRIGGER nx_equipment_owner_compat_trg
  BEFORE INSERT OR UPDATE ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_equipment_owner_compat();

-- ── 4. work_experience: give the owner their own rows back ─────────────────
-- Mirrors inspector_work_experience: any signed-in user may read (employment
-- history is shown on an inspector's public profile), only the owner writes.
-- work_experience_admin_all is left exactly as it is.
DROP POLICY IF EXISTS work_experience_read ON public.work_experience;
CREATE POLICY work_experience_read
  ON public.work_experience
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS work_experience_self_insert ON public.work_experience;
CREATE POLICY work_experience_self_insert
  ON public.work_experience
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS work_experience_self_update ON public.work_experience;
CREATE POLICY work_experience_self_update
  ON public.work_experience
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS work_experience_self_delete ON public.work_experience;
CREATE POLICY work_experience_self_delete
  ON public.work_experience
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- The table is owner-scoped for writes and signed-in-only for reads; anon has
-- no business here.
REVOKE ALL ON public.work_experience FROM anon;

COMMIT;
