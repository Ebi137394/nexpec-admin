-- ════════════════════════════════════════════════════════════════════════════
--  20260726120000_anonymize_inspection_passport.sql
--
--  ANTI-POACHING (2026-06) — public passport must not name the inspector.
--  get_inspection_passport() (anon-callable) previously returned the inspector's
--  full_name. A public, shareable passport link that names the inspector is a
--  direct disintermediation vector. The passport's value is PROOF (cryptographic
--  chain-of-custody + credentials valid at seal time), not identity.
--
--  This rewrites the RPC to return the opaque inspector_id instead of the name.
--  The web app derives a stable pseudonymous handle (NX-XXXXXX) + generated sigil
--  from that UUID and cross-links to the anonymized trust card at /p/[id]. No
--  name, no contact, no location ever leaves the server. Verbatim otherwise: seal
--  hashes, chain_verified, credential counts at seal, and anchor status are kept.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_inspection_passport(p_seal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE v_s record; v_certs int; v_calib int; v_anchor record;
BEGIN
  SELECT id, root_sha256, algorithm, chain_verified, items_count, captures_count,
         inspector_sealed_at, inspector_id, job_id
    INTO v_s FROM public.pi_report_seals WHERE id = p_seal_id;
  IF v_s.id IS NULL THEN RETURN NULL; END IF;

  -- NOTE: inspector full_name is deliberately NOT read or returned (anti-poaching).
  SELECT count(*) INTO v_certs FROM public.inspector_certifications c
   WHERE c.inspector_id = v_s.inspector_id
     AND (c.expires_at IS NULL OR c.expires_at >= v_s.inspector_sealed_at::date);
  SELECT count(*) INTO v_calib FROM public.inspector_equipment e
   WHERE e.inspector_id = v_s.inspector_id
     AND (e.next_calibration_due IS NULL OR e.next_calibration_due >= v_s.inspector_sealed_at::date);

  SELECT status, confirmed_at, calendar INTO v_anchor
    FROM public.inspection_seal_anchors WHERE seal_id = p_seal_id;

  RETURN jsonb_build_object(
    'seal', jsonb_build_object('id', v_s.id, 'root_sha256', v_s.root_sha256,
       'algorithm', v_s.algorithm, 'chain_verified', v_s.chain_verified,
       'items_count', v_s.items_count, 'captures_count', v_s.captures_count,
       'sealed_at', v_s.inspector_sealed_at),
    -- Opaque UUID only — the client derives an NX- handle + sigil and links to
    -- the anonymized trust card. No name/contact/location.
    'inspector', jsonb_build_object('id', v_s.inspector_id),
    'credentials', jsonb_build_object('certifications_valid_at_seal', coalesce(v_certs,0),
       'equipment_in_calibration_at_seal', coalesce(v_calib,0)),
    'anchor', jsonb_build_object('status', coalesce(v_anchor.status,'pending'),
       'confirmed_at', v_anchor.confirmed_at, 'calendar', v_anchor.calendar)
  );
END; $fn$;

GRANT EXECUTE ON FUNCTION public.get_inspection_passport(uuid) TO anon, authenticated;

COMMIT;
