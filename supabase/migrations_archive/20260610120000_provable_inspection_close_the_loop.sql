-- ════════════════════════════════════════════════════════════════════════════
--  20260610120000_provable_inspection_close_the_loop.sql
--
--  PROVABLE INSPECTION ENGINE — Sprint 2 (closing migration).
--
--  Three closing changes that finish the loop:
--
--    1) Fix `digest()` search-path so pi_* RPCs can find pgcrypto.
--       (pgcrypto lives in the `extensions` schema in Supabase, not
--        `public` — my Sprint-1 migration set search_path too narrowly.)
--
--    2) Wire pi_report_seals into assemble_evidence_pack so the CEL
--       manifest includes seal data. Adds an 8th artifact group:
--       `inspection_seals` (array, sorted by inspector_sealed_at).
--
--    3) Trigger tg_notify_inspection_report_sealed that fires on
--       INSERT into pi_report_seals and uses the existing
--       enqueue_notification helper to email the job's client with a
--       deep link to the new countersign action. Routes through the
--       same dispatch-notification-emails Edge Function (no new wiring).
--
--  Pure additive — touches no existing files. Existing assemble_evidence_pack
--  is replaced via CREATE OR REPLACE (atomic; same signature).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Fix the digest() search-path issue across all three pi_* RPCs.
-- ─────────────────────────────────────────────────────────────────────
ALTER FUNCTION public.pi_seal_inspection_report(uuid)
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.pi_countersign_inspection_report(uuid)
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.pi_fetch_report_seal(uuid)
  SET search_path = public, extensions, pg_temp;

