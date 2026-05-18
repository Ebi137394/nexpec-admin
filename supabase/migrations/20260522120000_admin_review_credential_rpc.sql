-- ════════════════════════════════════════════════════════════════════════════
--  20260522120000_admin_review_credential_rpc.sql
--  Phase 6 / Sprint 4 — compliance review surface.
--
--  Three decisions in one RPC: approve / reject / suspend an inspector
--  credential. SECURITY DEFINER, super_admin only, audit-annotated with
--  correlation id. Mirrors the admin_resolve_dispute pattern.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_review_credential(
  p_credential_id uuid,
  p_decision      text,   -- 'approved' | 'rejected' | 'suspended'
  p_notes         text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        uuid;
  v_actor_role   text;
  v_cred         public.inspector_credentials%ROWTYPE;
  v_correlation  uuid := gen_random_uuid();
  v_clean_notes  text;
  v_intent       text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can review credentials' USING ERRCODE = '42501';
  END IF;

  IF p_credential_id IS NULL THEN
    RAISE EXCEPTION 'credential_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'decision must be one of: approved, rejected, suspended (got: %)', p_decision
      USING ERRCODE = '22000';
  END IF;

  v_clean_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');
  IF v_clean_notes IS NULL THEN
    RAISE EXCEPTION 'Decision notes are required' USING ERRCODE = '22000';
  END IF;
  IF length(v_clean_notes) > 1000 THEN
    v_clean_notes := left(v_clean_notes, 1000);
  END IF;

  v_intent := CASE p_decision
    WHEN 'approved'  THEN 'Credential approved — ' || v_clean_notes
    WHEN 'rejected'  THEN 'Credential rejected — ' || v_clean_notes
    WHEN 'suspended' THEN 'Credential suspended — ' || v_clean_notes
  END;
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent(v_intent);

  SELECT * INTO v_cred
  FROM public.inspector_credentials
  WHERE id = p_credential_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credential not found' USING ERRCODE = 'P0002';
  END IF;

  -- Terminal-state guard: reject cannot be reversed by this RPC; admin
  -- must create a new credential row to re-evaluate.
  IF v_cred.status = 'rejected' AND p_decision = 'approved' THEN
    RAISE EXCEPTION 'Rejected credentials cannot be approved — the inspector must reapply'
      USING ERRCODE = '22000';
  END IF;

  -- Idempotent same-state writes — useful for re-recording notes.
  UPDATE public.inspector_credentials
  SET status              = p_decision::public.cci_credential_status,
      decided_at          = now(),
      decided_by_admin_id = v_actor,
      decision_notes      = v_clean_notes
  WHERE id = p_credential_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'credential_id',  p_credential_id,
    'from_status',    v_cred.status,
    'to_status',      p_decision,
    'correlation_id', v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.admin_review_credential(uuid, text, text) IS
  'Super_admin approves / rejects / suspends an inspector credential. Notes required, audit-annotated, FOR UPDATE locked.';

GRANT EXECUTE ON FUNCTION public.admin_review_credential(uuid, text, text) TO authenticated;

COMMIT;
