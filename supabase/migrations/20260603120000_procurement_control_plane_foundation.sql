-- ════════════════════════════════════════════════════════════════════════════
--  20260603120000_procurement_control_plane_foundation.sql
--  Phase 6 / Sprint 8 — The Procurement Control Plane (schema layer).
--
--  Lands four tables that, together, let an enterprise impose
--  pre-authorization budget gates + multi-tier approval workflows
--  with strict Segregation-of-Duties enforcement at the database tier.
--
--      department_budgets       per-dept, per-fiscal-period allocation
--      approval_policies        tenant-configured tiered routing rules
--      approval_requests        durable record of an approval gate firing
--      approval_decisions       per-approver decisions, SoD-protected
--
--  Mutations are RPC-only — none of these tables expose INSERT/UPDATE/
--  DELETE policies. SECURITY DEFINER RPCs land in the companion
--  migration (20260604120000) which carries the routing engine, the
--  SoD enforcement, and the audit-trail integration.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  department_budgets — fiscal-period allocation envelopes
--
--  One row per (department, fiscal period). Consumption is NOT stored
--  here — it is computed on read by the budget RPCs against the
--  invoice/job tables so we never have a stale denormalized total.
--  Storing only the allocation also means a re-issued invoice or a
--  voided contract instantly re-affects the available budget without
--  any maintenance job.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.department_budgets (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL    DEFAULT now(),
  updated_at            timestamptz NOT NULL    DEFAULT now(),

  org_id                uuid        NOT NULL    REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Nullable now → forward-compat for org-wide budgets (Phase 2). Phase 1
  -- enforces non-null via the create RPC, so the data shape stays clean.
  department_id         uuid                    REFERENCES public.departments(id)   ON DELETE CASCADE,

  fiscal_period_start   date        NOT NULL,
  fiscal_period_end     date        NOT NULL,
  currency              public.currency_code NOT NULL,
  allocated_cents       bigint      NOT NULL    CHECK (allocated_cents >= 0),
  notes                 text,

  created_by            uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT department_budgets_period_valid
    CHECK (fiscal_period_end > fiscal_period_start),

  -- One active budget per department per period. Re-issuing the budget
  -- for the same window is an UPDATE, not a new row.
  CONSTRAINT department_budgets_unique_period
    UNIQUE (department_id, fiscal_period_start, fiscal_period_end)
);

COMMENT ON TABLE public.department_budgets IS
  'Per-department fiscal-period budget envelopes. Consumption is computed on read against invoices/jobs — only the allocation is stored here.';

COMMENT ON COLUMN public.department_budgets.department_id IS
  'NULL allowed for forward-compatibility with org-wide budgets. Phase 1 enforces non-null at the RPC layer.';

CREATE INDEX IF NOT EXISTS department_budgets_org_idx
  ON public.department_budgets (org_id, fiscal_period_start DESC, fiscal_period_end DESC);

CREATE INDEX IF NOT EXISTS department_budgets_dept_idx
  ON public.department_budgets (department_id, fiscal_period_start DESC)
  WHERE department_id IS NOT NULL;

-- Updated-at trigger.
CREATE OR REPLACE FUNCTION public.tg_department_budgets_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tg_department_budgets_set_updated_at ON public.department_budgets;
CREATE TRIGGER tg_department_budgets_set_updated_at
  BEFORE UPDATE ON public.department_budgets
  FOR EACH ROW EXECUTE FUNCTION public.tg_department_budgets_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
