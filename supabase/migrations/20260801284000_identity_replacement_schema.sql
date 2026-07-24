-- ════════════════════════════════════════════════════════════════════════════
--  20260801284000_identity_replacement_schema.sql
--
--  INSPECTION MARKETPLACE — selective identity disclosure + inspector replacement
--  (SCHEMA layer only: columns, constraints, execution-time snapshot trigger,
--   and the two stable helper functions reused by RPCs and RLS).
--
--  Scope: Workflow A only  →  jobs → applications → job_contracts → signatures.
--  The Supplier/Brokered context (supplier_rfqs → deals → agreements →
--  inspector_engagement_meta) is a SEPARATE bounded context and is NOT touched
--  by this migration or its siblings (…286000 RPCs, …288000 view/RLS/cron).
--
--  Backward-compatible by construction:
--    • jobs.identity_mode defaults 'protected'      → legacy jobs behave as today
--    • jobs.replacement_mode defaults 'client_reapproval'
--    • job_contracts.client_approval_type defaults 'client_signature'
--    • effective_identity_mode is NULL for legacy executed contracts and is
--      resolved fail-closed to 'protected' by the client view (…288000).
--      NO destructive backfill is performed.
--
--  Idempotent + safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) jobs — Admin-controlled project policies (identity + replacement mode)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS identity_mode    text NOT NULL DEFAULT 'protected',
  ADD COLUMN IF NOT EXISTS replacement_mode text NOT NULL DEFAULT 'client_reapproval';

-- Enum-like guards (drop+add = idempotent). Existing rows already satisfy the
-- defaults, so these validate immediately.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_identity_mode_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_identity_mode_check
  CHECK (identity_mode = ANY (ARRAY['protected'::text, 'professional'::text, 'full'::text]));

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_replacement_mode_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_replacement_mode_check
  CHECK (replacement_mode = ANY (ARRAY['client_reapproval'::text, 'admin_authorized'::text]));

COMMENT ON COLUMN public.jobs.identity_mode IS
  'Admin-only project policy: protected|professional|full. Governs how much of the assigned inspector''s identity the client sees via client_job_contracts_view. Default protected = legacy behaviour.';
COMMENT ON COLUMN public.jobs.replacement_mode IS
  'Admin-only project policy: client_reapproval|admin_authorized. Governs whether a replacement contract needs a fresh client signature or is admin-authorized on the client side. Default client_reapproval.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) job_contracts — approval provenance + immutable execution-time snapshot
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.job_contracts
  ADD COLUMN IF NOT EXISTS client_approval_type      text NOT NULL DEFAULT 'client_signature',
  ADD COLUMN IF NOT EXISTS admin_authorized_by       uuid,
  ADD COLUMN IF NOT EXISTS admin_authorized_at       timestamptz,
  ADD COLUMN IF NOT EXISTS admin_authorization_reason text,
  ADD COLUMN IF NOT EXISTS effective_identity_mode   text;

-- client_approval_type ∈ {client_signature, admin_authorized}
ALTER TABLE public.job_contracts DROP CONSTRAINT IF EXISTS job_contracts_client_approval_type_check;
ALTER TABLE public.job_contracts
  ADD CONSTRAINT job_contracts_client_approval_type_check
  CHECK (client_approval_type = ANY (ARRAY['client_signature'::text, 'admin_authorized'::text]));

-- admin_authorized ⇒ full authorization metadata present (actor + timestamp +
-- non-empty reason). This is what lets Admin authorization stand in for the
-- client-approval side of an admin_authorized replacement.
ALTER TABLE public.job_contracts DROP CONSTRAINT IF EXISTS job_contracts_admin_auth_complete;
ALTER TABLE public.job_contracts
  ADD CONSTRAINT job_contracts_admin_auth_complete
  CHECK (
    client_approval_type <> 'admin_authorized'
    OR (
      admin_authorized_by IS NOT NULL
      AND admin_authorized_at IS NOT NULL
      AND length(btrim(COALESCE(admin_authorization_reason, ''))) > 0
    )
  );

-- client_signature must NOT falsely imply Admin authorization: a client_signature
-- contract carries no admin-authorization metadata.
ALTER TABLE public.job_contracts DROP CONSTRAINT IF EXISTS job_contracts_client_sig_no_admin_auth;
ALTER TABLE public.job_contracts
  ADD CONSTRAINT job_contracts_client_sig_no_admin_auth
  CHECK (
    client_approval_type = 'admin_authorized'
    OR (
      admin_authorized_by IS NULL
      AND admin_authorized_at IS NULL
      AND admin_authorization_reason IS NULL
    )
  );

