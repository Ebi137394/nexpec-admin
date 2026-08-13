-- ════════════════════════════════════════════════════════════════════════════
--  20260801468000_programs.sql
--
--  Phase 6 — Programs. The grouping tier above projects.
--
--  ── WHAT ALREADY EXISTS, AND IS REUSED ─────────────────────────────────────
--  public.projects (baseline:24154) is already organization-scoped with a
--  budget/spent pair and a status lifecycle, and public.jobs already carries
--  project_id. So the hierarchy is jobs -> projects -> (missing) -> org.
--  CAPABILITY-RECONCILIATION.md:250 records the gap as exactly that: "no
--  programs table (projects exists)".
--
--  This adds the missing tier and NOTHING else. No parallel project model, no
--  second budget system, no duplicate membership table — a program is a named,
--  org-owned bucket of existing projects with its own rollup.
--
--  ── ROLLUP IS DERIVED, NOT STORED ──────────────────────────────────────────
--  programs carry a budget, but spend is NOT duplicated onto the program row.
--  projects.spent is the existing source of truth and a stored program total
--  would be a second one that drifts the first time a project is reassigned.
--  nx_program_rollup() sums the children on read.
--
--  ── PRIVACY ────────────────────────────────────────────────────────────────
--  Programs are a BUYER-side planning object. They carry no inspector payout,
--  no platform spread, and no per-job commercial detail — the rollup exposes
--  only client-side budget figures the org already sees on its own projects.
--  RLS admits the owning organization's members and admins; nobody else.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── org membership predicate ───────────────────────────────────────────────
--  profiles.organization_id is the canonical membership link — there is no
--  organization_members table; get_organization_members(uuid) (baseline:11112)
--  reads profiles too. This wraps that one fact so the policies below and the
--  rollup cannot drift apart, and so a future membership model has one place to
--  change rather than four policies.
CREATE OR REPLACE FUNCTION public.nx_is_org_member(p_org_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_org_id IS NOT NULL
     AND p_uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.id = p_uid AND pr.organization_id = p_org_id);
$$;

ALTER FUNCTION public.nx_is_org_member(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_org_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_org_member(uuid, uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.programs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  code             text,
  description      text,
  status           text NOT NULL DEFAULT 'active',
  budget           numeric(12,2) NOT NULL DEFAULT 0,
  start_date       date,
  end_date         date,
  created_by       uuid,
  created_at       timestamp with time zone NOT NULL DEFAULT now(),
  updated_at       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT programs_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT programs_budget_nonneg  CHECK (budget >= 0),
  -- mirrors projects_status_check so the two tiers share one vocabulary
  CONSTRAINT programs_status_check CHECK (
    status = ANY (ARRAY['active','pending','completed','archived'])),
  CONSTRAINT programs_dates_ordered CHECK (
    start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT programs_code_unique_per_org UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS programs_org_idx ON public.programs (organization_id);

COMMENT ON TABLE public.programs IS
  'Grouping tier above projects: jobs -> projects -> programs -> organization. A program '
  'is a named, org-owned bucket of EXISTING projects — it introduces no parallel project '
  'model and no second budget system. Spend is never stored here; projects.spent remains '
  'the single source of truth and nx_program_rollup() sums it on read. Buyer-side planning '
  'only: no inspector payout, no platform spread.';

-- ─── the link: an existing project may belong to one program ────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_program_idx ON public.projects (program_id);

COMMENT ON COLUMN public.projects.program_id IS
  'Optional parent program. ON DELETE SET NULL: removing a program must never cascade into '
  'deleting real project and job history.';

-- ─── a program and its projects must belong to the same organization ────────
CREATE OR REPLACE FUNCTION public.nx_guard_project_program_same_org()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_prog_org uuid;
BEGIN
  IF NEW.program_id IS NULL THEN RETURN NEW; END IF;

  SELECT organization_id INTO v_prog_org FROM public.programs WHERE id = NEW.program_id;
  IF v_prog_org IS NULL THEN
    RAISE EXCEPTION 'PROGRAM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_prog_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION
      'PROGRAM_ORG_MISMATCH: a project cannot join a program owned by a different organization'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_guard_project_program_same_org() OWNER TO postgres;

-- INSERT and UPDATE both. A row must not be able to be BORN cross-org — the
-- lesson from 20260801462000, where UPDATE-only guards left the INSERT path open.
DROP TRIGGER IF EXISTS trg_projects_program_same_org ON public.projects;
CREATE TRIGGER trg_projects_program_same_org
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.nx_guard_project_program_same_org();

-- ─── derived rollup ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_program_rollup(p_program_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_org uuid; v_budget numeric(12,2); r record;
BEGIN
  SELECT organization_id, budget INTO v_org, v_budget
    FROM public.programs WHERE id = p_program_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'PROGRAM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Authorization mirrors the RLS policy rather than restating a new rule.
  IF NOT (public.nx_is_admin() OR public.nx_is_org_member(v_org, auth.uid())) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int                                   AS project_count,
         COALESCE(sum(p.budget), 0)::numeric(14,2)       AS projects_budget,
         COALESCE(sum(p.spent), 0)::numeric(14,2)        AS projects_spent,
         count(*) FILTER (WHERE p.status = 'active')::int  AS active_projects,
         count(*) FILTER (WHERE p.status = 'completed')::int AS completed_projects
    INTO r
    FROM public.projects p
   WHERE p.program_id = p_program_id;

  RETURN jsonb_build_object(
    'program_id',         p_program_id,
    'program_budget',     v_budget,
    'project_count',      r.project_count,
    'projects_budget',    r.projects_budget,
    'projects_spent',     r.projects_spent,
    'budget_remaining',   v_budget - r.projects_spent,
    'active_projects',    r.active_projects,
    'completed_projects', r.completed_projects);
END $fn$;

ALTER FUNCTION public.nx_program_rollup(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_program_rollup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_program_rollup(uuid) TO authenticated, service_role;

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS programs_admin_all ON public.programs;
CREATE POLICY programs_admin_all ON public.programs
  FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS programs_org_read ON public.programs;
CREATE POLICY programs_org_read ON public.programs
  FOR SELECT USING (public.nx_is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS programs_org_write ON public.programs;
CREATE POLICY programs_org_write ON public.programs
  FOR ALL USING (public.nx_is_org_member(organization_id, auth.uid()))
  WITH CHECK (public.nx_is_org_member(organization_id, auth.uid()));

REVOKE ALL ON TABLE public.programs FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.programs TO authenticated;
GRANT ALL ON TABLE public.programs TO service_role;

-- ─── Selftest ───────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname='public' AND tablename='programs' AND rowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST: programs has RLS disabled';
  END IF;

  IF has_table_privilege('anon','public.programs','SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon can read programs';
  END IF;

  -- the cross-org guard must cover INSERT, not only UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_projects_program_same_org'
       AND NOT tgisinternal AND (tgtype & 4) <> 0) THEN
    RAISE EXCEPTION
      'SELFTEST: trg_projects_program_same_org does not fire on INSERT — a project could be BORN in another org''s program';
  END IF;

  -- spend must NOT be duplicated onto the program row
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='programs'
                AND column_name IN ('spent','actual_spend','total_spent')) THEN
    RAISE EXCEPTION
      'SELFTEST: programs stores a spend column — projects.spent is the single source of truth and a second one would drift';
  END IF;

  -- and no commercial leakage columns
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='programs'
                AND column_name ~* 'payout|spread|margin') THEN
    RAISE EXCEPTION 'SELFTEST: programs carries a payout/spread/margin column';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
