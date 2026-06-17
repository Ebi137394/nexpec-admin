-- ════════════════════════════════════════════════════════════════════════════
--  20260531120000_active_org_switcher.sql
--  Phase 6 / Sprint 6 — Multi-org "active context" primitives.
--
--  PROBLEM
--  ───────
--  Procurement executives belong to multiple organizations. Before this
--  migration the app inferred their "active" org via an election rule
--  (elevated-role > enterprise > first-of-any). That works for a single
--  org but doesn't let users *explicitly* switch context — and inference
--  doesn't cross the web↔mobile boundary.
--
--  SOLUTION
--  ────────
--  Pin the active org on the user's profile and expose it via three RPCs.
--  Both web (Next.js) and mobile (Expo/RN) read and write the same DB
--  column, so the active context stays in sync across surfaces without
--  any client-side state synchronisation.
--
--  WHAT THIS LANDS
--  ───────────────
--    · profiles.active_org_id                — nullable FK, ON DELETE SET NULL
--    · set_active_org(p_org_id)              — validate membership + update
--    · clear_active_org()                    — null it out (orphan handling)
--    · fetch_my_org_memberships()            — rich rows for the switcher UI
--                                              (one round-trip; no per-org
--                                              hydration on the client)
--
--  Audit: set_active_org writes an `user.active_org.changed` event so
--  super-admin can see context-switching activity in /admin/audit if it
--  ever becomes relevant for compliance investigations.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  profiles.active_org_id
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_org_id uuid;

-- FK added separately so we can name it and re-attach idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'profiles_active_org_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_active_org_id_fkey
      FOREIGN KEY (active_org_id) REFERENCES public.organizations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.active_org_id IS
  'The user''s currently-selected organization context. Drives which org''s data is shown on /client/structure, /client/budget, /client/jobs/new, etc. NULL = use the election fallback (elevated-role > enterprise > first-of-any).';

CREATE INDEX IF NOT EXISTS profiles_active_org_idx
  ON public.profiles (active_org_id)
  WHERE active_org_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: set_active_org
--
--  Validates that the caller is still a member of p_org_id (active orgs
--  the user has been removed from must not silently succeed) and updates
--  profiles.active_org_id. Returns rich JSON so the client can update
--  optimistically without an extra read.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_active_org(
  p_org_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_actor_label text;
  v_org         record;
  v_member      record;
  v_old_org_id  uuid;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required (use clear_active_org() to unset)'
      USING ERRCODE = '22000';
  END IF;

  -- Org must exist and be active.
  SELECT id, name, slug, kind, is_active
    INTO v_org
    FROM public.organizations WHERE id = p_org_id;
  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_org.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Organization is inactive' USING ERRCODE = '42501';
  END IF;

  -- Caller must be a current member of the target org. Super-admin can
  -- also switch into any org (useful for support / impersonation flows).
  SELECT m.role::text AS role
    INTO v_member
    FROM public.org_members m
   WHERE m.org_id = p_org_id AND m.user_id = v_actor;

  IF v_member.role IS NULL THEN
    -- Allow super_admin even without a membership row.
    SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
    IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
      RAISE EXCEPTION 'You are not a member of this organization'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT active_org_id INTO v_old_org_id
    FROM public.profiles WHERE id = v_actor FOR UPDATE;

  UPDATE public.profiles
     SET active_org_id = p_org_id
   WHERE id = v_actor;

  -- Audit (best-effort: skip if audit_events isn't installed).
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, 'Unknown')
      INTO v_actor_label
      FROM public.profiles p WHERE p.id = v_actor;

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id
    ) VALUES (
      'user.active_org.changed',
      v_actor,
      COALESCE(v_actor_role, v_member.role, 'authenticated'),
      v_actor_label,
      'profiles',
      v_actor,
      format('Active org switched to %L', v_org.name),
      jsonb_build_object(
        'from_org_id', v_old_org_id,
        'to_org_id',   p_org_id,
        'to_org_name', v_org.name
      ),
      jsonb_build_object('org_id', p_org_id),
      v_correlation
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'active_org_id', p_org_id,
    'org_name',      v_org.name,
    'org_slug',      v_org.slug,
    'org_kind',      v_org.kind,
    'role',          v_member.role,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_active_org(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: clear_active_org
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clear_active_org()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  UPDATE public.profiles SET active_org_id = NULL WHERE id = v_actor;

  RETURN jsonb_build_object('ok', true, 'active_org_id', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_active_org() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: fetch_my_org_memberships
--
--  One-shot rich read used by the switcher UI. Returns every org the
--  caller belongs to with name, slug, kind, role, plus a boolean
--  is_active flag indicating which one is currently selected.
--
--  Sorted: active org first, then alphabetical by name. The UI is then
--  effectively zero-logic — it just maps.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_my_org_memberships()
RETURNS TABLE (
  org_id      uuid,
  org_name    text,
  org_slug    text,
  org_kind    text,
  org_logo_url text,
  is_active_org boolean,
  role        text,
  member_since timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_active     uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT active_org_id INTO v_active FROM public.profiles WHERE id = v_actor;

  RETURN QUERY
    SELECT
      o.id           AS org_id,
      o.name         AS org_name,
      o.slug         AS org_slug,
      o.kind         AS org_kind,
      o.logo_url     AS org_logo_url,
      (o.id = v_active) AS is_active_org,
      m.role::text   AS role,
      m.created_at   AS member_since
      FROM public.org_members m
      JOIN public.organizations o ON o.id = m.org_id
     WHERE m.user_id = v_actor
       AND o.is_active = true
     ORDER BY (o.id = v_active) DESC, lower(o.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_my_org_memberships() TO authenticated;

COMMIT;