-- effective_identity_mode ∈ {protected, professional, full} when present (NULL
-- while pending / for legacy executed rows).
ALTER TABLE public.job_contracts DROP CONSTRAINT IF EXISTS job_contracts_effective_identity_mode_check;
ALTER TABLE public.job_contracts
  ADD CONSTRAINT job_contracts_effective_identity_mode_check
  CHECK (
    effective_identity_mode IS NULL
    OR effective_identity_mode = ANY (ARRAY['protected'::text, 'professional'::text, 'full'::text])
  );

COMMENT ON COLUMN public.job_contracts.client_approval_type IS
  'client_signature (real client e-signature) | admin_authorized (admin stands in for the client-approval side during an admin_authorized replacement; inspector signature still required).';
COMMENT ON COLUMN public.job_contracts.effective_identity_mode IS
  'Immutable snapshot of jobs.identity_mode captured at the first transition to fully_executed. NULL while pending and for legacy executed rows (resolved fail-closed to protected by the client view). Never rewritten by later policy changes.';

-- The existing partial unique index (uniq_job_contracts_active_per_job on
-- job_contracts(job_id) WHERE status <> 'voided') remains the sole authority for
-- "exactly one active contract per job". We deliberately do NOT add a second.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Execution-time identity snapshot — un-bypassable BEFORE trigger
--
--    Fires for EVERY write to job_contracts, so all three execution orders are
--    covered identically (client→inspector, the defensive inspector→client hop,
--    and admin_authorized→inspector). Because it runs BEFORE the row is written,
--    no sign RPC can commit a fully_executed row without the snapshot, and none
--    can later mutate it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_job_contracts_identity_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_job_mode text;
BEGIN
  -- (a) IMMUTABILITY: once stamped, effective_identity_mode can never change.
  IF TG_OP = 'UPDATE' AND OLD.effective_identity_mode IS NOT NULL THEN
    NEW.effective_identity_mode := OLD.effective_identity_mode;
  END IF;

  -- (b) SNAPSHOT: on the first transition into fully_executed, stamp the Job's
  --     CURRENT identity_mode (fail-closed to 'protected' if somehow NULL).
  IF NEW.status = 'fully_executed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'fully_executed')
     AND NEW.effective_identity_mode IS NULL
  THEN
    SELECT j.identity_mode INTO v_job_mode FROM public.jobs j WHERE j.id = NEW.job_id;
    NEW.effective_identity_mode := COALESCE(v_job_mode, 'protected');
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.tg_job_contracts_identity_snapshot() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_job_contracts_identity_snapshot ON public.job_contracts;
CREATE TRIGGER trg_job_contracts_identity_snapshot
  BEFORE INSERT OR UPDATE ON public.job_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_job_contracts_identity_snapshot();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Helper functions (STABLE, SECURITY DEFINER, fixed search_path) — reused by
--    RLS policies (…288000) and the replacement/void RPCs (…286000).
-- ─────────────────────────────────────────────────────────────────────────────

-- is_active_contract_inspector(job, user):
--   TRUE  iff `user` is the inspector on THE current non-voided contract of `job`.
--   The partial unique index guarantees at most one non-voided contract per job,
--   so a replaced (former) inspector — whose contract is voided — returns FALSE,
--   which is exactly the operational/historical boundary used by write RLS.
CREATE OR REPLACE FUNCTION public.is_active_contract_inspector(p_job_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.job_contracts jc
    WHERE jc.job_id = p_job_id
      AND jc.inspector_id = p_user_id
      AND jc.status <> 'voided'
  );
$$;

ALTER FUNCTION public.is_active_contract_inspector(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_active_contract_inspector(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_contract_inspector(uuid, uuid) TO authenticated, service_role;

-- inspector_assignment_end(job, user):
--   The authoritative moment this user's assignment on this job ended.
--     • has any non-voided contract  → NULL  (still ACTIVE; no historical bound)
--     • all their contracts voided    → earliest voided_at (the replacement moment)
--     • FAIL-CLOSED: a voided contract with NULL voided_at contributes created_at
--       (the earliest safe instant), so malformed history never widens the window
--       into future project activity.
--   Callers treat NULL as "active → unbounded"; a non-NULL value bounds a former
--   inspector's historical reads to on/before that instant.
CREATE OR REPLACE FUNCTION public.inspector_assignment_end(p_job_id uuid, p_user_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
           WHEN bool_or(jc.status <> 'voided') THEN NULL
           ELSE min(COALESCE(jc.voided_at, jc.created_at))
         END
  FROM public.job_contracts jc
  WHERE jc.job_id = p_job_id
    AND jc.inspector_id = p_user_id;
$$;

ALTER FUNCTION public.inspector_assignment_end(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.inspector_assignment_end(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inspector_assignment_end(uuid, uuid) TO authenticated, service_role;

-- Reload PostgREST schema cache so the new columns resolve immediately.
NOTIFY pgrst, 'reload schema';
