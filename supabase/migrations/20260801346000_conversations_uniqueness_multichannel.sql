-- ════════════════════════════════════════════════════════════════════════════
--  20260801346000_conversations_uniqueness_multichannel.sql
--
--  The duplicate-key error in 344000's proof exposed a FIXTURE bug (one uuid
--  reused as both buyer and supplier — fixed in 344000 itself). Auditing every
--  uniqueness rule on conversations to confirm that then turned up a SECOND,
--  independent problem that is NOT a fixture issue and WILL fail at runtime.
--
--  ── THE REAL BLOCKER: uniq_conversations_job_room_per_user_kind ────────────
--      UNIQUE (job_id, user_id, kind) WHERE job_id IS NOT NULL
--
--  That encodes the old 1:1 model — one admin/internal room per user, per job,
--  per kind — and it is correct for every legacy kind. It is FATAL for
--  job_client_inspector, because open_direct_conversation attributes the room
--  to the buyer PRINCIPAL: when an inspector is replaced, the second room has
--  the same job_id, the same user_id and the same kind, differing only in
--  contractor_id. Replacement isolation — a core requirement, and the thing
--  conversations_one_direct_room_per_job_inspector exists to permit — would
--  have failed with 23505 on the second room. Same hazard on
--  job_supplier_inspector if one inspection ever has two supplier facilities.
--
--  ── THE OTHER RULE: conversations_job_id_client_id_contractor_id_key ───────
--      UNIQUE (job_id, client_id, contractor_id)   -- table constraint, all kinds
--
--  Every legacy writer (the 200000 backfill, ensure_job_conversation,
--  ensure_team_internal_conversation) inserts only (kind, user_id, job_id,
--  title), leaving client_id and contractor_id NULL. Under the default NULLS
--  DISTINCT this constraint is therefore VACUOUS for legacy rows — it has never
--  prevented anything. The new two-party kinds are the first writers to
--  populate both columns, so the rule silently activated against them and now
--  couples channels that have nothing to do with each other: it forbids a
--  buyer↔inspector room and a supplier↔inspector room coexisting on one job
--  whenever the buyer and the supplier are the same account. That is a real
--  product state — a supplier-role account may raise its own RFQ, becoming
--  supplier_rfqs.client_id and therefore the spawned job's buyer.
--
--  ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--  Both rules are re-expressed as PARTIAL indexes excluding the three
--  two-party kinds. For every legacy kind the semantics are byte-identical.
--  For the new kinds the three partial indexes from 334000/340000 become the
--  sole and authoritative duplicate-room rule, which is what they were written
--  to be. Nothing is dropped without a narrower replacement, and no channel
--  loses duplicate protection.
--
--  ── UNIQUENESS AFTER THIS MIGRATION ────────────────────────────────────────
--    help_support            one per user                    (uniq_..._help_support_per_user)
--    job_client_admin        one per (job, user)             (…_job_room_per_user_kind)
--    job_inspector_admin     one per (job, user)             (…_job_room_per_user_kind)
--    job_supplier_admin      one per (job, user)             (…_job_room_per_user_kind)
--    job_team_internal       one per (job, user)             (…_job_room_per_user_kind)
--    job_client_inspector    one per (job, inspector)        (334000 partial index)
--    job_supplier_inspector  one per (job, inspector, supplier) (340000 partial index)
--    buyer_supplier          one per (buyer, supplier)       (340000 partial index)
--
--  So a single job may legitimately carry: an admin room per party, a team
--  room, one direct room per inspector (replacement history preserved), and
--  one supplier-coordination room per (inspector, supplier) — while a second
--  room of the SAME channel and participants remains impossible.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- The three two-party kinds, factored out so both predicates stay in step.
-- Written inline rather than via a function because index predicates must be
-- IMMUTABLE and self-contained.

-- ── 1. per-user-per-kind room rule → legacy kinds only ──────────────────────
DROP INDEX IF EXISTS public.uniq_conversations_job_room_per_user_kind;

CREATE UNIQUE INDEX uniq_conversations_job_room_per_user_kind
  ON public.conversations (job_id, user_id, kind)
  WHERE job_id IS NOT NULL
    AND kind NOT IN (
      'job_client_inspector'::public.conversation_kind,
      'job_supplier_inspector'::public.conversation_kind,
      'buyer_supplier'::public.conversation_kind
    );

COMMENT ON INDEX public.uniq_conversations_job_room_per_user_kind IS
  'One admin-mediated / internal room per (job, user, kind). Scoped away from the two-party kinds by 20260801346000: those attribute the room to a PRINCIPAL, so a replacement inspector legitimately produces a second room with an identical (job_id, user_id, kind) and this rule would have rejected it. Their duplicate prevention lives in the 334000/340000 partial indexes.';

-- ── 2. the party-tuple rule → legacy kinds only ─────────────────────────────
--  Preserved rather than deleted. It is vacuous for legacy rows today (they
--  leave both party columns NULL), but keeping it means a future legacy writer
--  that DOES populate them still inherits the original guarantee.
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_job_id_client_id_contractor_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_legacy_party_tuple_key
  ON public.conversations (job_id, client_id, contractor_id)
  WHERE kind NOT IN (
    'job_client_inspector'::public.conversation_kind,
    'job_supplier_inspector'::public.conversation_kind,
    'buyer_supplier'::public.conversation_kind
  );

