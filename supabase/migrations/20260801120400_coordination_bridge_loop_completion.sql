-- ============================================================================
--  20260801120400_coordination_bridge_loop_completion.sql
--
--  PHASE 3 · COORDINATION BRIDGE — close the two loops that can't close today.
--
--  Found in the bridge deep-dive:
--   (1) SCHEDULE NEGOTIATION is one-directional. The schedule slot only reaches
--       'completed' when the VENDOR accepts an inspector proposal
--       (bridge_vendor_accept_schedule). If the vendor COUNTER-proposes
--       (→ 'awaiting_inspector'), the inspector has no way to LOCK that time —
--       only bridge_propose_schedule, which bounces it back to 'awaiting_vendor'
--       for another vendor round-trip. So a vendor-countered time can ping-pong
--       forever and the client-notify-on-lock never fires.
--         → NEW: bridge_accept_counter_schedule(bridge, slot) — inspector locks
--           the vendor's counter. Sets the slot 'completed', which fires the
--           EXISTING tg_notify_bridge_schedule_changed('completed') trigger →
--           notifies the inspector AND the client. (Reuses, doesn't duplicate.)
--
--   (2) pre_inspection_ack is an ORPHANED required slot. bridge_create seeds it
--       as required + 'awaiting_vendor', but there is NO vendor RPC to complete
--       it, and the web portal renders it as inert text. It can never reach
--       'completed', so bridge_complete always reports an unresolved required
--       slot.
--         → NEW: bridge_vendor_acknowledge_scope(token, slot, payload) —
--           vendor-side (service-role via the edge function), completes the slot.
--
--  Conventions mirror 20260612 exactly: SECURITY DEFINER, pinned search_path,
--  cb_actor_profile + cb_emit_audit, token hash-and-lookup for the vendor path,
--  REVOKE vendor RPCs from authenticated/anon (edge-function only).
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- A) INSPECTOR-SIDE — accept the vendor's counter-proposed schedule.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_accept_counter_schedule(
  p_bridge_id uuid,
  p_slot_id   uuid
) RETURNS public.bridge_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller   uuid := auth.uid();
  v_admin    boolean;
  v_bridge   RECORD;
  v_slot     public.bridge_slots%ROWTYPE;
  v_result   public.bridge_slots%ROWTYPE;
  v_proposed timestamptz;
  v_role     text;
  v_label    text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND role IN ('admin','super_admin'))
    INTO v_admin;

  SELECT id, job_id, inspector_id, status
    INTO v_bridge
    FROM public.coordination_bridges WHERE id = p_bridge_id;
  IF v_bridge.id IS NULL THEN
    RAISE EXCEPTION 'bridge not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_admin AND v_bridge.inspector_id <> v_caller THEN
    RAISE EXCEPTION 'only the assigned inspector or NEXPEC Admin may accept a counter'
      USING ERRCODE = '42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_slot
    FROM public.bridge_slots
   WHERE id = p_slot_id AND bridge_id = p_bridge_id AND kind = 'schedule';
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'schedule slot not found' USING ERRCODE = 'P0002';
  END IF;
  -- There must be a pending vendor counter to accept.
  IF v_slot.status <> 'awaiting_inspector' THEN
    RAISE EXCEPTION 'no vendor counter awaiting your acceptance (slot is %)', v_slot.status
      USING ERRCODE = '22023';
  END IF;

  v_proposed := (v_slot.payload_json ->> 'proposed_at')::timestamptz;
  IF v_proposed IS NULL THEN
    RAISE EXCEPTION 'counter has no proposed time' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bridge_slots
     SET status        = 'completed',
         completed_at  = now(),
         payload_json  = v_slot.payload_json
           || jsonb_build_object(
                'agreed_at',      v_proposed,
                'agreed_by_kind', 'inspector',
                'agreed_at_utc',  now()
              ),
         last_action_at            = now(),
         last_action_by_user_id    = v_caller,
         last_action_by_actor_kind = 'inspector'
   WHERE id = p_slot_id
   RETURNING * INTO v_result;
   -- → fires tg_notify_bridge_schedule_changed('completed') → pings inspector + client.

  SELECT actor_role, actor_label INTO v_role, v_label FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.schedule_accepted',
    'info',
    v_caller, COALESCE(v_role,'inspector'), v_label,
    v_bridge.id, v_bridge.job_id,
    format('Inspector accepted the vendor''s counter for %s', v_proposed),
    jsonb_build_object('slot_id', p_slot_id, 'agreed_at', v_proposed, 'agreed_by_kind','inspector'),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_accept_counter_schedule(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- B) VENDOR-SIDE — acknowledge the inspection scope (completes pre_inspection_ack).
--    Called ONLY by the vendor-bridge-auth Edge Function (service role).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_acknowledge_scope(
  p_raw_token text,
  p_slot_id   uuid,
  p_payload   jsonb DEFAULT '{}'::jsonb
) RETURNS public.bridge_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash   text;
  v_bridge RECORD;
  v_slot   public.bridge_slots%ROWTYPE;
  v_result public.bridge_slots%ROWTYPE;
BEGIN
  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');
  SELECT cb.id, cb.job_id, cb.status, cb.token_expires_at, cb.token_revoked_at
    INTO v_bridge
    FROM public.coordination_bridges cb
   WHERE cb.token_sha256 = v_hash;
  IF v_bridge.id IS NULL OR v_bridge.token_revoked_at IS NOT NULL OR v_bridge.token_expires_at < now() THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_slot
    FROM public.bridge_slots
   WHERE id = p_slot_id AND bridge_id = v_bridge.id AND kind = 'pre_inspection_ack';
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'pre_inspection_ack slot not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bridge_slots
     SET status        = 'completed',
         completed_at  = now(),
         payload_json  = COALESCE(p_payload, '{}'::jsonb)
           || jsonb_build_object('acknowledged_at', now(), 'by_kind', 'vendor'),
         last_action_at            = now(),
         last_action_by_actor_kind = 'vendor'
   WHERE id = p_slot_id
   RETURNING * INTO v_result;

  PERFORM public.cb_emit_audit(
    'coordination_bridge.scope_acknowledged',
    'info',
    NULL, 'vendor', NULL,
    v_bridge.id, v_bridge.job_id,
    'Vendor acknowledged the inspection scope and confirmed readiness.',
    jsonb_build_object('slot_id', p_slot_id, 'payload', COALESCE(p_payload,'{}'::jsonb)),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_acknowledge_scope(text, uuid, jsonb)
  FROM PUBLIC, authenticated, anon;

COMMIT;
