-- ════════════════════════════════════════════════════════════════════════════
--  20260523130000_org_mutation_rpcs.sql
--  Phase 6 / Sprint 4 close — Organizations mutation surface.
--
--  Three RPCs + one invitations table:
--
--    org_invitations             — pending email-based invitations.
--    admin_invite_org_member     — issues a new invitation row.
--    admin_update_org_member_role — change an existing member's seat role.
--    admin_remove_org_member     — revoke a seat.
--
--  All SECURITY DEFINER, super_admin only, audit-stamped.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── org_invitations table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_invitations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL    DEFAULT now(),
  org_id       uuid        NOT NULL    REFERENCES public.organizations(id) ON DELETE CASCADE,
  email        text        NOT NULL,
  role         public.org_member_role NOT NULL DEFAULT 'viewer',
  invited_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  status       text        NOT NULL    DEFAULT 'pending'
                                      CHECK (status IN ('pending', 'accepted', 'revoked')),
  accepted_at  timestamptz,
  expires_at   timestamptz NOT NULL    DEFAULT (now() + interval '14 days'),
  UNIQUE (org_id, email)
);

CREATE INDEX IF NOT EXISTS org_invitations_status_idx
  ON public.org_invitations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS org_invitations_email_idx
  ON public.org_invitations (lower(email));

ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_invitations_select_admin ON public.org_invitations;
CREATE POLICY org_invitations_select_admin
  ON public.org_invitations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  );

-- ── admin_invite_org_member ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_invite_org_member(
  p_org_id uuid,
  p_email  text,
  p_role   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid;
  v_actor_role  text;
  v_clean_email text;
  v_correlation uuid := gen_random_uuid();
  v_invitation_id uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can invite org members' USING ERRCODE = '42501';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required' USING ERRCODE = '22000';
  END IF;

  v_clean_email := lower(NULLIF(TRIM(COALESCE(p_email, '')), ''));
  IF v_clean_email IS NULL OR position('@' in v_clean_email) < 2 THEN
    RAISE EXCEPTION 'A valid email is required' USING ERRCODE = '22000';
  END IF;

  IF p_role NOT IN ('owner', 'procurement_admin', 'project_lead', 'viewer') THEN
    RAISE EXCEPTION 'role must be one of: owner, procurement_admin, project_lead, viewer (got: %)', p_role
      USING ERRCODE = '22000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Org invite issued — ' || v_clean_email || ' as ' || p_role);

  -- Upsert: re-invite a previously-revoked or expired row resets it.
  INSERT INTO public.org_invitations (org_id, email, role, invited_by, status, expires_at)
    VALUES (p_org_id, v_clean_email, p_role::public.org_member_role, v_actor, 'pending', now() + interval '14 days')
    ON CONFLICT (org_id, email) DO UPDATE
      SET role = EXCLUDED.role,
          status = 'pending',
          invited_by = EXCLUDED.invited_by,
          expires_at = EXCLUDED.expires_at,
          created_at = now(),
          accepted_at = NULL
    RETURNING id INTO v_invitation_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'invitation_id',  v_invitation_id,
    'org_id',         p_org_id,
    'email',          v_clean_email,
    'role',           p_role,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_invite_org_member(uuid, text, text)
  TO authenticated;

-- ── admin_update_org_member_role ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_org_member_role(
  p_member_id uuid,
  p_role      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid;
  v_actor_role  text;
  v_old_role    public.org_member_role;
  v_correlation uuid := gen_random_uuid();
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can change org member roles' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('owner', 'procurement_admin', 'project_lead', 'viewer') THEN
    RAISE EXCEPTION 'role must be one of: owner, procurement_admin, project_lead, viewer (got: %)', p_role
      USING ERRCODE = '22000';
  END IF;

  SELECT role INTO v_old_role FROM public.org_members WHERE id = p_member_id FOR UPDATE;
  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Org member role changed — ' || v_old_role::text || ' → ' || p_role);

  UPDATE public.org_members
  SET role = p_role::public.org_member_role
  WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'member_id',      p_member_id,
    'from_role',      v_old_role::text,
    'to_role',        p_role,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_org_member_role(uuid, text)
  TO authenticated;

-- ── admin_remove_org_member ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_remove_org_member(
  p_member_id uuid,
  p_reason    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid;
  v_actor_role  text;
  v_correlation uuid := gen_random_uuid();
  v_clean       text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can remove org members' USING ERRCODE = '42501';
  END IF;

  v_clean := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  IF v_clean IS NULL THEN
    RAISE EXCEPTION 'A reason is required for member removal' USING ERRCODE = '22000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE id = p_member_id) THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Org member removed — ' || v_clean);

  DELETE FROM public.org_members WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'member_id',      p_member_id,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_remove_org_member(uuid, text)
  TO authenticated;

COMMIT;
