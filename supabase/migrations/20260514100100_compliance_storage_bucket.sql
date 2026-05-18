-- ============================================================================
-- COMPLIANCE STORAGE BUCKET + POLICIES
-- ============================================================================
--
-- Creates the `compliance` bucket and its row-level policies on
-- storage.objects. Path layout:
--
--   compliance/cci-applications/<inspector_uid>/gov_id/<filename>
--   compliance/cci-applications/<inspector_uid>/experience/<filename>
--   compliance/captures/<job_uid>/<requirement_uid>/<filename>   (later)
--   compliance/documents/<job_uid>/<doc_id>/<filename>           (later)
--
-- The bucket is private (no anon read). All access is mediated by RLS
-- on storage.objects keyed off the path prefix.
-- ============================================================================

BEGIN;

-- ─── Create the bucket (idempotent) ─────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'compliance',
  'compliance',
  false,
  20971520,                                  -- 20 MB per object
  ARRAY[
    'image/jpeg', 'image/png', 'image/heic', 'image/webp',
    'application/pdf',
    'video/mp4', 'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public               = EXCLUDED.public,
  file_size_limit      = EXCLUDED.file_size_limit,
  allowed_mime_types   = EXCLUDED.allowed_mime_types;

-- ─── RLS policies on storage.objects (compliance bucket only) ───
--
-- Helper: parse the second path segment as a uuid (the inspector_uid
-- under cci-applications/). Used to enforce "only the inspector or an
-- admin can touch their own CCI-application paths".
--
-- storage.foldername(name) returns text[] of path segments; we index
-- it as foldername[2] which gives us '<inspector_uid>' for paths under
-- 'cci-applications/'.

-- CCI applications: INSERT for self
DROP POLICY IF EXISTS "compliance_cci_app_insert_self" ON storage.objects;
CREATE POLICY "compliance_cci_app_insert_self"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'cci-applications'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- CCI applications: SELECT for self or admin
DROP POLICY IF EXISTS "compliance_cci_app_select_self_or_admin" ON storage.objects;
CREATE POLICY "compliance_cci_app_select_self_or_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'cci-applications'
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR public.nx_is_admin()
    )
  );

-- CCI applications: UPDATE/DELETE only by admin (inspectors can re-upload
-- by submitting a new application; existing files are evidence and stay)
DROP POLICY IF EXISTS "compliance_cci_app_update_admin" ON storage.objects;
CREATE POLICY "compliance_cci_app_update_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'cci-applications'
    AND public.nx_is_admin()
  );

DROP POLICY IF EXISTS "compliance_cci_app_delete_admin" ON storage.objects;
CREATE POLICY "compliance_cci_app_delete_admin"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'compliance'
    AND (storage.foldername(name))[1] = 'cci-applications'
    AND public.nx_is_admin()
  );

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. Bucket exists:
--    SELECT id, public, file_size_limit FROM storage.buckets WHERE id='compliance';
-- 2. Policies installed:
--    SELECT polname FROM pg_policy
--      WHERE polrelid = 'storage.objects'::regclass
--      AND polname LIKE 'compliance_%';
-- ============================================================================
