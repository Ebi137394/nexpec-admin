-- ============================================================================
-- ALLOW AGENCY-OWNED JOBS — drop legacy NOT NULL on jobs.client_id
-- ============================================================================
--
-- The pre-compliance schema declared jobs.client_id as NOT NULL because
-- every job was owned by a client. The Compliance Mode foundation
-- migration (20260514100000) added jobs.agency_id and a jobs_owner_xor
-- CHECK constraint requiring exactly one of {client_id, agency_id} to
-- be non-null. The two constraints together made agency-owned jobs
-- impossible to insert: the XOR demanded client_id IS NULL while the
-- NOT NULL forbade it.
--
-- Dropping NOT NULL keeps existing client-posted rows intact (they
-- already have client_id set) and unlocks the post-compliance-job
-- flow for agency callers. The XOR constraint remains the single
-- source of truth for ownership invariants.
-- ============================================================================

BEGIN;

ALTER TABLE public.jobs ALTER COLUMN client_id DROP NOT NULL;

COMMIT;
