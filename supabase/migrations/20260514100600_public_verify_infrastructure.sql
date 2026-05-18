-- ============================================================================
-- PUBLIC VERIFY INFRASTRUCTURE — signing_keys + enhanced fetch RPCs
-- ============================================================================
BEGIN;

-- Defensive: ensure the HTML columns exist on verification_affidavits
-- before the RPCs below reference them. No-op if the STEP 6
-- compliance_affidavits_html migration already added them.
ALTER TABLE public.verification_affidavits
  ADD COLUMN IF NOT EXISTS html_storage_path text,
  ADD COLUMN IF NOT EXISTS html_sha256        text;

CREATE TABLE IF NOT EXISTS public.signing_keys (
  id                  text PRIMARY KEY,
  algorithm           text NOT NULL DEFAULT 'Ed25519',
  public_pem          text NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  rotated_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  created_by_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.signing_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signing_keys_anon_read_active" ON public.signing_keys;
CREATE POLICY "signing_keys_anon_read_active"
  ON public.signing_keys FOR SELECT
  TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "signing_keys_admin_write" ON public.signing_keys;
CREATE POLICY "signing_keys_admin_write"
  ON public.signing_keys FOR ALL
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

DROP FUNCTION IF EXISTS public.fetch_affidavit_by_verify_token(text);
CREATE OR REPLACE FUNCTION public.fetch_affidavit_by_verify_token(p_token text)
RETURNS TABLE (
  affidavit_id          uuid,
  status                public.affidavit_status,
  valid_from            timestamptz,
  valid_until           timestamptz,
  issued_at             timestamptz,
  revoked_at            timestamptz,
  revoked_reason        text,
  scope_name            text,
  scope_slug            text,
  scope_category        text,
  scope_region          text,
  scope_version         integer,
  subject_name          text,
  inspector_tier        public.cci_credential_tier,
  buyer_type            text,
  total_captures        integer,
  total_documents       integer,
  chain_intact          boolean,
  html_storage_path     text,
  html_sha256           text,
  pdf_sha256            text,
  json_payload_sha256   text,
  platform_signature       text,
  platform_signing_key_id  text,
  vca_version              text
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

DROP FUNCTION IF EXISTS public.fetch_cert_by_slug(text);
CREATE OR REPLACE FUNCTION public.fetch_cert_by_slug(p_slug text)
RETURNS TABLE (
  cert_id                     uuid,
  scope_name                  text,
  scope_slug                  text,
  scope_category              text,
  scope_region                text,
  supplier_display_name       text,
  valid_from                  timestamptz,
  valid_until                 timestamptz,
  revoked_at                  timestamptz,
  is_public_directory_listed  boolean,
  affidavit_verify_token      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.id,
    t.name, t.slug, t.category, t.region,
    COALESCE(p.full_name, p.first_name || ' ' || p.last_name),
    c.valid_from, c.valid_until, c.revoked_at, c.is_public_directory_listed,
    a.public_verify_token
  FROM public.trust_certificates c
  JOIN public.inspection_scope_templates t ON t.id = c.scope_template_id
  JOIN public.profiles p                   ON p.id = c.supplier_profile_id
  JOIN public.verification_affidavits a    ON a.id = c.affidavit_id
  WHERE c.public_slug = p_slug
    AND c.revoked_at IS NULL
    AND c.valid_until > NOW()
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.fetch_cert_by_slug(text) TO anon, authenticated;

COMMIT;
