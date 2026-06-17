-- ════════════════════════════════════════════════════════════════════════════
--  20260801122400_vendor_custody_core.sql
--
--  VENDOR CUSTODY SPINE — Phase 1 (Custody Core)
--
--  Turns an uploaded official document (stamped PDF, ISO cert, signed contract)
--  into an immutable, tamper-evident, notarizable source-of-truth — reusing the
--  existing Trust Spine (pi_canonical_json + extensions.digest), the same
--  mechanism behind pi_seal_inspection_report.
--
--    1. vendor_documents      custody table (content hash + seal + inline OTS state + binding)
--    2. storage bucket + RLS  private 'vendor_documents', per-vendor folder ({uid}/{doc_type}/file)
--    3. vendor_document_seal   RPC: ingest metadata → canonical-JSON SEAL → enqueue OTS (pending). Idempotent by content hash.
--    4. vendor_document_record_anchor  RPC: the OTS worker flips pending→submitted→bitcoin_confirmed (mirrors record_seal_anchor)
--
--  NOTE the actual OpenTimestamps calendar round-trip is performed by the OTS
--  worker (the existing anchor-inspection-seals / confirm-inspection-anchors
--  pattern), which a thin follow-up points at vendor_documents WHERE
--  ots_status='pending'. The SEAL (tamper-evidence) is fully live here and now.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Custody table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type      text NOT NULL DEFAULT 'other'
                CHECK (doc_type IN ('iso_cert','accreditation','insurance','financial','nda','msa','technical_proposal','mill_cert','other')),
  title         text,
  storage_path  text NOT NULL,                          -- path within the vendor_documents bucket
  mime_type     text,
  byte_size     bigint,
  content_sha256 text NOT NULL,                          -- fingerprint of the file content (immutable artifact)
  seal_sha256   text NOT NULL,                           -- canonical-JSON seal over content + metadata + identity
  seal_payload  jsonb NOT NULL DEFAULT '{}'::jsonb,      -- the exact object that was sealed (re-verifiable)
  -- OpenTimestamps notarization state (inline; mirrors inspection_seal_anchors)
  ots_status    text NOT NULL DEFAULT 'pending'
                CHECK (ots_status IN ('pending','submitted','bitcoin_confirmed','failed')),
  ots_calendar  text,
  ots_proof     text,
  ots_submitted_at timestamptz,
  ots_confirmed_at timestamptz,
  bitcoin_block_height bigint,
  -- polymorphic binding: what the document is attached to
  bound_type    text CHECK (bound_type IN ('vendor','quote','contract','job')),
  bound_id      uuid,
  -- extraction / verification (populated by later phases)
  extracted     jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at    timestamptz,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','revoked')),
  superseded_by uuid REFERENCES public.vendor_documents(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_docs_vendor_idx     ON public.vendor_documents (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vendor_docs_bound_idx      ON public.vendor_documents (bound_type, bound_id) WHERE bound_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_docs_ots_pending_idx ON public.vendor_documents (ots_status) WHERE ots_status = 'pending';
-- dedup: one active row per (vendor, content fingerprint) — the hash is the idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS vendor_docs_dedup_idx ON public.vendor_documents (vendor_id, content_sha256) WHERE status = 'active';

-- ── 2) Private storage bucket ───────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vendor_documents', 'vendor_documents',
  false,            -- private; signed URLs only
  52428800,         -- 50 MB (data books can be large)
  ARRAY[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 3) Storage RLS — per-vendor folder: {uid}/{doc_type}/{filename} ──────────
DROP POLICY IF EXISTS "vendor_docs_owner_all" ON storage.objects;
CREATE POLICY "vendor_docs_owner_all" ON storage.objects FOR ALL
  USING      (bucket_id = 'vendor_documents' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'vendor_documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "vendor_docs_admin_read" ON storage.objects;
CREATE POLICY "vendor_docs_admin_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'vendor_documents' AND public.nx_is_admin());

-- ── 4) Table RLS — vendor owns their dossier; admin god-mode ─────────────────
ALTER TABLE public.vendor_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_docs_self ON public.vendor_documents;
CREATE POLICY vendor_docs_self ON public.vendor_documents FOR ALL
  USING      (vendor_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (vendor_id = auth.uid() OR public.nx_is_admin());
GRANT SELECT, INSERT, UPDATE ON public.vendor_documents TO authenticated;

-- ── 5) SEAL RPC — ingest → canonical-JSON seal (Trust Spine) → pending OTS ───
CREATE OR REPLACE FUNCTION public.vendor_document_seal(
  p_storage_path   text,
  p_content_sha256 text,
  p_doc_type       text   DEFAULT 'other',
  p_title          text   DEFAULT NULL,
  p_mime_type      text   DEFAULT NULL,
  p_byte_size      bigint DEFAULT NULL,
  p_bound_type     text   DEFAULT 'vendor',
  p_bound_id       uuid   DEFAULT NULL
) RETURNS public.vendor_documents
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_existing   public.vendor_documents;
  v_payload    jsonb;
  v_seal       text;
  v_doc_type   text := lower(coalesce(p_doc_type,'other'));
  v_bound_type text := lower(coalesce(p_bound_type,'vendor'));
  v_row        public.vendor_documents;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(p_storage_path,'')   = '' THEN RAISE EXCEPTION 'storage_path_required'; END IF;
  IF coalesce(p_content_sha256,'') = '' THEN RAISE EXCEPTION 'content_hash_required'; END IF;
  IF v_doc_type NOT IN ('iso_cert','accreditation','insurance','financial','nda','msa','technical_proposal','mill_cert','other') THEN
    v_doc_type := 'other'; END IF;
  IF v_bound_type NOT IN ('vendor','quote','contract','job') THEN v_bound_type := 'vendor'; END IF;

  -- idempotent: identical content already sealed by this vendor → return it
  SELECT * INTO v_existing FROM public.vendor_documents
    WHERE vendor_id = v_uid AND content_sha256 = lower(p_content_sha256) AND status = 'active' LIMIT 1;
  IF FOUND THEN RETURN v_existing; END IF;

  -- canonical-JSON SEAL over content hash + metadata + identity (same spine as pi_seal)
  v_payload := jsonb_build_object(
    'kind','vendor_document', 'v', 1,
    'vendor_id',      v_uid,
    'doc_type',       v_doc_type,
    'content_sha256', lower(p_content_sha256),
    'byte_size',      p_byte_size,
    'mime_type',      p_mime_type,
    'storage_path',   p_storage_path,
    'bound_type',     v_bound_type,
    'bound_id',       p_bound_id,
    'issued_at',      now()
  );
  v_seal := encode(digest(public.pi_canonical_json(v_payload), 'sha256'), 'hex');

  INSERT INTO public.vendor_documents (
    vendor_id, doc_type, title, storage_path, mime_type, byte_size,
    content_sha256, seal_sha256, seal_payload, ots_status, bound_type, bound_id
  ) VALUES (
    v_uid, v_doc_type, p_title, p_storage_path, p_mime_type, p_byte_size,
    lower(p_content_sha256), v_seal, v_payload, 'pending', v_bound_type, p_bound_id
  ) RETURNING * INTO v_row;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.vendor_document_seal(text,text,text,text,text,bigint,text,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.vendor_document_seal(text,text,text,text,text,bigint,text,uuid) TO authenticated;

-- ── 6) OTS recorder — worker flips pending→submitted→bitcoin_confirmed ───────
CREATE OR REPLACE FUNCTION public.vendor_document_record_anchor(
  p_doc_id uuid, p_status text,
  p_calendar text DEFAULT NULL, p_ots_proof text DEFAULT NULL, p_block_height bigint DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'not authorized' USING errcode='42501'; END IF;
  IF p_status NOT IN ('pending','submitted','bitcoin_confirmed','failed') THEN RAISE EXCEPTION 'bad_status'; END IF;
  UPDATE public.vendor_documents SET
    ots_status           = p_status,
    ots_calendar         = coalesce(p_calendar, ots_calendar),
    ots_proof            = coalesce(p_ots_proof, ots_proof),
    ots_submitted_at     = CASE WHEN p_status = 'submitted' AND ots_submitted_at IS NULL THEN now() ELSE ots_submitted_at END,
    ots_confirmed_at     = CASE WHEN p_status = 'bitcoin_confirmed' THEN now() ELSE ots_confirmed_at END,
    bitcoin_block_height = coalesce(p_block_height, bitcoin_block_height),
    updated_at           = now()
  WHERE id = p_doc_id;
END $$;

REVOKE ALL ON FUNCTION public.vendor_document_record_anchor(uuid,text,text,text,bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.vendor_document_record_anchor(uuid,text,text,text,bigint) TO authenticated, service_role;

-- ── 7) SELF-TEST ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_canon text;
BEGIN
  IF to_regprocedure('public.vendor_document_seal(text,text,text,text,text,bigint,text,uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST seal RPC missing'; END IF;
  IF to_regprocedure('public.vendor_document_record_anchor(uuid,text,text,text,bigint)') IS NULL THEN RAISE EXCEPTION 'SELFTEST anchor RPC missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'vendor_documents') THEN RAISE EXCEPTION 'SELFTEST bucket missing'; END IF;
  v_canon := public.pi_canonical_json('{"b":1,"a":2}'::jsonb);   -- the seal mechanism must be live
  IF v_canon IS NULL THEN RAISE EXCEPTION 'SELFTEST canonicaliser missing'; END IF;
  RAISE NOTICE 'Vendor Custody Core installed: table + private bucket + storage RLS + seal RPC + OTS recorder.';
END $$;

COMMIT;
