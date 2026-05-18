-- ============================================================================
-- COMPLIANCE MODE — FOUNDATION (Phase α)
-- ============================================================================
--
-- Establishes the parallel inspection track for regulator-grade verification
-- jobs. This migration is exclusively additive — it does not modify or
-- remove any existing tables, columns, or policies. Existing "quality"
-- inspection jobs continue to work unchanged.
--
-- TABLES CREATED
--   inspection_scope_templates           — admin-curated scope library
--   inspection_evidence_requirements     — per-evidence checklist rows
--   inspection_captures                  — field captures w/ trust primitives
--   compliance_documents                 — supplier-uploaded legal documents
--   inspector_credentials                — tiered CCI credential tier
--   verification_affidavits              — final regulator-grade output
--   trust_certificates                   — public-portable trust assertion
--
-- COLUMNS ADDED TO jobs
--   inspection_type           ENUM (quality | compliance)  default 'quality'
--   scope_template_id         FK  → inspection_scope_templates
--   claimed_address_text      text
--   claimed_address_geocoded  geography(Point, 4326)
--
-- SEEDED DATA
--   3 active scope templates — SEV, TLV, FPP — with their requirements
--
-- HELPER FUNCTIONS
--   public.nx_is_admin(uid)                            — admin / super_admin
--   public.is_active_cci(uid, min_tier)             — CCI credential check
--   public.gen_verify_token()                       — URL-safe token gen
--
-- IMPORTANT EXECUTION NOTE
--   The entire file is a single BEGIN..COMMIT transaction. Run it as ONE
--   block in the Supabase SQL Editor — running fragments individually will
--   trip forward-reference errors (helpers reference tables created later
--   in the file).
-- ============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- PHASE A: ENUM types
-- ───────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inspection_type_kind') THEN
    CREATE TYPE public.inspection_type_kind AS ENUM ('quality', 'compliance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compliance_evidence_kind') THEN
    CREATE TYPE public.compliance_evidence_kind AS ENUM (
      'photo',
      'photo_with_face',
      'gps_pin',
      'document_upload',
      'video_walkthrough',
      'rep_interview',
      'signed_statement',
      'text_input'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compliance_capture_validation') THEN
    CREATE TYPE public.compliance_capture_validation AS ENUM (
      'pending',
      'valid',
      'flagged',
      'rejected'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compliance_doc_verification') THEN
    CREATE TYPE public.compliance_doc_verification AS ENUM (
      'pending',
      'verified',
      'flagged',
      'rejected'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cci_credential_tier') THEN
    CREATE TYPE public.cci_credential_tier AS ENUM (
      'cci_basic',
      'cci_advanced',
      'cci_lead'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cci_credential_status') THEN
    CREATE TYPE public.cci_credential_status AS ENUM (
      'pending',
      'approved',
      'suspended',
      'rejected',
      'expired'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'affidavit_status') THEN
    CREATE TYPE public.affidavit_status AS ENUM (
      'draft',
      'issued',
      'countersigned',
      'revoked'
    );
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- PHASE B: Helper functions (subset — is_active_cci moved to after Phase G
--          because it references inspector_credentials, which is created
--          later. Postgres parses function bodies at CREATE FUNCTION time
--          and forward-references error out.)
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_admin(p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = p_uid
       AND role IN ('admin', 'super_admin')
  );
$$;

-- URL-safe token generator. We *would* use pgcrypto's gen_random_bytes()
-- but on Supabase that function lives in the `extensions` schema and is
-- not resolvable from `public` without explicit qualification — and
-- because this function ends up in a DEFAULT expression on two tables
-- (verification_affidavits.public_verify_token + trust_certificates.
-- public_slug), we can't rely on a runtime search_path containing
-- `extensions`. Solution: derive entropy from gen_random_uuid() instead,
-- which is always resolvable in Supabase. A single UUID gives 122 bits
-- of entropy; we take 22 hex chars (~88 bits, more than enough to be
-- unguessable for a verify token).
CREATE OR REPLACE FUNCTION public.gen_verify_token()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 22);
$$;

-- ───────────────────────────────────────────────────────────────────────
-- PHASE C: Scope templates + Evidence requirements
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspection_scope_templates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                      text NOT NULL UNIQUE,
  name                      text NOT NULL,
  version                   integer NOT NULL DEFAULT 1,
  category                  text NOT NULL,
  region                    text NOT NULL DEFAULT 'global',
  validity_months           integer NOT NULL DEFAULT 12,
  base_price_cents          bigint NOT NULL DEFAULT 0,
  requires_credential_tier  public.cci_credential_tier NOT NULL DEFAULT 'cci_basic',
  description_md            text,
  is_active                 boolean NOT NULL DEFAULT true,
  created_by_admin_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT NOW(),
  updated_at                timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT scope_template_slug_format CHECK (slug ~ '^[a-z0-9_]+$'),
  CONSTRAINT scope_template_validity_positive CHECK (validity_months > 0)
);

CREATE INDEX IF NOT EXISTS idx_scope_templates_active
  ON public.inspection_scope_templates (is_active, category)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.inspection_evidence_requirements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       uuid NOT NULL REFERENCES public.inspection_scope_templates(id) ON DELETE CASCADE,
  sort_order        integer NOT NULL DEFAULT 0,
  kind              public.compliance_evidence_kind NOT NULL,
  label             text NOT NULL,
  hint              text,
  required          boolean NOT NULL DEFAULT true,
  min_count         integer NOT NULL DEFAULT 1,
  max_count         integer NOT NULL DEFAULT 1,
  constraints_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT req_count_sane CHECK (min_count >= 0 AND max_count >= min_count)
);

CREATE INDEX IF NOT EXISTS idx_evidence_requirements_template
  ON public.inspection_evidence_requirements (template_id, sort_order);

-- ───────────────────────────────────────────────────────────────────────
-- PHASE D: Jobs additive columns
-- ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS inspection_type public.inspection_type_kind NOT NULL DEFAULT 'quality',
  ADD COLUMN IF NOT EXISTS scope_template_id uuid REFERENCES public.inspection_scope_templates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS claimed_address_text text,
  ADD COLUMN IF NOT EXISTS claimed_address_geocoded geography(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_jobs_inspection_type_compliance
  ON public.jobs (inspection_type, created_at DESC)
  WHERE inspection_type = 'compliance';

CREATE INDEX IF NOT EXISTS idx_jobs_scope_template
  ON public.jobs (scope_template_id)
  WHERE scope_template_id IS NOT NULL;

-- A compliance job MUST have a scope template; a quality job MUST NOT.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_compliance_requires_template;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_compliance_requires_template CHECK (
  (inspection_type = 'compliance' AND scope_template_id IS NOT NULL)
  OR (inspection_type = 'quality' AND scope_template_id IS NULL)
);

-- ───────────────────────────────────────────────────────────────────────
-- PHASE E: Inspection captures (trust-primitives table)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspection_captures (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                      uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  requirement_id              uuid NOT NULL REFERENCES public.inspection_evidence_requirements(id) ON DELETE RESTRICT,
  inspector_id                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  kind                        public.compliance_evidence_kind NOT NULL,
  sort_index                  integer NOT NULL DEFAULT 0,

  -- File / media
  storage_path                text,
  mime_type                   text,
  file_size_bytes             bigint,

  -- EXIF (for photo + video kinds)
  exif_json                   jsonb,

  -- GPS (for any kind that carries a location)
  gps_lat                     numeric(10, 7),
  gps_lng                     numeric(10, 7),
  gps_accuracy_m              numeric(8, 2),
  gps_pin                     geography(Point, 4326),

  -- Timestamps
  captured_at                 timestamptz,

  -- Device attestation (Apple App Attest / Google Play Integrity)
  device_attestation_token    text,
  device_platform             text,

  -- Tamper-evident chain
  capture_sha256              text,
  prev_capture_sha256         text,

  -- Face presence (for selfie+rep / photo_with_face)
  face_detected_count         integer,
  face_liveness_score         numeric(5, 4),

  -- Text payloads (for text_input + signed_statement bodies)
  text_payload                text,
  signature_payload           jsonb,

  -- Server-side validation
  server_validation_status    public.compliance_capture_validation NOT NULL DEFAULT 'pending',
  server_flags_json           jsonb NOT NULL DEFAULT '[]'::jsonb,
  server_validated_at         timestamptz,

  -- Bookkeeping
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT capture_gps_lat_range  CHECK (gps_lat  IS NULL OR (gps_lat  BETWEEN -90 AND 90)),
  CONSTRAINT capture_gps_lng_range  CHECK (gps_lng  IS NULL OR (gps_lng  BETWEEN -180 AND 180))
);

CREATE INDEX IF NOT EXISTS idx_captures_job_requirement
  ON public.inspection_captures (job_id, requirement_id, sort_index);

CREATE INDEX IF NOT EXISTS idx_captures_inspector_recent
  ON public.inspection_captures (inspector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_captures_flagged
  ON public.inspection_captures (server_validation_status, created_at DESC)
  WHERE server_validation_status IN ('flagged', 'rejected');

-- Trigger: auto-populate gps_pin from gps_lat/gps_lng when both are set.
CREATE OR REPLACE FUNCTION public.tg_capture_set_gps_pin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.gps_lat IS NOT NULL AND NEW.gps_lng IS NOT NULL THEN
    NEW.gps_pin := ST_SetSRID(ST_MakePoint(NEW.gps_lng, NEW.gps_lat), 4326)::geography;
  ELSE
    NEW.gps_pin := NULL;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_captures_set_gps_pin ON public.inspection_captures;
CREATE TRIGGER trg_captures_set_gps_pin
  BEFORE INSERT OR UPDATE OF gps_lat, gps_lng ON public.inspection_captures
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_capture_set_gps_pin();

-- ───────────────────────────────────────────────────────────────────────
-- PHASE F: Compliance documents
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compliance_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  doc_type              text NOT NULL,
  storage_path          text NOT NULL,
  uploaded_by           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploader_role         text NOT NULL,    -- 'client' | 'agency' | 'inspector' | 'admin'

  -- OCR + extracted fields
  ocr_text              text,
  ocr_fields_json       jsonb,
  issuing_authority     text,
  document_number       text,
  issued_at             date,
  expires_at            date,

  -- Verification
  verification_status   public.compliance_doc_verification NOT NULL DEFAULT 'pending',
  verification_notes    text,
  verified_by_admin_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at           timestamptz,

  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_job
  ON public.compliance_documents (job_id, doc_type);

CREATE INDEX IF NOT EXISTS idx_docs_expiring_soon
  ON public.compliance_documents (expires_at)
  WHERE expires_at IS NOT NULL AND verification_status = 'verified';

-- ───────────────────────────────────────────────────────────────────────
-- PHASE G: Inspector credentials (CCI)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspector_credentials (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id                        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier                                public.cci_credential_tier NOT NULL,
  status                              public.cci_credential_status NOT NULL DEFAULT 'pending',

  -- Government-issued ID
  gov_id_storage_path                 text,
  gov_id_issuing_country              text,
  gov_id_verified                     boolean NOT NULL DEFAULT false,

  -- Experience evidence
  experience_years_documented         numeric(4, 1),
  experience_evidence_paths           text[],

  -- Strict-liability agreement (immutable once signed)
  strict_liability_agreement_version  text,
  strict_liability_signed_at          timestamptz,
  strict_liability_signature_sha256   text,
  strict_liability_signature_payload  jsonb,

  -- Admin decision
  applied_at                          timestamptz NOT NULL DEFAULT NOW(),
  decided_at                          timestamptz,
  decided_by_admin_id                 uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision_notes                      text,
  expires_at                          timestamptz,

  created_at                          timestamptz NOT NULL DEFAULT NOW(),
  updated_at                          timestamptz NOT NULL DEFAULT NOW(),

  -- One ACTIVE (pending|approved|suspended) row per inspector+tier.
  -- Rejected/expired rows accumulate for audit.
  CONSTRAINT credential_decision_consistency CHECK (
    (status IN ('pending') AND decided_at IS NULL)
    OR (status IN ('approved','suspended','rejected','expired') AND decided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inspector_active_credential_per_tier
  ON public.inspector_credentials (inspector_id, tier)
  WHERE status IN ('pending', 'approved', 'suspended');

CREATE INDEX IF NOT EXISTS idx_credentials_status
  ON public.inspector_credentials (status, applied_at DESC);

-- ─── is_active_cci helper (defined here, AFTER inspector_credentials exists)
--    Returns true iff the given uid holds an active CCI credential at or
--    above the requested minimum tier (basic < advanced < lead).
CREATE OR REPLACE FUNCTION public.is_active_cci(
  p_uid       uuid,
  p_min_tier  public.cci_credential_tier DEFAULT 'cci_basic'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.inspector_credentials ic
     WHERE ic.inspector_id = p_uid
       AND ic.status = 'approved'
       AND (ic.expires_at IS NULL OR ic.expires_at > NOW())
       AND CASE ic.tier
             WHEN 'cci_basic'    THEN 1
             WHEN 'cci_advanced' THEN 2
             WHEN 'cci_lead'     THEN 3
           END
           >=
           CASE p_min_tier
             WHEN 'cci_basic'    THEN 1
             WHEN 'cci_advanced' THEN 2
             WHEN 'cci_lead'     THEN 3
           END
  );
$$;

-- ───────────────────────────────────────────────────────────────────────
-- PHASE H: Verification affidavits
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.verification_affidavits (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                          uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
  inspection_report_id            uuid,    -- intentionally not a hard FK — table is live-DB-only
  status                          public.affidavit_status NOT NULL DEFAULT 'draft',

  -- Rendered output
  pdf_storage_path                text,
  pdf_sha256                      text,

  -- Machine-readable payload (the full structured affidavit)
  json_payload                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  json_payload_sha256             text,

  -- Public-verify URL
  public_verify_token             text NOT NULL UNIQUE DEFAULT public.gen_verify_token(),

  -- Validity window
  valid_from                      timestamptz,
  valid_until                     timestamptz,

  -- Signatures
  signed_by_inspector_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  signed_by_inspector_credential  uuid REFERENCES public.inspector_credentials(id) ON DELETE SET NULL,
  signed_at                       timestamptz,

  countersigned_by_admin_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  countersigned_at                timestamptz,

  -- Revocation
  revoked_at                      timestamptz,
  revoked_by_admin_id             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_reason                  text,

  issued_at                       timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT NOW(),
  updated_at                      timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT affidavit_validity_range CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  )
);

CREATE INDEX IF NOT EXISTS idx_affidavits_verify_token
  ON public.verification_affidavits (public_verify_token);

CREATE INDEX IF NOT EXISTS idx_affidavits_status_issued
  ON public.verification_affidavits (status, issued_at DESC);

-- ───────────────────────────────────────────────────────────────────────
-- PHASE I: Trust certificates (the public-facing portable assertion)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trust_certificates (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_profile_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  scope_template_id             uuid NOT NULL REFERENCES public.inspection_scope_templates(id) ON DELETE RESTRICT,
  affidavit_id                  uuid NOT NULL REFERENCES public.verification_affidavits(id) ON DELETE RESTRICT,
  public_slug                   text NOT NULL UNIQUE DEFAULT public.gen_verify_token(),
  is_public_directory_listed    boolean NOT NULL DEFAULT false,
  valid_from                    timestamptz NOT NULL,
  valid_until                   timestamptz NOT NULL,
  revoked_at                    timestamptz,
  revoked_reason                text,
  created_at                    timestamptz NOT NULL DEFAULT NOW(),
  updated_at                    timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT cert_validity_range CHECK (valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_trust_certs_supplier
  ON public.trust_certificates (supplier_profile_id, valid_until DESC);

CREATE INDEX IF NOT EXISTS idx_trust_certs_directory
  ON public.trust_certificates (is_public_directory_listed, valid_until DESC)
  WHERE is_public_directory_listed = true AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trust_certs_active
  ON public.trust_certificates (valid_until)
  WHERE revoked_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────
-- PHASE J: RLS — enable on every new table
-- ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.inspection_scope_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_evidence_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_captures              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspector_credentials            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_affidavits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_certificates               ENABLE ROW LEVEL SECURITY;

-- ─── scope templates
-- Read: anyone authenticated can see active templates; admins see all.
-- Write: admins only.
DROP POLICY IF EXISTS "templates_read_active" ON public.inspection_scope_templates;
CREATE POLICY "templates_read_active"
  ON public.inspection_scope_templates FOR SELECT
  USING (is_active = true OR public.nx_is_admin());

DROP POLICY IF EXISTS "templates_admin_write" ON public.inspection_scope_templates;
CREATE POLICY "templates_admin_write"
  ON public.inspection_scope_templates FOR ALL
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- ─── evidence requirements
DROP POLICY IF EXISTS "requirements_read_via_template" ON public.inspection_evidence_requirements;
CREATE POLICY "requirements_read_via_template"
  ON public.inspection_evidence_requirements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.inspection_scope_templates t
       WHERE t.id = inspection_evidence_requirements.template_id
         AND (t.is_active = true OR public.nx_is_admin())
    )
  );

DROP POLICY IF EXISTS "requirements_admin_write" ON public.inspection_evidence_requirements;
CREATE POLICY "requirements_admin_write"
  ON public.inspection_evidence_requirements FOR ALL
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- ─── inspection captures
DROP POLICY IF EXISTS "captures_read_parties" ON public.inspection_captures;
CREATE POLICY "captures_read_parties"
  ON public.inspection_captures FOR SELECT
  USING (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = inspection_captures.job_id
         AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
    )
  );

DROP POLICY IF EXISTS "captures_insert_inspector_self" ON public.inspection_captures;
CREATE POLICY "captures_insert_inspector_self"
  ON public.inspection_captures FOR INSERT
  WITH CHECK (
    inspector_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_id
         AND j.contractor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "captures_update_inspector_self" ON public.inspection_captures;
CREATE POLICY "captures_update_inspector_self"
  ON public.inspection_captures FOR UPDATE
  USING (inspector_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (inspector_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "captures_delete_admin_only" ON public.inspection_captures;
CREATE POLICY "captures_delete_admin_only"
  ON public.inspection_captures FOR DELETE
  USING (public.nx_is_admin());

-- ─── compliance documents
DROP POLICY IF EXISTS "docs_read_parties" ON public.compliance_documents;
CREATE POLICY "docs_read_parties"
  ON public.compliance_documents FOR SELECT
  USING (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = compliance_documents.job_id
         AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
    )
  );

DROP POLICY IF EXISTS "docs_insert_parties" ON public.compliance_documents;
CREATE POLICY "docs_insert_parties"
  ON public.compliance_documents FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_id
         AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
    )
  );

DROP POLICY IF EXISTS "docs_update_admin_or_uploader" ON public.compliance_documents;
CREATE POLICY "docs_update_admin_or_uploader"
  ON public.compliance_documents FOR UPDATE
  USING (
    public.nx_is_admin()
    OR (uploaded_by = auth.uid() AND verification_status = 'pending')
  )
  WITH CHECK (
    public.nx_is_admin()
    OR (uploaded_by = auth.uid() AND verification_status = 'pending')
  );

DROP POLICY IF EXISTS "docs_delete_admin_only" ON public.compliance_documents;
CREATE POLICY "docs_delete_admin_only"
  ON public.compliance_documents FOR DELETE
  USING (public.nx_is_admin());

-- ─── inspector credentials
DROP POLICY IF EXISTS "credentials_read_self_or_admin" ON public.inspector_credentials;
CREATE POLICY "credentials_read_self_or_admin"
  ON public.inspector_credentials FOR SELECT
  USING (inspector_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "credentials_insert_self_pending" ON public.inspector_credentials;
CREATE POLICY "credentials_insert_self_pending"
  ON public.inspector_credentials FOR INSERT
  WITH CHECK (inspector_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS "credentials_update_self_pending_or_admin" ON public.inspector_credentials;
CREATE POLICY "credentials_update_self_pending_or_admin"
  ON public.inspector_credentials FOR UPDATE
  USING (
    public.nx_is_admin()
    OR (inspector_id = auth.uid() AND status = 'pending')
  )
  WITH CHECK (
    public.nx_is_admin()
    OR (inspector_id = auth.uid() AND status = 'pending')
  );

-- ─── verification affidavits
DROP POLICY IF EXISTS "affidavits_read_parties" ON public.verification_affidavits;
CREATE POLICY "affidavits_read_parties"
  ON public.verification_affidavits FOR SELECT
  USING (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = verification_affidavits.job_id
         AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
    )
  );

DROP POLICY IF EXISTS "affidavits_admin_write" ON public.verification_affidavits;
CREATE POLICY "affidavits_admin_write"
  ON public.verification_affidavits FOR ALL
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- ─── trust certificates
DROP POLICY IF EXISTS "certs_read_owner_or_admin" ON public.trust_certificates;
CREATE POLICY "certs_read_owner_or_admin"
  ON public.trust_certificates FOR SELECT
  USING (supplier_profile_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS "certs_admin_write" ON public.trust_certificates;
CREATE POLICY "certs_admin_write"
  ON public.trust_certificates FOR ALL
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- ───────────────────────────────────────────────────────────────────────
-- PHASE K: Public verify-URL functions (anon-safe)
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_affidavit_by_verify_token(p_token text)
RETURNS TABLE (
  status          public.affidavit_status,
  valid_from      timestamptz,
  valid_until     timestamptz,
  issued_at       timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,
  scope_name      text,
  scope_slug      text,
  pdf_sha256      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    a.status,
    a.valid_from,
    a.valid_until,
    a.issued_at,
    a.revoked_at,
    a.revoked_reason,
    t.name AS scope_name,
    t.slug AS scope_slug,
    a.pdf_sha256
  FROM public.verification_affidavits a
  JOIN public.jobs j                          ON j.id = a.job_id
  JOIN public.inspection_scope_templates t    ON t.id = j.scope_template_id
  WHERE a.public_verify_token = p_token
    AND a.status IN ('issued', 'countersigned')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_affidavit_by_verify_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fetch_cert_by_slug(p_slug text)
RETURNS TABLE (
  scope_name                  text,
  scope_slug                  text,
  supplier_display_name       text,
  valid_from                  timestamptz,
  valid_until                 timestamptz,
  revoked_at                  timestamptz,
  is_public_directory_listed  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.name                                                       AS scope_name,
    t.slug                                                       AS scope_slug,
    COALESCE(p.full_name, p.first_name || ' ' || p.last_name)    AS supplier_display_name,
    c.valid_from,
    c.valid_until,
    c.revoked_at,
    c.is_public_directory_listed
  FROM public.trust_certificates c
  JOIN public.inspection_scope_templates t ON t.id = c.scope_template_id
  JOIN public.profiles p                   ON p.id = c.supplier_profile_id
  WHERE c.public_slug = p_slug
    AND c.revoked_at IS NULL
    AND c.valid_until > NOW()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_cert_by_slug(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────
-- PHASE L: Seed scope templates + their evidence requirements
-- ───────────────────────────────────────────────────────────────────────
WITH sev AS (
  INSERT INTO public.inspection_scope_templates (
    slug, name, version, category, region, validity_months,
    base_price_cents, requires_credential_tier, description_md, is_active
  ) VALUES (
    'supplier_existence_verification',
    'Supplier Existence Verification',
    1,
    'supplier_verification',
    'global',
    12,
    49900,
    'cci_basic',
    'Verifies that the supplier physically exists at the claimed address, has visible commercial signage, has an operational reception/office area, and has at least one identifiable representative on-site.',
    true
  )
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
),
tlv AS (
  INSERT INTO public.inspection_scope_templates (
    slug, name, version, category, region, validity_months,
    base_price_cents, requires_credential_tier, description_md, is_active
  ) VALUES (
    'trade_license_verification',
    'Trade License Verification',
    1,
    'license_verification',
    'global',
    12,
    39900,
    'cci_basic',
    'Captures a physical-original photo of the supplier''s trade license, records the extracted license number, and GPS-pins the address of issuance.',
    true
  )
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
),
fpp AS (
  INSERT INTO public.inspection_scope_templates (
    slug, name, version, category, region, validity_months,
    base_price_cents, requires_credential_tier, description_md, is_active
  ) VALUES (
    'facility_photo_pack',
    'Facility Photo Pack',
    1,
    'facility_audit',
    'global',
    6,
    29900,
    'cci_basic',
    'A structured photographic record of the production and storage areas of the facility, with a GPS pin anchoring the location.',
    true
  )
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
)
INSERT INTO public.inspection_evidence_requirements
  (template_id, sort_order, kind, label, hint, required, min_count, max_count, constraints_json)
SELECT id, 1, 'gps_pin'::public.compliance_evidence_kind,        'GPS pin at the front entrance',                          'Stand at the main entrance and capture the GPS fix.',                       true, 1, 1, '{"max_accuracy_m": 30}'::jsonb FROM sev UNION ALL
SELECT id, 2, 'photo'::public.compliance_evidence_kind,          'Photo of building exterior with company signage',         'Frame the building so the visible signage is unambiguous and readable.',    true, 1, 3, '{"require_exif_gps": true}'::jsonb FROM sev UNION ALL
SELECT id, 3, 'photo'::public.compliance_evidence_kind,          'Photo of reception / office interior',                    'A wide shot of the reception or main office area.',                         true, 1, 3, '{"require_exif_gps": true}'::jsonb FROM sev UNION ALL
SELECT id, 4, 'photo_with_face'::public.compliance_evidence_kind,'Selfie with the company representative',                  'Both inspector and representative clearly visible in the same frame.',      true, 1, 1, '{"require_face_count_min": 2, "min_liveness_score": 0.7}'::jsonb FROM sev UNION ALL
SELECT id, 1, 'photo'::public.compliance_evidence_kind,          'Photo of the original physical trade license',            'Capture the original document on a flat surface; corners visible.',         true, 1, 2, '{"require_exif_gps": true}'::jsonb FROM tlv UNION ALL
SELECT id, 2, 'text_input'::public.compliance_evidence_kind,     'License number (as printed on the document)',             'Type the license number exactly as it appears.',                            true, 1, 1, '{"max_length": 64}'::jsonb FROM tlv UNION ALL
SELECT id, 3, 'gps_pin'::public.compliance_evidence_kind,        'GPS pin at the registered address',                       'Capture the GPS at the supplier''s registered address.',                    true, 1, 1, '{"max_accuracy_m": 30}'::jsonb FROM tlv UNION ALL
SELECT id, 1, 'photo'::public.compliance_evidence_kind,          'Wide shot of the warehouse / manufacturing floor',        'Capture the full breadth of the working area.',                             true, 1, 5, '{"require_exif_gps": true}'::jsonb FROM fpp UNION ALL
SELECT id, 2, 'photo'::public.compliance_evidence_kind,          'Photo of key production equipment',                       'One representative photo per major piece of equipment.',                    true, 1, 6, '{"require_exif_gps": true}'::jsonb FROM fpp UNION ALL
SELECT id, 3, 'photo'::public.compliance_evidence_kind,          'Photo of inventory / storage area',                       'A wide shot of the storage / inventory area.',                              true, 1, 4, '{"require_exif_gps": true}'::jsonb FROM fpp UNION ALL
SELECT id, 4, 'gps_pin'::public.compliance_evidence_kind,        'GPS pin of the facility',                                 'Capture the GPS at the center of the facility.',                            true, 1, 1, '{"max_accuracy_m": 50}'::jsonb FROM fpp;

-- ───────────────────────────────────────────────────────────────────────
-- PHASE M: updated_at triggers across new tables
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'inspection_scope_templates',
      'compliance_documents',
      'inspector_credentials',
      'verification_affidavits',
      'trust_certificates'
    ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at()',
      t
    );
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
-- 1. Confirm the 7 new tables exist and have RLS enabled.
-- 2. Confirm jobs picked up the new columns.
-- 3. Confirm seed templates landed:
--    SELECT t.slug, COUNT(r.id) AS reqs
--      FROM public.inspection_scope_templates t
--      LEFT JOIN public.inspection_evidence_requirements r ON r.template_id = t.id
--      WHERE t.slug IN ('supplier_existence_verification','trade_license_verification','facility_photo_pack')
--      GROUP BY t.slug ORDER BY t.slug;
--    expect: facility_photo_pack=4, supplier_existence_verification=4, trade_license_verification=3
-- ============================================================================
