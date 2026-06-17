-- ════════════════════════════════════════════════════════════════════════════
--  20260529120000_invoice_department_attribution.sql
--  Phase 6 / Sprint 5 — Cost-center → budget roll-up, schema layer.
--
--  WHAT THIS LANDS
--  ───────────────
--    · jobs.department_id              — soft suggestion captured at post-time
--    · invoices.department_id          — canonical spend attribution
--    · invoices.cost_center_snapshot   — frozen text, immune to dept renames
--    · tg_invoice_inherit_department   — BEFORE INSERT trigger that copies
--                                        department_id from the parent job
--                                        and snapshots the cost center
--    · reassign_invoice_department()   — SECURITY DEFINER RPC for post-issue
--                                        reclassification; auth via
--                                        can_manage_org_structure; audited
--
--  WHY INVOICE-ANCHORED
--  ────────────────────
--  See architecture discussion in chat history. Short version: invoice is
--  the commitment moment (issued when job_contract reaches fully_executed);
--  job pricing churns through negotiation so attribution at job-post time
--  is a hint, not a fact.
--
--  FINANCIAL SUITE NOTE
--  ────────────────────
--  The financial suite foundation (public.invoices table itself, the four
--  budget RPCs, fin_visible_client_ids) lives in production but is not yet
--  represented in this repo — a tracking item the owner is aware of. This
--  migration uses `to_regclass()` guards so applying it against an env that
--  lacks public.invoices skips the invoice-side changes cleanly (jobs side
--  still runs because public.jobs is baseline).
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  jobs.department_id  (always present — public.jobs is baseline)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS department_id uuid
    REFERENCES public.departments(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.jobs.department_id IS
  'Optional department the buyer attributed this job to at post-time. Soft suggestion — invoices inherit this at issuance but procurement can reassign.';

CREATE INDEX IF NOT EXISTS jobs_department_idx
  ON public.jobs (department_id, created_at DESC)
  WHERE department_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
--  invoices.department_id + cost_center_snapshot  (conditional)
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.invoices') IS NULL THEN
    RAISE NOTICE '[20260529120000] public.invoices not found — skipping invoice-side adds. Apply the financial suite foundation first.';
    RETURN;
  END IF;

  -- Add columns idempotently.
  EXECUTE 'ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS department_id uuid';
  -- FK is added in a second step so we can attach it as named constraint
  -- and avoid duplicate creation if the column already had one.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'invoices_department_id_fkey'
  ) THEN
    EXECUTE '
      ALTER TABLE public.invoices
        ADD CONSTRAINT invoices_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL
    ';
  END IF;

  EXECUTE 'ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cost_center_snapshot text';

  -- Indexes.
  EXECUTE '
    CREATE INDEX IF NOT EXISTS invoices_department_idx
      ON public.invoices (department_id, issued_at DESC)
      WHERE department_id IS NOT NULL
  ';
  EXECUTE '
    CREATE INDEX IF NOT EXISTS invoices_cost_center_snapshot_idx
      ON public.invoices (cost_center_snapshot)
      WHERE cost_center_snapshot IS NOT NULL
  ';

  -- Column comments.
  EXECUTE $c$
    COMMENT ON COLUMN public.invoices.department_id IS
      'Canonical department attribution. Defaults at INSERT via tg_invoice_inherit_department trigger; reclassifiable via reassign_invoice_department RPC.'
  $c$;
  EXECUTE $c$
    COMMENT ON COLUMN public.invoices.cost_center_snapshot IS
      'Snapshot of departments.cost_center at attribution time. Frozen — does not drift if the dept''s cost_center label is later renamed. NULL when department_id is NULL.'
  $c$;
END $$;

-- ─────────────────────────────────────────────────────────────────────
--  Trigger: tg_invoice_inherit_department
--
--  Fires BEFORE INSERT and BEFORE UPDATE of department_id on invoices.
--    · On INSERT: if department_id is NULL, copy from parent job.
--                 if department_id is set, snapshot the cost_center.
--    · On UPDATE: only when department_id changes, refresh the snapshot.
--
--  The trigger never overwrites a department_id that was explicitly
--  passed in — that lets the RPC and any future direct admin-write
--  win over the inherited default.
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.invoices') IS NULL THEN RETURN; END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.tg_invoice_inherit_department()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $body$
    DECLARE
      v_job_dept_id uuid;
      v_cost        text;
    BEGIN
      -- Inherit from parent job when no department was explicitly set.
      IF NEW.department_id IS NULL AND NEW.job_id IS NOT NULL THEN
        SELECT department_id INTO v_job_dept_id
          FROM public.jobs WHERE id = NEW.job_id;
        IF v_job_dept_id IS NOT NULL THEN
          NEW.department_id := v_job_dept_id;
        END IF;
      END IF;

      -- Refresh the snapshot any time department_id transitions to a value
      -- (covers both initial INSERT and UPDATE-induced transitions).
      IF NEW.department_id IS NOT NULL
         AND (
           TG_OP = 'INSERT'
           OR (TG_OP = 'UPDATE'
               AND NEW.department_id IS DISTINCT FROM OLD.department_id)
         )
      THEN
        SELECT cost_center INTO v_cost
          FROM public.departments WHERE id = NEW.department_id;
        NEW.cost_center_snapshot := v_cost;
      ELSIF NEW.department_id IS NULL THEN
        NEW.cost_center_snapshot := NULL;
      END IF;

      RETURN NEW;
    END;
    $body$
  $f$;

  -- (Re)attach the trigger idempotently.
  EXECUTE 'DROP TRIGGER IF EXISTS tg_invoice_inherit_department ON public.invoices';
  EXECUTE '
    CREATE TRIGGER tg_invoice_inherit_department
      BEFORE INSERT OR UPDATE OF department_id ON public.invoices
      FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_inherit_department()
  ';
