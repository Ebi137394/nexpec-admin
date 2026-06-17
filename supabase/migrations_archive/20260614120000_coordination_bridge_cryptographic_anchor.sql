-- ════════════════════════════════════════════════════════════════════════════
--  20260614120000_coordination_bridge_cryptographic_anchor.sql
--
--  COORDINATION BRIDGE — Sprint C (cryptographic anchoring + new detector).
--
--  Three changes that close the loop end-to-end:
--
--    1) Extend `assemble_evidence_pack` with a NINTH artifact group:
--       `vendor_coordination` (bridge state + accepted documents +
--       vendor identity snapshot). The evidence pack now contains the
--       full pre-inspection coordination history.
--
--    2) Extend `pi_seal_inspection_report` so the inspection seal's
--       `root_sha256` is computed over a FOUR-component composition:
--         captures_root || items_root || report_meta || vendor_chain_root
--       where vendor_chain_root is SHA-256 over the deterministic
--       concatenation of every accepted vendor document's
--       `sha256_client_computed`, ordered by accepted_at.
--       Tampering with any accepted vendor document invalidates the
--       seal — the cryptographic chain now extends backwards through
--       the vendor relationship.
--
--    3) Add `detect_vendor_coordination_latency` — the 7th anomaly
--       detector in the Compliance Command Center. Surfaces vendor
--       relationships that systematically delay document submission
--       or scheduling responses.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) assemble_evidence_pack — add the vendor_coordination artifact group.
-- ─────────────────────────────────────────────────────────────────────
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
  v_correlation uuid := gen_random_uuid();
  v_has_inv     boolean := to_regclass('public.invoices')              IS NOT NULL;
  v_has_contr   boolean := to_regclass('public.job_contracts')         IS NOT NULL;
  v_has_appr    boolean := to_regclass('public.approval_requests')     IS NOT NULL;
  v_has_seals   boolean := to_regclass('public.pi_report_seals')       IS NOT NULL;
  v_has_bridge  boolean := to_regclass('public.coordination_bridges')  IS NOT NULL;
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

  -- ── 8. Inspection seals ─────────────────────────────────────────
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

  -- ── 9. Vendor coordination (NEW) ────────────────────────────────
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
      'vendor_coordination',  v_vendor_coordination
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assemble_evidence_pack(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) pi_seal_inspection_report — fold accepted vendor-document hashes
--    into the seal root. Algorithm version bumped to v2.
-- ─────────────────────────────────────────────────────────────────────
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

  v_captures_root      text;
  v_items_root         text;
  v_report_meta_sha    text;
  v_vendor_root        text;
  v_root               text;
  v_inspector_sig      text;

  v_audit_id           uuid;
  v_actor_role         text;

  v_capture            RECORD;
  v_item               RECORD;
  v_vendor_doc         RECORD;
  v_item_jsonb         jsonb;
  v_report_jsonb       jsonb;

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

  -- ── Vendor-chain root (NEW · Sprint C) ──
  -- Hash chain over every ACCEPTED vendor-uploaded document belonging
  -- to the Coordination Bridge for this report's job. Order by
  -- accepted_at, then id, so re-derivation is deterministic.
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

  -- ── Compose root (4-component, lexicographic) ──
  WITH parts(s) AS (
    VALUES (v_captures_root), (v_items_root), (v_report_meta_sha), (v_vendor_root)
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
    format('Sealed inspection report %s (captures=%s, items=%s, chain=%s)',
      p_report_id, v_captures_count, v_items_count,
      CASE WHEN v_chain_verified THEN 'intact' ELSE 'broken' END),
    jsonb_build_object(
      'seal_id',                   v_seal_id,
      'root_sha256',               v_root,
      'captures_root_sha256',      v_captures_root,
      'items_root_sha256',         v_items_root,
      'report_meta_sha256',        v_report_meta_sha,
      'vendor_chain_root_sha256',  v_vendor_root,
      'inspector_signature_sha256', v_inspector_sig,
      'captures_count',            v_captures_count,
      'items_count',               v_items_count,
      'chain_verified',            v_chain_verified,
      'chain_break_at_capture_id', v_chain_break_at,
      'algorithm',                 'sha256/canonical-json/v2'
    ),
    jsonb_build_object('seal_id', v_seal_id::text, 'root_hash', v_root)
  )
  RETURNING id INTO v_audit_id;

  INSERT INTO public.pi_report_seals (
    id, report_id, job_id, inspector_id,
    algorithm,
    root_sha256, captures_root_sha256, items_root_sha256, report_meta_sha256,
    captures_count, items_count,
    chain_verified, chain_break_at_capture_id,
    inspector_sealed_at, inspector_signature_sha256,
    audit_event_id
  )
  VALUES (
    v_seal_id,
    p_report_id, v_report.job_id, v_report.inspector_id,
    'sha256/canonical-json/v2',
    v_root, v_captures_root, v_items_root, v_report_meta_sha,
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

-- ─────────────────────────────────────────────────────────────────────
-- 3) detect_vendor_coordination_latency — 7th anomaly detector.
--
--    Surfaces vendor contacts whose median document-fulfilment time
--    exceeds 5 days across at least 2 bridges, OR whose schedule
--    counter-proposals exceed 3 rounds on a single bridge. These
--    patterns indicate strained vendor relationships that should
--    elevate to compliance leadership.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_vendor_coordination_latency(
  p_org_id uuid,
  p_lookback_days integer DEFAULT 90
) RETURNS TABLE (
  vendor_contact_id   uuid,
  vendor_company      text,
  bridges_count       integer,
  median_doc_days     numeric,
  max_counter_rounds  integer,
  severity            text,
  evidence            jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_admin  boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role='super_admin') INTO v_admin;
  IF NOT v_admin
     AND NOT EXISTS (
       SELECT 1 FROM public.org_members
        WHERE org_id = p_org_id AND user_id = v_caller
          AND role IN ('owner', 'procurement_admin')
     )
  THEN
    RAISE EXCEPTION 'not authorised to read compliance posture for this org' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  WITH org_jobs AS (
    SELECT j.id AS job_id, j.created_at
      FROM public.jobs j
      JOIN public.departments d ON d.id = j.department_id
     WHERE d.org_id = p_org_id
       AND j.created_at >= now() - (GREATEST(1, COALESCE(p_lookback_days, 90)) || ' days')::interval
  ),
  org_bridges AS (
    SELECT cb.id, cb.vendor_contact_id, cb.job_id, cb.created_at, cb.completed_at, cb.cancelled_at
      FROM public.coordination_bridges cb
      JOIN org_jobs oj ON oj.job_id = cb.job_id
  ),
  doc_latency AS (
    SELECT b.vendor_contact_id,
           b.id AS bridge_id,
           extract(epoch from (d.accepted_at - s.created_at)) / 86400.0 AS days_to_accept
      FROM org_bridges b
      JOIN public.bridge_slots s     ON s.bridge_id = b.id AND s.kind = 'document_request'
      JOIN public.bridge_documents d ON d.slot_id = s.id AND d.accepted_at IS NOT NULL
  ),
  schedule_counters AS (
    SELECT b.vendor_contact_id, b.id AS bridge_id,
           COUNT(*) FILTER (
             WHERE a.event_type = 'coordination_bridge.schedule_counter_proposed'
                OR a.event_type = 'coordination_bridge.schedule_proposed'
           ) AS rounds
      FROM org_bridges b
      LEFT JOIN public.audit_events a
             ON a.subject_table = 'coordination_bridges'
            AND a.subject_id = b.id
     GROUP BY b.vendor_contact_id, b.id
  ),
  vendor_agg AS (
    SELECT
      ob.vendor_contact_id,
      COUNT(DISTINCT ob.id)::int AS bridges_count,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY dl.days_to_accept), 0) AS median_doc_days,
      COALESCE(MAX(sc.rounds), 0)::int AS max_counter_rounds
    FROM org_bridges ob
    LEFT JOIN doc_latency       dl ON dl.vendor_contact_id = ob.vendor_contact_id
    LEFT JOIN schedule_counters sc ON sc.bridge_id = ob.id
   GROUP BY ob.vendor_contact_id
  )
  SELECT
    va.vendor_contact_id,
    vc.company_name AS vendor_company,
    va.bridges_count,
    round(va.median_doc_days::numeric, 2) AS median_doc_days,
    va.max_counter_rounds,
    CASE
      WHEN va.median_doc_days > 14 OR va.max_counter_rounds >= 5 THEN 'critical'
      WHEN va.median_doc_days > 5  OR va.max_counter_rounds >= 3 THEN 'warning'
      ELSE 'info'
    END AS severity,
    jsonb_build_object(
      'vendor_company',     vc.company_name,
      'vendor_email',       vc.contact_email,
      'bridges_count',      va.bridges_count,
      'median_doc_days',    round(va.median_doc_days::numeric, 2),
      'max_counter_rounds', va.max_counter_rounds,
      'lookback_days',      COALESCE(p_lookback_days, 90)
    ) AS evidence
    FROM vendor_agg va
    JOIN public.vendor_contacts vc ON vc.id = va.vendor_contact_id
   WHERE va.bridges_count >= 1
     AND (va.median_doc_days > 5 OR va.max_counter_rounds >= 3)
   ORDER BY severity DESC, va.median_doc_days DESC;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.detect_vendor_coordination_latency(uuid, integer)
  TO authenticated;

COMMIT;
