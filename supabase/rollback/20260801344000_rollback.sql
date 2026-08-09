-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801344000_conversations_kind_shape_all_channels
--
--  Restores the 20260801210000 shape rule verbatim (help_support + the three
--  job-scoped admin/internal kinds).
--
--  ⚠ ORDERING MATTERS. This rollback makes every two-party kind uninsertable
--  again, so it must run BEFORE — or together with — the 340000/334000
--  rollbacks. Running it alone leaves the direct-chat RPCs in place but unable
--  to create a room: open_direct_conversation() would pass authorization and
--  then fail with 23514, which is exactly the defect 344000 fixed.
--
--  Existing rows of the new kinds are NOT deleted: they are commercial records,
--  and the restored constraint is NOT VALID so it does not re-scan them.
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

COMMENT ON CONSTRAINT conversations_kind_shape ON public.conversations IS
  'Per-kind shape contract for conversations (restored to the 20260801210000 rule). EXHAUSTIVE ALLOW-LIST: any conversation_kind without a branch here cannot be inserted.';

DO $verify$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'conversations_kind_shape'
     AND conrelid = 'public.conversations'::regclass;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: conversations_kind_shape is missing entirely';
  END IF;
  IF v_def ~ 'job_client_inspector|job_supplier_inspector|buyer_supplier' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: a two-party kind survived in the shape rule';
  END IF;
  IF v_def !~ 'job_team_internal' THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: job_team_internal was dropped (Ghost Mode would break)';
  END IF;
  RAISE WARNING '344000 rolled back — two-party conversation kinds can no longer be INSERTED. Roll back 340000 and 334000 as well.';
END
$verify$;

COMMIT;
