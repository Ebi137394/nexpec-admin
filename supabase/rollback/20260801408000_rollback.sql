-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801408000_rollback.sql
--
--  Reverses the QCP document coherence + sign-off layer. Leaves the QCP schema
--  from 20260801406000 completely intact — this file only removes what 408000
--  added on top of it.
--
--  ⚠ Dropping the acceptance columns DESTROYS SIGN-OFF RECORDS: who accepted
--    which required document, when, and against which artifact. The
--    corresponding public.audit_events rows SURVIVE (they are ordinary audit
--    rows and are deliberately not deleted), so the trail is recoverable, but
--    the current-state answer "is this requirement satisfied?" is lost.
--
--  Guarded: aborts if any acceptance exists. Override deliberately with
--    nexpec.force_drop_qcp_docs = 1.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE v_n int;
BEGIN
  IF to_regclass('public.qcp_required_documents') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='qcp_required_documents'
                    AND column_name='accepted_at') THEN
    RETURN;   -- 408000 was never applied
  END IF;

  EXECUTE 'SELECT count(*) FROM public.qcp_required_documents WHERE accepted_at IS NOT NULL'
    INTO v_n;
  IF v_n > 0 AND coalesce(current_setting('nexpec.force_drop_qcp_docs', true), '') <> '1' THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: % QCP required document(s) carry a recorded acceptance '
      '(accepted_by / accepted_at). Dropping these columns destroys the sign-off '
      'record. Set nexpec.force_drop_qcp_docs=1 if that is genuinely intended.', v_n;
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS trg_qcp_required_document_audit ON public.qcp_required_documents;
DROP TRIGGER IF EXISTS trg_guard_qcp_required_document ON public.qcp_required_documents;

DROP FUNCTION IF EXISTS public.nx_qcp_revision_documents(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_revoke_document_acceptance(uuid, text);
DROP FUNCTION IF EXISTS public.nx_qcp_accept_document(uuid, text);
DROP FUNCTION IF EXISTS public.nx_qcp_attach_document(uuid, uuid);
DROP FUNCTION IF EXISTS public.tg_qcp_required_document_audit();
DROP FUNCTION IF EXISTS public.tg_guard_qcp_required_document();
DROP FUNCTION IF EXISTS public.nx_qcp_may_read(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_may_accept_document(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_may_supply_document(uuid, uuid);

DO $cols$
BEGIN
  IF to_regclass('public.qcp_required_documents') IS NULL THEN RETURN; END IF;

  ALTER TABLE public.qcp_required_documents
    DROP CONSTRAINT IF EXISTS qcp_req_doc_acceptance_paired,
    DROP CONSTRAINT IF EXISTS qcp_req_doc_acceptance_needs_document,
    DROP CONSTRAINT IF EXISTS qcp_req_doc_submission_paired;

  ALTER TABLE public.qcp_required_documents
    DROP COLUMN IF EXISTS acceptance_note,
    DROP COLUMN IF EXISTS accepted_at,
    DROP COLUMN IF EXISTS accepted_by,
    DROP COLUMN IF EXISTS submitted_at,
    DROP COLUMN IF EXISTS submitted_by;
END
$cols$;

DROP INDEX IF EXISTS public.qcp_required_documents_document_idx;
DROP INDEX IF EXISTS public.qcp_required_documents_revision_idx;

--  NOTE: the REVOKE of INSERT/UPDATE/DELETE on qcp_required_documents from
--  authenticated is NOT reversed. Re-granting a direct write path would
--  reopen exactly the forgery surface 20260801402000 closed on ITP, and
--  20260801406000 never granted it in the first place — the REVOKE was
--  defence in depth, and defence in depth is not something a rollback undoes.

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='qcp_required_documents'
                AND column_name='accepted_by') THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: accepted_by is still present';
  END IF;
  IF to_regprocedure('public.nx_qcp_accept_document(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: nx_qcp_accept_document is still present';
  END IF;

  -- Everything 408000 borrowed must be untouched.
  IF to_regclass('public.qcp_required_documents') IS NULL
     OR to_regclass('public.qcp_revisions') IS NULL
     OR to_regclass('public.quality_control_plans') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: 20260801406000''s QCP schema was damaged — 408000 only added on top of it';
  END IF;
  IF to_regclass('public.documents') IS NULL
     OR to_regclass('public.project_documents') IS NULL
     OR to_regclass('public.audit_events') IS NULL
     OR to_regprocedure('public.nx_can_access_doc(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a pre-existing document object is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.documents'::regclass) THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: RLS on public.documents was disturbed';
  END IF;

  RAISE NOTICE 'rollback complete: QCP document coherence + sign-off removed; QCP schema, documents, audit_events and nx_can_access_doc intact.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
