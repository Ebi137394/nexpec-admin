-- ════════════════════════════════════════════════════════════════════════════
--  20260615120000_legacy_contracts_decommission.sql
--
--  CONTRACT MODEL CONSOLIDATION — V3 is now the only canonical surface.
--
--  CONTEXT
--  ───────
--  The mobile app previously surfaced both the V1 `public.contracts` table
--  and the V3 `public.job_contracts` table on the Smart Contracts Hub and
--  on the Job Details "Contract" tile. This caused the same job to display
--  TWO contract rows whenever both stacks had records — exactly the
--  duplication the user reported ("one job, two contracts").
--
--  This migration is the DATABASE-side half of the cutover:
--
--    1) Soft-deletes V1 contract rows that have a V3 counterpart for the
--       same job. The legacy row is preserved (deleted_at IS NOT NULL)
--       for SOX-grade audit history but is never surfaced again.
--
--    2) Adds an index that future queries can use to enforce "active
--       contracts only" cheaply: WHERE deleted_at IS NULL.
--
--    3) Writes an immutable audit_events row per soft-delete so the
--       Compliance Command Center can prove this consolidation was
--       performed against real data, not synthesized.
--
--  WHAT THIS DOES NOT DO
--  ─────────────────────
--    • Does not drop the contracts table. Audit history retention.
--    • Does not delete V1 rows for jobs that never received a V3 contract
--      (orphaned legacy contracts). Those remain visible only through the
--      web admin archive surface — never the mobile app, because the
--      mobile Hub now ignores the legacy table entirely.
--    • Does not modify any V3 row.
--    • Does not change the `contracts` table schema. Backwards-compatible.
--
--  Re-runnable. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) Sanity check — ensure `contracts.deleted_at` exists. The column has
--    been on the table since 2026-02 per the column dump, but a defensive
--    guard prevents this migration from breaking on a fresh dev clone.
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'contracts'
       AND column_name  = 'deleted_at'
  ) THEN
    ALTER TABLE public.contracts ADD COLUMN deleted_at timestamptz;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Soft-delete V1 contract rows whose job_id has a V3 counterpart.
--    Only touches rows where deleted_at IS NULL today, so re-running
--    this migration is a no-op after the first pass.
-- ─────────────────────────────────────────────────────────────────────
WITH duplicates AS (
  SELECT c.id, c.job_id
    FROM public.contracts c
   WHERE c.deleted_at IS NULL
     AND c.job_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.job_contracts jc
        WHERE jc.job_id = c.job_id
     )
),
soft_deleted AS (
  UPDATE public.contracts AS c
     SET deleted_at = now()
    FROM duplicates d
   WHERE c.id = d.id
  RETURNING c.id, c.job_id, c.client_id, c.contractor_id, c.status
)
INSERT INTO public.audit_events (
  event_type, severity, actor_id, actor_role, actor_label,
  subject_table, subject_id, job_id, summary, delta, metadata
)
SELECT
  'compliance.contracts.legacy_decommissioned',
  'info',
  NULL,             -- system actor
  'system',
  'NEXPEC System',
  'contracts',
  sd.id,
  sd.job_id,
  format(
    'Legacy V1 contract %s soft-deleted: superseded by V3 job_contracts row for job %s',
    sd.id,
    sd.job_id
  ),
  jsonb_build_object(
    'legacy_contract_id', sd.id,
    'job_id',             sd.job_id,
    'client_id',          sd.client_id,
    'contractor_id',      sd.contractor_id,
    'legacy_status',      sd.status,
    'reason',             'v3_cutover_consolidation'
  ),
  jsonb_build_object(
    'migration', '20260615120000_legacy_contracts_decommission',
    'job_id',    sd.job_id::text
  )
FROM soft_deleted sd;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Index supporting the new "active contracts only" query pattern.
--    Cheap partial index — only holds non-deleted rows.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS contracts_active_idx
  ON public.contracts (job_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Lock the legacy table down. Authenticated users can still SELECT
--    (for the read-only archive viewer at /contracts/[id]) but cannot
--    INSERT / UPDATE / DELETE directly. All mutations going forward
--    must flow through the V3 job_contracts model.
--
--    Existing RLS policies are not touched — the REVOKE below is a
--    table-level guard above RLS.
-- ─────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.contracts FROM PUBLIC, authenticated, anon;

COMMENT ON TABLE public.contracts IS
  'V1 legacy contracts table — DECOMMISSIONED 2026-06-15. Read-only archive.'
  ' All active contract operations flow through public.job_contracts (V3).'
  ' Mobile Hub no longer reads from this table; the web admin archive surface'
  ' still exposes it read-only for SOX audit history.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- POST-MIGRATION VERIFICATION QUERIES (run manually after applying)
-- ─────────────────────────────────────────────────────────────────────
-- 1) Confirm soft-delete count matches expected duplicates:
--      SELECT count(*) FROM public.contracts WHERE deleted_at IS NOT NULL;
--
-- 2) Confirm no job has BOTH an active legacy row AND a V3 row:
--      SELECT c.job_id
--        FROM public.contracts c
--        JOIN public.job_contracts jc ON jc.job_id = c.job_id
--       WHERE c.deleted_at IS NULL;
--      -- Expect: 0 rows
--
-- 3) Confirm audit emission:
--      SELECT count(*) FROM public.audit_events
--       WHERE event_type = 'compliance.contracts.legacy_decommissioned';
--
-- 4) Confirm the REVOKE took effect (run as the inspector role):
--      INSERT INTO public.contracts (job_id, client_id, contractor_id, status)
--        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'draft');
--      -- Expect: 42501 insufficient_privilege
-- ─────────────────────────────────────────────────────────────────────