COMMENT ON INDEX public.conversations_legacy_party_tuple_key IS
  'Successor to the table constraint conversations_job_id_client_id_contractor_id_key, narrowed to non-two-party kinds by 20260801346000. The original applied to every kind; because legacy writers leave client_id/contractor_id NULL it was vacuous for them, and it only ever bit the new channels — forbidding a buyer↔inspector and a supplier↔inspector room on the same job when one account is both buyer and supplier (a supplier that raised its own RFQ). Legacy semantics are unchanged.';

-- ── 3. Self-tests ───────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF to_regclass('public.uniq_conversations_job_room_per_user_kind') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the legacy per-user-kind room rule was dropped without replacement';
  END IF;
  IF to_regclass('public.conversations_legacy_party_tuple_key') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the legacy party-tuple rule was dropped without replacement';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'conversations_job_id_client_id_contractor_id_key'
                AND conrelid = 'public.conversations'::regclass) THEN
    RAISE EXCEPTION 'SELFTEST: the kind-agnostic party-tuple constraint still exists';
  END IF;

  -- The three per-channel rules must survive: they are now the ONLY duplicate
  -- protection for the two-party kinds.
  IF to_regclass('public.conversations_one_direct_room_per_job_inspector') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: buyer-inspector duplicate prevention is missing';
  END IF;
  IF to_regclass('public.conversations_one_supplier_inspector_room') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: supplier-inspector duplicate prevention is missing';
  END IF;
  IF to_regclass('public.conversations_one_buyer_supplier_room') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: buyer-supplier duplicate prevention is missing';
  END IF;
  IF to_regclass('public.uniq_conversations_help_support_per_user') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: help_support uniqueness was disturbed';
  END IF;
END
$verify$;

-- ── 4. Behavioural proof ────────────────────────────────────────────────────
--  Asserts the two things this migration exists to change, and the two things
--  it must NOT change. Fixtures are removed before COMMIT.
DO $behaviour$
DECLARE
  v_buyer uuid := '00000000-0000-4000-8000-0000000000c1';
  v_i1    uuid := '00000000-0000-4000-8000-0000000000c2';
  v_i2    uuid := '00000000-0000-4000-8000-0000000000c3';
  v_sup   uuid := '00000000-0000-4000-8000-0000000000c4';
  v_j     uuid := '00000000-0000-4000-8000-0000000000d1';
  v_ok    boolean;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_buyer,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','uq.buyer@selftest.nx',now(),now()),
         (v_i1,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','uq.i1@selftest.nx',now(),now()),
         (v_i2,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','uq.i2@selftest.nx',now(),now()),
         (v_sup,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','uq.sup@selftest.nx',now(),now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email, role)
  VALUES (v_buyer,'uq.buyer@selftest.nx','client'), (v_i1,'uq.i1@selftest.nx','inspector'),
         (v_i2,'uq.i2@selftest.nx','inspector'),    (v_sup,'uq.sup@selftest.nx','supplier')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.jobs (id, title, client_id, status, moderation_status)
  VALUES (v_j, 'uniqueness selftest', v_buyer, 'open', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- ★ THE FIX: replacement. Two direct rooms, same job, same buyer principal,
  --   same kind — different inspectors. This is what used to raise 23505.
  INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, status)
  VALUES (v_j, v_buyer, v_i1, 'job_client_inspector', v_buyer, 'open'),
         (v_j, v_buyer, v_i2, 'job_client_inspector', v_buyer, 'open');

  -- ★ THE FIX: channel coexistence when one account is both buyer and supplier
  --   (a supplier that raised its own RFQ). Identical (job, client, contractor)
  --   tuple across two different kinds — used to violate the table constraint.
  INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, status)
  VALUES (v_j, v_buyer, v_i1, 'job_supplier_inspector', v_i1, 'open');

  -- MUST STILL FAIL: a duplicate room of the SAME channel.
  BEGIN
    INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, status)
    VALUES (v_j, v_buyer, v_i1, 'job_client_inspector', v_buyer, 'open');
    v_ok := false;
  EXCEPTION WHEN unique_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'SELFTEST: a DUPLICATE buyer-inspector room was accepted — per-channel uniqueness is gone';
  END IF;

  -- MUST STILL FAIL: two admin rooms for the same (job, user, kind).
  INSERT INTO public.conversations (job_id, kind, user_id, status)
  VALUES (v_j, 'job_client_admin', v_buyer, 'open');
  BEGIN
    INSERT INTO public.conversations (job_id, kind, user_id, status)
    VALUES (v_j, 'job_client_admin', v_buyer, 'open');
    v_ok := false;
  EXCEPTION WHEN unique_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'SELFTEST: legacy one-room-per-(job,user,kind) was weakened';
  END IF;

  DELETE FROM public.conversations WHERE job_id = v_j;
  DELETE FROM public.jobs     WHERE id = v_j;
  DELETE FROM public.profiles WHERE id IN (v_buyer, v_i1, v_i2, v_sup);
  DELETE FROM auth.users      WHERE id IN (v_buyer, v_i1, v_i2, v_sup);

  RAISE NOTICE 'Multi-channel uniqueness verified: replacement rooms coexist, duplicates of the same channel still rejected, legacy rules intact.';
END
$behaviour$;

COMMIT;
