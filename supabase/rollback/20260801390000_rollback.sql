-- ════════════════════════════════════════════════════════════════════════════
--  supabase/rollback/20260801390000_rollback.sql
--
--  Reverses 20260801390000 (visit-aware reporting). LOCAL only.
--
--  Drops the two report-scoped visit readers and RESTORES the two functions the
--  migration replaced, byte-for-byte from the migrations that own them:
--    • nx_report_contributors        → the 20260801378000 definition
--    • nx_admin_report_review_queue  → the 20260801364000 definition
--
--  ── WHAT ROLLING BACK COSTS YOU ────────────────────────────────────────────
--  The restored nx_report_contributors returns full_name to ANY authorised
--  caller, including the job's client and agency, WITHOUT consulting
--  nx_job_effective_identity_mode. That is the pre-existing behaviour and it is
--  an identity-disclosure hole: on a 'protected' engagement a buyer surface
--  wired to it would print the crew's real names. Nothing in apps/ calls it as
--  of this migration except reportVisits.ts, which tolerates the missing
--  `handle` / `identity_disclosed` keys (it defaults handle to 'NX-000000' and
--  identity_disclosed to false), so the rollback does not crash a page — but
--  DO NOT ship a buyer-facing contributor list on the rolled-back version.
--
--  The admin queue loses its visit_rollup column; reportReview.ts maps it by
--  name and lands on null, and the admin page renders no visit context. No
--  page breaks.
--
--  NO DATA IS MODIFIED. No report, visit, seal, template or publish flag is
--  touched — this migration never wrote a row and neither does its reversal.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.nx_report_visit_log(uuid);
-- Dropped after the log: the review queue below references the rollup.
DROP FUNCTION IF EXISTS public.nx_admin_report_review_queue(int, boolean);
DROP FUNCTION IF EXISTS public.nx_report_visit_rollup(uuid);
DROP FUNCTION IF EXISTS public.nx_report_contributors(uuid);

-- ── Restore nx_report_contributors exactly as 20260801378000 defined it ─────
CREATE FUNCTION public.nx_report_contributors(p_report_id uuid)
RETURNS TABLE (
  inspector_id uuid,
  full_name    text,
  team_role    text,
  is_lead      boolean,
  is_contracted boolean,
  item_count   int,
  capture_count int
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job uuid;
  v_rep RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.job_id, r.inspector_id INTO v_rep
    FROM public.inspection_reports r WHERE r.id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found' USING errcode = 'P0002';
  END IF;
  v_job := v_rep.job_id;

  IF NOT (
    public.nx_is_admin()
    OR public.nx_is_active_job_team_member(v_job, v_uid)
    OR EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = v_job
                  AND (v_uid = j.client_id OR v_uid = j.agency_id
                       OR v_uid = j.contractor_id))
  ) THEN
    RAISE EXCEPTION 'not authorized for this report' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH item_counts AS (
    -- NULL inspector_id means the report's own inspector (legacy semantics).
    SELECT COALESCE(i.inspector_id, v_rep.inspector_id) AS iid, count(*)::int AS n
      FROM public.inspection_items i
     WHERE i.report_id = p_report_id
     GROUP BY 1
  ), capture_counts AS (
    SELECT c.inspector_id AS iid, count(*)::int AS n
      FROM public.inspection_captures c
     WHERE c.job_id = v_job AND c.inspector_id IS NOT NULL
     GROUP BY 1
  ), everyone AS (
    SELECT iid FROM item_counts
    UNION
    SELECT iid FROM capture_counts
    UNION
    SELECT v_rep.inspector_id
  )
  SELECT e.iid, p.full_name, ji.role, COALESCE(ji.is_lead, false),
         (e.iid IS NOT DISTINCT FROM j.contractor_id),
         COALESCE(ic.n, 0), COALESCE(cc.n, 0)
    FROM everyone e
    LEFT JOIN public.profiles p  ON p.id = e.iid
    LEFT JOIN public.jobs j      ON j.id = v_job
    LEFT JOIN public.job_inspectors ji
           ON ji.job_id = v_job AND ji.inspector_id = e.iid
          AND ji.status IN ('assigned','active')
    LEFT JOIN item_counts    ic ON ic.iid = e.iid
    LEFT JOIN capture_counts cc ON cc.iid = e.iid
   WHERE e.iid IS NOT NULL
   ORDER BY COALESCE(ji.is_lead, false) DESC, COALESCE(ic.n,0) + COALESCE(cc.n,0) DESC;
END $fn$;

ALTER FUNCTION public.nx_report_contributors(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_report_contributors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_report_contributors(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_report_contributors(uuid) IS
  'Who contributed to a report, DERIVED from existing inspection_items and inspection_captures rather than a new contributions table. NULL item.inspector_id counts towards the report''s own inspector, preserving legacy meaning. Returns no pricing column.';

-- ── Restore nx_admin_report_review_queue as 20260801364000 defined it ───────
CREATE FUNCTION public.nx_admin_report_review_queue(
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

DO $verify$
BEGIN
  IF to_regprocedure('public.nx_report_visit_rollup(uuid)') IS NOT NULL
     OR to_regprocedure('public.nx_report_visit_log(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a report visit reader survived';
  END IF;
  IF to_regprocedure('public.nx_report_contributors(uuid)') IS NULL
     OR to_regprocedure('public.nx_admin_report_review_queue(int,boolean)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a replaced function was not restored — earlier phases would be broken';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.parameters
              WHERE specific_schema='public'
                AND parameter_name = 'visit_rollup'
                AND specific_name LIKE 'nx_admin_report_review_queue%') THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the review queue still carries visit context';
  END IF;

  -- Everything earlier phases own must be untouched.
  IF to_regprocedure('public.nx_job_visits(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: the canonical visit reader was disturbed';
  END IF;
  IF to_regprocedure('public.approve_inspection_report(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.nx_admin_review_inspection_report(uuid,text,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: a report review / publish path was disturbed';
  END IF;
  IF to_regclass('public.report_templates') IS NULL
     OR to_regclass('public.pi_report_seals') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ERROR: report templates or seals were disturbed';
  END IF;

  RAISE NOTICE 'rollback complete: visit context removed from reporting; contributor identity gate REMOVED — do not expose a buyer contributor list on this version.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
