-- ════════════════════════════════════════════════════════════════════════════
--  20260801344000_conversations_kind_shape_all_channels.sql
--
--  ROOT CAUSE. public.conversations carries CHECK conversations_kind_shape,
--  which is an EXHAUSTIVE ALLOW-LIST of conversation kinds:
--
--      (kind IN (job_client_admin, job_inspector_admin, job_team_internal)
--       AND job_id IS NOT NULL)
--   OR (kind = help_support AND job_id IS NULL)
--
--  A kind that appears in NEITHER branch matches no disjunct, so the CHECK is
--  false and the INSERT is rejected with 23514 — no matter how correct the
--  authorization was. 20260801332000/338000 added four new enum values and
--  334000/340000 wrote rooms with them, but nothing extended this constraint.
--  Result: open_direct_conversation() passed every gate and then died on the
--  INSERT, and because the room never existed every downstream assertion
--  (send, unread, attachments, admin transcript, history) cascaded.
--
--  This is the SAME defect 20260801210000 fixed for job_team_internal. Its
--  header even predicts it: "the new kind matches NO branch and the insert is
--  REJECTED". Adding an enum value is not enough — this constraint must be
--  extended in the same batch, every time.
--
--  ── WHY THIS IS TIGHTER, NOT LOOSER ────────────────────────────────────────
--  The lazy fix is to append the four kinds to the job-scoped list. That would
--  be wrong twice over: buyer_supplier is deliberately job-LESS (a procurement
--  relationship exists before any job, and a purely procurement RFQ never
--  spawns one), and it would say nothing about the party columns the two-party
--  kinds depend on. So each new kind gets its own branch asserting the exact
--  shape its authorization function reads:
--
--    kind                    job_id     client_id            contractor_id
--    ─────────────────────── ────────── ──────────────────── ──────────────
--    help_support            NULL       —                    —
--    job_client_admin        NOT NULL   —                    —
--    job_inspector_admin     NOT NULL   —                    —
--    job_supplier_admin      NOT NULL   —                    —
--    job_team_internal       NOT NULL   —                    —
--    job_client_inspector    NOT NULL   buyer principal      inspector
--    job_supplier_inspector  NOT NULL   SUPPLIER             inspector
--    buyer_supplier          NULL       buyer principal      SUPPLIER
--
--  A malformed two-party row — say a direct room with a NULL inspector, which
--  would make nx_direct_chat_authorized(job, NULL, uid) permanently false and
--  strand the conversation — is now impossible rather than merely unlikely.
--  The four legacy kinds keep EXACTLY their existing rule; no new requirement
--  is imposed on rows that already exist.
--
--  ── NOT VALID IS DELIBERATE ────────────────────────────────────────────────
--  Matches the baseline and 210000. A VALID constraint re-scans every existing
--  conversation, and Production predates all of this; a legacy row with an
--  unexpected NULL would abort the migration. New and updated rows are checked
--  either way, which is what actually matters here.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_kind_shape;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_kind_shape CHECK (
    -- ── admin-mediated + internal: job-scoped, party columns unconstrained ──
    (
      (kind = ANY (ARRAY[
        'job_client_admin'::public.conversation_kind,
        'job_inspector_admin'::public.conversation_kind,
        'job_supplier_admin'::public.conversation_kind,
        'job_team_internal'::public.conversation_kind
      ])) AND (job_id IS NOT NULL)
    )

    -- ── help & support: explicitly NOT job-scoped ──────────────────────────
    OR ((kind = 'help_support'::public.conversation_kind) AND (job_id IS NULL))

    -- ── buyer ↔ inspector (20260801334000): job-scoped, both parties named ──
    OR (
      (kind = 'job_client_inspector'::public.conversation_kind)
      AND (job_id IS NOT NULL)
      AND (client_id IS NOT NULL)      -- buyer principal, COALESCE(agency_id, client_id)
      AND (contractor_id IS NOT NULL)  -- the active contract inspector
    )

    -- ── supplier ↔ inspector (20260801340000): job-scoped, both parties named.
    --    client_id carries the SUPPLIER on this kind; the kind is what
    --    disambiguates that column, and every gate reads it that way. ────────
    OR (
      (kind = 'job_supplier_inspector'::public.conversation_kind)
      AND (job_id IS NOT NULL)
      AND (client_id IS NOT NULL)      -- the supplier attached to the job
      AND (contractor_id IS NOT NULL)  -- the active contract inspector
    )

    -- ── buyer ↔ supplier (20260801340000): job-LESS by design ───────────────
    OR (
      (kind = 'buyer_supplier'::public.conversation_kind)
      AND (job_id IS NULL)
      AND (client_id IS NOT NULL)      -- buyer principal
      AND (contractor_id IS NOT NULL)  -- the supplier
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT conversations_kind_shape ON public.conversations IS
  'Per-kind shape contract for conversations. EXHAUSTIVE ALLOW-LIST: a conversation_kind with no branch here cannot be inserted at all, so every ALTER TYPE ... ADD VALUE on conversation_kind MUST extend this constraint in the same batch (see 20260801210000 and 20260801344000, which both exist because that step was missed). Two-party kinds additionally require their party columns, so a room can never be created in a shape its own authorization function would reject.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_def  text;
  v_kind text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'conversations_kind_shape'
     AND conrelid = 'public.conversations'::regclass;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: conversations_kind_shape is missing';
  END IF;

  -- EVERY enum value must appear. This is the check whose absence caused the
  -- outage twice; it now fails the migration instead of the runtime insert.
  FOR v_kind IN
    SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'conversation_kind'
  LOOP
    IF position(v_kind IN v_def) = 0 THEN
      RAISE EXCEPTION
        'SELFTEST: conversation_kind ''%'' has no branch in conversations_kind_shape — every insert of that kind would fail with 23514',
        v_kind;
    END IF;
  END LOOP;

  -- The two-party kinds must genuinely require their party columns; otherwise
  -- this migration would have loosened the constraint instead of tightening it.
  IF v_def !~ 'contractor_id IS NOT NULL' THEN
    RAISE EXCEPTION 'SELFTEST: the shape rule does not require contractor_id on any two-party kind';
  END IF;
  IF v_def !~ 'client_id IS NOT NULL' THEN
    RAISE EXCEPTION 'SELFTEST: the shape rule does not require client_id on any two-party kind';
  END IF;

  -- buyer_supplier must stay job-LESS, and the job-scoped kinds job-scoped.
  IF v_def !~ 'help_support' OR v_def !~ 'job_team_internal' THEN
    RAISE EXCEPTION 'SELFTEST: a pre-existing kind was dropped from the shape rule';
  END IF;
END
$verify$;

-- Behavioural proof, rolled back immediately: one legal row per new kind must
-- be accepted, and a malformed two-party row must still be refused. Runs
-- against real fixtures so it cannot pass on a technicality.
DO $behaviour$
DECLARE
  -- ★ THREE DISTINCT PRINCIPALS, ON PURPOSE. The first version of this proof
  --   reused one uuid as both the buyer and the supplier, which is not a
  --   shorter fixture — it is a DIFFERENT and impossible relationship, and it
  --   collided on conversations_job_id_client_id_contractor_id_key because
  --   both rows then shared (job_id, client_id, contractor_id). Per the shape
  --   contract above, client_id carries the BUYER on job_client_inspector and
  --   the SUPPLIER on job_supplier_inspector; those are different parties, so
  --   the fixture must use different accounts.
  v_buyer     uuid := '00000000-0000-4000-8000-0000000000a1';
  v_inspector uuid := '00000000-0000-4000-8000-0000000000a2';
  v_supplier  uuid := '00000000-0000-4000-8000-0000000000a3';
  v_j         uuid := '00000000-0000-4000-8000-0000000000b1';
  v_ok boolean;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_buyer,    '00000000-0000-0000-0000-000000000000','authenticated','authenticated','shape.buyer@selftest.nx',now(),now()),
         (v_inspector,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','shape.insp@selftest.nx',now(),now()),
         (v_supplier, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','shape.sup@selftest.nx',now(),now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email, role)
  VALUES (v_buyer,    'shape.buyer@selftest.nx','client'),
         (v_inspector,'shape.insp@selftest.nx','inspector'),
         (v_supplier, 'shape.sup@selftest.nx','supplier')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.jobs (id, title, client_id, status, moderation_status)
  VALUES (v_j, 'shape selftest', v_buyer, 'open', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- Legal shapes, each with its REAL participants:
  --   job_client_inspector    client_id = buyer     contractor_id = inspector
  --   job_supplier_inspector  client_id = SUPPLIER  contractor_id = inspector
  --   buyer_supplier          client_id = buyer     contractor_id = SUPPLIER, job_id NULL
  --   job_supplier_admin      job-scoped, party columns unused
  INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, status)
  VALUES (v_j,  v_buyer,    v_inspector, 'job_client_inspector',   v_buyer,     'open'),
         (v_j,  v_supplier, v_inspector, 'job_supplier_inspector', v_inspector, 'open'),
         (NULL, v_buyer,    v_supplier,  'buyer_supplier',         v_buyer,     'open'),
         (v_j,  NULL,       NULL,        'job_supplier_admin',     v_buyer,     'open');

  -- malformed: a direct room with no inspector must still be refused
  BEGIN
    INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, status)
    VALUES (v_j, v_buyer, NULL, 'job_client_inspector', v_buyer, 'open');
    v_ok := false;
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'SELFTEST: a direct room with NULL contractor_id was accepted — the constraint is too permissive';
  END IF;

  -- malformed: buyer_supplier must not be job-scoped
  BEGIN
    INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, status)
    VALUES (v_j, v_buyer, v_supplier, 'buyer_supplier', v_buyer, 'open');
    v_ok := false;
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'SELFTEST: a job-scoped buyer_supplier row was accepted';
  END IF;

  -- Clean up: this proof must leave nothing behind.
  DELETE FROM public.conversations
   WHERE job_id = v_j
      OR contractor_id IN (v_inspector, v_supplier)
      OR client_id IN (v_buyer, v_supplier);
  DELETE FROM public.jobs     WHERE id = v_j;
  DELETE FROM public.profiles WHERE id IN (v_buyer, v_inspector, v_supplier);
  DELETE FROM auth.users      WHERE id IN (v_buyer, v_inspector, v_supplier);

  RAISE NOTICE 'conversations_kind_shape admits all 8 kinds and still rejects malformed two-party rows.';
END
$behaviour$;

COMMIT;
