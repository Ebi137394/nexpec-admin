-- ════════════════════════════════════════════════════════════════════════════
--  20260526120000_enterprise_department_hierarchy.sql
--  Phase 6 / Sprint 5 — Enterprise org-chart primitives.
--
--  WHAT THIS LANDS
--  ───────────────
--    public.departments             — nested org-chart node (self-ref tree)
--    public.department_members      — user ↔ department assignment
--    public.fetch_department_tree   — RPC: hierarchical roll-up with counts
--    public.create_department       — RPC: SECURITY DEFINER mutation
--    public.rename_department       — RPC: SECURITY DEFINER mutation
--    public.move_department         — RPC: re-parent (cycle-safe)
--    public.delete_department       — RPC: cascade-aware delete
--    public.assign_member_to_department    — RPC: idempotent assignment
--    public.unassign_member_from_department — RPC: idempotent removal
--
--  RLS posture
--    departments / department_members:
--      SELECT — super_admin OR member of the parent org (read-only via RLS)
--      INSERT/UPDATE/DELETE — none. All writes go through SECURITY DEFINER
--      RPCs that enforce super_admin and audit-stamp the action, mirroring
--      org_members mutation posture from 20260523130000.
--
--  Cost center
--    `departments.cost_center` is a free-form short code (e.g. "CC-1042").
--    Indexed for joins from the budget module so spend can roll up by
--    department in a later sprint without schema churn.
--
--  Cycle prevention
--    `move_department` walks the would-be ancestor chain and refuses any
--    re-parenting that would create a loop. A `departments_no_self_parent`
--    CHECK constraint blocks the trivial case at the table level.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── departments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL    DEFAULT now(),
  updated_at           timestamptz NOT NULL    DEFAULT now(),

  org_id               uuid        NOT NULL    REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_department_id uuid                    REFERENCES public.departments(id)   ON DELETE CASCADE,

  name                 text        NOT NULL,
  cost_center          text,

  CONSTRAINT departments_no_self_parent CHECK (parent_department_id IS NULL OR parent_department_id <> id),
  CONSTRAINT departments_name_not_blank CHECK (length(trim(name)) > 0)
);

COMMENT ON TABLE public.departments IS
  'Enterprise org-chart nodes. Self-referencing tree scoped to an organization. Mutations are admin-only via SECURITY DEFINER RPCs.';

COMMENT ON COLUMN public.departments.cost_center IS
  'Free-form cost-center / budget code (e.g. "CC-1042"). Future budget roll-ups join on this column.';

CREATE INDEX IF NOT EXISTS departments_org_idx
  ON public.departments (org_id, parent_department_id NULLS FIRST, name);

CREATE INDEX IF NOT EXISTS departments_parent_idx
  ON public.departments (parent_department_id);

CREATE INDEX IF NOT EXISTS departments_cost_center_idx
  ON public.departments (org_id, cost_center)
  WHERE cost_center IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS departments_unique_name_under_parent
  ON public.departments (
    org_id,
    COALESCE(parent_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

-- updated_at trigger ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_departments_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_departments_set_updated_at ON public.departments;
CREATE TRIGGER tg_departments_set_updated_at
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.tg_departments_set_updated_at();

-- ── department_members ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.department_members (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL    DEFAULT now(),

  department_id uuid        NOT NULL    REFERENCES public.departments(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL    REFERENCES public.profiles(id)    ON DELETE CASCADE,

  UNIQUE (department_id, user_id)
);

COMMENT ON TABLE public.department_members IS
  'User assignments to departments. A user may belong to multiple departments under the same org.';

CREATE INDEX IF NOT EXISTS department_members_department_idx
  ON public.department_members (department_id);

CREATE INDEX IF NOT EXISTS department_members_user_idx
  ON public.department_members (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.departments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_select_admin   ON public.departments;
DROP POLICY IF EXISTS departments_select_members ON public.departments;

CREATE POLICY departments_select_admin
  ON public.departments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  ));

CREATE POLICY departments_select_members
  ON public.departments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = departments.org_id AND m.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS department_members_select_admin   ON public.department_members;
DROP POLICY IF EXISTS department_members_select_members ON public.department_members;

CREATE POLICY department_members_select_admin
  ON public.department_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  ));

