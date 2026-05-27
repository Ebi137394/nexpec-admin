-- ════════════════════════════════════════════════════════════════════════════
--  20260604120000_procurement_control_plane_rpcs.sql
--  Phase 6 / Sprint 8 — The Procurement Control Plane (engine layer).
--
--  Ships:
--    1. jobs.status — adds 'pending_approval' to the CHECK constraint
--    2. set_department_budget          — allocate an envelope
--    3. set_approval_policy            — define a band
--    4. check_department_budget        — read-only consumption query
--    5. evaluate_job_for_approval      — does this job need a gate?
--    6. submit_job_approval            — record a decision (SoD-checked)
--    7. cancel_job_approval            — requester withdraws
--    8. fetch_my_pending_approvals     — approver dashboard feed
--
--  All RPCs SECURITY DEFINER, all audit-stamped where they mutate,
--  all gated by can_manage_org_structure or its tighter variants.
--
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  Extend jobs.status to allow 'pending_approval'
--
--  We rebuild the CHECK constraint defensively — production may have a
--  different existing set. Pulls the existing constraint name and rebuilds
--  with the new value union. Idempotent.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_existing_check text;
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RAISE NOTICE 'jobs table not found, skipping status check rebuild';
    RETURN;
  END IF;

  -- Drop the old check constraint if present.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_status_check') THEN
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_status_check;
  END IF;

  -- Rebuild with the full status alphabet INCLUDING pending_approval.
  -- Values match the production status enum + the new gate state.
  ALTER TABLE public.jobs ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
      'pending_approval',     -- ← Sprint 8 (Procurement Control Plane gate)
      'open',
      'assigned',
      'in_progress',
      'completed',
      'paid',
      'cancelled',
      'disputed'
    )
  );

  COMMENT ON CONSTRAINT jobs_status_check ON public.jobs IS
    'Sprint 8: pending_approval added as the parked-pre-marketplace state for jobs that breached an approval gate.';
END $$;

-- Marketplace queries already filter `WHERE status = ''open''` — adding
-- pending_approval automatically hides those jobs from inspectors.

