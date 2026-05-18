-- ============================================================================
--  20260515160000_affidavit_pdf_storage.sql
--
--  PDF Rendering Pipeline — Tier 1 (canonical PDF)
--
--  Adds:
--    1. pdf_storage_path column on verification_affidavits — bucket-relative
--       path of the canonical PDF (e.g. affidavits/<job>/<aff>.pdf).
--    2. Extends fetch_affidavit_by_verify_token() so the anon-callable
--       public verify page can know whether a PDF exists and where to
--       request a signed URL for it.
--
--  Trust model:
--    The PDF is rendered server-side from the same HTML that goes through
--    Ed25519-signing. The PDF's SHA-256 is recorded on
--    verification_affidavits.pdf_sha256 (column already exists from earlier
--    migrations). Anyone can re-download the PDF, recompute SHA-256, and
--    compare to the value returned by fetch_affidavit_by_verify_token —
--    if they differ, the PDF was tampered with.
--
--  IDEMPOTENT — safe to re-run. Wrapped in BEGIN..COMMIT.
-- ============================================================================

BEGIN;

-- 1) PDF storage path on the affidavit row ──────────────────────────────────
ALTER TABLE public.verification_affidavits
  ADD COLUMN IF NOT EXISTS pdf_storage_path text;

COMMENT ON COLUMN public.verification_affidavits.pdf_storage_path IS
  'Bucket-relative path of the canonical PDF inside the `compliance` storage '
  'bucket. Rendered server-side from the same HTML that anchors the signed '
  'canonical JSON; SHA-256 of the bytes is on pdf_sha256.';

-- 2) Extend the public verify RPC to include pdf_storage_path ───────────────
DROP FUNCTION IF EXISTS public.fetch_affidavit_by_verify_token(text);
CREATE OR REPLACE FUNCTION public.fetch_affidavit_by_verify_token(p_token text)
RETURNS TABLE (
  affidavit_id              uuid,
  status                    public.affidavit_status,
  valid_from                timestamptz,
  valid_until               timestamptz,
  issued_at                 timestamptz,
  revoked_at                timestamptz,
  revoked_reason            text,
  scope_name                text,
  scope_slug                text,
  scope_category            text,
  scope_region              text,
  scope_version             integer,
  subject_name              text,
  inspector_tier            public.cci_credential_tier,
  buyer_type                text,
  total_captures            integer,
  total_documents           integer,
  external_evidence_count   integer,
  chain_intact              boolean,
  html_storage_path         text,
  html_sha256               text,
  pdf_storage_path          text,
  pdf_sha256                text,
  json_payload_sha256       text,
  platform_signature        text,
  platform_signing_key_id   text,
  vca_version               text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id, a.status, a.valid_from, a.valid_until, a.issued_at,
    a.revoked_at, a.revoked_reason,
    t.name, t.slug, t.category, t.region, t.version,
    j.title,
    (SELECT ic.tier FROM public.inspector_credentials ic WHERE ic.id = a.signed_by_inspector_credential),
    CASE WHEN j.client_id IS NOT NULL THEN 'client' ELSE 'agency' END,
    (SELECT COUNT(*)::int FROM public.inspection_captures   WHERE job_id = j.id),
    (SELECT COUNT(*)::int FROM public.compliance_documents WHERE job_id = j.id),
    (SELECT COUNT(*)::int FROM public.compliance_documents
       WHERE job_id = j.id AND document_url IS NOT NULL),
    COALESCE((a.json_payload->'chain_of_custody'->>'chain_intact')::boolean, false),
    a.html_storage_path, a.html_sha256,
    a.pdf_storage_path,  a.pdf_sha256,
    a.json_payload_sha256,
    a.json_payload->'tamper_evidence'->>'platform_signature',
    a.json_payload->'tamper_evidence'->>'platform_signing_key_id',
    a.json_payload->>'vca_version'
  FROM public.verification_affidavits a
  JOIN public.jobs j                          ON j.id = a.job_id
  JOIN public.inspection_scope_templates t    ON t.id = j.scope_template_id
  WHERE a.public_verify_token = p_token
    AND a.status IN ('issued', 'countersigned')
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_affidavit_by_verify_token(text) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
-- 1. Confirm the column exists:
--    SELECT column_name FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'verification_affidavits'
--       AND column_name IN ('pdf_storage_path', 'pdf_sha256');
--
-- 2. Confirm the RPC return type includes both pdf fields:
--    \df+ public.fetch_affidavit_by_verify_token
-- ============================================================================
