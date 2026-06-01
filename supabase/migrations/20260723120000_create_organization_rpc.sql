-- ════════════════════════════════════════════════════════════════════════════
--  20260723120000_create_organization_rpc.sql
--
--  ADD-ORG capability. NEXPEC had NO self-service organization creation — orgs
--  only ever came from seed files (supabase/seeds/exxonmobil_test_org.sql); no
--  RPC, no web flow, no INSERT path. This adds the missing primitive: any
--  authenticated user can create an organization and is recorded as its OWNER
--  (org_members.role='owner'), which immediately unlocks the existing
--  can_manage_org_structure() powers (departments, budgets, team invites).
--
--  Additive + safe. SECURITY DEFINER so the insert isn't blocked by the
--  deny-by-default RLS on organizations/org_members; the function itself
--  enforces auth + validation. Columns verified against 20260521120000 /
--  20260521120100 (organizations: name/kind/owner_id/is_active; org_members:
--  org_id/user_id/role, UNIQUE(org_id,user_id); kind CHECK IN enterprise/agency;
--  org_member_role enum has 'owner').
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_kind text DEFAULT 'enterprise'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := lower(btrim(coalesce(p_kind, 'enterprise')));
  v_org  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Organization name must be 2-120 characters' USING ERRCODE = '22000';
  END IF;
  IF v_kind NOT IN ('enterprise', 'agency') THEN
    v_kind := 'enterprise';
  END IF;

  INSERT INTO public.organizations (name, kind, owner_id, is_active)
       VALUES (v_name, v_kind, v_uid, true)
    RETURNING id INTO v_org;

  -- The creator becomes the owner.
  INSERT INTO public.org_members (org_id, user_id, role)
       VALUES (v_org, v_uid, 'owner')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner';

  RETURN jsonb_build_object('ok', true, 'org_id', v_org, 'name', v_name, 'kind', v_kind);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;
