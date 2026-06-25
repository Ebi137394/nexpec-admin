-- ════════════════════════════════════════════════════════════════════════════
--  20260801188000_team_jobs_rpc.sql   (Agency Team Workspaces — Set 2, list RPC)
--
--  nx_team_jobs() — the enumeration the team Missions view needs: every job owned
--  by an org the caller belongs to (owner = agency_id|client_id is a teammate).
--
--  Why an RPC and not a raw table read: the jobs RLS lets a teammate SEE these
--  rows, but a bare `select * from jobs` would also return every open-marketplace
--  job (the public browse policy) and the full row incl. price columns. This RPC
--  returns a PRICE-FREE projection of ONLY the org's jobs — keeping the team list
--  clean and price-blind. Filtered by the org-membership set (index-friendly),
--  not a per-row function scan.
--
--  Idempotent. ADDITIVE. Read-only (STABLE).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.nx_team_jobs()
RETURNS TABLE (
  id             uuid,
  title          text,
  status         text,
  domain         text,
  location_city  text,
  scheduled_date timestamptz,
  created_at     timestamptz,
  contractor_id  uuid,
  can_manage     boolean
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT
    j.id, j.title, j.status, j.domain::text, j.location_city,
    j.scheduled_date, j.created_at, j.contractor_id,
    public.nx_can_team_manage_job(j.id) AS can_manage
  FROM public.jobs j
  WHERE COALESCE(j.agency_id, j.client_id) IN (
    SELECT om.user_id
    FROM public.org_members om
    WHERE om.org_id IN (
      SELECT om2.org_id FROM public.org_members om2 WHERE om2.user_id = auth.uid()
    )
  )
  ORDER BY j.created_at DESC NULLS LAST;
$fn$;

REVOKE ALL    ON FUNCTION public.nx_team_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_team_jobs() TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_team_jobs() IS
  'Price-free projection of jobs owned by an org the caller belongs to (team Missions list). can_manage = caller is a non-viewer in the owner org.';

DO $test$
BEGIN
  IF to_regprocedure('public.nx_team_jobs()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: nx_team_jobs missing';
  END IF;
  IF has_function_privilege('anon','public.nx_team_jobs()','EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: anon must NOT have nx_team_jobs';
  END IF;
  -- price-blind: the projection must not leak any *_cents column
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['client_price_cents','inspector_payout_cents','platform_spread_cents','budget_cents']) c
    WHERE pg_get_functiondef(to_regprocedure('public.nx_team_jobs()')) LIKE '%'||c||'%'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: nx_team_jobs leaks a price column';
  END IF;
  RAISE NOTICE 'nx_team_jobs OK (org-scoped, price-free).';
END $test$;

COMMIT;
