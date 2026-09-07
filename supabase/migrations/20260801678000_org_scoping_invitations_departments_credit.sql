-- ════════════════════════════════════════════════════════════════════════════
--  20260801678000_org_scoping_invitations_departments_credit.sql
--
--  Four remaining audit repairs, all in the organisation/commercial area.
--
--  A. nx_is_org_member() decides org-scoped access (public.programs RLS) by
--     reading profiles.organization_id — the model NOTHING writes.
--     create_organization writes public.org_members. Measured on Production:
--     org_members holds 1 row, 7 profiles carry organization_id, and they
--     DISAGREE for that row. So genuine members were being DENIED while a
--     stale denormalised column granted access to someone else.
--
--  B. org_invitations is written by admin_invite_org_member and then read only
--     for display. Nothing anywhere promotes an accepted invitation into
--     org_members, so an invitation was a write-only dead end.
--
--  C. jobs.department_id FOREIGN KEYs public.org_departments, but
--     create_department INSERTs into public.departments and every picker reads
--     that same legacy table. A job could therefore never reference a
--     department the UI could create. org_departments is canonical: it is the
--     FK target, it is what the Admin SSO console already reads, and it is the
--     richer shape. Both tables hold ZERO rows on Production and no job
--     carries a department_id, so nothing is migrated and nothing is guessed.
--
--  D. client_payment_terms / client_credit_limit_cents drive the client
--     Finance credit panel but have no writer at all: all 54 profiles sit on
--     the column defaults ('prepay', 0). Credit is a NEXPEC decision, so the
--     writer is admin-only — a customer must never grant itself credit.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════ A. Authoritative organisation membership ══════════════════════
-- Widening only: every account this newly admits is a REAL member of that
-- organisation according to org_members. The legacy column is still honoured
-- so no currently-working access is withdrawn by this change.
CREATE OR REPLACE FUNCTION public.nx_is_org_member(p_org_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p_org_id IS NOT NULL
     AND p_uid IS NOT NULL
     AND (
       -- Authoritative: the membership table create_organization actually writes.
       EXISTS (SELECT 1 FROM public.org_members m
                WHERE m.user_id = p_uid AND m.org_id = p_org_id)
       -- Legacy denormalisation, kept so existing access is not revoked.
       OR EXISTS (SELECT 1 FROM public.profiles pr
                   WHERE pr.id = p_uid AND pr.organization_id = p_org_id)
     );
$$;

COMMENT ON FUNCTION public.nx_is_org_member(uuid, uuid) IS
  'Organisation membership for RLS. org_members is authoritative; '
  'profiles.organization_id is a legacy denormalisation retained only so that '
  'existing access is not withdrawn. Do not add a third model.';

-- Every org a user actually belongs to. Multi-org by construction: this never
-- collapses several memberships into one, and never picks one arbitrarily.
CREATE OR REPLACE FUNCTION public.nx_user_org_ids(p_uid uuid DEFAULT auth.uid())
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT o), '{}'::uuid[])
    FROM (
      SELECT m.org_id AS o FROM public.org_members m WHERE m.user_id = p_uid
      UNION
      SELECT pr.organization_id FROM public.profiles pr
       WHERE pr.id = p_uid AND pr.organization_id IS NOT NULL
    ) s WHERE o IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.nx_user_org_ids(uuid) FROM anon;

-- ═══════════ B. Invitation acceptance ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.nx_accept_org_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE inv record; v_email text; v_existing text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000';
  END IF;

  -- Lock the row so two simultaneous accepts cannot both proceed.
  SELECT * INTO inv FROM public.org_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE='P0002';
  END IF;

  -- IDENTITY: only the invited address may accept. An invitation is addressed
  -- to a person, not merely to whoever holds the link.
  SELECT lower(btrim(email)) INTO v_email FROM public.profiles WHERE id = auth.uid();
  IF v_email IS NULL OR v_email <> lower(btrim(inv.email)) THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address'
      USING ERRCODE='42501';
  END IF;

  IF inv.status <> 'pending' THEN
    -- Replay: already accepted by this same person is a no-op, not an error.
    IF inv.status = 'accepted' AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE org_id = inv.org_id AND user_id = auth.uid())
    THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'org_id', inv.org_id);
    END IF;
    RAISE EXCEPTION 'This invitation is %', inv.status USING ERRCODE='22023';
  END IF;

  IF inv.expires_at IS NOT NULL AND inv.expires_at < now() THEN
    UPDATE public.org_invitations SET status='expired' WHERE id = inv.id;
    RAISE EXCEPTION 'This invitation has expired' USING ERRCODE='22023';
  END IF;

  -- Membership in the invited organisation only, with the invited role only.
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (inv.org_id, auth.uid(), inv.role)
  ON CONFLICT DO NOTHING;

  UPDATE public.org_invitations
     SET status='accepted', accepted_at=now()
   WHERE id = inv.id;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('org.invitation_accepted', 'warning', auth.uid(), auth.uid(), 'org_members',
          'Organisation invitation accepted',
          jsonb_build_object('org_id', inv.org_id, 'role', inv.role,
                             'invitation_id', inv.id, 'invited_by', inv.invited_by));

  RETURN jsonb_build_object('ok', true, 'org_id', inv.org_id, 'role', inv.role);
END $$;

