-- ============================================================================
-- WORK EXPERIENCE + RESUME + RICH RATES — sprint 11 (web launch)
--
-- 1. inspector_work_experience      — chronological work history rows
-- 2. profiles.{resume_path, rate columns} — rich-rates extensions
-- 3. storage.buckets.resumes        — private resume/CV bucket + RLS
--
-- Rates additions on profiles:
--    currency                       TEXT   default 'USD' (ISO 4217)
--    travel_rate_cents              BIGINT — per-hour rate while travelling
--    overtime_multiplier            NUMERIC(4,2) default 1.50
--    weekend_multiplier             NUMERIC(4,2) default 1.50
--    holiday_multiplier             NUMERIC(4,2) default 2.00
--    payment_terms                  TEXT — enum-like; 'net15'|'net30'|'net45'|'net60'
--    minimum_engagement_hours       INT  — minimum bookable engagement
--    resume_path                    TEXT — storage object key in `resumes`
--
-- The legacy resume_url remains as a public-URL field for back-compat.
-- New code reads resume_path, signs URLs on demand.
-- ============================================================================

BEGIN;

-- ─── 1. inspector_work_experience ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inspector_work_experience (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company         TEXT NOT NULL CHECK (char_length(company) BETWEEN 1 AND 160),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  location        TEXT CHECK (location IS NULL OR char_length(location) <= 160),
  start_date      DATE NOT NULL,
  end_date        DATE,
  is_current      BOOLEAN NOT NULL DEFAULT FALSE,
  description     TEXT CHECK (description IS NULL OR char_length(description) <= 4000),
  achievements    TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- end_date can only be NULL while is_current = TRUE, and vice versa
  CONSTRAINT inspector_work_experience_date_logic CHECK (
    (is_current = TRUE AND end_date IS NULL)
    OR (is_current = FALSE AND end_date IS NOT NULL AND end_date >= start_date)
  ),
  CONSTRAINT inspector_work_experience_achievements_cap CHECK (
    array_length(achievements, 1) IS NULL
    OR array_length(achievements, 1) <= 20
  )
);

CREATE INDEX IF NOT EXISTS idx_inspector_work_experience_inspector
  ON public.inspector_work_experience(inspector_id, start_date DESC);

-- updated_at trigger (reuse the helper installed in sprint 10)
DROP TRIGGER IF EXISTS inspector_work_experience_touch
  ON public.inspector_work_experience;
CREATE TRIGGER inspector_work_experience_touch
  BEFORE UPDATE ON public.inspector_work_experience
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.inspector_work_experience ENABLE ROW LEVEL SECURITY;

-- self full CRUD
DROP POLICY IF EXISTS "insp_work_exp_self_all" ON public.inspector_work_experience;
CREATE POLICY "insp_work_exp_self_all"
  ON public.inspector_work_experience FOR ALL
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

-- public read — clients reviewing inspector profiles see history
-- (GR4: client never contacts the inspector directly, but they CAN see
-- the work history surfaced by admin during dispatch review).
DROP POLICY IF EXISTS "insp_work_exp_public_read" ON public.inspector_work_experience;
CREATE POLICY "insp_work_exp_public_read"
  ON public.inspector_work_experience FOR SELECT
  USING (true);

-- ─── 2. profiles: rates + resume_path additions ──────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS currency                  TEXT          DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS travel_rate_cents         BIGINT,
  ADD COLUMN IF NOT EXISTS overtime_multiplier       NUMERIC(4,2)  DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS weekend_multiplier        NUMERIC(4,2)  DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS holiday_multiplier        NUMERIC(4,2)  DEFAULT 2.00,
  ADD COLUMN IF NOT EXISTS payment_terms             TEXT          DEFAULT 'net30',
  ADD COLUMN IF NOT EXISTS minimum_engagement_hours  INT,
  ADD COLUMN IF NOT EXISTS resume_path               TEXT;

-- Sanity checks — keep multipliers in a believable band, terms enum-like.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_currency_iso'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_currency_iso
        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_overtime_multiplier_band'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_overtime_multiplier_band
        CHECK (overtime_multiplier IS NULL OR (overtime_multiplier BETWEEN 1.00 AND 5.00));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_weekend_multiplier_band'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_weekend_multiplier_band
        CHECK (weekend_multiplier IS NULL OR (weekend_multiplier BETWEEN 1.00 AND 5.00));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_holiday_multiplier_band'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_holiday_multiplier_band
        CHECK (holiday_multiplier IS NULL OR (holiday_multiplier BETWEEN 1.00 AND 5.00));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_payment_terms_enum'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_payment_terms_enum
        CHECK (payment_terms IS NULL OR payment_terms IN ('net7','net15','net30','net45','net60','on_completion'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_minimum_engagement_band'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_minimum_engagement_band
        CHECK (minimum_engagement_hours IS NULL OR (minimum_engagement_hours BETWEEN 1 AND 240));
  END IF;
END $$;

-- ─── 3. resumes private bucket + RLS ─────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  false,                                          -- private
  10485760,                                       -- 10 MB cap
  ARRAY['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path layout: resumes/<inspector_uid>/<filename>
DROP POLICY IF EXISTS "resumes_self_all" ON storage.objects;
CREATE POLICY "resumes_self_all"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "resumes_admin_read" ON storage.objects;
CREATE POLICY "resumes_admin_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'resumes'
    AND public.nx_is_admin()
  );

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. Work experience table:
--      \d+ public.inspector_work_experience
-- 2. Profile rate columns:
--      SELECT column_name, data_type, column_default
--        FROM information_schema.columns
--        WHERE table_schema='public' AND table_name='profiles'
--        AND column_name IN ('currency','travel_rate_cents','overtime_multiplier',
--                            'weekend_multiplier','holiday_multiplier','payment_terms',
--                            'minimum_engagement_hours','resume_path')
--        ORDER BY column_name;
-- 3. Resumes bucket:
--      SELECT id, public, file_size_limit FROM storage.buckets WHERE id='resumes';
-- ============================================================================
