-- ════════════════════════════════════════════════════════════════════════════
--  20260605120000_compliance_evidence_locker.sql
--  Phase 6 / Sprint 9 — The Compliance Evidence Locker (CEL).
--
--  Lands a single RPC, `assemble_evidence_pack(p_job_id)`, that returns a
--  deterministic JSONB bundle of every artifact in a job's lifecycle:
--
--      · job                snapshot of public.jobs row
--      · parties            client + inspector profile snapshots
--      · department         dept + cost-center snapshot (if attributed)
--      · job_contracts      every contract revision with signature evidence
--      · approval_requests  + decisions (one or none per job)
--      · invoices           all invoices issued against the job
--      · audit_events       every audit row tagged to this job
--
--  DETERMINISM
--  ───────────
--  · Every subquery has an explicit ORDER BY (id ASC) so two consecutive
--    calls against unchanged data produce byte-identical JSONB.
--  · Timestamps emitted in ISO 8601 with timezone — Postgres' default
--    text-cast of timestamptz is deterministic.
--  · NO `now()` / `gen_random_uuid()` / `auth.uid()` values are placed
--    inside the artifact payload. Those go in the consumer's envelope.
--
--  AUTHORIZATION
--  ─────────────
--  · The NEXPEC Platform Owner (super_admin) — universal.
--  · The job's `client_id` (buyer who posted) — their own job.
--  · The job's `contractor_id` (assigned inspector) — their own work.
--  · Any org_member with role IN ('owner', 'procurement_admin') on the
--    org that the job's attributed department belongs to — i.e. the
--    Enterprise Admins of the tenant funding the job.
--
--  · Plain org_members with role IN ('project_lead', 'viewer') do NOT
--    get the pack — it contains the full chain-of-custody including
--    signature IPs and approval comments, which are need-to-know.
--
--  · Inspectors with no relationship to this job → denied.
--
--  AUDIT
--  ─────
--  Every successful call writes a 'compliance.evidence_pack.assembled'
--  audit_events row with the actor id, role, and a correlation_id that
--  matches the envelope's `correlation_id` the server action passes
--  back to the customer. The trail itself is auditable.
--
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  Helper: can_assemble_evidence_for(job_id, user_id) — single
--  authorization predicate used by the RPC. Lives at function level
--  (not RLS) because the RPC is SECURITY DEFINER.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_assemble_evidence_for(
  p_job_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job        record;
  v_dept_org   uuid;
  v_user_role  text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Platform Owner — universal.
  SELECT role INTO v_user_role FROM public.profiles WHERE id = p_user_id;
  IF v_user_role = 'super_admin' THEN
    RETURN true;
  END IF;

  -- Pull job's identifying ids.
  SELECT id, client_id, contractor_id, department_id
    INTO v_job
    FROM public.jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RETURN false;
  END IF;

  -- Job parties get their own evidence pack.
  IF v_job.client_id = p_user_id OR v_job.contractor_id = p_user_id THEN
    RETURN true;
  END IF;

  -- Enterprise Admin gate — elevated role on the org that owns the
  -- attributed department. Project leads + viewers are deliberately
  -- excluded (signature IPs + approval comments are need-to-know).
  IF v_job.department_id IS NOT NULL THEN
    SELECT org_id INTO v_dept_org FROM public.departments WHERE id = v_job.department_id;
    IF v_dept_org IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.org_members
         WHERE org_id  = v_dept_org
           AND user_id = p_user_id
           AND role IN ('owner', 'procurement_admin')
      ) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_assemble_evidence_for(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: assemble_evidence_pack
--
--  Returns a single JSONB object with the seven artifact groups.
--  Hashes are computed in the server action — keeping crypto outside
--  the DB lets us swap algorithms (SHA-256 → SHA3-256, future Ed25519
--  signature) without re-migrating.
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
  v_correlation uuid := gen_random_uuid();
  v_has_inv     boolean := to_regclass('public.invoices') IS NOT NULL;
  v_has_contr   boolean := to_regclass('public.job_contracts') IS NOT NULL;
  v_has_appr    boolean := to_regclass('public.approval_requests') IS NOT NULL;
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
    'id',                    j.id,
    'title',                 j.title,
    'description',           j.description,
    'status',                j.status,
    'moderation_status',     j.moderation_status,
    'urgency',               j.urgency,
    'job_type',              j.job_type,
    'location_city',         j.location_city,
    'client_id',             j.client_id,
    'agency_id',             j.agency_id,
    'contractor_id',         j.contractor_id,
    'budget_cents',          j.budget_cents,
    'client_price_cents',    j.client_price_cents,
    'inspector_payout_cents', j.inspector_payout_cents,
    'department_id',         j.department_id,
    'specialty_slugs',       j.specialty_slugs,
    'requires_cci',          j.requires_cci,
    'created_at',            j.created_at,
    'updated_at',            j.updated_at
  )
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;

  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  -- ── 2. Parties (client + inspector profile snapshots) ──────────
  SELECT jsonb_build_object(
    'client',     (
      SELECT jsonb_build_object(
        'id',         p.id,
        'full_name',  p.full_name,
        'email',      p.email,
        'role',       p.role
      ) FROM public.profiles p
       WHERE p.id = (v_job->>'client_id')::uuid
    ),
    'contractor', (
      SELECT jsonb_build_object(
        'id',         p.id,
        'full_name',  p.full_name,
        'email',      p.email,
        'role',       p.role
      ) FROM public.profiles p
       WHERE p.id = (v_job->>'contractor_id')::uuid
    )
  ) INTO v_parties;

  -- ── 3. Department + cost-center snapshot ───────────────────────
  IF (v_job->>'department_id') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id',           d.id,
      'org_id',       d.org_id,
      'name',         d.name,
      'cost_center',  d.cost_center,
      'parent_department_id', d.parent_department_id,
      'created_at',   d.created_at
    )
      INTO v_department
      FROM public.departments d
     WHERE d.id = (v_job->>'department_id')::uuid;
  ELSE
    v_department := NULL;
  END IF;

  -- ── 4. Contracts (every revision, with signature evidence) ─────
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
        'decisions',              (
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
      )
      END
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
          'id',                    i.id,
          'invoice_number',        i.invoice_number,
          'job_id',                i.job_id,
          'contract_id',           i.contract_id,
          'client_id',             i.client_id,
          'inspector_id',          i.inspector_id,
          'client_amount_cents',   i.client_amount_cents,
          'inspector_amount_cents', i.inspector_amount_cents,
          'platform_fee_cents',    i.platform_fee_cents,
          'total_cents',           i.total_cents,
          'currency',              i.currency,
          'status',                i.status,
          'issued_at',             i.issued_at,
          'due_date',              i.due_date,
          'approved_at',           i.approved_at,
          'disputed_at',           i.disputed_at,
          'dispute_reason',        i.dispute_reason,
          'paid_at',               i.paid_at,
          'paid_reference',        i.paid_reference,
          'voided_at',             i.voided_at,
          'voided_reason',         i.voided_reason,
          'department_id',         i.department_id,
          'cost_center_snapshot',  i.cost_center_snapshot,
          'line_items',            COALESCE(i.line_items_json, '[]'::jsonb)
        ) AS row
          FROM public.invoices i
         WHERE i.job_id = p_job_id
      ) sub;
  ELSE
    v_invoices := '[]'::jsonb;
  END IF;

  -- ── 7. Audit events scoped to this job ─────────────────────────
  -- Union of (a) direct subject_id = job_id rows, (b) metadata.job_id
  -- match, (c) subject_id = a related contract/invoice/approval row.
  WITH related_subjects AS (
    SELECT p_job_id AS subject_id
    UNION
    SELECT id FROM public.job_contracts WHERE v_has_contr AND job_id = p_job_id
    UNION
    SELECT id FROM public.invoices WHERE v_has_inv AND job_id = p_job_id
    UNION
    SELECT id FROM public.approval_requests WHERE v_has_appr AND job_id = p_job_id
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

  -- ── 8. Write our own audit row for this assembly call ──────────
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
        'has_approval',    v_approvals IS NOT NULL
      ),
      jsonb_build_object('job_id', p_job_id),
      v_correlation
    );
  END IF;

  -- ── 9. Return the bundle ───────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',             true,
    'correlation_id', v_correlation,
    'artifacts',      jsonb_build_object(
      'job',          v_job,
      'parties',      v_parties,
      'department',   v_department,
      'contracts',    v_contracts,
      'approvals',    v_approvals,
      'invoices',     v_invoices,
      'audit_events', v_audit
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assemble_evidence_pack(uuid) TO authenticated;

COMMIT;
