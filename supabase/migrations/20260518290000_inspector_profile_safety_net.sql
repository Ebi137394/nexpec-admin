-- ============================================================================
-- INSPECTOR PROFILE SAFETY-NET
--
-- Idempotent guard for:
--   • profiles.specialty_slugs (text[])  → multi-select specialties
--   • profiles.resume_path     (text)    → CV/Resume storage path
--   • profiles.ndt_methods     (text[])  → NDT method codes
--   • 'resumes' private bucket + RLS    → CV uploads
--   • 'avatars' public bucket          → avatar uploads
--
-- Safe to re-run. Wraps every DDL in IF NOT EXISTS / DO blocks.
-- ============================================================================

BEGIN;

-- 1) Column guards ------------------------------------------------------------

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS specialty_slugs text[] DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ndt_methods    text[] DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS resume_path    text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url     text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS certifications text[] DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS headline       text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio            text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location_city  text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location_province text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS travel_radius_km int;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_of_residence text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS work_authorized_countries text[] DEFAULT '{}'::text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS open_to_sponsored_work boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sponsored_countries text[] DEFAULT '{}'::text[];

-- 2) GIN indexes for fast array-overlap filtering (jobs feed + admin search)
CREATE INDEX IF NOT EXISTS idx_profiles_specialty_slugs_gin
  ON public.profiles USING GIN (specialty_slugs);
CREATE INDEX IF NOT EXISTS idx_profiles_ndt_methods_gin
  ON public.profiles USING GIN (ndt_methods);

-- 3) Resumes bucket -----------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes', 'resumes', false, 10485760, -- 10 MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 4) Resumes RLS — owner reads/writes their own; admins read all -------------
DROP POLICY IF EXISTS "resumes_owner_or_admin_read"   ON storage.objects;
DROP POLICY IF EXISTS "resumes_owner_insert"          ON storage.objects;
DROP POLICY IF EXISTS "resumes_owner_update"          ON storage.objects;
DROP POLICY IF EXISTS "resumes_owner_or_admin_delete" ON storage.objects;

CREATE POLICY "resumes_owner_or_admin_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'resumes'
    AND (
      public.nx_is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

CREATE POLICY "resumes_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "resumes_owner_update" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "resumes_owner_or_admin_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'resumes'
    AND (
      public.nx_is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- 5) Avatars bucket (public) -------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', true, 5242880, -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "avatars_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_insert"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete"  ON storage.objects;

CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_update" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6) Smoke-test view: prove the schema is correct ----------------------------
-- Run this AFTER the migration to confirm everything's in place:
--
--   SELECT * FROM public.inspector_profile_smoke_test;
--
-- Expected: every row prints 'ok'. Anything else → tell us which row failed.

CREATE OR REPLACE VIEW public.inspector_profile_smoke_test AS
SELECT 'profiles.specialty_slugs' AS check, CASE
  WHEN EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='profiles' AND column_name='specialty_slugs')
  THEN 'ok' ELSE 'MISSING' END AS status
UNION ALL SELECT 'profiles.ndt_methods',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='profiles' AND column_name='ndt_methods')
  THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'profiles.resume_path',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='profiles' AND column_name='resume_path')
  THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'bucket: resumes',
  CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id='resumes')
  THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'bucket: avatars',
  CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id='avatars')
  THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'bucket: chat_attachments',
  CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id='chat_attachments')
  THEN 'ok' ELSE 'MISSING' END;

GRANT SELECT ON public.inspector_profile_smoke_test TO authenticated;

COMMIT;
