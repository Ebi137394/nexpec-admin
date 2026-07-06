-- ════════════════════════════════════════════════════════════════════════════
--  20260801252000_fix_nx_can_access_doc_dispute_work_orders.sql
--
--  Forward correction for a LATENT bug shipped in 20260801242000.
--
--  242000 added a dispute-reports branch to nx_can_access_doc that joined
--  `public.projects` and read `p.client_id` / `p.inspector_id`. But
--  `disputes.project_id` is an FK to `public.work_orders(id)` — NOT
--  `public.projects` (which is the org/budget table and has neither client_id
--  nor inspector_id). Because a plpgsql body is not column-checked at CREATE
--  time, 242000 applied clean, but the branch raises 42703 ("column p.client_id
--  does not exist") whenever it is reached at runtime. Effect: fails CLOSED —
--  dispute-report parties can't mint a signed URL for their PDF, and any
--  deny-path that falls through to this branch errors instead of returning
--  false. No security regression (admin + owner short-circuit earlier), but the
--  feature is broken and must be healed.
--
--  Fix: re-issue nx_can_access_doc with the dispute branch resolving parties
--  through public.work_orders. Every other branch is unchanged (all verified
--  against the live schema). Signature + parameter names are identical to the
--  applied version, so CREATE OR REPLACE cleanly replaces in place.
--
--  Idempotent + self-tested (the self-test EXECUTES the function so every branch
--  is planned/run and any drifted column fails HERE, not in production).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_can_access_doc(
  p_uid    uuid,
  p_bucket text,
  p_path   text
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_uid IS NULL OR p_bucket IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  -- admin / super_admin (god-mode)
  SELECT role INTO v_role FROM public.profiles WHERE id = p_uid;
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN true;
  END IF;

  -- storage owner (the uploader)
  IF EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = p_bucket AND o.name = p_path AND o.owner = p_uid
  ) THEN
    RETURN true;
  END IF;

  -- job-party linkage. Suffix match ('%' || path) tolerates rows that stored a
  -- full public URL vs. a bare path. Each branch gates on the caller being a
  -- party (client / agency / assigned contractor) to the owning job.
  IF EXISTS (
    SELECT 1 FROM public.inspection_reports r
      JOIN public.jobs j ON j.id = r.job_id
     WHERE (r.photo_url LIKE '%' || p_path
            OR r.pdf_url LIKE '%' || p_path
            OR r.final_report_doc LIKE '%' || p_path)
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.contracts c
     WHERE c.document_url LIKE '%' || p_path
       AND (c.client_id = p_uid OR c.contractor_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_documents pd
      JOIN public.jobs j ON j.id = pd.job_id
     WHERE pd.file_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.template_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  -- chat attachments: caller owns the conversation, or is a job-party of the
  -- conversation's job.
  IF EXISTS (
    SELECT 1 FROM public.messages m
      JOIN public.conversations cv ON cv.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND (
         cv.user_id = p_uid
         OR (cv.job_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.jobs j
               WHERE j.id = cv.job_id
                 AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
            ))
       )
  ) THEN RETURN true; END IF;

  -- dispute-reports: the generated PDF is visible to the dispute's parties.
  -- disputes.project_id is an FK to public.work_orders(id) (NOT public.projects,
  -- the org/budget table which has no client_id/inspector_id). Resolve the
  -- client + assigned inspector through work_orders; the raiser is always a party.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
      JOIN public.work_orders w ON w.id = d.project_id
     WHERE d.report_url LIKE '%' || p_path
       AND (w.client_id = p_uid OR w.inspector_id = p_uid OR d.raised_by = p_uid)
  ) THEN RETURN true; END IF;

  RETURN false;  -- deny by default
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

-- ── Self-test: execute the function so EVERY branch is planned + run ─────────
DO $test$
DECLARE
  v_ok boolean;
  v_def text;
BEGIN
  -- A uid/path that matches nothing forces each branch's EXISTS to execute and
  -- return false without short-circuiting, so a drifted table/column reference
  -- (the very class of bug this migration fixes) raises 42703 HERE, not in prod.
  SELECT public.nx_can_access_doc(
           '00000000-0000-0000-0000-000000000000'::uuid,
           'dispute-reports',
           '__nx_selftest_no_such_path__'
         ) INTO v_ok;
  IF v_ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_can_access_doc self-probe returned %, expected false', v_ok;
  END IF;

  -- Confirm the dispute branch is now rewired to work_orders (strip line comments
  -- with the newline-sensitive 'n' flag so we match code, not prose).
  v_def := regexp_replace(pg_get_functiondef('public.nx_can_access_doc(uuid,text,text)'::regprocedure), '--.*', '', 'gn');
  IF position('public.work_orders' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: dispute branch not rewired to work_orders';
  END IF;

  RAISE NOTICE 'nx_can_access_doc healed: dispute parties via work_orders; all 8 branches execute clean.';
END $test$;

COMMIT;