--  approval_policies — tenant-configured tiered routing rules
--
--  Each row is one BAND: jobs whose amount falls in
--  [min_amount_cents, max_amount_cents) match this policy.
--
--  · max_amount_cents = NULL means "unbounded above"
--  · Multiple bands per org form a ladder; a constraint trigger below
--    enforces non-overlap within (org_id, scope_department_id, currency)
--  · required_approver_roles is an array of org_member_role values
--    that are valid approvers. min_approvers_count is how many distinct
--    approvers must approve before the request transitions to approved.
--  · requires_sod = true (default) — the requester cannot be an approver
--  · scope_department_id NULL → policy applies to every department in
--    the org. Non-null → policy applies only to that dept + descendants
--    (a small recursive walk in the engine, not stored in the policy)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_policies (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL    DEFAULT now(),
  updated_at               timestamptz NOT NULL    DEFAULT now(),

  org_id                   uuid        NOT NULL    REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                     text        NOT NULL,

  min_amount_cents         bigint      NOT NULL    CHECK (min_amount_cents >= 0),
  max_amount_cents         bigint                  CHECK (max_amount_cents IS NULL OR max_amount_cents > min_amount_cents),
  currency                 public.currency_code NOT NULL,

  required_approver_roles  text[]      NOT NULL    CHECK (array_length(required_approver_roles, 1) >= 1),
  min_approvers_count      int         NOT NULL    DEFAULT 1   CHECK (min_approvers_count >= 1),
  requires_sod             boolean     NOT NULL    DEFAULT true,

  scope_department_id      uuid                    REFERENCES public.departments(id) ON DELETE CASCADE,

  is_active                boolean     NOT NULL    DEFAULT true,
  created_by               uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT approval_policies_min_lt_max
    CHECK (max_amount_cents IS NULL OR max_amount_cents > min_amount_cents)
);

COMMENT ON TABLE public.approval_policies IS
  'Tenant-configured pre-authorization bands. Each row is one tier; tiers form a non-overlapping ladder per (org, scope, currency).';

CREATE INDEX IF NOT EXISTS approval_policies_org_active_idx
  ON public.approval_policies (org_id, is_active, currency, min_amount_cents);

CREATE INDEX IF NOT EXISTS approval_policies_scope_idx
  ON public.approval_policies (scope_department_id)
  WHERE scope_department_id IS NOT NULL;

-- Updated-at trigger.
CREATE OR REPLACE FUNCTION public.tg_approval_policies_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tg_approval_policies_set_updated_at ON public.approval_policies;
CREATE TRIGGER tg_approval_policies_set_updated_at
  BEFORE UPDATE ON public.approval_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_approval_policies_set_updated_at();

-- Constraint trigger — refuses any INSERT/UPDATE that would create
-- overlapping bands within (org_id, scope_department_id, currency).
-- A constraint trigger (vs a CHECK) is required because the predicate
-- spans rows.
CREATE OR REPLACE FUNCTION public.tg_approval_policies_no_overlap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_overlap_count int;
BEGIN
  IF NEW.is_active IS DISTINCT FROM TRUE THEN
    RETURN NEW; -- inactive bands don't participate in the ladder
  END IF;

  SELECT COUNT(*)
    INTO v_overlap_count
    FROM public.approval_policies p
   WHERE p.id <> NEW.id
     AND p.org_id = NEW.org_id
     AND p.is_active = true
     AND p.currency = NEW.currency
     AND COALESCE(p.scope_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(NEW.scope_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
     -- Range overlap: [a_min, a_max) overlaps [b_min, b_max) when a_min < b_max AND b_min < a_max
     -- max NULL means +infinity for that side.
     AND NEW.min_amount_cents < COALESCE(p.max_amount_cents, 9223372036854775807::bigint)
     AND p.min_amount_cents   < COALESCE(NEW.max_amount_cents, 9223372036854775807::bigint);

  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'approval policy band overlaps an existing active band for this scope/currency'
      USING ERRCODE = '23P01'; -- exclusion_violation
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_approval_policies_no_overlap ON public.approval_policies;
CREATE CONSTRAINT TRIGGER tg_approval_policies_no_overlap
  AFTER INSERT OR UPDATE ON public.approval_policies
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.tg_approval_policies_no_overlap();

-- ─────────────────────────────────────────────────────────────────────
--  approval_requests — durable record of a gate firing
--
--  Snapshot pattern — the policy fields (`min_approvers_required`,
--  `required_approver_roles`) are COPIED from the policy at request
--  time. Subsequent policy edits do NOT change what this request
--  requires; the audit trail stays meaningful.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_requests (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL    DEFAULT now(),
  updated_at               timestamptz NOT NULL    DEFAULT now(),

  org_id                   uuid        NOT NULL    REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id                   uuid        NOT NULL    REFERENCES public.jobs(id)          ON DELETE CASCADE,
  department_id            uuid                    REFERENCES public.departments(id)   ON DELETE SET NULL,
  policy_id                uuid                    REFERENCES public.approval_policies(id) ON DELETE SET NULL,

  requested_by             uuid        NOT NULL    REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_at             timestamptz NOT NULL    DEFAULT now(),

  amount_cents             bigint      NOT NULL    CHECK (amount_cents >= 0),
  currency                 public.currency_code NOT NULL,

  -- Snapshot fields — frozen at request time
  min_approvers_required   int         NOT NULL    CHECK (min_approvers_required >= 1),
  required_approver_roles  text[]      NOT NULL    CHECK (array_length(required_approver_roles, 1) >= 1),
  requires_sod             boolean     NOT NULL    DEFAULT true,

  status                   text        NOT NULL    DEFAULT 'pending'
                                       CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'superseded')),
  final_decision_at        timestamptz,
  final_decision_by        uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason         text,

  -- One active approval request per job — re-posts of the same job
  -- are not currently supported; the existing request must be
  -- cancelled or superseded first.
  CONSTRAINT approval_requests_one_per_job UNIQUE (job_id)
);

