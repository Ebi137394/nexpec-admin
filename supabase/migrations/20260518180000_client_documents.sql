-- ============================================================================
-- SPRINT 12B — Client documents
--
-- Employer-side documents (drawings, spec sheets, NDAs, prior reports, etc).
--
-- ACCESS MATRIX
--   Owner (client/agency/enterprise)  full CRUD on own rows
--   Admin                             full CRUD on every row (oversight)
--   Assigned inspector                READ-ONLY on docs scoped to their
--                                     assigned job (job_id matches a job
--                                     where assigned_inspector_id=auth.uid())
--
-- BUCKET: client_documents (private, 25 MB). Path layout:
--   {owner_id}/{job_id-or-'org'}/{filename}
-- so storage.foldername[1] = owner uid, foldername[2] = job uid or literal 'org'.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id      uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN (
    'drawing','spec_sheet','nda','prior_report','regulatory',
    'vendor_doc','photo_evidence','other'
  )),
  label       text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 160),
  file_path   text NOT NULL,
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_documents_owner
  ON public.client_documents(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_documents_job
  ON public.client_documents(job_id) WHERE job_id IS NOT NULL;

-- updated_at trigger reuses helper from Sprint 10
DROP TRIGGER IF EXISTS client_documents_touch ON public.client_documents;
CREATE TRIGGER client_documents_touch
  BEFORE UPDATE ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

-- Owner full CRUD
DROP POLICY IF EXISTS "cdocs_owner_all" ON public.client_documents;
CREATE POLICY "cdocs_owner_all" ON public.client_documents FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Admin full CRUD
DROP POLICY IF EXISTS "cdocs_admin_all" ON public.client_documents;
CREATE POLICY "cdocs_admin_all" ON public.client_documents FOR ALL
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- Assigned inspector READ-ONLY on job-scoped docs only
DROP POLICY IF EXISTS "cdocs_inspector_read" ON public.client_documents;
CREATE POLICY "cdocs_inspector_read" ON public.client_documents FOR SELECT
  USING (
    job_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = client_documents.job_id
         AND j.assigned_inspector_id = auth.uid()
    )
  );

-- ─── Storage bucket ────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client_documents',
  'client_documents',
  false,            -- private; signed URLs only
  26214400,         -- 25 MB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── Storage RLS ──────────────────────────────────────────────────────
-- Path: {owner_id}/{job_id-or-'org'}/{filename}
--   foldername[1] = owner uid
--   foldername[2] = job uid (uuid) OR literal 'org' for org-wide docs

-- Owner full CRUD on their own folder
DROP POLICY IF EXISTS "cdocs_storage_owner_all" ON storage.objects;
CREATE POLICY "cdocs_storage_owner_all" ON storage.objects FOR ALL
  USING (
    bucket_id = 'client_documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'client_documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin SELECT on every object in the bucket
DROP POLICY IF EXISTS "cdocs_storage_admin_read" ON storage.objects;
CREATE POLICY "cdocs_storage_admin_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'client_documents'
    AND public.nx_is_admin()
  );

-- Assigned inspector SELECT on job-scoped objects only.
-- The path's second segment is the job uid (when set). If foldername[2]
-- parses as a uuid AND points to a job the caller is assigned to → allow.
DROP POLICY IF EXISTS "cdocs_storage_inspector_read" ON storage.objects;
CREATE POLICY "cdocs_storage_inspector_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'client_documents'
    AND (storage.foldername(name))[2] IS NOT NULL
    AND (storage.foldername(name))[2] <> 'org'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id::text = (storage.foldername(name))[2]
         AND j.assigned_inspector_id = auth.uid()
    )
  );

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT polname FROM pg_policy
--   WHERE polrelid = 'public.client_documents'::regclass;
-- SELECT polname FROM pg_policy
--   WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'cdocs_storage_%';
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id='client_documents';
-- ============================================================================