CREATE POLICY department_members_select_members
  ON public.department_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.departments d
      JOIN public.org_members m ON m.org_id = d.org_id
      WHERE d.id = department_members.department_id
        AND m.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────
--  RPC: fetch_department_tree
--  Returns one row per department in the org with a precomputed depth
--  and a member_count roll-up (direct members only — descendant
--  roll-ups are computed client-side from the returned tree to keep
--  the RPC fast and stable for large trees).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_department_tree(p_org_id uuid)
RETURNS TABLE (
  id                   uuid,
  org_id               uuid,
  parent_department_id uuid,
  name                 text,
  cost_center          text,
  depth                int,
  member_count         int,
  created_at           timestamptz,
  updated_at           timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT d.id, d.org_id, d.parent_department_id, d.name, d.cost_center,
           0 AS depth, d.created_at, d.updated_at
      FROM public.departments d
     WHERE d.org_id = p_org_id
       AND d.parent_department_id IS NULL
    UNION ALL
    SELECT d.id, d.org_id, d.parent_department_id, d.name, d.cost_center,
           t.depth + 1, d.created_at, d.updated_at
      FROM public.departments d
      JOIN tree t ON t.id = d.parent_department_id
  ),
  counts AS (
    SELECT dm.department_id, count(*)::int AS n
      FROM public.department_members dm
     GROUP BY dm.department_id
  )
  SELECT t.id, t.org_id, t.parent_department_id, t.name, t.cost_center,
         t.depth,
         COALESCE(c.n, 0) AS member_count,
         t.created_at, t.updated_at
    FROM tree t
    LEFT JOIN counts c ON c.department_id = t.id
   ORDER BY t.depth, lower(t.name);
$$;

