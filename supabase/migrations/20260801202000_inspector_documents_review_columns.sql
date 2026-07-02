-- ════════════════════════════════════════════════════════════════════════════
--  20260801202000_inspector_documents_review_columns.sql  (Mobile Parity — P1-1)
--
--  `inspector_documents` is (id, inspector_id, doc_name, file_url, expiry_date,
--  status, created_at) — it has NO review-audit columns, yet the admin
--  verification UI writes `reviewed_at`/`reviewed_by` on approve/reject
--  (app/(admin)/verification/index.tsx) → those UPDATEs 400 and approval silently
--  fails. We WANT the audit trail, so add the columns (the alternative — deleting
--  the writes — loses who/when reviewed). Additive, idempotent.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.inspector_documents
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inspector_documents.reviewed_at IS
  'When an admin approved/rejected this document (verification audit trail).';
COMMENT ON COLUMN public.inspector_documents.reviewed_by IS
  'Admin profile id that reviewed this document.';

DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspector_documents'
                    AND column_name='reviewed_at')
   OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspector_documents'
                    AND column_name='reviewed_by') THEN
    RAISE EXCEPTION 'SELFTEST: inspector_documents review columns missing';
  END IF;
  RAISE NOTICE 'inspector_documents review columns OK (reviewed_at, reviewed_by).';
END
$test$;

COMMIT;
