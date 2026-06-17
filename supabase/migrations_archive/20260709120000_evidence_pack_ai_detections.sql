-- ════════════════════════════════════════════════════════════════════════════
--  20260709120000_evidence_pack_ai_detections.sql
--
--  Provable AI — pack side. Completes the round-trip from 20260708 (which folded
--  ai_root into the seal): the downloadable evidence pack now carries a 10th
--  artifact group, `ai_detections`, AND the seal artifact now exposes
--  ai_root_sha256 + ai_count. A third party can therefore recompute ai_root
--  from the pack and confirm it composes into the seal's root_sha256 — fully
--  auditable, no trust in NEXPEC required.
--
--  Reproduced verbatim from the latest definition (20260614) with ONLY:
--    • v_ai_detections var + v_has_ai guard,
--    • ai_root_sha256 / ai_count added to the inspection_seals artifact,
--    • a new ai_detections group block,
--    • 'ai_detections' added to the artifacts object + the assembly audit delta.
--  The public EvidencePackVerifier hashes manifest.artifacts generically, so the
--  new group is covered with NO web change. Additive; no existing group altered.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.assemble_evidence_pack(
  p_job_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_actor_lbl   text;
  v_job         jsonb;
  v_parties     jsonb;
  v_department  jsonb;
  v_contracts   jsonb;
  v_approvals   jsonb;
  v_invoices    jsonb;
  v_audit       jsonb;
  v_seals       jsonb;
  v_vendor_coordination jsonb;
  v_ai_detections jsonb;
  v_correlation uuid := gen_random_uuid();
  v_has_inv     boolean := to_regclass('public.invoices')              IS NOT NULL;
  v_has_contr   boolean := to_regclass('public.job_contracts')         IS NOT NULL;
  v_has_appr    boolean := to_regclass('public.approval_requests')     IS NOT NULL;
  v_has_seals   boolean := to_regclass('public.pi_report_seals')       IS NOT NULL;
  v_has_bridge  boolean := to_regclass('public.coordination_bridges')  IS NOT NULL;
  v_has_ai      boolean := to_regclass('public.ai_detections')         IS NOT NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.can_assemble_evidence_for(p_job_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to assemble an evidence pack for this job'
      USING ERRCODE = '42501';
  END IF;

  -- ── 1. Job snapshot ──────────────────────────────────────────────
  SELECT jsonb_build_object(
    'id', j.id, 'title', j.title, 'description', j.description,
    'status', j.status, 'moderation_status', j.moderation_status,
    'urgency', j.urgency, 'job_type', j.job_type, 'location_city', j.location_city,
    'client_id', j.client_id, 'agency_id', j.agency_id, 'contractor_id', j.contractor_id,
    'budget_cents', j.budget_cents, 'client_price_cents', j.client_price_cents,
    'inspector_payout_cents', j.inspector_payout_cents,
    'department_id', j.department_id, 'specialty_slugs', j.specialty_slugs,
    'requires_cci', j.requires_cci, 'created_at', j.created_at, 'updated_at', j.updated_at
  )
    INTO v_job FROM public.jobs j WHERE j.id = p_job_id;

  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  -- ── 2. Parties ───────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'client', (
      SELECT jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role)
        FROM public.profiles p WHERE p.id = (v_job->>'client_id')::uuid
    ),
    'contractor', (
      SELECT jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role)
        FROM public.profiles p WHERE p.id = (v_job->>'contractor_id')::uuid
    )
  ) INTO v_parties;

  -- ── 3. Department + cost-center ─────────────────────────────────
  IF (v_job->>'department_id') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', d.id, 'org_id', d.org_id, 'name', d.name,
      'cost_center', d.cost_center, 'parent_department_id', d.parent_department_id,
      'created_at', d.created_at
    ) INTO v_department FROM public.departments d
     WHERE d.id = (v_job->>'department_id')::uuid;
  ELSE
    v_department := NULL;
  END IF;

  -- ── 4. Contracts ────────────────────────────────────────────────
  IF v_has_contr THEN
    SELECT COALESCE(jsonb_agg(row ORDER BY ord), '[]'::jsonb) INTO v_contracts
      FROM (
        SELECT row_number() OVER (ORDER BY c.id) AS ord,
          jsonb_build_object(
            'id', c.id, 'job_id', c.job_id, 'application_id', c.application_id,
            'client_id', c.client_id, 'inspector_id', c.inspector_id,
            'client_price_cents', c.client_price_cents,
            'inspector_payout_cents', c.inspector_payout_cents,
            'contract_text_md', c.contract_text_md,
            'custom_contract_url', c.custom_contract_url, 'status', c.status,
            'client_signed_at', c.client_signed_at, 'client_signed_name', c.client_signed_name,
            'client_signed_ip', c.client_signed_ip, 'inspector_signed_at', c.inspector_signed_at,
            'inspector_signed_name', c.inspector_signed_name, 'inspector_signed_ip', c.inspector_signed_ip,
            'created_at', COALESCE(to_jsonb((row_to_json(c) ->> 'created_at')), 'null'::jsonb)
          ) AS row
          FROM public.job_contracts c WHERE c.job_id = p_job_id
      ) sub;
  ELSE v_contracts := '[]'::jsonb; END IF;

  -- ── 5. Approval request + decisions ─────────────────────────────
  IF v_has_appr THEN
    SELECT CASE WHEN r.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', r.id, 'org_id', r.org_id, 'job_id', r.job_id,
        'department_id', r.department_id, 'policy_id', r.policy_id,
        'requested_by', r.requested_by, 'requested_at', r.requested_at,
        'amount_cents', r.amount_cents, 'currency', r.currency, 'status', r.status,
        'min_approvers_required', r.min_approvers_required,
        'required_approver_roles', r.required_approver_roles,
        'requires_sod', r.requires_sod, 'final_decision_at', r.final_decision_at,
        'final_decision_by', r.final_decision_by, 'rejection_reason', r.rejection_reason,
        'decisions', (
          SELECT COALESCE(jsonb_agg(d ORDER BY d->>'decided_at'), '[]'::jsonb)
          FROM (
            SELECT jsonb_build_object(
              'id', ad.id, 'decided_by', ad.decided_by, 'decided_at', ad.decided_at,
              'decision', ad.decision, 'comment', ad.comment,
              'decider_role_at_time', ad.decider_role_at_time
            ) AS d FROM public.approval_decisions ad
             WHERE ad.approval_request_id = r.id ORDER BY ad.decided_at
          ) sub
        )
      ) END INTO v_approvals
      FROM public.approval_requests r WHERE r.job_id = p_job_id;
  ELSE v_approvals := NULL; END IF;

  -- ── 6. Invoices ─────────────────────────────────────────────────
  IF v_has_inv THEN
    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'issued_at' NULLS LAST, row->>'id'), '[]'::jsonb)
      INTO v_invoices
      FROM (
        SELECT jsonb_build_object(
          'id', i.id, 'invoice_number', i.invoice_number, 'job_id', i.job_id,
          'contract_id', i.contract_id, 'client_id', i.client_id, 'inspector_id', i.inspector_id,
          'client_amount_cents', i.client_amount_cents,
          'inspector_amount_cents', i.inspector_amount_cents,
          'platform_fee_cents', i.platform_fee_cents, 'total_cents', i.total_cents,
          'currency', i.currency, 'status', i.status, 'issued_at', i.issued_at,
          'due_date', i.due_date, 'approved_at', i.approved_at,
          'disputed_at', i.disputed_at, 'dispute_reason', i.dispute_reason,
          'paid_at', i.paid_at, 'paid_reference', i.paid_reference,
          'voided_at', i.voided_at, 'voided_reason', i.voided_reason,
          'department_id', i.department_id, 'cost_center_snapshot', i.cost_center_snapshot,
          'line_items', COALESCE(i.line_items_json, '[]'::jsonb)
        ) AS row FROM public.invoices i WHERE i.job_id = p_job_id
      ) sub;
  ELSE v_invoices := '[]'::jsonb; END IF;

  -- ── 7. Audit events ─────────────────────────────────────────────
  WITH related_subjects AS (
    SELECT p_job_id AS subject_id
    UNION SELECT id FROM public.job_contracts     WHERE v_has_contr AND job_id = p_job_id
    UNION SELECT id FROM public.invoices          WHERE v_has_inv   AND job_id = p_job_id
    UNION SELECT id FROM public.approval_requests WHERE v_has_appr  AND job_id = p_job_id
    UNION SELECT id FROM public.coordination_bridges WHERE v_has_bridge AND job_id = p_job_id
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at', row->>'id'), '[]'::jsonb)
    INTO v_audit
    FROM (
      SELECT jsonb_build_object(
        'id', a.id, 'created_at', a.created_at, 'event_type', a.event_type,
        'severity', a.severity, 'actor_id', a.actor_id, 'actor_role', a.actor_role,
        'actor_label', a.actor_label, 'subject_table', a.subject_table, 'subject_id', a.subject_id,
        'summary', a.summary, 'delta', a.delta, 'metadata', a.metadata,
        'correlation_id', a.correlation_id
      ) AS row FROM public.audit_events a
       WHERE a.subject_id IN (SELECT subject_id FROM related_subjects)
          OR (a.metadata ? 'job_id' AND a.metadata->>'job_id' = p_job_id::text)
       ORDER BY a.created_at, a.id
    ) sub;

  -- ── 8. Inspection seals (now exposes ai_root_sha256 + ai_count) ──
  IF v_has_seals THEN
    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'inspector_sealed_at', row->>'id'), '[]'::jsonb)
      INTO v_seals
      FROM (
        SELECT jsonb_build_object(
          'id', s.id, 'report_id', s.report_id, 'job_id', s.job_id, 'inspector_id', s.inspector_id,
          'algorithm', s.algorithm, 'root_sha256', s.root_sha256,
          'captures_root_sha256', s.captures_root_sha256,
          'items_root_sha256', s.items_root_sha256,
          'report_meta_sha256', s.report_meta_sha256,
          'ai_root_sha256', s.ai_root_sha256,
          'ai_count', s.ai_count,
          'captures_count', s.captures_count, 'items_count', s.items_count,
          'chain_verified', s.chain_verified,
          'chain_break_at_capture_id', s.chain_break_at_capture_id,
          'inspector_sealed_at', s.inspector_sealed_at,
          'inspector_signature_sha256', s.inspector_signature_sha256,
          'client_signed_at', s.client_signed_at, 'client_signed_by', s.client_signed_by,
          'client_signature_sha256', s.client_signature_sha256,
          'audit_event_id', s.audit_event_id
        ) AS row
          FROM public.pi_report_seals s
          JOIN public.inspection_reports ir ON ir.id = s.report_id
         WHERE ir.job_id = p_job_id
      ) sub;
  ELSE v_seals := '[]'::jsonb; END IF;

  -- ── 9. Vendor coordination ──────────────────────────────────────
  IF v_has_bridge THEN
    SELECT
      CASE WHEN cb.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'bridge', jsonb_build_object(
          'id', cb.id,
          'status', cb.status,
          'created_at', cb.created_at,
          'completed_at', cb.completed_at,
          'cancelled_at', cb.cancelled_at,
          'token_issued_at', cb.token_issued_at,
          'token_expires_at', cb.token_expires_at,
          'token_revoked_at', cb.token_revoked_at,
          'vendor_first_seen_at', cb.vendor_first_seen_at,
          'vendor_last_seen_at',  cb.vendor_last_seen_at,
          'vendor_session_count', cb.vendor_session_count
        ),
        'vendor', (
          SELECT jsonb_build_object(
            'id', vc.id, 'company_name', vc.company_name,
            'contact_name', vc.contact_name, 'contact_email', vc.contact_email,
            'country_code', vc.country_code, 'timezone', vc.timezone,
            'language_code', vc.language_code
          ) FROM public.vendor_contacts vc WHERE vc.id = cb.vendor_contact_id
        ),
        'slots', (
          SELECT COALESCE(jsonb_agg(row ORDER BY row->>'sort_order', row->>'created_at'), '[]'::jsonb)
            FROM (
              SELECT jsonb_build_object(
                'id', s.id, 'kind', s.kind, 'status', s.status,
                'title', s.title, 'description', s.description, 'required', s.required,
                'sort_order', s.sort_order, 'payload', s.payload_json,
                'created_at', s.created_at, 'last_action_at', s.last_action_at,
                'completed_at', s.completed_at,
                'rejected_at', s.rejected_at, 'rejected_reason', s.rejected_reason
              ) AS row
                FROM public.bridge_slots s WHERE s.bridge_id = cb.id
            ) sub
        ),
        'documents', (
          SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at'), '[]'::jsonb)
            FROM (
              SELECT jsonb_build_object(
                'id', d.id, 'slot_id', d.slot_id,
                'uploaded_by_actor_kind', d.uploaded_by_actor_kind,
                'filename', d.original_filename, 'mime_type', d.mime_type,
                'size_bytes', d.file_size_bytes,
                'sha256_client_computed', d.sha256_client_computed,
                'sha256_server_verified', d.sha256_server_verified,
                'sha256_match', d.sha256_match,
                'created_at', d.created_at,
                'accepted_at', d.accepted_at, 'accepted_by_user_id', d.accepted_by_user_id,
                'rejected_at', d.rejected_at, 'rejected_reason', d.rejected_reason
              ) AS row
                FROM public.bridge_documents d WHERE d.bridge_id = cb.id
            ) sub
        )
      ) END INTO v_vendor_coordination
      FROM public.coordination_bridges cb WHERE cb.job_id = p_job_id;
  ELSE
    v_vendor_coordination := NULL;
  END IF;

  -- ── 9b. AI detections (Provable AI) ─────────────────────────────
  IF v_has_ai THEN
    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at', row->>'id'), '[]'::jsonb)
      INTO v_ai_detections
      FROM (
        SELECT jsonb_build_object(
          'id', d.id, 'job_id', d.job_id, 'report_id', d.report_id, 'capture_id', d.capture_id,
          'defect_id', d.defect_id, 'label', d.label, 'confidence', d.confidence,
          'severity', d.severity, 'severity_scale', d.severity_scale,
          'standard_refs', d.standard_refs,
          'model_slug', d.model_slug, 'model_version', d.model_version, 'model_sha256', d.model_sha256,
          'accepted_by_human', d.accepted_by_human, 'created_at', d.created_at
        ) AS row FROM public.ai_detections d WHERE d.job_id = p_job_id
      ) sub;
  ELSE v_ai_detections := '[]'::jsonb; END IF;

  -- ── 10. Audit row for this assembly call ────────────────────────
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT role, COALESCE(NULLIF(TRIM(full_name), ''), email, 'Unknown')
      INTO v_actor_role, v_actor_lbl
      FROM public.profiles WHERE id = v_actor;

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id
    ) VALUES (
      'compliance.evidence_pack.assembled',
      v_actor, COALESCE(v_actor_role, 'authenticated'), v_actor_lbl,
      'jobs', p_job_id,
      format('SOX evidence pack assembled for job %s', p_job_id::text),
      jsonb_build_object(
        'contracts_count', jsonb_array_length(v_contracts),
        'invoices_count',  jsonb_array_length(v_invoices),
        'audit_count',     jsonb_array_length(v_audit),
        'seals_count',     jsonb_array_length(v_seals),
        'ai_detections_count', COALESCE(jsonb_array_length(v_ai_detections), 0),
        'has_approval',    v_approvals IS NOT NULL,
        'has_vendor_coordination', v_vendor_coordination IS NOT NULL
      ),
      jsonb_build_object('job_id', p_job_id),
      v_correlation
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'correlation_id', v_correlation,
    'artifacts',      jsonb_build_object(
      'job',                  v_job,
      'parties',              v_parties,
      'department',           v_department,
      'contracts',            v_contracts,
      'approvals',            v_approvals,
      'invoices',             v_invoices,
      'audit_events',         v_audit,
      'inspection_seals',     v_seals,
      'vendor_coordination',  v_vendor_coordination,
      'ai_detections',        v_ai_detections
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assemble_evidence_pack(uuid) TO authenticated;

COMMIT;