COMMENT ON TABLE public.approval_requests IS
  'One approval gate per job. Snapshots policy at request time so subsequent policy edits do not retroactively change what was required.';

CREATE INDEX IF NOT EXISTS approval_requests_org_status_idx
  ON public.approval_requests (org_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS approval_requests_requester_idx
  ON public.approval_requests (requested_by, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS approval_requests_pending_idx
  ON public.approval_requests (org_id, requested_at)
  WHERE status = 'pending';

-- Updated-at trigger.
CREATE OR REPLACE FUNCTION public.tg_approval_requests_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tg_approval_requests_set_updated_at ON public.approval_requests;
CREATE TRIGGER tg_approval_requests_set_updated_at
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_approval_requests_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
--  approval_decisions — per-approver decisions
--
--  This is where the SoD invariant LIVES. The constraint trigger
--  refuses any row where decided_by = approval_requests.requested_by.
--  Combined with `UNIQUE (request_id, decided_by)` we mathematically
--  cannot represent a self-approval and we cannot represent a single
--  user approving the same request twice.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_decisions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL    DEFAULT now(),

  approval_request_id      uuid        NOT NULL    REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  decided_by               uuid        NOT NULL    REFERENCES public.profiles(id) ON DELETE CASCADE,
  decided_at               timestamptz NOT NULL    DEFAULT now(),

  decision                 text        NOT NULL    CHECK (decision IN ('approved', 'rejected')),
  comment                  text,
  -- Snapshot of the decider's org_member.role at the moment they decided.
  -- Lets the audit trail tell "VP Procurement Carla approved this" even
  -- if Carla's seat role later changes.
  decider_role_at_time     text,

  CONSTRAINT approval_decisions_one_per_user UNIQUE (approval_request_id, decided_by)
);

COMMENT ON TABLE public.approval_decisions IS
  'Per-approver decisions. SoD constraint trigger forbids self-approval at the schema layer — SOX 404 satisfied without trusting application code.';

CREATE INDEX IF NOT EXISTS approval_decisions_request_idx
  ON public.approval_decisions (approval_request_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS approval_decisions_decider_idx
  ON public.approval_decisions (decided_by, decided_at DESC);

-- ─────────────────────────────────────────────────────────────────────
--  THE SoD CONSTRAINT TRIGGER
--
--  Refuses any approval_decisions row whose decided_by matches the
--  approval_request's requested_by, UNLESS the request explicitly opted
--  out of SoD (requires_sod = false). The opt-out path exists for
--  Phase-2-style "single-author dept" scenarios where a small team
--  legitimately has no separate approver — but the OPT-OUT must be
--  set at policy-definition time, not at decision time, so it surfaces
--  in audit-of-audit checks.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_approval_decisions_enforce_sod()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_requester    uuid;
  v_requires_sod boolean;
BEGIN
  SELECT requested_by, requires_sod
    INTO v_requester, v_requires_sod
    FROM public.approval_requests
   WHERE id = NEW.approval_request_id;

  IF v_requester IS NULL THEN
    -- Should not happen with FK in place; defensive.
    RAISE EXCEPTION 'approval request not found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_requires_sod, true) IS TRUE AND NEW.decided_by = v_requester THEN
    RAISE EXCEPTION 'Segregation of Duties violation: the request poster cannot approve their own request'
      USING ERRCODE = '42501',
            HINT = 'SOX 404 — schema-enforced. Another authorised approver must decide.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_approval_decisions_enforce_sod ON public.approval_decisions;
CREATE CONSTRAINT TRIGGER tg_approval_decisions_enforce_sod
  AFTER INSERT OR UPDATE OF decided_by ON public.approval_decisions
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.tg_approval_decisions_enforce_sod();

-- ─────────────────────────────────────────────────────────────────────
--  RLS — read posture (mutations are RPC-only)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.department_budgets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_decisions   ENABLE ROW LEVEL SECURITY;

-- department_budgets — Platform Owner OR org members read
DROP POLICY IF EXISTS department_budgets_select_admin    ON public.department_budgets;
DROP POLICY IF EXISTS department_budgets_select_members  ON public.department_budgets;

CREATE POLICY department_budgets_select_admin
  ON public.department_budgets FOR SELECT
  USING (public._actor_is_super_admin());

CREATE POLICY department_budgets_select_members
  ON public.department_budgets FOR SELECT
  USING (public.is_member_of_org(org_id));

-- approval_policies — same read posture
DROP POLICY IF EXISTS approval_policies_select_admin    ON public.approval_policies;
DROP POLICY IF EXISTS approval_policies_select_members  ON public.approval_policies;

CREATE POLICY approval_policies_select_admin
  ON public.approval_policies FOR SELECT
  USING (public._actor_is_super_admin());

CREATE POLICY approval_policies_select_members
  ON public.approval_policies FOR SELECT
  USING (public.is_member_of_org(org_id));

-- approval_requests — Platform Owner + requester + org members
DROP POLICY IF EXISTS approval_requests_select_admin       ON public.approval_requests;
DROP POLICY IF EXISTS approval_requests_select_requester   ON public.approval_requests;
DROP POLICY IF EXISTS approval_requests_select_members     ON public.approval_requests;

CREATE POLICY approval_requests_select_admin
  ON public.approval_requests FOR SELECT
  USING (public._actor_is_super_admin());

CREATE POLICY approval_requests_select_requester
  ON public.approval_requests FOR SELECT
  USING (requested_by = auth.uid());

CREATE POLICY approval_requests_select_members
  ON public.approval_requests FOR SELECT
  USING (public.is_member_of_org(org_id));

-- approval_decisions — Platform Owner + the decider + org members of the request's org
DROP POLICY IF EXISTS approval_decisions_select_admin   ON public.approval_decisions;
DROP POLICY IF EXISTS approval_decisions_select_self    ON public.approval_decisions;
DROP POLICY IF EXISTS approval_decisions_select_members ON public.approval_decisions;

CREATE POLICY approval_decisions_select_admin
  ON public.approval_decisions FOR SELECT
  USING (public._actor_is_super_admin());

CREATE POLICY approval_decisions_select_self
  ON public.approval_decisions FOR SELECT
  USING (decided_by = auth.uid());

CREATE POLICY approval_decisions_select_members
  ON public.approval_decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.approval_requests r
      WHERE r.id = approval_decisions.approval_request_id
        AND public.is_member_of_org(r.org_id)
    )
  );

-- No INSERT/UPDATE/DELETE policies anywhere — every mutation goes
-- through the SECURITY DEFINER RPCs in the companion migration.

COMMIT;