CREATE OR REPLACE FUNCTION public.nx_admin_revoke_org_invitation(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE inv record;
BEGIN
  SELECT * INTO inv FROM public.org_invitations WHERE id = p_invitation_id;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  IF NOT (public.nx_is_admin() OR public.can_manage_org_structure(inv.org_id, auth.uid())) THEN
    RAISE EXCEPTION 'You may not manage invitations for that organisation' USING ERRCODE='42501';
  END IF;
  IF inv.status = 'accepted' THEN
    RAISE EXCEPTION 'That invitation was already accepted; remove the membership instead'
      USING ERRCODE='22023';
  END IF;
  UPDATE public.org_invitations SET status='revoked' WHERE id = inv.id;
  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('org.invitation_revoked','warning', auth.uid(), auth.uid(), 'org_invitations',
          'Organisation invitation revoked', jsonb_build_object('invitation_id', inv.id));
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.nx_accept_org_invitation(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.nx_admin_revoke_org_invitation(uuid) FROM anon;

-- ═══════════ C. Departments: write the FK target ═══════════════════════════
-- Body reproduced from the live definition; the only changes are the target
-- table and the columns org_departments requires. Permission check, audit and
-- return shape are unchanged.
CREATE OR REPLACE FUNCTION public.create_department(
  p_org_id uuid, p_parent_department_id uuid, p_name text, p_cost_center text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_actor_label text;
  v_name        text;
  v_cost        text;
  v_slug        text;
  v_depth       int := 0;
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

  -- Parent is validated against the SAME table we insert into, so a hierarchy
  -- can never span the two models.
  IF p_parent_department_id IS NOT NULL THEN
    SELECT COALESCE(depth, 0) + 1 INTO v_depth
      FROM public.org_departments
     WHERE id = p_parent_department_id AND org_id = p_org_id;
    IF v_depth IS NULL THEN
      RAISE EXCEPTION 'Parent department not found in this organization' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  v_slug := NULLIF(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '');
  v_slug := NULLIF(btrim(v_slug, '-'), '');

  INSERT INTO public.org_departments
    (org_id, parent_department_id, name, slug, kind, cost_center_code, depth, created_by)
  VALUES (p_org_id, p_parent_department_id, v_name, COALESCE(v_slug, 'dept'),
          'department', v_cost, COALESCE(v_depth, 0), v_actor)
  RETURNING id INTO v_id;

  SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
    FROM public._dept_actor_profile(v_actor);

  INSERT INTO public.audit_events (
    event_type, actor_id, actor_role, actor_label,
    subject_table, subject_id, summary, delta, metadata, correlation_id
  ) VALUES (
    'department.created', v_actor, v_actor_role, v_actor_label,
    'org_departments', v_id, format('Department %L created', v_name),
    jsonb_build_object('name', v_name, 'cost_center', v_cost,
                       'parent_department_id', p_parent_department_id),
    jsonb_build_object('org_id', p_org_id), v_correlation
  );

  RETURN jsonb_build_object(
    'ok', true, 'department_id', v_id, 'org_id', p_org_id,
    'parent_department_id', p_parent_department_id,
    'name', v_name, 'cost_center', v_cost, 'correlation_id', v_correlation);
END;
$function$;

-- ═══════════ D. Client credit terms, admin-only ════════════════════════════
CREATE OR REPLACE FUNCTION public.nx_admin_set_client_credit_terms(
  p_client_id uuid, p_payment_terms text, p_credit_limit_cents bigint, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE before_terms text; before_limit bigint;
BEGIN
  -- Credit is a NEXPEC decision. A customer must never grant itself terms, so
  -- this is admin-only and there is deliberately no self-service path.
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'nx_admin_set_client_credit_terms: admin only' USING ERRCODE='42501';
  END IF;
  -- The allowed set is NOT invented here: it mirrors the existing
  -- profiles_client_terms_chk CHECK constraint exactly. Validating in the RPC
  -- as well turns a raw constraint violation into a usable message, but the
  -- database remains the authority.
  IF p_payment_terms NOT IN ('prepay','net_15','net_30','net_45','net_60') THEN
    RAISE EXCEPTION
      'unsupported payment terms %. Allowed: prepay, net_15, net_30, net_45, net_60',
      p_payment_terms USING ERRCODE='22023';
  END IF;
  IF p_credit_limit_cents IS NULL OR p_credit_limit_cents < 0 THEN
    RAISE EXCEPTION 'credit limit must be zero or more minor units' USING ERRCODE='22023';
  END IF;

  SELECT client_payment_terms, client_credit_limit_cents
    INTO before_terms, before_limit FROM public.profiles WHERE id = p_client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such account' USING ERRCODE='P0002'; END IF;

  UPDATE public.profiles
     SET client_payment_terms = p_payment_terms,
         client_credit_limit_cents = p_credit_limit_cents,
         updated_at = now()
   WHERE id = p_client_id;

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_id, subject_table, summary, metadata)
  VALUES ('client.credit_terms_changed', 'critical', auth.uid(), p_client_id, 'profiles',
          'Client credit terms set to ' || p_payment_terms,
          jsonb_build_object(
            'before', jsonb_build_object('terms', before_terms, 'limit_cents', before_limit),
            'after',  jsonb_build_object('terms', p_payment_terms, 'limit_cents', p_credit_limit_cents),
            'reason', p_reason));
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.nx_admin_set_client_credit_terms(uuid,text,bigint,text) FROM anon;

COMMIT;
