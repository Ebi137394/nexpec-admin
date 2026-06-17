-- ============================================================================
-- INSPECTOR COMPLIANCE RECORDS — sprint 10
--
-- Three sibling tables for an inspector's personal compliance dossier:
--   1. inspector_documents       — ID cards, work permits, insurance, safety
--                                  tickets. Free-form `kind` + label + file
--                                  + expiry.
--   2. inspector_equipment       — Owned/operated equipment with calibration
--                                  tracking. last_calibration_at +
--                                  next_calibration_due + cert file.
--   3. inspector_certifications  — Proper certifications table (separate
--                                  from profiles.certifications text[] which
--                                  remains for the chip cloud). Issuer,
--                                  cert number, expiry, file.
--
-- All three are inspector-owned (RLS keyed off inspector_id = auth.uid())
-- with read access for admins via the existing nx_is_admin() helper.
--
-- Storage: a dedicated private bucket `inspector_credentials` with three
-- top-level path prefixes — documents/, equipment/, certifications/. Path
-- layout: <prefix>/<inspector_uid>/<filename>. The inspector owns and
-- writes their own folder; admins can read everything in the bucket.
-- ============================================================================

BEGIN;

-- ─── 1. inspector_documents ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inspector_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN (
    'id_card',
    'passport',
    'work_permit',
    'insurance',
    'safety_ticket',
    'medical',
    'background_check',
    'other'
  )),
  label           TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  file_url        TEXT,                              -- signed-URL form (server-built on read)
  file_path       TEXT NOT NULL,                     -- object key in inspector_credentials bucket
  expires_at      DATE,
  notes           TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspector_documents_inspector
  ON public.inspector_documents(inspector_id);

CREATE INDEX IF NOT EXISTS idx_inspector_documents_expiry
  ON public.inspector_documents(inspector_id, expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── 2. inspector_equipment ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inspector_equipment (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  manufacturer                  TEXT CHECK (manufacturer IS NULL OR char_length(manufacturer) <= 80),
  model_number                  TEXT CHECK (model_number IS NULL OR char_length(model_number) <= 80),
  serial_number                 TEXT CHECK (serial_number IS NULL OR char_length(serial_number) <= 80),
  last_calibration_at           DATE,
  next_calibration_due          DATE,
  calibration_certificate_url   TEXT,
  calibration_certificate_path  TEXT,
  notes                         TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspector_equipment_inspector
  ON public.inspector_equipment(inspector_id);

CREATE INDEX IF NOT EXISTS idx_inspector_equipment_due
  ON public.inspector_equipment(inspector_id, next_calibration_due)
  WHERE next_calibration_due IS NOT NULL;

-- ─── 3. inspector_certifications ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inspector_certifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  issuing_body          TEXT CHECK (issuing_body IS NULL OR char_length(issuing_body) <= 120),
  certificate_number    TEXT CHECK (certificate_number IS NULL OR char_length(certificate_number) <= 120),
  issued_at             DATE,
  expires_at            DATE,
  certificate_url       TEXT,
  certificate_path      TEXT,
  notes                 TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspector_certifications_inspector
  ON public.inspector_certifications(inspector_id);

CREATE INDEX IF NOT EXISTS idx_inspector_certifications_expiry
  ON public.inspector_certifications(inspector_id, expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── updated_at triggers ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inspector_documents_touch ON public.inspector_documents;
CREATE TRIGGER inspector_documents_touch
  BEFORE UPDATE ON public.inspector_documents
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS inspector_equipment_touch ON public.inspector_equipment;
CREATE TRIGGER inspector_equipment_touch
  BEFORE UPDATE ON public.inspector_equipment
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS inspector_certifications_touch ON public.inspector_certifications;
CREATE TRIGGER inspector_certifications_touch
  BEFORE UPDATE ON public.inspector_certifications
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.inspector_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspector_equipment      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspector_certifications ENABLE ROW LEVEL SECURITY;

-- inspector_documents: self full CRUD; admin read
DROP POLICY IF EXISTS "insp_docs_self_all" ON public.inspector_documents;
CREATE POLICY "insp_docs_self_all"
  ON public.inspector_documents FOR ALL
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

DROP POLICY IF EXISTS "insp_docs_admin_read" ON public.inspector_documents;
CREATE POLICY "insp_docs_admin_read"
  ON public.inspector_documents FOR SELECT
  USING (public.nx_is_admin());

-- inspector_equipment: self full CRUD; admin read
DROP POLICY IF EXISTS "insp_equip_self_all" ON public.inspector_equipment;
CREATE POLICY "insp_equip_self_all"
  ON public.inspector_equipment FOR ALL
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

DROP POLICY IF EXISTS "insp_equip_admin_read" ON public.inspector_equipment;
CREATE POLICY "insp_equip_admin_read"
  ON public.inspector_equipment FOR SELECT
  USING (public.nx_is_admin());

-- inspector_certifications: self full CRUD; admin read
DROP POLICY IF EXISTS "insp_certs_self_all" ON public.inspector_certifications;
CREATE POLICY "insp_certs_self_all"
  ON public.inspector_certifications FOR ALL
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

DROP POLICY IF EXISTS "insp_certs_admin_read" ON public.inspector_certifications;
CREATE POLICY "insp_certs_admin_read"
  ON public.inspector_certifications FOR SELECT
  USING (public.nx_is_admin());

-- ─── Storage bucket: inspector_credentials ───────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspector_credentials',
  'inspector_credentials',
  false,                                       -- private; we serve via signed URLs
  20971520,                                    -- 20 MB per object
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── Storage RLS — three prefixes, mirror pattern ────────────────────────
--
-- Path layout for all three prefixes:
--   <prefix>/<inspector_uid>/<filename>
-- so storage.foldername(name)[1] = prefix and [2] = inspector uid.

-- documents/
DROP POLICY IF EXISTS "insp_cred_docs_self_all" ON storage.objects;
CREATE POLICY "insp_cred_docs_self_all"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'documents'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'documents'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "insp_cred_docs_admin_read" ON storage.objects;
CREATE POLICY "insp_cred_docs_admin_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'documents'
    AND public.nx_is_admin()
  );

-- equipment/
DROP POLICY IF EXISTS "insp_cred_equip_self_all" ON storage.objects;
CREATE POLICY "insp_cred_equip_self_all"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'equipment'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'equipment'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "insp_cred_equip_admin_read" ON storage.objects;
CREATE POLICY "insp_cred_equip_admin_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'equipment'
    AND public.nx_is_admin()
  );

-- certifications/
DROP POLICY IF EXISTS "insp_cred_certs_self_all" ON storage.objects;
CREATE POLICY "insp_cred_certs_self_all"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'certifications'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'certifications'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "insp_cred_certs_admin_read" ON storage.objects;
CREATE POLICY "insp_cred_certs_admin_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspector_credentials'
    AND (storage.foldername(name))[1] = 'certifications'
    AND public.nx_is_admin()
  );

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. Tables exist:
--      SELECT table_name FROM information_schema.tables
--        WHERE table_schema='public'
--        AND table_name IN ('inspector_documents','inspector_equipment','inspector_certifications');
-- 2. RLS enabled:
--      SELECT relname, relrowsecurity FROM pg_class
--        WHERE relname IN ('inspector_documents','inspector_equipment','inspector_certifications');
-- 3. Bucket present:
--      SELECT id, public, file_size_limit FROM storage.buckets WHERE id='inspector_credentials';
-- 4. Storage policies:
--      SELECT polname FROM pg_policy
--        WHERE polrelid = 'storage.objects'::regclass
--        AND polname LIKE 'insp_cred_%';
-- ============================================================================
