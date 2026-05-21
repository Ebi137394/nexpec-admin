-- ════════════════════════════════════════════════════════════════════════════
--  20260527120000_department_client_authorization.sql
--  Phase 6 / Sprint 5 (Path A) — Enterprise self-service + Super-Admin oversight.
--
--  WHY
--  ───
--  The initial department RPCs (20260526120000) restricted ALL mutations
--  to super_admin. Path A widens the door so enterprise admins (org_members
--  with role in {'owner', 'procurement_admin'}) can manage their OWN org's
--  tree, while super_admin retains override + audit on every change.
--
--  WHAT THIS LANDS
--  ───────────────
--    public.can_manage_org_structure(org_id, user_id) → bool
--      Single source of truth for "can this user mutate this org's tree?".
--      super_admin OR elevated org_member.
--
--    create_department / rename_department / move_department / delete_department
--    assign_member_to_department / unassign_member_from_department
--      CREATE OR REPLACED to call can_manage_org_structure() instead of the
--      strict super_admin gate. Each RPC now:
--        · resolves the affected org_id
--        · checks authorization through the helper
--        · INSERTs an explicit audit_events row (baseline schema) so the
--          trail is captured regardless of whether session-level
--          audit_set_intent triggers exist for these tables.
--
--    public.fetch_department_audit_trail(org_id, limit) → setof audit_events
--      Filtered read of audit_events scoped to a single org's departments
--      + member assignments. Super-admin only. Powers the admin audit panel.
--
--  AUDIT SHAPE (per baseline columns)
--  ──────────────────────────────────
--    event_type     → 'department.created' | '.renamed' | '.moved' |
--                     '.deleted' | 'department_member.assigned' | '.unassigned'
--    actor_id       → auth.uid()
--    actor_role     → profiles.role of the actor
--    actor_label    → profiles.full_name or email
--    subject_table  → 'departments' | 'department_members'
--    subject_id     → department id (or assignment id for member ops)
--    summary        → human-readable line
--    delta          → jsonb with old/new state where applicable
--    correlation_id → fresh uuid per call (groups related rows)
--    metadata       → { org_id, ... } for fast lookup
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  Helper: can_manage_org_structure
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_org_structure(
  p_org_id  uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND role = 'super_admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id  = p_org_id
        AND user_id = p_user_id
        AND role IN ('owner', 'procurement_admin')
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_org_structure(uuid, uuid) TO authenticated;

-- Small private helper to fetch an actor's role + label for audit rows.
CREATE OR REPLACE FUNCTION public._dept_actor_profile(p_user_id uuid)
RETURNS TABLE (actor_role text, actor_label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(p.role, 'authenticated') AS actor_role,
    COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, 'Unknown') AS actor_label
  FROM public.profiles p
  WHERE p.id = p_user_id
  LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: create_department  (REPLACED)
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
  v_actor_label text;
  v_name        text;
  v_cost        text;
  v_id          uuid;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_manage_org_structure(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to manage this organization''s structure'
      USING ERRCODE = '42501';
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

  INSERT INTO public.departments (org_id, parent_department_id, name, cost_center)
    VALUES (p_org_id, p_parent_department_id, v_name, v_cost)
    RETURNING id INTO v_id;

  -- Audit -----------------------------------------------------------
  SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
    FROM public._dept_actor_profile(v_actor);

  INSERT INTO public.audit_events (
    event_type, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, delta, metadata, correlation_id
  ) VALUES (
    'department.created',
    v_actor,
    v_actor_role,
    v_actor_label,
    'departments',
    v_id,
    format('Department %L created', v_name),
    jsonb_build_object(
      'name', v_name,
      'cost_center', v_cost,
      'parent_department_id', p_parent_department_id
    ),
    jsonb_build_object('org_id', p_org_id),
    v_correlation
  );

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
--  RPC: rename_department  (REPLACED)
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
  v_actor_label text;
  v_org_id      uuid;
  v_old_name    text;
  v_old_cost    text;
  v_name        text;
  v_cost        text;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT org_id, name, cost_center INTO v_org_id, v_old_name, v_old_cost
    FROM public.departments WHERE id = p_department_id FOR UPDATE;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_org_structure(v_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to manage this organization''s structure'
      USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(TRIM(COALESCE(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Department name is required' USING ERRCODE = '22000';
  END IF;

  v_cost := NULLIF(TRIM(COALESCE(p_cost_center, '')), '');

  UPDATE public.departments
     SET name = v_name,
         cost_center = v_cost
   WHERE id = p_department_id;

  SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
    FROM public._dept_actor_profile(v_actor);

  INSERT INTO public.audit_events (
    event_type, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, delta, metadata, correlation_id
  ) VALUES (
    'department.renamed',
    v_actor,
    v_actor_role,
    v_actor_label,
    'departments',
    p_department_id,
    format('Department renamed %L → %L', v_old_name, v_name),
    jsonb_build_object(
      'from', jsonb_build_object('name', v_old_name, 'cost_center', v_old_cost),
      'to',   jsonb_build_object('name', v_name,     'cost_center', v_cost)
    ),
    jsonb_build_object('org_id', v_org_id),
    v_correlation
  );

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
--  RPC: move_department  (REPLACED — cycle guard unchanged)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.move_department(
  p_department_id uuid,
  p_new_parent_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_actor_label text;
  v_org_id      uuid;
  v_old_parent  uuid;
  v_new_parent_org uuid;
  v_correlation uuid := gen_random_uuid();
  v_creates_cycle boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT org_id, parent_department_id INTO v_org_id, v_old_parent
    FROM public.departments WHERE id = p_department_id FOR UPDATE;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_org_structure(v_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to manage this organization''s structure'
      USING ERRCODE = '42501';
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

    WITH RECURSIVE ancestors AS (
      SELECT id, parent_department_id FROM public.departments WHERE id = p_new_parent_id
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

  UPDATE public.departments
     SET parent_department_id = p_new_parent_id
   WHERE id = p_department_id;

  SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
    FROM public._dept_actor_profile(v_actor);

  INSERT INTO public.audit_events (
    event_type, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, delta, metadata, correlation_id
  ) VALUES (
    'department.moved',
    v_actor,
    v_actor_role,
    v_actor_label,
    'departments',
    p_department_id,
    'Department re-parented',
    jsonb_build_object(
      'from_parent_id', v_old_parent,
      'to_parent_id',   p_new_parent_id
    ),
    jsonb_build_object('org_id', v_org_id),
    v_correlation
  );

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
--  RPC: delete_department  (REPLACED)
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
  v_actor_label text;
  v_org_id      uuid;
  v_descendant_count int;
  v_member_count     int;
  v_name             text;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT org_id, name INTO v_org_id, v_name
    FROM public.departments WHERE id = p_department_id FOR UPDATE;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_org_structure(v_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to manage this organization''s structure'
      USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Department has % descendants and % members. Pass p_force=true to delete.',
      v_descendant_count, v_member_count
      USING ERRCODE = '22000';
  END IF;

  DELETE FROM public.departments WHERE id = p_department_id;

  SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
    FROM public._dept_actor_profile(v_actor);

  INSERT INTO public.audit_events (
    event_type, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, delta, metadata, correlation_id, severity
  ) VALUES (
    'department.deleted',
    v_actor,
    v_actor_role,
    v_actor_label,
    'departments',
    p_department_id,
    format('Department %L deleted (cascade: %s descendants, %s member assignments)',
      v_name, v_descendant_count, v_member_count),
    jsonb_build_object(
      'name', v_name,
      'descendants_removed', v_descendant_count,
      'members_orphaned', v_member_count
    ),
    jsonb_build_object('org_id', v_org_id),
    v_correlation,
    CASE WHEN v_descendant_count > 0 OR v_member_count > 0 THEN 'warning' ELSE 'info' END
  );

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
--  RPC: assign_member_to_department  (REPLACED)
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
  v_actor_label text;
  v_org_id      uuid;
  v_assignment_id uuid;
  v_user_label  text;
  v_dept_name   text;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT org_id, name INTO v_org_id, v_dept_name
    FROM public.departments WHERE id = p_department_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_org_structure(v_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to manage this organization''s structure'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = v_org_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'User is not a member of this organization' USING ERRCODE = '22000';
  END IF;

  INSERT INTO public.department_members (department_id, user_id)
    VALUES (p_department_id, p_user_id)
    ON CONFLICT (department_id, user_id) DO UPDATE
      SET created_at = public.department_members.created_at
    RETURNING id INTO v_assignment_id;

  SELECT COALESCE(NULLIF(TRIM(full_name), ''), email, 'Unknown') INTO v_user_label
    FROM public.profiles WHERE id = p_user_id;

  SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
    FROM public._dept_actor_profile(v_actor);

  INSERT INTO public.audit_events (
    event_type, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, delta, metadata, correlation_id
  ) VALUES (
    'department_member.assigned',
    v_actor,
    v_actor_role,
    v_actor_label,
    'department_members',
    v_assignment_id,
    format('%s assigned to %L', COALESCE(v_user_label, 'User'), v_dept_name),
    jsonb_build_object(
      'department_id', p_department_id,
      'department_name', v_dept_name,
      'user_id', p_user_id,
      'user_label', v_user_label
    ),
    jsonb_build_object('org_id', v_org_id),
    v_correlation
  );

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
--  RPC: unassign_member_from_department  (REPLACED)
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
  v_actor_label text;
  v_org_id      uuid;
  v_dept_name   text;
  v_user_label  text;
  v_correlation uuid := gen_random_uuid();
  v_removed     int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT org_id, name INTO v_org_id, v_dept_name
    FROM public.departments WHERE id = p_department_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_org_structure(v_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to manage this organization''s structure'
      USING ERRCODE = '42501';
  END IF;

  WITH del AS (
    DELETE FROM public.department_members
    WHERE department_id = p_department_id AND user_id = p_user_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_removed FROM del;

  IF v_removed > 0 THEN
    SELECT COALESCE(NULLIF(TRIM(full_name), ''), email, 'Unknown') INTO v_user_label
      FROM public.profiles WHERE id = p_user_id;

    SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
      FROM public._dept_actor_profile(v_actor);

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id
    ) VALUES (
      'department_member.unassigned',
      v_actor,
      v_actor_role,
      v_actor_label,
      'department_members',
      p_department_id,
      format('%s unassigned from %L', COALESCE(v_user_label, 'User'), v_dept_name),
      jsonb_build_object(
        'department_id', p_department_id,
        'department_name', v_dept_name,
        'user_id', p_user_id,
        'user_label', v_user_label
      ),
      jsonb_build_object('org_id', v_org_id),
      v_correlation
    );
  END IF;

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

-- ─────────────────────────────────────────────────────────────────────
--  RPC: fetch_department_audit_trail
--  Super-admin-only read of the audit trail filtered to one org's
--  department + member events. The client never calls this — the
--  admin structure page does.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_department_audit_trail(
  p_org_id uuid,
  p_limit  int DEFAULT 50
) RETURNS TABLE (
  id              uuid,
  created_at      timestamptz,
  event_type      text,
  severity        text,
  actor_id        uuid,
  actor_role      text,
  actor_label     text,
  subject_table   text,
  subject_id      uuid,
  summary         text,
  delta           jsonb,
  metadata        jsonb,
  correlation_id  uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_limit       int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can read the department audit trail'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT a.id, a.created_at, a.event_type, a.severity,
           a.actor_id, a.actor_role, a.actor_label,
           a.subject_table, a.subject_id,
           a.summary, a.delta, a.metadata, a.correlation_id
      FROM public.audit_events a
     WHERE a.event_type IN (
             'department.created',
             'department.renamed',
             'department.moved',
             'department.deleted',
             'department_member.assigned',
             'department_member.unassigned'
           )
       AND a.metadata->>'org_id' = p_org_id::text
     ORDER BY a.created_at DESC
     LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_department_audit_trail(uuid, int) TO authenticated;

COMMIT;