GRANT EXECUTE ON FUNCTION public.fetch_department_tree(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: create_department
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_department(
  p_org_id               uuid,
  p_parent_department_id uuid,
  p_name                 text,
  p_cost_center          text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_name        text;
  v_cost        text;
  v_id          uuid;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can create departments' USING ERRCODE = '42501';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required' USING ERRCODE = '22000';
  END IF;

  v_name := NULLIF(TRIM(COALESCE(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Department name is required' USING ERRCODE = '22000';
  END IF;

  v_cost := NULLIF(TRIM(COALESCE(p_cost_center, '')), '');

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_parent_department_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.departments
      WHERE id = p_parent_department_id AND org_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'Parent department not found in this organization' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Department created — ' || v_name);

  INSERT INTO public.departments (org_id, parent_department_id, name, cost_center)
    VALUES (p_org_id, p_parent_department_id, v_name, v_cost)
    RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'department_id', v_id,
    'org_id', p_org_id,
    'parent_department_id', p_parent_department_id,
    'name', v_name,
    'cost_center', v_cost,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_department(uuid, uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: rename_department
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rename_department(
  p_department_id uuid,
  p_name          text,
  p_cost_center   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_old_name    text;
  v_name        text;
  v_cost        text;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can rename departments' USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(TRIM(COALESCE(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Department name is required' USING ERRCODE = '22000';
  END IF;

  v_cost := NULLIF(TRIM(COALESCE(p_cost_center, '')), '');

  SELECT name INTO v_old_name FROM public.departments WHERE id = p_department_id FOR UPDATE;
  IF v_old_name IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Department renamed — "' || v_old_name || '" → "' || v_name || '"');

  UPDATE public.departments
     SET name = v_name,
         cost_center = v_cost
   WHERE id = p_department_id;

  RETURN jsonb_build_object(
    'ok', true,
    'department_id', p_department_id,
    'from_name', v_old_name,
    'to_name', v_name,
    'cost_center', v_cost,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_department(uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: move_department  (re-parent, cycle-safe)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.move_department(
  p_department_id        uuid,
  p_new_parent_id        uuid  -- NULL = promote to root
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_org_id      uuid;
  v_new_parent_org uuid;
  v_correlation uuid := gen_random_uuid();
  v_creates_cycle boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can move departments' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM public.departments WHERE id = p_department_id FOR UPDATE;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_new_parent_id IS NOT NULL THEN
    IF p_new_parent_id = p_department_id THEN
      RAISE EXCEPTION 'A department cannot be its own parent' USING ERRCODE = '22000';
    END IF;

    SELECT org_id INTO v_new_parent_org FROM public.departments WHERE id = p_new_parent_id;
    IF v_new_parent_org IS NULL THEN
      RAISE EXCEPTION 'New parent department not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_new_parent_org <> v_org_id THEN
      RAISE EXCEPTION 'New parent belongs to a different organization' USING ERRCODE = '22000';
    END IF;

    -- Cycle guard: ensure p_department_id is not an ancestor of p_new_parent_id.
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_department_id
        FROM public.departments
       WHERE id = p_new_parent_id
      UNION ALL
      SELECT d.id, d.parent_department_id
        FROM public.departments d
        JOIN ancestors a ON a.parent_department_id = d.id
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = p_department_id)
      INTO v_creates_cycle;

    IF v_creates_cycle THEN
      RAISE EXCEPTION 'Cannot move a department under one of its own descendants' USING ERRCODE = '22000';
    END IF;
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Department re-parented');

  UPDATE public.departments
     SET parent_department_id = p_new_parent_id
   WHERE id = p_department_id;

  RETURN jsonb_build_object(
    'ok', true,
    'department_id', p_department_id,
    'new_parent_id', p_new_parent_id,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_department(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: delete_department
--  Cascades children via FK ON DELETE CASCADE. Caller is expected to
--  confirm — the RPC does not require a reason since the cascade is
--  deterministic, but it does refuse if the department has members
--  unless `p_force` is true (admin must consciously orphan members).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_department(
  p_department_id uuid,
  p_force         boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_descendant_count int;
  v_member_count     int;
  v_name             text;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can delete departments' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM public.departments WHERE id = p_department_id FOR UPDATE;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  WITH RECURSIVE descendants AS (
    SELECT id FROM public.departments WHERE id = p_department_id
    UNION ALL
    SELECT d.id FROM public.departments d
      JOIN descendants dx ON dx.id = d.parent_department_id
  )
  SELECT
    (SELECT count(*) - 1 FROM descendants),
    (SELECT count(*) FROM public.department_members WHERE department_id IN (SELECT id FROM descendants))
  INTO v_descendant_count, v_member_count;

  IF (v_member_count > 0 OR v_descendant_count > 0) AND COALESCE(p_force, false) IS FALSE THEN
    RAISE EXCEPTION 'Department has % descendants and % members. Pass p_force=true to delete.', v_descendant_count, v_member_count
      USING ERRCODE = '22000';
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Department deleted — ' || v_name);

  DELETE FROM public.departments WHERE id = p_department_id;

  RETURN jsonb_build_object(
    'ok', true,
    'department_id', p_department_id,
    'descendants_removed', v_descendant_count,
    'members_orphaned', v_member_count,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_department(uuid, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: assign_member_to_department  (idempotent)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_member_to_department(
  p_department_id uuid,
  p_user_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_org_id      uuid;
  v_assignment_id uuid;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can assign department members' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM public.departments WHERE id = p_department_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  -- The user must already be a member of the parent org.
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = v_org_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'User is not a member of this organization' USING ERRCODE = '22000';
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Department member assigned');

  INSERT INTO public.department_members (department_id, user_id)
    VALUES (p_department_id, p_user_id)
    ON CONFLICT (department_id, user_id) DO UPDATE
      SET created_at = public.department_members.created_at  -- no-op, keeps RETURNING populated
    RETURNING id INTO v_assignment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'assignment_id', v_assignment_id,
    'department_id', p_department_id,
    'user_id', p_user_id,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_member_to_department(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: unassign_member_from_department  (idempotent)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unassign_member_from_department(
  p_department_id uuid,
  p_user_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_correlation uuid := gen_random_uuid();
  v_removed     int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can unassign department members' USING ERRCODE = '42501';
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Department member unassigned');

  WITH del AS (
    DELETE FROM public.department_members
    WHERE department_id = p_department_id AND user_id = p_user_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_removed FROM del;

  RETURN jsonb_build_object(
    'ok', true,
    'department_id', p_department_id,
    'user_id', p_user_id,
    'removed', v_removed,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unassign_member_from_department(uuid, uuid) TO authenticated;

COMMIT;
