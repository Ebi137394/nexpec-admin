-- ============================================================================
--  20260515140000_verify_external_evidence_count.sql
--
--  Extends the public-anon verify RPC to surface the count of
--  External-Link evidence items, so the verify page can display a
--  breakdown like "Documents verified: 3  (1 external)".
--
--  Only adds a new return column. Existing callers continue to work.
--
--  SELF-HEALING:
--    Runs an ADD COLUMN IF NOT EXISTS on compliance_documents.document_url
--    up front, so this migration can be applied standalone even if you
--    accidentally skipped 20260515120000_compliance_external_link_support.
--    (Idempotent — safe to re-run.)
-- ============================================================================

BEGIN;

-- Belt-and-braces: ensure the column exists before the RPC body references it.
ALTER TABLE public.compliance_documents
  ADD COLUMN IF NOT EXISTS document_url text;

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
    a.html_storage_path, a.html_sha256, a.pdf_sha256, a.json_payload_sha256,
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