-- ─────────────────────────────────────────────────────────────────────
--  RPC: set_department_budget
--
--  Allocate (or update) a budget envelope for one department in one
--  fiscal period. Gated by can_manage_org_structure (Platform Owner OR
--  org owner / procurement_admin).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_department_budget(
  p_department_id        uuid,
  p_fiscal_period_start  date,
  p_fiscal_period_end    date,
  p_currency             text,
  p_allocated_cents      bigint,
  p_notes                text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_actor_lbl  text;
  v_org_id     uuid;
  v_currency   public.currency_code;
  v_id         uuid;
  v_existing   record;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT org_id INTO v_org_id FROM public.departments WHERE id = p_department_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_org_structure(v_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to set budgets for this organization'
      USING ERRCODE = '42501';
  END IF;

  IF p_allocated_cents IS NULL OR p_allocated_cents < 0 THEN
    RAISE EXCEPTION 'allocated_cents must be >= 0 (got %)', p_allocated_cents USING ERRCODE = '22000';
  END IF;
  IF p_fiscal_period_end <= p_fiscal_period_start THEN
    RAISE EXCEPTION 'fiscal_period_end must be after fiscal_period_start' USING ERRCODE = '22000';
  END IF;

  v_currency := p_currency::public.currency_code;

  -- Capture existing for the audit delta.
  SELECT id, allocated_cents, currency
    INTO v_existing
    FROM public.department_budgets
   WHERE department_id = p_department_id
     AND fiscal_period_start = p_fiscal_period_start
     AND fiscal_period_end   = p_fiscal_period_end
   FOR UPDATE;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.department_budgets (
      org_id, department_id, fiscal_period_start, fiscal_period_end,
      currency, allocated_cents, notes, created_by
    ) VALUES (
      v_org_id, p_department_id, p_fiscal_period_start, p_fiscal_period_end,
      v_currency, p_allocated_cents, p_notes, v_actor
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.department_budgets
       SET currency        = v_currency,
           allocated_cents = p_allocated_cents,
           notes           = p_notes,
           updated_at      = now()
     WHERE id = v_existing.id;
    v_id := v_existing.id;
  END IF;

  -- Audit
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT actor_role, actor_label INTO v_actor_role, v_actor_lbl
      FROM public._dept_actor_profile(v_actor);

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id
    ) VALUES (
      CASE WHEN v_existing.id IS NULL THEN 'department.budget.created' ELSE 'department.budget.updated' END,
      v_actor, v_actor_role, v_actor_lbl,
      'department_budgets', v_id,
      format('Department budget %s for %L..%L: %s %s',
        CASE WHEN v_existing.id IS NULL THEN 'created' ELSE 'updated' END,
        p_fiscal_period_start, p_fiscal_period_end, v_currency,
        (p_allocated_cents::numeric / 100)::text),
      jsonb_build_object(
        'from_allocated_cents', v_existing.allocated_cents,
        'to_allocated_cents',   p_allocated_cents,
        'currency',             v_currency,
        'period_start',         p_fiscal_period_start,
        'period_end',           p_fiscal_period_end
      ),
      jsonb_build_object('org_id', v_org_id, 'department_id', p_department_id),
      v_correlation
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'budget_id', v_id,
    'org_id', v_org_id,
    'department_id', p_department_id,
    'allocated_cents', p_allocated_cents,
    'currency', v_currency,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_department_budget(uuid, date, date, text, bigint, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: set_approval_policy
--
--  Create or update one band. Tier-overlap is enforced by the constraint
--  trigger on the table — this RPC just provides a clean validated
--  surface + audit row. Pass `p_id` to update an existing band; omit
--  for insert.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_approval_policy(
  p_org_id                  uuid,
  p_name                    text,
  p_min_amount_cents        bigint,
  p_max_amount_cents        bigint,        -- NULL = unbounded above
  p_currency                text,
  p_required_approver_roles text[],
  p_min_approvers_count     int            DEFAULT 1,
  p_requires_sod            boolean        DEFAULT true,
  p_scope_department_id     uuid           DEFAULT NULL,
  p_is_active               boolean        DEFAULT true,
  p_id                      uuid           DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_actor_lbl   text;
  v_currency    public.currency_code;
  v_id          uuid;
  v_correlation uuid := gen_random_uuid();
  v_op          text := CASE WHEN p_id IS NULL THEN 'created' ELSE 'updated' END;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_manage_org_structure(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to set approval policies for this organization'
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'policy name is required' USING ERRCODE = '22000';
  END IF;
  IF p_min_amount_cents IS NULL OR p_min_amount_cents < 0 THEN
    RAISE EXCEPTION 'min_amount_cents must be >= 0' USING ERRCODE = '22000';
  END IF;
  IF p_max_amount_cents IS NOT NULL AND p_max_amount_cents <= p_min_amount_cents THEN
    RAISE EXCEPTION 'max_amount_cents must be > min_amount_cents (or NULL)' USING ERRCODE = '22000';
  END IF;
  IF p_min_approvers_count IS NULL OR p_min_approvers_count < 1 THEN
    RAISE EXCEPTION 'min_approvers_count must be >= 1' USING ERRCODE = '22000';
  END IF;
  IF p_required_approver_roles IS NULL OR array_length(p_required_approver_roles, 1) < 1 THEN
    RAISE EXCEPTION 'required_approver_roles must include at least one role' USING ERRCODE = '22000';
  END IF;
  -- Validate roles against the org_member_role enum (defensive — text[] storage)
  IF EXISTS (
    SELECT 1 FROM unnest(p_required_approver_roles) r
    WHERE r NOT IN ('owner','procurement_admin','project_lead','viewer')
  ) THEN
    RAISE EXCEPTION 'required_approver_roles contains an unknown org_member_role' USING ERRCODE = '22000';
  END IF;

  v_currency := p_currency::public.currency_code;

  IF p_scope_department_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.departments
       WHERE id = p_scope_department_id AND org_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'scope_department_id does not belong to this organization' USING ERRCODE = '22000';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.approval_policies (
      org_id, name, min_amount_cents, max_amount_cents, currency,
      required_approver_roles, min_approvers_count, requires_sod,
      scope_department_id, is_active, created_by
    ) VALUES (
      p_org_id, trim(p_name), p_min_amount_cents, p_max_amount_cents, v_currency,
      p_required_approver_roles, p_min_approvers_count, p_requires_sod,
      p_scope_department_id, p_is_active, v_actor
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.approval_policies
       SET name                    = trim(p_name),
           min_amount_cents        = p_min_amount_cents,
           max_amount_cents        = p_max_amount_cents,
           currency                = v_currency,
           required_approver_roles = p_required_approver_roles,
           min_approvers_count     = p_min_approvers_count,
           requires_sod            = p_requires_sod,
           scope_department_id     = p_scope_department_id,
           is_active               = p_is_active,
           updated_at              = now()
     WHERE id = p_id AND org_id = p_org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Approval policy not found' USING ERRCODE = 'P0002';
    END IF;
    v_id := p_id;
  END IF;

  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT actor_role, actor_label INTO v_actor_role, v_actor_lbl
      FROM public._dept_actor_profile(v_actor);

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id
    ) VALUES (
      format('approval_policy.%s', v_op),
      v_actor, v_actor_role, v_actor_lbl,
      'approval_policies', v_id,
      format('Approval policy %L %s: %s %s..%s',
        trim(p_name), v_op, v_currency,
        (p_min_amount_cents::numeric / 100)::text,
        COALESCE((p_max_amount_cents::numeric / 100)::text, '∞')),
      jsonb_build_object(
        'min_amount_cents', p_min_amount_cents,
        'max_amount_cents', p_max_amount_cents,
        'currency', v_currency,
        'required_approver_roles', p_required_approver_roles,
        'min_approvers_count', p_min_approvers_count,
        'requires_sod', p_requires_sod
      ),
      jsonb_build_object('org_id', p_org_id),
      v_correlation
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'policy_id', v_id,
    'org_id', p_org_id,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_approval_policy(uuid, text, bigint, bigint, text, text[], int, boolean, uuid, boolean, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: check_department_budget
--
--  Read-only. Returns (allocated, committed, paid, available) for the
--  given dept × period, all in the budget's native currency. The
--  `p_additional_cents` parameter lets the caller ask "if I were to
--  add X more cents to this department's commitments, would I breach?"
--
--  Commitment definition: jobs in status (pending_approval, open,
--  assigned, in_progress, completed) whose department_id is this
--  dept OR a descendant. Cancelled / disputed jobs are excluded.
--  Amounts are converted via convert_cents at each job's issuance
--  time so historical commitments stay stable when FX rates change.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_department_budget(
  p_department_id      uuid,
  p_as_of              date    DEFAULT current_date,
  p_additional_cents   bigint  DEFAULT 0,
  p_additional_currency text   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_budget     record;
  v_committed  bigint := 0;
  v_paid       bigint := 0;
  v_addl       bigint := COALESCE(p_additional_cents, 0);
  v_org_id     uuid;
  v_has_inv    boolean := to_regclass('public.invoices') IS NOT NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT org_id INTO v_org_id FROM public.departments WHERE id = p_department_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Department not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public._actor_is_super_admin() OR public.is_member_of_org(v_org_id)) THEN
    RAISE EXCEPTION 'You do not have permission to read this budget' USING ERRCODE = '42501';
  END IF;

  -- Pick the budget whose period contains p_as_of for this department.
  SELECT id, allocated_cents, currency, fiscal_period_start, fiscal_period_end
    INTO v_budget
    FROM public.department_budgets
   WHERE department_id = p_department_id
     AND fiscal_period_start <= p_as_of
     AND fiscal_period_end   >  p_as_of
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_budget.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'has_budget',         false,
      'department_id',      p_department_id,
      'org_id',             v_org_id
    );
  END IF;

  -- Sum committed via job.budget_cents (the buyer's commitment at post
  -- time). When invoices exist they take precedence for paid amounts.
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.departments WHERE id = p_department_id
    UNION ALL
    SELECT d.id FROM public.departments d
      JOIN subtree s ON s.id = d.parent_department_id
  )
  SELECT
    COALESCE(SUM(
      public.convert_cents(
        COALESCE(j.client_price_cents, 0),
        'USD',  -- jobs are recorded in USD-cents in baseline
        v_budget.currency::text,
        j.created_at
      )
    ), 0)::bigint
    INTO v_committed
    FROM public.jobs j
   WHERE j.department_id IN (SELECT id FROM subtree)
     AND j.status IN ('pending_approval','open','assigned','in_progress','completed','paid');

  -- Paid totals from invoices when available.
  IF v_has_inv THEN
    WITH RECURSIVE subtree AS (
      SELECT id FROM public.departments WHERE id = p_department_id
      UNION ALL
      SELECT d.id FROM public.departments d
        JOIN subtree s ON s.id = d.parent_department_id
    )
    SELECT
      COALESCE(SUM(
        public.convert_cents(
          i.total_cents,
          COALESCE(i.currency, 'USD'),
          v_budget.currency::text,
          i.issued_at
        )
      ), 0)::bigint
      INTO v_paid
      FROM public.invoices i
     WHERE i.department_id IN (SELECT id FROM subtree)
       AND i.status = 'paid';
  END IF;

  -- Convert the requested additional amount into the budget's currency.
  IF v_addl > 0 AND p_additional_currency IS NOT NULL THEN
    v_addl := COALESCE(
      public.convert_cents(v_addl, p_additional_currency, v_budget.currency::text, now()),
      v_addl  -- if FX path missing, treat additional as already in budget ccy (best effort)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'has_budget',          true,
    'budget_id',           v_budget.id,
    'department_id',       p_department_id,
    'org_id',              v_org_id,
    'currency',            v_budget.currency,
    'period_start',        v_budget.fiscal_period_start,
    'period_end',          v_budget.fiscal_period_end,
    'allocated_cents',     v_budget.allocated_cents,
    'committed_cents',     v_committed,
    'paid_cents',          v_paid,
    'available_cents',     v_budget.allocated_cents - v_committed,
    'additional_cents',    v_addl,
    'would_exceed',        (v_committed + v_addl) > v_budget.allocated_cents,
    'projected_remaining', v_budget.allocated_cents - (v_committed + v_addl)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_department_budget(uuid, date, bigint, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: evaluate_job_for_approval
--
--  THE ROUTING ENGINE. Called by createJob BEFORE inserting the job.
--  Returns a clean jsonb verdict the action uses to decide whether to
--  set status='open' (auto-post) or status='pending_approval' (gated).
--
--  Resolves the single applicable policy by:
--    · scoping to org_id
--    · filtering active + currency = p_currency
--    · selecting whichever band's [min,max) range contains p_amount_cents
--    · narrowest scope wins — a department-scoped policy supersedes
--      an org-wide policy at the same amount (handled by ORDER BY in
--      the selector below)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluate_job_for_approval(
  p_org_id        uuid,
  p_department_id uuid,
  p_amount_cents  bigint,
  p_currency      text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_policy   record;
  v_currency public.currency_code;
  v_amount_in_policy_ccy bigint;
  v_budget   jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_member_of_org(p_org_id) AND NOT public._actor_is_super_admin() THEN
    RAISE EXCEPTION 'You are not a member of this organization' USING ERRCODE = '42501';
  END IF;

  -- Defensive cast — invalid currency code shouldn't even reach here.
  v_currency := COALESCE(p_currency, 'USD')::public.currency_code;

  -- Convert the requested amount into each candidate band's currency
  -- on the fly. To stay simple we keep this lookup currency-by-currency
  -- — we resolve the policy at the input currency first; if no policy
  -- in that currency matches, we widen to USD for cross-currency cases.
  WITH candidates AS (
    SELECT
      p.id,
      p.name,
      p.currency,
      p.min_amount_cents,
      p.max_amount_cents,
      p.required_approver_roles,
      p.min_approvers_count,
      p.requires_sod,
      p.scope_department_id,
      -- Convert the requested amount into THIS band's currency for the
      -- range check. Same FX primitive everywhere; same now()-based rate.
      public.convert_cents(p_amount_cents, v_currency::text, p.currency::text, now())
        AS amt_in_band_ccy
      FROM public.approval_policies p
     WHERE p.org_id = p_org_id
       AND p.is_active = true
       -- Scope match: either no scope (org-wide) OR the job's department
       -- is the policy's scope or a descendant.
       AND (
            p.scope_department_id IS NULL
         OR p.scope_department_id = p_department_id
         OR EXISTS (
              WITH RECURSIVE ancestors AS (
                SELECT id, parent_department_id
                  FROM public.departments WHERE id = p_department_id
                UNION ALL
                SELECT d.id, d.parent_department_id
                  FROM public.departments d
                  JOIN ancestors a ON a.parent_department_id = d.id
              )
              SELECT 1 FROM ancestors WHERE id = p.scope_department_id
            )
       )
  )
  SELECT id, name, currency::text AS currency,
         min_amount_cents, max_amount_cents,
         required_approver_roles, min_approvers_count, requires_sod,
         scope_department_id, amt_in_band_ccy
    INTO v_policy
    FROM candidates c
   WHERE c.amt_in_band_ccy IS NOT NULL
     AND c.amt_in_band_ccy >= c.min_amount_cents
     AND (c.max_amount_cents IS NULL OR c.amt_in_band_ccy < c.max_amount_cents)
   ORDER BY
     -- Narrowest scope first (dept-scoped beats org-wide at same amount).
     (c.scope_department_id IS NOT NULL) DESC,
     -- Tightest amount band wins ties (higher min beats lower min).
     c.min_amount_cents DESC
   LIMIT 1;

  -- Budget context — always returned even when no approval is required,
  -- so the UI can warn at job-post time before the user fills out the form.
  v_budget := public.check_department_budget(
    p_department_id, current_date, p_amount_cents, p_currency
  );

  IF v_policy.id IS NULL THEN
    -- No band matched → auto-post.
    RETURN jsonb_build_object(
      'ok',                 true,
      'requires_approval',  false,
      'reason',             'no_policy_matches',
      'budget',             v_budget
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',                       true,
    'requires_approval',        true,
    'policy_id',                v_policy.id,
    'policy_name',              v_policy.name,
    'policy_currency',          v_policy.currency,
    'amount_in_policy_ccy',     v_policy.amt_in_band_ccy,
    'required_approver_roles',  to_jsonb(v_policy.required_approver_roles),
    'min_approvers_count',      v_policy.min_approvers_count,
    'requires_sod',             v_policy.requires_sod,
    'scope_department_id',      v_policy.scope_department_id,
    'budget',                   v_budget
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_job_for_approval(uuid, uuid, bigint, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: submit_job_approval
--
--  Approver records a decision. Enforces:
--    1. Caller is authenticated
--    2. Caller is NOT the requester (SoD — also enforced by the
--       constraint trigger, but we fail fast with a friendly error)
--    3. Caller has a current org_member.role in the request's
--       required_approver_roles snapshot
--    4. Caller hasn't already decided (the UNIQUE constraint catches this
--       too — we surface a friendlier error)
--
--  When the decision is 'approved', recomputes whether the request has
--  reached quorum (count(approved) >= min_approvers_required, no
--  rejections). If yes, transitions request to approved, advances the
--  job to status='open', and writes the granted audit row.
--
--  When 'rejected', short-circuits: request → rejected, job → cancelled,
--  audit row severity=warning.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_job_approval(
  p_job_id   uuid,
  p_decision text,
  p_comment  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_actor_lbl   text;
  v_request     record;
  v_my_org_role text;
  v_approved_count int;
  v_rejected_count int;
  v_now         timestamptz := now();
  v_correlation uuid := gen_random_uuid();
  v_decision_id uuid;
  v_final       text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected' USING ERRCODE = '22000';
  END IF;

  SELECT *
    INTO v_request
    FROM public.approval_requests
   WHERE job_id = p_job_id
   FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'No approval request found for this job' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Approval request is already %', v_request.status USING ERRCODE = '22000';
  END IF;

  -- SoD — friendly check (the trigger catches the table-level write too,
  -- but failing here gives a better error message to the UI).
  IF v_request.requires_sod IS TRUE AND v_actor = v_request.requested_by THEN
    RAISE EXCEPTION 'Segregation of Duties: you cannot approve your own request'
      USING ERRCODE = '42501',
            HINT = 'A different authorised approver must decide.';
  END IF;

  -- Authorisation — Platform Owner bypasses role match for override
  -- purposes (audit-visible); otherwise the actor must hold a current
  -- org_members.role that's in the request's required_approver_roles set.
  IF public._actor_is_super_admin() THEN
    v_my_org_role := 'super_admin';
  ELSE
    SELECT m.role::text
      INTO v_my_org_role
      FROM public.org_members m
     WHERE m.org_id  = v_request.org_id
       AND m.user_id = v_actor;

    IF v_my_org_role IS NULL THEN
      RAISE EXCEPTION 'You are not a member of this organization' USING ERRCODE = '42501';
    END IF;

    IF NOT (v_my_org_role = ANY(v_request.required_approver_roles)) THEN
      RAISE EXCEPTION 'Your role (%) is not in the list of permitted approvers (%)',
        v_my_org_role, v_request.required_approver_roles USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Record the decision. The unique-constraint catches duplicates.
  BEGIN
    INSERT INTO public.approval_decisions (
      approval_request_id, decided_by, decided_at, decision, comment, decider_role_at_time
    ) VALUES (
      v_request.id, v_actor, v_now, p_decision, p_comment, v_my_org_role
    )
    RETURNING id INTO v_decision_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You have already decided on this request' USING ERRCODE = '23505';
  END;

  -- Recompute counters AFTER the insert.
  SELECT
    COUNT(*) FILTER (WHERE decision = 'approved'),
    COUNT(*) FILTER (WHERE decision = 'rejected')
    INTO v_approved_count, v_rejected_count
    FROM public.approval_decisions
   WHERE approval_request_id = v_request.id;

  -- Resolve final outcome.
  IF v_rejected_count > 0 THEN
    -- Any single rejection short-circuits.
    v_final := 'rejected';
    UPDATE public.approval_requests
       SET status            = 'rejected',
           final_decision_at = v_now,
           final_decision_by = v_actor,
           rejection_reason  = COALESCE(p_comment, 'Rejected by approver'),
           updated_at        = v_now
     WHERE id = v_request.id;
    -- Park the job in cancelled — keeps the timeline visible without
    -- letting it leak into the marketplace.
    UPDATE public.jobs
       SET status = 'cancelled'
     WHERE id = p_job_id;
  ELSIF v_approved_count >= v_request.min_approvers_required THEN
    -- Quorum met — release the job.
    v_final := 'approved';
    UPDATE public.approval_requests
       SET status            = 'approved',
           final_decision_at = v_now,
           final_decision_by = v_actor,
           updated_at        = v_now
     WHERE id = v_request.id;
    UPDATE public.jobs
       SET status = 'open'
     WHERE id = p_job_id;
  ELSE
    v_final := 'pending';
  END IF;

  -- Audit
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT actor_role, actor_label INTO v_actor_role, v_actor_lbl
      FROM public._dept_actor_profile(v_actor);

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id, severity
    ) VALUES (
      CASE
        WHEN v_final = 'approved'  THEN 'job.approval.granted'
        WHEN v_final = 'rejected'  THEN 'job.approval.rejected'
        ELSE                            'job.approval.decision_recorded'
      END,
      v_actor, v_actor_role, v_actor_lbl,
      'approval_requests', v_request.id,
      format('%s by %s (role %s)',
        CASE p_decision WHEN 'approved' THEN 'Approval recorded' ELSE 'Rejection recorded' END,
        COALESCE(v_actor_lbl, 'Unknown'), v_my_org_role),
      jsonb_build_object(
        'decision', p_decision,
        'comment',  p_comment,
        'approved_count', v_approved_count,
        'rejected_count', v_rejected_count,
        'min_approvers_required', v_request.min_approvers_required,
        'final', v_final
      ),
      jsonb_build_object(
        'org_id', v_request.org_id,
        'job_id', p_job_id,
        'request_id', v_request.id
      ),
      v_correlation,
      CASE WHEN v_final = 'rejected' THEN 'warning' ELSE 'info' END
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'decision_id',     v_decision_id,
    'request_id',      v_request.id,
    'final',           v_final,
    'approved_count',  v_approved_count,
    'rejected_count',  v_rejected_count,
    'min_required',    v_request.min_approvers_required,
    'correlation_id',  v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_job_approval(uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: cancel_job_approval
--
--  Requester withdraws. Only the original requester (or Platform Owner)
--  can cancel. Sets request to 'cancelled' + job to 'cancelled'. Useful
--  when the requester realises they posted in error before any approver
--  has acted.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_job_approval(
  p_job_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_actor_lbl   text;
  v_request     record;
  v_now         timestamptz := now();
  v_correlation uuid := gen_random_uuid();
  v_reason      text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  v_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to cancel an approval request' USING ERRCODE = '22000';
  END IF;

  SELECT *
    INTO v_request
    FROM public.approval_requests
   WHERE job_id = p_job_id
   FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'No approval request found for this job' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Approval request is already %', v_request.status USING ERRCODE = '22000';
  END IF;

  IF v_request.requested_by <> v_actor AND NOT public._actor_is_super_admin() THEN
    RAISE EXCEPTION 'Only the original requester or the Platform Owner can cancel an approval request'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.approval_requests
     SET status            = 'cancelled',
         final_decision_at = v_now,
         final_decision_by = v_actor,
         rejection_reason  = v_reason,
         updated_at        = v_now
   WHERE id = v_request.id;

  UPDATE public.jobs SET status = 'cancelled' WHERE id = p_job_id;

  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT actor_role, actor_label INTO v_actor_role, v_actor_lbl
      FROM public._dept_actor_profile(v_actor);

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id
    ) VALUES (
      'job.approval.cancelled_by_requester',
      v_actor, v_actor_role, v_actor_lbl,
      'approval_requests', v_request.id,
      format('Approval request withdrawn — %s', v_reason),
      jsonb_build_object('reason', v_reason),
      jsonb_build_object('org_id', v_request.org_id, 'job_id', p_job_id, 'request_id', v_request.id),
      v_correlation
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'request_id',     v_request.id,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_job_approval(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: fetch_my_pending_approvals
--
--  Feeds the approver dashboard. Returns every pending request in
--  the caller's active org where the caller's org_member.role is in
--  the required_approver_roles set AND (per SoD) the caller is NOT
--  the requester. Returns rich rows so the UI doesn't need a second
--  fetch.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_my_pending_approvals()
RETURNS TABLE (
  request_id            uuid,
  job_id                uuid,
  job_title             text,
  org_id                uuid,
  org_name              text,
  department_id         uuid,
  department_name       text,
  cost_center           text,
  requested_by          uuid,
  requested_by_label    text,
  requested_at          timestamptz,
  amount_cents          bigint,
  currency              text,
  min_approvers_required int,
  approved_count        int,
  required_approver_roles text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    r.id            AS request_id,
    r.job_id        AS job_id,
    j.title         AS job_title,
    r.org_id        AS org_id,
    o.name          AS org_name,
    r.department_id AS department_id,
    d.name          AS department_name,
    d.cost_center   AS cost_center,
    r.requested_by  AS requested_by,
    COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, 'Unknown') AS requested_by_label,
    r.requested_at  AS requested_at,
    r.amount_cents  AS amount_cents,
    r.currency::text AS currency,
    r.min_approvers_required AS min_approvers_required,
    (SELECT COUNT(*)::int FROM public.approval_decisions ad
       WHERE ad.approval_request_id = r.id AND ad.decision = 'approved') AS approved_count,
    r.required_approver_roles AS required_approver_roles
    FROM public.approval_requests r
    JOIN public.organizations o ON o.id = r.org_id
    JOIN public.jobs j          ON j.id = r.job_id
    LEFT JOIN public.departments d ON d.id = r.department_id
    LEFT JOIN public.profiles p    ON p.id = r.requested_by
   WHERE r.status = 'pending'
     AND r.requested_by <> v_actor                                 -- SoD
     AND (
       public._actor_is_super_admin()                              -- Platform Owner sees all
       OR EXISTS (
         SELECT 1 FROM public.org_members m
          WHERE m.org_id  = r.org_id
            AND m.user_id = v_actor
            AND m.role::text = ANY(r.required_approver_roles)      -- role match
       )
     )
     -- Caller hasn't already decided.
     AND NOT EXISTS (
       SELECT 1 FROM public.approval_decisions ad
        WHERE ad.approval_request_id = r.id AND ad.decided_by = v_actor
     )
   ORDER BY r.requested_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_my_pending_approvals() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: open_job_approval_request
--
--  Called by the createJob server action AFTER inserting the job with
--  status='pending_approval'. Creates the approval_request row snapshot
--  + writes the initiating audit row. Separate RPC so the action can
--  control the job-insert + request-insert as a logical pair without
--  the database needing to know about the action's redirect logic.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.open_job_approval_request(
  p_job_id                  uuid,
  p_policy_id               uuid,
  p_amount_cents            bigint,
  p_currency                text,
  p_min_approvers_required  int,
  p_required_approver_roles text[],
  p_requires_sod            boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_role  text;
  v_actor_lbl   text;
  v_job         record;
  v_request_id  uuid;
  v_currency    public.currency_code;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Pull job context — the action just inserted this row.
  SELECT id, client_id, department_id, status, title
    INTO v_job
    FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  -- Only the requester (the buyer) can open the request on their own job.
  IF v_job.client_id IS DISTINCT FROM v_actor AND NOT public._actor_is_super_admin() THEN
    RAISE EXCEPTION 'Only the job poster can open an approval request' USING ERRCODE = '42501';
  END IF;

  IF v_job.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Job must be in pending_approval status (got %)', v_job.status USING ERRCODE = '22000';
  END IF;

  v_currency := COALESCE(p_currency, 'USD')::public.currency_code;

  -- Resolve org_id via the department, falling through to NULL when
  -- there's no department attribution (the engine still routes; the
  -- request just records org as the requester's primary).
  DECLARE v_org_id uuid;
  BEGIN
    IF v_job.department_id IS NOT NULL THEN
      SELECT org_id INTO v_org_id FROM public.departments WHERE id = v_job.department_id;
    END IF;
    IF v_org_id IS NULL THEN
      SELECT org_id INTO v_org_id
        FROM public.org_members
       WHERE user_id = v_actor
       ORDER BY created_at ASC
       LIMIT 1;
    END IF;
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'Could not resolve org for approval request' USING ERRCODE = '22000';
    END IF;
  END;

  INSERT INTO public.approval_requests (
    org_id, job_id, department_id, policy_id, requested_by, requested_at,
    amount_cents, currency, min_approvers_required, required_approver_roles, requires_sod
  ) VALUES (
    v_org_id, p_job_id, v_job.department_id, p_policy_id, v_actor, now(),
    p_amount_cents, v_currency, p_min_approvers_required, p_required_approver_roles, p_requires_sod
  )
  RETURNING id INTO v_request_id;

  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT actor_role, actor_label INTO v_actor_role, v_actor_lbl
      FROM public._dept_actor_profile(v_actor);

    INSERT INTO public.audit_events (
      event_type, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata, correlation_id
    ) VALUES (
      'job.approval.requested',
      v_actor, v_actor_role, v_actor_lbl,
      'approval_requests', v_request_id,
      format('Approval requested for job %L (%s %s)',
        v_job.title, v_currency, (p_amount_cents::numeric / 100)::text),
      jsonb_build_object(
        'amount_cents', p_amount_cents,
        'currency', v_currency,
        'min_approvers_required', p_min_approvers_required,
        'required_approver_roles', p_required_approver_roles
      ),
      jsonb_build_object('org_id', v_org_id, 'job_id', p_job_id),
      v_correlation
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'request_id',     v_request_id,
    'org_id',         v_org_id,
    'job_id',         p_job_id,
    'correlation_id', v_correlation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_job_approval_request(uuid, uuid, bigint, text, int, text[], boolean) TO authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
--  VERIFICATION (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1. Confirm the status check allows pending_approval.
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'jobs_status_check';
--
-- 2. Try a self-approval — must fail with 42501.
-- INSERT INTO public.approval_requests
--   (org_id, job_id, requested_by, amount_cents, currency, min_approvers_required, required_approver_roles)
-- VALUES (...);  -- fill in test ids
-- INSERT INTO public.approval_decisions
--   (approval_request_id, decided_by, decision)
-- VALUES (<the_request_id>, <same_user_as_requester>, 'approved');
-- ERROR:  42501: Segregation of Duties violation: ...
--
-- 3. Try overlapping bands — must fail.
-- INSERT INTO public.approval_policies (...) VALUES (...);  -- band [0, 1000000)
-- INSERT INTO public.approval_policies (...) VALUES (...);  -- band [500000, 2000000) — same org/ccy/scope
-- ERROR:  23P01: approval policy band overlaps an existing active band ...
