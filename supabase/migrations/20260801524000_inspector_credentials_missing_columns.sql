-- ════════════════════════════════════════════════════════════════════════════
--  20260801524000_inspector_credentials_missing_columns.sql
--
--  P1 — /inspector/compliance cannot save a certification or a document. Both
--  upload forms INSERT columns that do not exist on either table.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  apps/web/src/lib/actions/inspectorCertifications.ts collects name,
--  issuingBody, certificateNumber, issuedAt, expiresAt, notes and a file, then:
--
--      .from('inspector_certifications').insert({
--         inspector_id, name, issuing_body, certificate_number,
--         issued_at, expires_at, certificate_path, notes })
--
--  The table has certification_type, certification_number, issued_date,
--  expiry_date, document_url. So `name`, `issuing_body`, `certificate_path`
--  and `notes` are all 42703. inspectorDocuments.ts is the same story with
--  kind / label / file_path / expires_at / notes against a table holding
--  doc_name / file_url / expiry_date.
--
--  Every submission therefore uploaded the file to storage, failed at the
--  INSERT, and rolled the storage object back. An inspector could not add a
--  single credential — which is the first thing Inspector onboarding asks for.
--  Verified identical on NEXPEC-Staging, so this is not local drift.
--
--  ── WHY COLUMNS RATHER THAN REWRITING THE CODE DOWN ────────────────────────
--  Four of the mismatches are pure renames and ARE fixed in code, not here —
--  duplicating a column that already exists under another name would be the
--  worse repair:
--
--      name              -> certification_type      (code changed)
--      certificate_number-> certification_number    (code changed)
--      issued_at         -> issued_date             (code changed)
--      expires_at        -> expiry_date             (code changed)
--      label             -> doc_name                (code changed)
--
--  The rest have no counterpart at all. The forms deliberately collect them and
--  the read path renders them, so dropping them would delete a feature rather
--  than repair one. Those are added here.
--
--  certificate_path / file_path are deliberately NOT folded into
--  document_url / file_url. Those hold an externally-hosted URL; these hold an
--  object path inside a private bucket that the reader turns into a short-lived
--  signed URL. Storing a bucket path in a column named *_url is how a private
--  credential ends up rendered as a public link.
--
--  ── SAFETY ─────────────────────────────────────────────────────────────────
--   • Purely additive. Every column is nullable with no default, so no existing
--     row changes and no write path is forced to supply anything new.
--   • No column is dropped, renamed or retyped.
--   • No policy, grant, trigger or constraint is altered, so the RLS posture of
--     both tables is exactly what it was.
--   • updated_at is added without a trigger. 20260801-era work removed a
--     misattached updated_at trigger from contractor_certifications; attaching
--     one here uninvited would repeat that. The write paths set it explicitly.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.inspector_certifications
  ADD COLUMN IF NOT EXISTS issuing_body     text,
  ADD COLUMN IF NOT EXISTS certificate_path text,
  ADD COLUMN IF NOT EXISTS notes            text,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz;

COMMENT ON COLUMN public.inspector_certifications.issuing_body IS
  'Awarding body (ASNT, API, CSWIP …). Collected by the /inspector/compliance form; had no column until 20260801524000, so every submission failed at INSERT.';
COMMENT ON COLUMN public.inspector_certifications.certificate_path IS
  'Object path inside the PRIVATE inspector_credentials bucket. Distinct from document_url, which is an externally-hosted URL — a bucket path stored in a *_url column invites being rendered as a public link.';

ALTER TABLE public.inspector_documents
  ADD COLUMN IF NOT EXISTS kind       text,
  ADD COLUMN IF NOT EXISTS file_path  text,
  ADD COLUMN IF NOT EXISTS notes      text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

COMMENT ON COLUMN public.inspector_documents.kind IS
  'Document category chosen on the compliance form (insurance, right-to-work, …). Added by 20260801524000; the form had been posting it into a column that did not exist.';
COMMENT ON COLUMN public.inspector_documents.file_path IS
  'Object path inside the PRIVATE inspector_credentials bucket. See inspector_certifications.certificate_path for why this is not file_url.';

-- ── Self-test — every column both write paths reference must now resolve ────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t || '.' || c, ', ') INTO v_missing
  FROM (
    VALUES
      ('inspector_certifications','certification_type'),
      ('inspector_certifications','certification_number'),
      ('inspector_certifications','issued_date'),
      ('inspector_certifications','expiry_date'),
      ('inspector_certifications','issuing_body'),
      ('inspector_certifications','certificate_path'),
      ('inspector_certifications','notes'),
      ('inspector_certifications','updated_at'),
      ('inspector_documents','doc_name'),
      ('inspector_documents','expiry_date'),
      ('inspector_documents','kind'),
      ('inspector_documents','file_path'),
      ('inspector_documents','notes'),
      ('inspector_documents','updated_at')
  ) AS want(t, c)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = want.t AND column_name = want.c
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'INSPECTOR_CREDENTIAL_COLUMNS_MISSING: %', v_missing;
  END IF;
  RAISE NOTICE 'ok: every column the compliance write paths reference resolves.';
END $$;

COMMIT;
