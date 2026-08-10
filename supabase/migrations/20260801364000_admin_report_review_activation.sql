-- ════════════════════════════════════════════════════════════════════════════
--  20260801364000_admin_report_review_activation.sql
--
--  ADMIN REPORT REVIEW — activate the two-stage review that already exists in
--  the schema and has never been writable.
--
--  ── WHAT THE RECONCILIATION FOUND (evidence, not assumption) ───────────────
--  inspection_reports has carried these columns since the baseline (23087-23093):
--      technical_approved / technical_approved_by / technical_approved_at
--      financial_approved / financial_approved_by / financial_approved_at
--  Both *_by columns even have FOREIGN KEYs to auth.users (28453, 28463). So a
--  two-stage admin review was designed. It was never finished:
--
--    • apps/web/src/lib/actions/submitReport.ts states outright that it "NEVER
--      sets technical_approved / financial_approved / is_published /
--      is_client_approved" — deliberately leaving them for a later actor.
--    • apps/web/src/lib/data/inspectorReport.ts READS all six and surfaces them
--      to the inspector.
--    • NOTHING WRITES THEM. No RPC, no server action, no admin screen. Admin web
--      has 32 routes and not one reviews an inspection report.
--
--  So the inspector is shown an approval state that could never become true.
--
--  ── WHAT IS ALREADY COMPLETE AND IS NOT TOUCHED HERE ───────────────────────
--  The CLIENT path works and is left exactly as it is: approve_inspection_report
--  (repaired in 20260801162000) sets status + is_published + is_client_approved
--  and is authorized to the job's client/agency only. This migration does NOT
--  change who publishes a report, does NOT gate the client, and does NOT alter
--  that function. Admin review is RECORDED ALONGSIDE it.
--
--  ── DELIBERATELY NON-BLOCKING ──────────────────────────────────────────────
--  Making admin sign-off mandatory would change a live workflow and could strand
--  every in-flight report. Review is therefore recorded and surfaced, not
--  enforced. The enforcement decision is a policy choice for later; the data it
--  would need starts being captured now.
--
--  ── PAYMENT FREEZE — READ THIS BEFORE EDITING ──────────────────────────────
--  'financial_approved' is a REVIEW FLAG. It authorises NOTHING. It must never
--  move money, credit a wallet, write a transaction, or set admin_confirmed_at
--  (which is what actually fires the payout trigger). Settlement stays manual
--  and admin-initiated. A self-test fails the deploy if this function ever
--  names a money surface.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Record an admin review decision ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_review_inspection_report(
  p_report_id uuid,
  p_kind      text,
  p_approved  boolean,
  p_note      text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin  uuid := auth.uid();
  v_report RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  IF p_kind IS NULL OR lower(btrim(p_kind)) NOT IN ('technical', 'financial') THEN
    RAISE EXCEPTION 'p_kind must be technical or financial (got %)', p_kind
      USING errcode = '22023';
  END IF;
  p_kind := lower(btrim(p_kind));

  SELECT r.id, r.job_id, r.inspector_id, r.status
    INTO v_report
    FROM public.inspection_reports r
   WHERE r.id = p_report_id AND r.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspection report % not found', p_report_id USING errcode = 'P0002';
  END IF;

  -- Only the review columns are written. status / is_published /
  -- is_client_approved belong to the client path and are NOT touched.
  IF p_kind = 'technical' THEN
    UPDATE public.inspection_reports
       SET technical_approved    = p_approved,
           technical_approved_by = v_admin,
           technical_approved_at = now(),
           updated_at            = now()
     WHERE id = p_report_id;
  ELSE
    UPDATE public.inspection_reports
       SET financial_approved    = p_approved,
           financial_approved_by = v_admin,
           financial_approved_at = now(),
           updated_at            = now()
     WHERE id = p_report_id;
  END IF;

  -- Audit on the existing job_events spine (event_type 'status_change' is the
  -- CHECK-permitted value used by approve_inspection_report).
  BEGIN
    INSERT INTO public.job_events (job_id, actor_id, event_type, metadata)
    VALUES (v_report.job_id, v_admin, 'status_change',
            jsonb_build_object('area', 'inspection_report_review',
                               'report_id', p_report_id,
                               'review_kind', p_kind,
                               'approved', p_approved,
                               'note', NULLIF(btrim(coalesce(p_note, '')), '')));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'report review audit failed for %: %', p_report_id, SQLERRM;
  END;

  -- Tell the inspector. A notification failure must not lose the decision.
  BEGIN
    PERFORM public.notify_safe(
      v_report.inspector_id, 'system',
      CASE WHEN p_approved
           THEN format('%s review passed', initcap(p_kind))
           ELSE format('%s review needs changes', initcap(p_kind)) END,
      COALESCE(NULLIF(btrim(coalesce(p_note, '')), ''),
               CASE WHEN p_approved
                    THEN 'Your report passed this review stage.'
                    ELSE 'Your report needs changes before it can proceed.' END),
      '/inspector/jobs/' || v_report.job_id::text,
      v_report.job_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'report review notification failed for %: %', p_report_id, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id,
                            'kind', p_kind, 'approved', p_approved);
END $fn$;

ALTER FUNCTION public.nx_admin_review_inspection_report(uuid, text, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_admin_review_inspection_report(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_admin_review_inspection_report(uuid, text, boolean, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_admin_review_inspection_report(uuid, text, boolean, text) IS
  'Records an admin technical/financial review on an inspection report. Writes ONLY the review columns — status, is_published and is_client_approved remain owned by the client path (approve_inspection_report). MOVES NO MONEY: financial_approved is a review flag and authorises no settlement; payouts stay manual.';

-- ── 2) The admin review queue ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_admin_report_review_queue(
  p_limit          int     DEFAULT 50,
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
  pdf_url            text
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
         r.pdf_url
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
  'Admin-only queue of inspection reports awaiting technical/financial review, oldest first. Returns no pricing column of any kind.';

-- ── 3) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  drev text := pg_get_functiondef('public.nx_admin_review_inspection_report(uuid,text,boolean,text)'::regprocedure);
  dq   text := pg_get_functiondef('public.nx_admin_report_review_queue(int,boolean)'::regprocedure);
BEGIN
  IF position('admin only' IN drev) = 0 OR position('admin only' IN dq) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a report-review function is not admin-gated';
  END IF;

  -- PAYMENT FREEZE. financial_approved must authorise nothing.
  IF drev ~* '\m(admin_confirmed_at|payout|wallet|escrow|transactions|inspector_payout_cents|client_price_cents|release_payment|stripe)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the review function names a money surface — financial_approved must move no money';
  END IF;

  -- The client publish path must remain the client''s.
  IF drev ~* 'SET[^;]*\mis_published\M' OR drev ~* 'SET[^;]*\mis_client_approved\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin review writes a client-owned publish column';
  END IF;

  -- The pre-existing client approval path must be intact and unchanged.
  IF to_regprocedure('public.approve_inspection_report(uuid,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: approve_inspection_report is missing — the client path must be preserved';
  END IF;

  IF has_function_privilege('anon','public.nx_admin_review_inspection_report(uuid,text,boolean,text)','EXECUTE')
     OR has_function_privilege('anon','public.nx_admin_report_review_queue(int,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon can reach a report-review function';
  END IF;

  RAISE NOTICE 'admin report review active: dormant technical/financial columns are now writable, client publish path untouched.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
