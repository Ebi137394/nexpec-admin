-- ════════════════════════════════════════════════════════════════════════════
--  20260801378000_team_evidence_and_report_contribution.sql
--
--  MULTI-INSPECTOR, part 2 — evidence attribution and report contribution.
--
--  ── THE CONCRETE GAP ───────────────────────────────────────────────────────
--  20260801376000 gave a job a team, but a team member still could not DO
--  anything. The live capture policy is:
--      captures_insert_inspector_self …
--        WITH CHECK (inspector_id = auth.uid()
--                    AND EXISTS (SELECT 1 FROM jobs j
--                                 WHERE j.id = job_id
--                                   AND j.contractor_id = auth.uid()))
--  Only the CONTRACTED inspector may capture evidence. A welding specialist
--  added to the team is authorised for nothing. Likewise captures_read_parties
--  is keyed to client/agency/contractor, so teammates cannot see each other's
--  evidence.
--
--  And inspection_items — the structured pass/fail record — carries no
--  inspector column at all, so with several people working one job there is no
--  way to say who recorded which result.
--
--  ── WHAT THIS DOES ─────────────────────────────────────────────────────────
--  1. inspection_items.inspector_id — additive, nullable. NULL means "the
--     report's inspector", which is exactly the pre-existing meaning, so no
--     backfill is needed and every existing row keeps its current semantics.
--  2. Extends the capture policies with an ADDITIONAL permissive clause for
--     active team members. The contractor's access is untouched — the new
--     policies are separate objects, OR-ed by PostgreSQL, so nothing that works
--     today can stop working.
--  3. nx_report_contributors() — who actually contributed to a report, derived
--     from the evidence and items themselves rather than a new table.
--
--  ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
--   • It does not weaken the RESTRICTIVE policy from 20260801288000. That one
--     AND-s over everything and requires an ACTIVE CONTRACT for an author to
--     UPDATE their own capture; it still applies, so replacement isolation
--     survives. Team members get INSERT and SELECT, not a bypass.
--   • It does not touch jobs.contractor_id, settlement, or any money surface.
--   • It creates no second reporting system. Contribution is derived from the
--     existing inspection_captures / inspection_items rows.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Attribute a structured item to the inspector who recorded it ─────────
ALTER TABLE public.inspection_items
  ADD COLUMN IF NOT EXISTS inspector_id uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS inspection_items_inspector_idx
  ON public.inspection_items (inspector_id)
  WHERE inspector_id IS NOT NULL;

COMMENT ON COLUMN public.inspection_items.inspector_id IS
  'Which team member recorded this result. NULL means the report''s own inspector — the pre-existing meaning — so legacy rows need no backfill and keep their semantics exactly.';

-- ── 2) Let active team members capture and read evidence ────────────────────
--  Separate ADDITIONAL policies. PostgreSQL OR-s permissive policies, so the
--  existing contractor-only rules keep working untouched; these only widen.

CREATE OR REPLACE FUNCTION public.nx_is_active_job_team_member(
  p_job_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.job_inspectors ji
     WHERE ji.job_id = p_job_id
       AND ji.inspector_id = p_uid
       AND ji.status IN ('assigned', 'active'));
$fn$;

ALTER FUNCTION public.nx_is_active_job_team_member(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_active_job_team_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_active_job_team_member(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_is_active_job_team_member(uuid, uuid) IS
  'True when the user holds an active membership on the job team. Used by RLS to widen evidence access to team members WITHOUT altering the contractor rules that already exist.';

DROP POLICY IF EXISTS captures_insert_team_member ON public.inspection_captures;
CREATE POLICY captures_insert_team_member ON public.inspection_captures
  FOR INSERT TO authenticated
  WITH CHECK (
    inspector_id = auth.uid()
    AND public.nx_is_active_job_team_member(job_id, auth.uid())
  );

DROP POLICY IF EXISTS captures_read_team_member ON public.inspection_captures;
CREATE POLICY captures_read_team_member ON public.inspection_captures
  FOR SELECT TO authenticated
  USING (public.nx_is_active_job_team_member(job_id, auth.uid()));

-- Structured items follow the same rule, via the item's report.
ALTER TABLE public.inspection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inspection_items_team_read ON public.inspection_items;
CREATE POLICY inspection_items_team_read ON public.inspection_items
  FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.inspection_reports r
       JOIN public.jobs j ON j.id = r.job_id
       WHERE r.id = inspection_items.report_id
         AND (auth.uid() = j.client_id
              OR auth.uid() = j.agency_id
              OR auth.uid() = j.contractor_id
              OR public.nx_is_active_job_team_member(j.id, auth.uid())))
  );

DROP POLICY IF EXISTS inspection_items_team_write ON public.inspection_items;
CREATE POLICY inspection_items_team_write ON public.inspection_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.inspection_reports r
       JOIN public.jobs j ON j.id = r.job_id
       WHERE r.id = inspection_items.report_id
         AND (auth.uid() = j.contractor_id
              OR public.nx_is_active_job_team_member(j.id, auth.uid())))
  );

REVOKE ALL ON TABLE public.inspection_items FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.inspection_items TO authenticated;
GRANT ALL ON TABLE public.inspection_items TO service_role;

-- ── 3) Who contributed to this report ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_report_contributors(p_report_id uuid)
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

-- ── 4) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dcon text := pg_get_functiondef('public.nx_report_contributors(uuid)'::regprocedure);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_items'
                    AND column_name='inspector_id') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspection_items.inspector_id was not added';
  END IF;

  -- The pre-existing contractor policies MUST still exist — we widen, never replace.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='inspection_captures'
                  AND policyname='captures_insert_inspector_self') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the original contractor capture policy was removed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='inspection_captures'
                  AND policyname='captures_update_requires_active_inspector') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the RESTRICTIVE active-contract policy from 288000 is gone — replacement isolation would break';
  END IF;
  -- and the new team policies exist
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='inspection_captures'
                  AND policyname='captures_insert_team_member') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: team members still cannot capture evidence';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='inspection_items' AND rowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: RLS not enabled on inspection_items';
  END IF;

  -- MONEY-FREE
  IF dcon ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_report_contributors names a money surface';
  END IF;

  RAISE NOTICE 'team evidence + report contribution ready: contractor rules widened, not replaced.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
