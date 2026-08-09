-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801346000_conversations_uniqueness_multichannel
--
--  Restores the kind-agnostic uniqueness model:
--    • UNIQUE (job_id, user_id, kind) WHERE job_id IS NOT NULL   — all kinds
--    • table constraint UNIQUE (job_id, client_id, contractor_id) — all kinds
--
--  ⚠ THIS RE-BREAKS REPLACEMENT. Under the restored per-(job,user,kind) rule a
--  second buyer↔inspector room on the same job — which is exactly how a
--  replacement inspector gets an isolated room — raises 23505. Roll this back
--  only together with 340000/334000, never on its own.
--
--  The restore can also FAIL if two-party rooms already exist that violate the
--  wider rules (a replaced inspector, or a supplier that is also the buyer).
--  That is deliberate: silently dropping those rows to force the old shape
--  back would destroy commercial records. If it fails, decide explicitly what
--  to do with the conflicting conversations before retrying.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP INDEX IF EXISTS public.conversations_legacy_party_tuple_key;
DROP INDEX IF EXISTS public.uniq_conversations_job_room_per_user_kind;

CREATE UNIQUE INDEX uniq_conversations_job_room_per_user_kind
  ON public.conversations (job_id, user_id, kind)
  WHERE job_id IS NOT NULL;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_job_id_client_id_contractor_id_key
  UNIQUE (job_id, client_id, contractor_id);

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'conversations_job_id_client_id_contractor_id_key'
                    AND conrelid = 'public.conversations'::regclass) THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the kind-agnostic party-tuple constraint was not restored';
  END IF;
  IF to_regclass('public.conversations_legacy_party_tuple_key') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the partial successor index survived';
  END IF;
  -- The per-channel rules are NOT this migration's to remove.
  IF to_regclass('public.conversations_one_direct_room_per_job_inspector') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: it removed a per-channel duplicate rule';
  END IF;
  RAISE WARNING '346000 rolled back — replacement-inspector rooms can no longer be created (23505). Roll back 340000 and 334000 as well.';
END
$verify$;

COMMIT;
