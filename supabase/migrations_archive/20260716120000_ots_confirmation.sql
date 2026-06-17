-- ════════════════════════════════════════════════════════════════════════════
--  20260716120000_ots_confirmation.sql
--
--  OTS confirmation — record the Bitcoin attestation on a seal anchor.
--
--  anchor-inspection-seals submits a seal root to a free OpenTimestamps calendar
--  (status 'submitted'). confirm-inspection-anchors later upgrades that proof
--  once it is included in a Bitcoin block, flipping the anchor to
--  'bitcoin_confirmed'. This migration adds the two columns that final state
--  needs and surfaces the block height on the public passport.
--
--  Additive + idempotent: two nullable columns, plus get_inspection_passport
--  reproduced verbatim with ONE new field in its 'anchor' object (the page
--  ignores unknown fields, so no UI change). No existing column/grant altered.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.inspection_seal_anchors
  ADD COLUMN IF NOT EXISTS bitcoin_block_height integer;
ALTER TABLE public.inspection_seal_anchors
  ADD COLUMN IF NOT EXISTS upgraded_at timestamptz;

-- ── get_inspection_passport — surface bitcoin_block_height on the anchor ─────
CREATE OR REPLACE FUNCTION public.get_inspection_passport(p_seal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_s record; v_name text; v_certs int; v_calib int; v_anchor record;
BEGIN
  SELECT id, root_sha256, algorithm, chain_verified, items_count, captures_count,
         inspector_sealed_at, inspector_id, job_id
    INTO v_s FROM public.pi_report_seals WHERE id = p_seal_id;
  IF v_s.id IS NULL THEN RETURN NULL; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_s.inspector_id;

  SELECT count(*) INTO v_certs FROM public.inspector_certifications c
   WHERE c.inspector_id = v_s.inspector_id
     AND (c.expires_at IS NULL OR c.expires_at >= v_s.inspector_sealed_at::date);
  SELECT count(*) INTO v_calib FROM public.inspector_equipment e
   WHERE e.inspector_id = v_s.inspector_id
     AND (e.next_calibration_due IS NULL OR e.next_calibration_due >= v_s.inspector_sealed_at::date);

  SELECT status, confirmed_at, calendar, bitcoin_block_height
    INTO v_anchor
    FROM public.inspection_seal_anchors WHERE seal_id = p_seal_id;

  RETURN jsonb_build_object(
    'seal', jsonb_build_object('id', v_s.id, 'root_sha256', v_s.root_sha256,
       'algorithm', v_s.algorithm, 'chain_verified', v_s.chain_verified,
       'items_count', v_s.items_count, 'captures_count', v_s.captures_count,
       'sealed_at', v_s.inspector_sealed_at),
    'inspector', jsonb_build_object('name', coalesce(v_name,'Verified inspector')),
    'credentials', jsonb_build_object('certifications_valid_at_seal', coalesce(v_certs,0),
       'equipment_in_calibration_at_seal', coalesce(v_calib,0)),
    'anchor', jsonb_build_object('status', coalesce(v_anchor.status,'pending'),
       'confirmed_at', v_anchor.confirmed_at, 'calendar', v_anchor.calendar,
       'bitcoin_block_height', v_anchor.bitcoin_block_height)
  );
END; $fn$;

GRANT EXECUTE ON FUNCTION public.get_inspection_passport(uuid) TO anon, authenticated;

COMMIT;
