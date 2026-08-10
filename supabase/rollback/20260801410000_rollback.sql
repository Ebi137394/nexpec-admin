-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801410000_rollback.sql
--
--  Reverses 20260801410000 (QCP ↔ reporting / analytics integration). LOCAL only.
--
--  Drops the eight QCP reporting readers and RESTORES nx_admin_report_review_queue
--  byte-for-byte from 20260801400000, the migration that owns its current shape
--  (visit_rollup from 390000 and itp_rollup from 400000, both preserved).
--
--  ── WHAT ROLLING BACK COSTS YOU ────────────────────────────────────────────
--  The admin review queue loses its qcp_rollup column. reportReview.ts maps the
--  queue by key name and would land on undefined, so no page breaks — the admin
--  report review surface simply shows no quality-plan governance context, and a
--  reviewer signing off a report can no longer see from the queue that a
--  mandatory QCP document is missing or that a hold point is still open. Nothing
--  else in apps/ reads any function dropped here.
--
--  NO DATA IS MODIFIED. This migration never wrote a row and neither does its
--  reversal: no plan, revision, stage, template link, required document, ITP
--  result, report, seal, template or publish flag is touched. No progress column
--  is dropped because none was ever created — progress was derived at read time.
--
--  ── ORDER MATTERS ──────────────────────────────────────────────────────────
--  The queue is dropped FIRST because it references nx_report_qcp_rollup, then
--  the readers in dependency order (report → rollup → stage → for_job → visible
--  → effective_revision / scope_jobs), then the queue is recreated without the
--  QCP column.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.nx_admin_report_review_queue(int, boolean);
DROP FUNCTION IF EXISTS public.nx_report_qcp_rollup(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_outstanding_requirements(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_rollup(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_stage_progress(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_for_job(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_visible(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_effective_revision(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_scope_jobs(uuid, uuid);

-- ── Restore nx_admin_report_review_queue exactly as 20260801400000 defined it ─
CREATE FUNCTION public.nx_admin_report_review_queue(
  p_limit           int     DEFAULT 50,
  p_only_unreviewed boolean DEFAULT true
) RETURNS TABLE (
  report_id          uuid,
  job_id             uuid,
  job_title          text,
  inspector_id       uuid,
  inspector_name     text,
  status             text,
  submitted_at       timestamptz,
  technical_approved boolean,
  financial_approved boolean,
  is_published       boolean,
  is_client_approved boolean,
  pdf_url            text,
  visit_rollup       jsonb,
  itp_rollup         jsonb
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.job_id, j.title, r.inspector_id, p.full_name,
         r.status, r.created_at,
         COALESCE(r.technical_approved, false),
         COALESCE(r.financial_approved, false),
         COALESCE(r.is_published, false),
         COALESCE(r.is_client_approved, false),
         r.pdf_url,
         public.nx_report_visit_rollup(r.id),
         public.nx_report_itp_rollup(r.id)
    FROM public.inspection_reports r
    LEFT JOIN public.jobs     j ON j.id = r.job_id
    LEFT JOIN public.profiles p ON p.id = r.inspector_id
   WHERE r.deleted_at IS NULL
     AND (NOT p_only_unreviewed
          OR COALESCE(r.technical_approved, false) = false
          OR COALESCE(r.financial_approved, false) = false)
   ORDER BY r.created_at ASC
   LIMIT GREATEST(COALESCE(p_limit, 50), 1);
END $fn$;

ALTER FUNCTION public.nx_admin_report_review_queue(int, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_admin_report_review_queue(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_admin_report_review_queue(int, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_admin_report_review_queue(int, boolean) IS
  'Admin-only queue of inspection reports awaiting technical/financial review, oldest first, each carrying its visit programme rollup (20260801390000) and its ITP rollup (20260801400000) so a reviewer can see both whether the work is finished and whether the quality plan is satisfied before signing off. Returns no pricing column of any kind.';

DO $verify$
BEGIN
  -- Nothing from this lane may survive.
  IF to_regprocedure('public.nx_qcp_scope_jobs(uuid,uuid)')          IS NOT NULL
     OR to_regprocedure('public.nx_qcp_effective_revision(uuid)')    IS NOT NULL
     OR to_regprocedure('public.nx_qcp_visible(uuid,uuid)')          IS NOT NULL
     OR to_regprocedure('public.nx_qcp_for_job(uuid)')               IS NOT NULL
     OR to_regprocedure('public.nx_qcp_stage_progress(uuid,uuid)')   IS NOT NULL
     OR to_regprocedure('public.nx_qcp_rollup(uuid)')                IS NOT NULL
     OR to_regprocedure('public.nx_qcp_outstanding_requirements(uuid)') IS NOT NULL
     OR to_regprocedure('public.nx_report_qcp_rollup(uuid)')         IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a QCP reporting reader survived';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.parameters
              WHERE specific_schema = 'public'
                AND parameter_name = 'qcp_rollup'
                AND specific_name LIKE 'nx_admin_report_review_queue%') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the review queue still carries QCP context';
  END IF;

  -- Everything earlier phases own must be intact and unregressed.
  IF to_regprocedure('public.nx_admin_report_review_queue(int,boolean)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the review queue was not restored — the admin report page would break';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.parameters
                  WHERE specific_schema = 'public'
                    AND parameter_name = 'visit_rollup'
                    AND specific_name LIKE 'nx_admin_report_review_queue%')
     OR NOT EXISTS (SELECT 1 FROM information_schema.parameters
                     WHERE specific_schema = 'public'
                       AND parameter_name = 'itp_rollup'
                       AND specific_name LIKE 'nx_admin_report_review_queue%') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the restored queue lost visit_rollup or itp_rollup — 20260801390000 / 20260801400000 were regressed by the reversal';
  END IF;
  IF to_regprocedure('public.nx_report_visit_rollup(uuid)') IS NULL
     OR to_regprocedure('public.nx_report_itp_rollup(uuid)') IS NULL
     OR to_regprocedure('public.nx_report_itp_log(uuid)') IS NULL
     OR to_regprocedure('public.nx_job_itp(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a visit or ITP reader was disturbed';
  END IF;
  IF to_regclass('public.report_templates') IS NULL
     OR to_regclass('public.pi_report_seals') IS NULL
     OR to_regprocedure('public.approve_inspection_report(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.nx_admin_review_inspection_report(uuid,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: report templating, sealing, review or publishing was disturbed';
  END IF;

  -- The QCP schema itself belongs to 20260801406000 and must be untouched:
  -- this reversal removes reporting, not the plans.
  IF to_regclass('public.quality_control_plans') IS NULL
     OR to_regclass('public.qcp_revisions')          IS NULL
     OR to_regclass('public.qcp_stages')             IS NULL
     OR to_regclass('public.qcp_stage_templates')    IS NULL
     OR to_regclass('public.qcp_required_documents') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a QCP table disappeared — this reversal must not touch the schema lane';
  END IF;

  RAISE NOTICE 'rollback complete: QCP reporting removed, review queue restored with visit_rollup + itp_rollup. No data changed; the QCP schema is untouched.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