-- ─────────────────────────────────────────────────────────────────────
-- 2) assemble_evidence_pack — add an `inspection_seals` artifact group.
--
--    Strategy: load every pi_report_seals row whose report belongs to
--    this job, ordered deterministically by inspector_sealed_at. The
--    seal's root_sha256 becomes a cryptographic anchor inside the pack —
--    a third-party verifier can re-derive it from the raw rows and
--    confirm the inspection_reports / inspection_items / inspection_captures
--    content has not been mutated since sealing.
--
--    Authorization gate is unchanged — can_assemble_evidence_for(...)
--    already governs who can call this RPC.
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
  v_correlation uuid := gen_random_uuid();
  v_has_inv     boolean := to_regclass('public.invoices')           IS NOT NULL;
  v_has_contr   boolean := to_regclass('public.job_contracts')      IS NOT NULL;
  v_has_appr    boolean := to_regclass('public.approval_requests')  IS NOT NULL;
  v_has_seals   boolean := to_regclass('public.pi_report_seals')    IS NOT NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_assemble_evidence_for(p_job_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to assemble an evidence pack for this job'
      USING ERRCODE = '42501';
  END IF;

  -- ── 1. Job snapshot ─────────────────────────────────────────────
  SELECT jsonb_build_object(
    'id',                     j.id,
    'title',                  j.title,
    'description',            j.description,
    'status',                 j.status,
    'moderation_status',      j.moderation_status,
    'urgency',                j.urgency,
    'job_type',               j.job_type,
    'location_city',          j.location_city,
    'client_id',              j.client_id,
    'agency_id',              j.agency_id,
    'contractor_id',          j.contractor_id,
    'budget_cents',           j.budget_cents,
    'client_price_cents',     j.client_price_cents,
    'inspector_payout_cents', j.inspector_payout_cents,
    'department_id',          j.department_id,
    'specialty_slugs',        j.specialty_slugs,
    'requires_cci',           j.requires_cci,
    'created_at',             j.created_at,
    'updated_at',             j.updated_at
  )
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;

  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  -- ── 2. Parties ──────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'client', (
      SELECT jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role
      ) FROM public.profiles p WHERE p.id = (v_job->>'client_id')::uuid
    ),
    'contractor', (
      SELECT jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role
      ) FROM public.profiles p WHERE p.id = (v_job->>'contractor_id')::uuid
    )
  ) INTO v_parties;

  -- ── 3. Department + cost-center ────────────────────────────────
  IF (v_job->>'department_id') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id',                   d.id,
      'org_id',               d.org_id,
      'name',                 d.name,
      'cost_center',          d.cost_center,
      'parent_department_id', d.parent_department_id,
      'created_at',           d.created_at
    )
      INTO v_department
      FROM public.departments d
     WHERE d.id = (v_job->>'department_id')::uuid;
  ELSE
    v_department := NULL;
  END IF;

  -- ── 4. Contracts ───────────────────────────────────────────────
  IF v_has_contr THEN
    SELECT COALESCE(jsonb_agg(row ORDER BY ord), '[]'::jsonb) INTO v_contracts
      FROM (
        SELECT row_number() OVER (ORDER BY c.id) AS ord,
          jsonb_build_object(
            'id',                     c.id,
            'job_id',                 c.job_id,
            'application_id',         c.application_id,
            'client_id',              c.client_id,
            'inspector_id',           c.inspector_id,
            'client_price_cents',     c.client_price_cents,
            'inspector_payout_cents', c.inspector_payout_cents,
            'contract_text_md',       c.contract_text_md,
            'custom_contract_url',    c.custom_contract_url,
            'status',                 c.status,
            'client_signed_at',       c.client_signed_at,
            'client_signed_name',     c.client_signed_name,
            'client_signed_ip',       c.client_signed_ip,
            'inspector_signed_at',    c.inspector_signed_at,
            'inspector_signed_name',  c.inspector_signed_name,
            'inspector_signed_ip',    c.inspector_signed_ip,
            'created_at',             COALESCE(to_jsonb((row_to_json(c) ->> 'created_at')), 'null'::jsonb)
          ) AS row
          FROM public.job_contracts c
         WHERE c.job_id = p_job_id
      ) sub;
  ELSE
    v_contracts := '[]'::jsonb;
  END IF;

  -- ── 5. Approval request + decisions ────────────────────────────
  IF v_has_appr THEN
    SELECT
      CASE WHEN r.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id',                     r.id,
        'org_id',                 r.org_id,
        'job_id',                 r.job_id,
        'department_id',          r.department_id,
        'policy_id',              r.policy_id,
        'requested_by',           r.requested_by,
        'requested_at',           r.requested_at,
        'amount_cents',           r.amount_cents,
        'currency',               r.currency,
        'status',                 r.status,
        'min_approvers_required', r.min_approvers_required,
        'required_approver_roles', r.required_approver_roles,
        'requires_sod',           r.requires_sod,
        'final_decision_at',      r.final_decision_at,
        'final_decision_by',      r.final_decision_by,
        'rejection_reason',       r.rejection_reason,
        'decisions', (
          SELECT COALESCE(jsonb_agg(d ORDER BY d->>'decided_at'), '[]'::jsonb)
          FROM (
            SELECT jsonb_build_object(
              'id',                   ad.id,
              'decided_by',           ad.decided_by,
              'decided_at',           ad.decided_at,
              'decision',             ad.decision,
              'comment',              ad.comment,
              'decider_role_at_time', ad.decider_role_at_time
            ) AS d
              FROM public.approval_decisions ad
             WHERE ad.approval_request_id = r.id
             ORDER BY ad.decided_at
          ) sub
        )
      ) END
      INTO v_approvals
      FROM public.approval_requests r
     WHERE r.job_id = p_job_id;
  ELSE
    v_approvals := NULL;
  END IF;

  -- ── 6. Invoices ────────────────────────────────────────────────
  IF v_has_inv THEN
    SELECT COALESCE(jsonb_agg(row ORDER BY row->>'issued_at' NULLS LAST, row->>'id'), '[]'::jsonb) INTO v_invoices
      FROM (
        SELECT jsonb_build_object(
          'id',                     i.id,
          'invoice_number',         i.invoice_number,
          'job_id',                 i.job_id,
          'contract_id',            i.contract_id,
          'client_id',              i.client_id,
          'inspector_id',           i.inspector_id,
          'client_amount_cents',    i.client_amount_cents,
          'inspector_amount_cents', i.inspector_amount_cents,
          'platform_fee_cents',     i.platform_fee_cents,
          'total_cents',            i.total_cents,
          'currency',               i.currency,
          'status',                 i.status,
          'issued_at',              i.issued_at,
          'due_date',               i.due_date,
          'approved_at',            i.approved_at,
          'disputed_at',            i.disputed_at,
          'dispute_reason',         i.dispute_reason,
          'paid_at',                i.paid_at,
          'paid_reference',         i.paid_reference,
          'voided_at',              i.voided_at,
          'voided_reason',          i.voided_reason,
          'department_id',          i.department_id,
          'cost_center_snapshot',   i.cost_center_snapshot,
          'line_items',             COALESCE(i.line_items_json, '[]'::jsonb)
        ) AS row
          FROM public.invoices i
         WHERE i.job_id = p_job_id
      ) sub;
  ELSE
    v_invoices := '[]'::jsonb;
  END IF;

  -- ── 7. Audit events ────────────────────────────────────────────
  WITH related_subjects AS (
    SELECT p_job_id AS subject_id
    UNION
    SELECT id FROM public.job_contracts     WHERE v_has_contr AND job_id = p_job_id
    UNION
    SELECT id FROM public.invoices          WHERE v_has_inv   AND job_id = p_job_id
    UNION
    SELECT id FROM public.approval_requests WHERE v_has_appr  AND job_id = p_job_id
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at', row->>'id'), '[]'::jsonb)
    INTO v_audit
    FROM (
      SELECT jsonb_build_object(
        'id',             a.id,
        'created_at',     a.created_at,
        'event_type',     a.event_type,
        'severity',       a.severity,
        'actor_id',       a.actor_id,
        'actor_role',     a.actor_role,
        'actor_label',    a.actor_label,
        'subject_table',  a.subject_table,
        'subject_id',     a.subject_id,
        'summary',        a.summary,
        'delta',          a.delta,
        'metadata',       a.metadata,
        'correlation_id', a.correlation_id
      ) AS row
        FROM public.audit_events a
       WHERE a.subject_id IN (SELECT subject_id FROM related_subjects)
          OR (a.metadata ? 'job_id' AND a.metadata->>'job_id' = p_job_id::text)
       ORDER BY a.created_at, a.id
    ) sub;

  -- ── 8. Inspection seals (NEW — Sprint 2 closing) ───────────────
  -- One seal row per sealed inspection_report. Deterministic order.
  IF v_has_seals THEN
    SELECT COALESCE(
      jsonb_agg(row ORDER BY row->>'inspector_sealed_at', row->>'id'),
      '[]'::jsonb
    ) INTO v_seals
      FROM (
        SELECT jsonb_build_object(
          'id',                         s.id,
          'report_id',                  s.report_id,
          'job_id',                     s.job_id,
          'inspector_id',               s.inspector_id,
          'algorithm',                  s.algorithm,
          'root_sha256',                s.root_sha256,
          'captures_root_sha256',       s.captures_root_sha256,
          'items_root_sha256',          s.items_root_sha256,
          'report_meta_sha256',         s.report_meta_sha256,
          'captures_count',             s.captures_count,
          'items_count',                s.items_count,
          'chain_verified',             s.chain_verified,
          'chain_break_at_capture_id',  s.chain_break_at_capture_id,
          'inspector_sealed_at',        s.inspector_sealed_at,
          'inspector_signature_sha256', s.inspector_signature_sha256,
          'client_signed_at',           s.client_signed_at,
          'client_signed_by',           s.client_signed_by,
          'client_signature_sha256',    s.client_signature_sha256,
          'audit_event_id',             s.audit_event_id
        ) AS row
          FROM public.pi_report_seals s
          JOIN public.inspection_reports ir ON ir.id = s.report_id
         WHERE ir.job_id = p_job_id
      ) sub;
  ELSE
    v_seals := '[]'::jsonb;
  END IF;

  -- ── 9. Write our own audit row ─────────────────────────────────
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
        'has_approval',    v_approvals IS NOT NULL
      ),
      jsonb_build_object('job_id', p_job_id),
      v_correlation
    );
  END IF;

  -- ── 10. Return the bundle (now with inspection_seals) ──────────
  RETURN jsonb_build_object(
    'ok',             true,
    'correlation_id', v_correlation,
    'artifacts',      jsonb_build_object(
      'job',               v_job,
      'parties',           v_parties,
      'department',        v_department,
      'contracts',         v_contracts,
      'approvals',         v_approvals,
      'invoices',          v_invoices,
      'audit_events',      v_audit,
      'inspection_seals',  v_seals
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assemble_evidence_pack(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Notification trigger — emails the job's client when a seal lands,
--    nudging them to countersign.
--
--    Routes through enqueue_notification → in-app row + email queue
--    overlay. The dispatch-notification-emails Edge Function will pick
--    it up on its next 5-minute tick and send via Resend, using the
--    'inspection_report.sealed_awaiting_countersign' template (added
--    in the matching templates.ts patch).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_inspection_report_sealed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job        RECORD;
  v_inspector  RECORD;
  v_link       text;
  v_verify     text;
  v_template_data jsonb;
BEGIN
  -- Job context — bail silently if we can't resolve the client.
  SELECT id, title, client_id
    INTO v_job
    FROM public.jobs
   WHERE id = NEW.job_id;

  IF v_job.id IS NULL OR v_job.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Inspector profile (best-effort label).
  SELECT id, full_name, email
    INTO v_inspector
    FROM public.profiles
   WHERE id = NEW.inspector_id;

  v_link   := '/client/jobs/' || NEW.job_id::text || '#countersign';
  v_verify := '/verify?seal_id=' || NEW.id::text
              || '&hash=' || NEW.root_sha256;

  v_template_data := jsonb_build_object(
    'seal_id',                    NEW.id,
    'report_id',                  NEW.report_id,
    'job_id',                     NEW.job_id,
    'job_title',                  COALESCE(NULLIF(v_job.title, ''), 'Inspection job'),
    'inspector_id',               NEW.inspector_id,
    'inspector_name',             COALESCE(NULLIF(v_inspector.full_name, ''), v_inspector.email),
    'root_sha256',                NEW.root_sha256,
    'captures_count',             NEW.captures_count,
    'items_count',                NEW.items_count,
    'chain_verified',             NEW.chain_verified,
    'algorithm',                  NEW.algorithm,
    'inspector_sealed_at',        NEW.inspector_sealed_at,
    'inspector_signature_sha256', NEW.inspector_signature_sha256,
    'countersign_link',           v_link,
    'verify_link',                v_verify
  );

  -- Pings client + queues email.
  PERFORM public.enqueue_notification(
    v_job.client_id,
    'inspection_sealed_awaiting_countersign',
    'Your inspection report is sealed — ready to countersign',
    'Inspector ' || COALESCE(NULLIF(v_inspector.full_name, ''), v_inspector.email)
      || ' sealed the report for '
      || COALESCE(NULLIF(v_job.title, ''), 'this job')
      || '. Open it to review and add your countersignature.',
    v_link,
    NEW.job_id,
    true,
    'inspection_report.sealed_awaiting_countersign',
    v_template_data
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_notify_inspection_report_sealed: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tg_notify_inspection_report_sealed ON public.pi_report_seals;
CREATE TRIGGER tg_notify_inspection_report_sealed
  AFTER INSERT ON public.pi_report_seals
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_inspection_report_sealed();

COMMIT;
