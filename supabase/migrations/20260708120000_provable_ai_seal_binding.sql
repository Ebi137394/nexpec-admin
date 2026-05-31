-- ════════════════════════════════════════════════════════════════════════════
--  20260708120000_provable_ai_seal_binding.sql
--
--  THE MASTERSTROKE — Provable AI. Every HUMAN-ACCEPTED AI detection is folded
--  into the inspection seal's root hash, bound to the exact signed model
--  (slug + version + sha256) that produced it. Tamper with any accepted
--  detection after sealing → its ai_root changes → the seal's root_sha256
--  changes → re-derivation mismatch → detectable. The AI Co-Inspector is now
--  cryptographically auditable, with the human inspector as the sealing author.
--
--  CHANGE: pi_seal_inspection_report adds a 5th root component, `ai_root`, to the
--  existing lexicographically-sorted composition
--    sha256( sort([captures_root, items_root, report_meta, vendor_root, ai_root]) )
--  and bumps the canonical-algorithm tag v2 → v3. Two additive nullable columns
--  (ai_root_sha256, ai_count) record it on the seal.
--
--  SAFETY (verified 2026-05-29):
--   • The public EvidencePackVerifier recomputes the EVIDENCE-PACK manifest
--     integrity (sha256 of the artifacts array) — NOT the PIE root from its
--     components — so this root-formula change does NOT break /verify. New seals
--     simply carry algorithm 'v3'; older seals keep 'v1'/'v2'.
--   • Body is reproduced verbatim from the latest definition (20260614) with
--     ONLY the ai_root additions. Idempotent. No existing column altered.
--   • Guarded by to_regclass('public.ai_detections') — a no-op (empty ai_root)
--     until detections exist.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Additive, nullable — record the AI component on the seal.
ALTER TABLE public.pi_report_seals ADD COLUMN IF NOT EXISTS ai_root_sha256 text;
ALTER TABLE public.pi_report_seals ADD COLUMN IF NOT EXISTS ai_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.pi_seal_inspection_report(p_report_id uuid)
RETURNS public.pi_report_seals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_caller             uuid := auth.uid();
  v_is_admin           boolean;
  v_report             public.inspection_reports%ROWTYPE;
  v_existing           public.pi_report_seals%ROWTYPE;

  v_seal_id            uuid := gen_random_uuid();
  v_sealed_at          timestamptz := now();

  v_captures_count     integer := 0;
  v_items_count        integer := 0;
  v_chain_verified     boolean := true;
  v_chain_break_at     uuid;

  v_prev_hash          text;
  v_captures_concat    text := '';
  v_items_concat       text := '';
  v_vendor_concat      text := '';
  v_ai_concat          text := '';

  v_captures_root      text;
  v_items_root         text;
  v_report_meta_sha    text;
  v_vendor_root        text;
  v_ai_root            text;
  v_ai_count           integer := 0;
  v_root               text;
  v_inspector_sig      text;

  v_audit_id           uuid;
  v_actor_role         text;

  v_capture            RECORD;
  v_item               RECORD;
  v_vendor_doc         RECORD;
  v_ai                 RECORD;
  v_item_jsonb         jsonb;
  v_report_jsonb       jsonb;
  v_ai_jsonb           jsonb;

  v_result             public.pi_report_seals%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND role = 'super_admin')
    INTO v_is_admin;
  v_actor_role := CASE WHEN v_is_admin THEN 'super_admin' ELSE 'inspector' END;

  SELECT * INTO v_report FROM public.inspection_reports WHERE id = p_report_id;
  IF v_report.id IS NULL THEN
    RAISE EXCEPTION 'inspection report % not found', p_report_id USING ERRCODE = 'P0002';
  END IF;
  IF v_report.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'inspection report % is deleted', p_report_id USING ERRCODE = '22023';
  END IF;
  IF NOT v_is_admin AND v_report.inspector_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'only the report author or NEXPEC Admin may seal this report'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.pi_report_seals WHERE report_id = p_report_id;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- ── Captures root + chain ──
  v_prev_hash := NULL;
  FOR v_capture IN
    SELECT id, capture_sha256, prev_capture_sha256, sort_index, captured_at
      FROM public.inspection_captures
     WHERE job_id = v_report.job_id
     ORDER BY sort_index ASC, captured_at ASC NULLS LAST, id ASC
  LOOP
    v_captures_count := v_captures_count + 1;
    IF v_captures_count = 1 THEN
      IF v_capture.prev_capture_sha256 IS NOT NULL THEN
        v_chain_verified := false;
        v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
      END IF;
    ELSE
      IF v_capture.prev_capture_sha256 IS DISTINCT FROM v_prev_hash THEN
        v_chain_verified := false;
        v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
      END IF;
    END IF;
    IF v_capture.capture_sha256 IS NULL THEN
      v_chain_verified := false;
      v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
    END IF;
    v_captures_concat := v_captures_concat || COALESCE(v_capture.capture_sha256, '') || '|';
    v_prev_hash := v_capture.capture_sha256;
  END LOOP;
  v_captures_root := encode(digest(v_captures_concat, 'sha256'), 'hex');

  -- ── Items root ──
  FOR v_item IN
    SELECT id, description, status, photo_url, notes, location, created_at
      FROM public.inspection_items
     WHERE report_id = p_report_id
     ORDER BY created_at ASC NULLS LAST, id ASC
  LOOP
    v_items_count := v_items_count + 1;
    v_item_jsonb := jsonb_build_object(
      'id', v_item.id, 'description', v_item.description, 'status', v_item.status,
      'photo_url', v_item.photo_url, 'notes', v_item.notes, 'location', v_item.location,
      'created_at', v_item.created_at
    );
    v_items_concat := v_items_concat || public.pi_canonical_json(v_item_jsonb) || '|';
  END LOOP;
  v_items_root := encode(digest(v_items_concat, 'sha256'), 'hex');

  -- ── Report metadata hash ──
  v_report_jsonb := jsonb_build_object(
    'id', v_report.id, 'job_id', v_report.job_id, 'inspector_id', v_report.inspector_id,
    'status', v_report.status, 'notes', v_report.notes, 'pdf_url', v_report.pdf_url,
    'final_report_doc', v_report.final_report_doc, 'is_published', v_report.is_published,
    'is_client_approved', v_report.is_client_approved, 'signed_docs_url', v_report.signed_docs_url,
    'created_at', v_report.created_at
  );
  v_report_meta_sha := encode(digest(public.pi_canonical_json(v_report_jsonb), 'sha256'), 'hex');

  -- ── Vendor-chain root (Sprint C) ──
  IF to_regclass('public.bridge_documents') IS NOT NULL THEN
    FOR v_vendor_doc IN
      SELECT d.sha256_client_computed, d.accepted_at, d.id
        FROM public.bridge_documents d
        JOIN public.coordination_bridges cb ON cb.id = d.bridge_id
       WHERE cb.job_id = v_report.job_id
         AND d.uploaded_by_actor_kind = 'vendor'
         AND d.accepted_at IS NOT NULL
       ORDER BY d.accepted_at ASC NULLS LAST, d.id ASC
    LOOP
      v_vendor_concat := v_vendor_concat || COALESCE(v_vendor_doc.sha256_client_computed, '') || '|';
    END LOOP;
  END IF;
  v_vendor_root := encode(digest(v_vendor_concat, 'sha256'), 'hex');

  -- ── AI-detection root (NEW · Provable AI) ──
  -- Hash chain over every HUMAN-ACCEPTED AI detection for this report, each
  -- bound to the exact signed model (slug+version+sha256). Ordered by
  -- created_at then id for deterministic re-derivation. Folding this into the
  -- root makes every accepted AI suggestion tamper-evident under the seal.
  IF to_regclass('public.ai_detections') IS NOT NULL THEN
    FOR v_ai IN
      SELECT id, defect_id, label, confidence, severity, model_slug, model_version, model_sha256
        FROM public.ai_detections
       WHERE accepted_by_human = true
         AND ( report_id = p_report_id
               OR (report_id IS NULL AND job_id = v_report.job_id) )
       ORDER BY created_at ASC NULLS LAST, id ASC
    LOOP
      v_ai_count := v_ai_count + 1;
      v_ai_jsonb := jsonb_build_object(
        'id', v_ai.id, 'defect_id', v_ai.defect_id, 'label', v_ai.label,
        'confidence', v_ai.confidence, 'severity', v_ai.severity,
        'model_slug', v_ai.model_slug, 'model_version', v_ai.model_version,
        'model_sha256', v_ai.model_sha256
      );
      v_ai_concat := v_ai_concat || public.pi_canonical_json(v_ai_jsonb) || '|';
    END LOOP;
  END IF;
  v_ai_root := encode(digest(v_ai_concat, 'sha256'), 'hex');

  -- ── Compose root (5-component, lexicographic) ──
  WITH parts(s) AS (
    VALUES (v_captures_root), (v_items_root), (v_report_meta_sha), (v_vendor_root), (v_ai_root)
  )
  SELECT encode(digest(string_agg(s, '|' ORDER BY s), 'sha256'), 'hex')
    INTO v_root FROM parts;

  v_inspector_sig := encode(
    digest(
      v_report.inspector_id::text || '|'
      || to_char(v_sealed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || v_root,
      'sha256'
    ), 'hex'
  );

  -- ── Audit + seal write ──
  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id, summary, delta, metadata
  )
  VALUES (
    'compliance.inspection_report.sealed',
    'info',
    v_caller, v_actor_role, NULL,
    'inspection_reports', p_report_id, v_report.job_id,
    format('Sealed inspection report %s (captures=%s, items=%s, ai=%s, chain=%s)',
      p_report_id, v_captures_count, v_items_count, v_ai_count,
      CASE WHEN v_chain_verified THEN 'intact' ELSE 'broken' END),
    jsonb_build_object(
      'seal_id',                   v_seal_id,
      'root_sha256',               v_root,
      'captures_root_sha256',      v_captures_root,
      'items_root_sha256',         v_items_root,
      'report_meta_sha256',        v_report_meta_sha,
      'vendor_chain_root_sha256',  v_vendor_root,
      'ai_root_sha256',            v_ai_root,
      'ai_count',                  v_ai_count,
      'inspector_signature_sha256', v_inspector_sig,
      'captures_count',            v_captures_count,
      'items_count',               v_items_count,
      'chain_verified',            v_chain_verified,
      'chain_break_at_capture_id', v_chain_break_at,
      'algorithm',                 'sha256/canonical-json/v3'
    ),
    jsonb_build_object('seal_id', v_seal_id::text, 'root_hash', v_root)
  )
  RETURNING id INTO v_audit_id;

  INSERT INTO public.pi_report_seals (
    id, report_id, job_id, inspector_id,
    algorithm,
    root_sha256, captures_root_sha256, items_root_sha256, report_meta_sha256,
    ai_root_sha256, ai_count,
    captures_count, items_count,
    chain_verified, chain_break_at_capture_id,
    inspector_sealed_at, inspector_signature_sha256,
    audit_event_id
  )
  VALUES (
    v_seal_id,
    p_report_id, v_report.job_id, v_report.inspector_id,
    'sha256/canonical-json/v3',
    v_root, v_captures_root, v_items_root, v_report_meta_sha,
    v_ai_root, v_ai_count,
    v_captures_count, v_items_count,
    v_chain_verified, v_chain_break_at,
    v_sealed_at, v_inspector_sig,
    v_audit_id
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.pi_seal_inspection_report(uuid) TO authenticated;

COMMIT;
