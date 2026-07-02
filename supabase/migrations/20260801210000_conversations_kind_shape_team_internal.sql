-- ════════════════════════════════════════════════════════════════════════════
--  20260801210000_conversations_kind_shape_team_internal.sql  (Ghost-Mode hotfix)
--
--  208000's ensure_team_internal_conversation() inserts kind='job_team_internal'
--  with job_id NOT NULL, but the baseline CHECK `conversations_kind_shape` only
--  admits:
--     job_client_admin | job_inspector_admin   → job_id NOT NULL
--     help_support                             → job_id NULL
--  → the new kind matches NO branch and the insert is REJECTED, so Ghost Mode
--  could never create its room (caught by rls_team_internal_test's seed). Recreate
--  the constraint with job_team_internal in the job-scoped branch.
--
--  Kept NOT VALID to match the original (does not re-scan existing rows; new rows
--  are still enforced). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_kind_shape;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_kind_shape CHECK (
    (
      (kind = ANY (ARRAY[
        'job_client_admin'::public.conversation_kind,
        'job_inspector_admin'::public.conversation_kind,
        'job_team_internal'::public.conversation_kind
      ])) AND (job_id IS NOT NULL)
    )
    OR ((kind = 'help_support'::public.conversation_kind) AND (job_id IS NULL))
  ) NOT VALID;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_kind_shape'
      AND pg_get_constraintdef(oid) LIKE '%job_team_internal%'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: conversations_kind_shape does not admit job_team_internal';
  END IF;
  RAISE NOTICE 'conversations_kind_shape now admits job_team_internal (job-scoped).';
END
$test$;

COMMIT;
