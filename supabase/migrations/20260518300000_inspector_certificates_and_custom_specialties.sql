-- ============================================================================
-- Inspector certificates + custom-specialty support
--
-- 1) Lets inspectors store an array of CUSTOM (free-form) specialties &
--    NDT methods beyond the curated SPECIALTY_GROUPS list.
-- 2) Adds a full inspector_certificates table for individual cert
--    documents (API 510 PDF, CWI card, etc.) with expiry tracking.
-- 3) Private 'inspector_certificates' storage bucket with owner-scoped RLS.
-- ============================================================================

BEGIN;

-- 1) Custom specialty / method overflow columns -----------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS custom_specialties  text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS custom_ndt_methods  text[] DEFAULT '{}'::text[];

-- 2) Certificates table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inspector_certificates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  issuing_body    text,
  certificate_no  text,
  issue_date      date,
  expiry_date     date,
  file_path       text,          -- storage path in 'inspector_certificates' bucket
  file_mime       text,
  file_size_bytes bigint,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspector_certs_inspector
  ON public.inspector_certificates(inspector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inspector_certs_expiry
  ON public.inspector_certificates(expiry_date)
  WHERE expiry_date IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_inspector_certificates_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_inspector_certs_updated_at ON public.inspector_certificates;
CREATE TRIGGER trg_inspector_certs_updated_at
  BEFORE UPDATE ON public.inspector_certificates
  FOR EACH ROW EXECUTE FUNCTION public.touch_inspector_certificates_updated_at();

-- 3) RLS — inspectors manage their own, admins read all ---------------------
ALTER TABLE public.inspector_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "certs_self_or_admin_read"   ON public.inspector_certificates;
DROP POLICY IF EXISTS "certs_self_insert"          ON public.inspector_certificates;
DROP POLICY IF EXISTS "certs_self_update"          ON public.inspector_certificates;
DROP POLICY IF EXISTS "certs_self_or_admin_delete" ON public.inspector_certificates;

CREATE POLICY "certs_self_or_admin_read"
  ON public.inspector_certificates FOR SELECT
  USING (inspector_id = auth.uid() OR public.nx_is_admin());

CREATE POLICY "certs_self_insert"
  ON public.inspector_certificates FOR INSERT
  WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "certs_self_update"
  ON public.inspector_certificates FOR UPDATE
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "certs_self_or_admin_delete"
  ON public.inspector_certificates FOR DELETE
  USING (inspector_id = auth.uid() OR public.nx_is_admin());

-- 4) Storage bucket --------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspector_certificates', 'inspector_certificates', false, 15728640, -- 15 MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg', 'image/png', 'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "certs_storage_owner_or_admin_read"   ON storage.objects;
DROP POLICY IF EXISTS "certs_storage_owner_insert"          ON storage.objects;
DROP POLICY IF EXISTS "certs_storage_owner_update"          ON storage.objects;
DROP POLICY IF EXISTS "certs_storage_owner_or_admin_delete" ON storage.objects;

CREATE POLICY "certs_storage_owner_or_admin_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspector_certificates'
    AND (
      public.nx_is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

CREATE POLICY "certs_storage_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'inspector_certificates'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "certs_storage_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'inspector_certificates'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'inspector_certificates'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "certs_storage_owner_or_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'inspector_certificates'
    AND (
      public.nx_is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

COMMIT;
