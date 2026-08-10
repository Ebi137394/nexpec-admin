-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801406000_rollback.sql — reverses the QCP foundation.
--
--  ⚠ WHAT ROLLING BACK COSTS YOU
--  Dropping qcp_revisions DESTROYS THE GOVERNING QUALITY DOCUMENT and its whole
--  append-preserved history: every approved revision, every superseded one,
--  who approved what and when, the stage structure and the required-document
--  register. A QCP is a contractual quality record; this is not a cache.
--
--  NOT deleted, because QCP never owned them:
--    • inspection_scope_templates and itp_points — QCP only LINKED to them.
--      Every point, acceptance criterion and evidence requirement survives.
--    • itp_point_results — the execution record QCP derived progress from.
--    • public.documents — QCP linked documents, it never stored a file.
--    • flash_reports — QCP nonconformances are ordinary flash reports and stay
--      in the NCR workflow exactly as if raised by hand.
--    • audit_events — the approval trail written by nx_qcp_approve_revision is
--      append-only and is deliberately left standing.
--
--  Guarded: aborts if any revision has ever been approved. Override
--  deliberately with `SET nexpec.force_drop_qcp = 1`.
--
--  LOCAL only. Forward-only in production.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE
  v_rev  int := 0;
  v_appr int := 0;
BEGIN
  IF to_regclass('public.qcp_revisions') IS NULL THEN
    RAISE NOTICE 'qcp_revisions absent — nothing to roll back';
    RETURN;
  END IF;

  SELECT count(*) INTO v_rev  FROM public.qcp_revisions;
  SELECT count(*) INTO v_appr FROM public.qcp_revisions
   WHERE status IN ('approved','superseded');

  IF v_appr > 0 AND coalesce(current_setting('nexpec.force_drop_qcp', true), '') <> '1' THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: % of % quality-plan revision(s) have been APPROVED. '
      'Dropping them destroys an append-preserved governing quality document '
      '(approvals, supersession lineage, stage structure, required documents). '
      'Set nexpec.force_drop_qcp=1 if that is genuinely intended.', v_appr, v_rev;
  END IF;

  IF v_rev > 0 THEN
    RAISE WARNING 'rolling back QCP while % draft revision(s) exist — they will be destroyed', v_rev;
  END IF;
END
$guard$;

-- ── The seven RPCs ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.nx_qcp_revision_history(uuid);
DROP FUNCTION IF EXISTS public.nx_project_qcp(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_set_stage_templates(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.nx_qcp_approve_revision(uuid, text);
DROP FUNCTION IF EXISTS public.nx_qcp_submit_revision(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_add_revision(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_create(uuid, text, uuid);

-- ── Authorization helpers (dependants first) ────────────────────────────────
DROP FUNCTION IF EXISTS public.nx_qcp_can_author(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_can_read(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_can_read_detail(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_is_engaged_inspector(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_scope_job_ids(uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_org_author(uuid, uuid);
DROP FUNCTION IF EXISTS public.nx_qcp_org_reader(uuid, uuid);

-- ── Triggers, then tables (children first), then trigger functions ──────────
DROP TRIGGER IF EXISTS trg_qcp_required_document_guard  ON public.qcp_required_documents;
DROP TRIGGER IF EXISTS trg_qcp_stage_templates_draft_only ON public.qcp_stage_templates;
DROP TRIGGER IF EXISTS trg_qcp_stages_draft_only        ON public.qcp_stages;
DROP TRIGGER IF EXISTS trg_qcp_revision_state           ON public.qcp_revisions;
DROP TRIGGER IF EXISTS trg_qcp_org_matches_project      ON public.quality_control_plans;
DROP TRIGGER IF EXISTS trg_touch_qcp                    ON public.quality_control_plans;

DROP TABLE IF EXISTS public.qcp_required_documents;
DROP TABLE IF EXISTS public.qcp_stage_templates;
DROP TABLE IF EXISTS public.qcp_stages;
DROP TABLE IF EXISTS public.qcp_revisions;
DROP TABLE IF EXISTS public.quality_control_plans;

DROP FUNCTION IF EXISTS public.tg_qcp_required_document_guard();
DROP FUNCTION IF EXISTS public.tg_qcp_child_draft_only();
DROP FUNCTION IF EXISTS public.tg_qcp_revision_state();
DROP FUNCTION IF EXISTS public.tg_qcp_org_matches_project();
DROP FUNCTION IF EXISTS public.tg_touch_qcp();

DO $verify$
BEGIN
  IF to_regclass('public.quality_control_plans') IS NOT NULL
     OR to_regclass('public.qcp_revisions') IS NOT NULL
     OR to_regclass('public.qcp_stages') IS NOT NULL
     OR to_regclass('public.qcp_stage_templates') IS NOT NULL
     OR to_regclass('public.qcp_required_documents') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: a QCP table is still present';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND (p.proname LIKE 'nx\_qcp\_%' OR p.proname LIKE 'tg\_qcp\_%'
                     OR p.proname = 'nx_project_qcp' OR p.proname = 'tg_touch_qcp')) THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: a QCP function is still present';
  END IF;

  -- Everything QCP only ORCHESTRATED must be untouched.
  IF to_regclass('public.inspection_scope_templates') IS NULL
     OR to_regclass('public.itp_points') IS NULL
     OR to_regclass('public.itp_point_results') IS NULL
     OR to_regclass('public.documents') IS NULL
     OR to_regclass('public.flash_reports') IS NULL
     OR to_regclass('public.projects') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: an object QCP only linked to is missing';
  END IF;
  IF to_regprocedure('public.nx_job_itp(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_itp_record_result(uuid,uuid,text,uuid,text,text)') IS NULL
     OR to_regprocedure('public.nx_itp_release_hold(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: an ITP RPC was collaterally dropped';
  END IF;
  IF has_table_privilege('authenticated', 'public.itp_point_results', 'INSERT') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: 20260801402000''s lockdown was disturbed';
  END IF;

  RAISE NOTICE 'rollback complete: QCP removed; scope templates, ITP points and results, documents and NCRs intact.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