END $$;

-- ─────────────────────────────────────────────────────────────────────
--  RPC: reassign_invoice_department
--
--  Auth: super_admin OR an org_member with role IN ('owner',
--  'procurement_admin') on the destination department's organization.
--  Same allow-set as can_manage_org_structure so a procurement_admin
--  who owns the org chart also owns reclassification.
--
--  Defence: refuses to move an invoice into an org whose buyer (job.
--  client_id) isn't actually a member of that org — prevents one org
--  from yoinking another's invoices.
--
--  Audit: writes a `invoice.department.reassigned` audit_events row
--  with the from/to dept ids, the reason, and a correlation_id.
--
--  Triggers tg_invoice_inherit_department which refreshes the snapshot.
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.invoices') IS NULL THEN RETURN; END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.reassign_invoice_department(
      p_invoice_id          uuid,
      p_new_department_id   uuid,   -- NULL clears the attribution
      p_reason              text
    ) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      v_actor          uuid := auth.uid();
      v_actor_role     text;
      v_actor_label    text;
      v_invoice        record;
      v_job_client_id  uuid;
      v_target_org_id  uuid;
      v_old_org_id     uuid;
      v_reason         text;
      v_correlation    uuid := gen_random_uuid();
    BEGIN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
      END IF;

      v_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');
      IF v_reason IS NULL THEN
        RAISE EXCEPTION 'A reason is required for invoice reassignment' USING ERRCODE = '22000';
      END IF;

      SELECT id, job_id, department_id, client_id
        INTO v_invoice
        FROM public.invoices
       WHERE id = p_invoice_id
       FOR UPDATE;

      IF v_invoice.id IS NULL THEN
        RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
      END IF;

      -- Resolve the org_id we're authorising against.
      -- Path A: explicit new department supplied → use its org.
      -- Path B: clearing attribution → use the old department's org.
      -- Path C: neither old nor new dept → infer from any org the
      --         job's client_id belongs to (rare; refuse for safety).
      IF p_new_department_id IS NOT NULL THEN
        SELECT org_id INTO v_target_org_id
          FROM public.departments WHERE id = p_new_department_id;
        IF v_target_org_id IS NULL THEN
          RAISE EXCEPTION 'Target department not found' USING ERRCODE = 'P0002';
        END IF;
      ELSIF v_invoice.department_id IS NOT NULL THEN
        SELECT org_id INTO v_target_org_id
          FROM public.departments WHERE id = v_invoice.department_id;
      END IF;

      IF v_target_org_id IS NULL THEN
        RAISE EXCEPTION 'Cannot determine an organization context for this invoice. Specify a target department.' USING ERRCODE = '22000';
      END IF;

      IF NOT public.can_manage_org_structure(v_target_org_id, v_actor) THEN
        RAISE EXCEPTION 'You do not have permission to reassign invoices in this organization'
          USING ERRCODE = '42501';
      END IF;

      -- Belt-and-braces: prevent cross-org capture. When attaching to a
      -- dept in org X, the invoice's buyer must actually be a member of X.
      IF p_new_department_id IS NOT NULL THEN
        SELECT client_id INTO v_job_client_id
          FROM public.jobs WHERE id = v_invoice.job_id;
        IF v_job_client_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.org_members
              WHERE org_id = v_target_org_id
                AND user_id = v_job_client_id
           )
        THEN
          RAISE EXCEPTION 'Invoice buyer is not a member of the target organization'
            USING ERRCODE = '42501';
        END IF;
      END IF;

      -- Capture old org for the audit delta.
      IF v_invoice.department_id IS NOT NULL THEN
        SELECT org_id INTO v_old_org_id
          FROM public.departments WHERE id = v_invoice.department_id;
      END IF;

      -- Apply the update — trigger refreshes cost_center_snapshot.
      UPDATE public.invoices
         SET department_id = p_new_department_id
       WHERE id = p_invoice_id;

      -- Resolve actor identity for the audit row.
      SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
        FROM public._dept_actor_profile(v_actor);

      INSERT INTO public.audit_events (
        event_type, actor_id, actor_role, actor_label,
        subject_table, subject_id, summary, delta, metadata, correlation_id
      ) VALUES (
        'invoice.department.reassigned',
        v_actor,
        v_actor_role,
        v_actor_label,
        'invoices',
        p_invoice_id,
        format('Invoice department reassigned · %s', v_reason),
        jsonb_build_object(
          'from_department_id', v_invoice.department_id,
          'to_department_id',   p_new_department_id,
          'from_org_id',        v_old_org_id,
          'to_org_id',          v_target_org_id,
          'reason',             v_reason
        ),
        jsonb_build_object(
          'org_id',     v_target_org_id,
          'invoice_id', p_invoice_id,
          'job_id',     v_invoice.job_id
        ),
        v_correlation
      );

      RETURN jsonb_build_object(
        'ok', true,
        'invoice_id', p_invoice_id,
        'from_department_id', v_invoice.department_id,
        'to_department_id', p_new_department_id,
        'correlation_id', v_correlation
      );
    END;
    $body$
  $f$;

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.reassign_invoice_department(uuid, uuid, text) TO authenticated';
END $$;

COMMIT;
