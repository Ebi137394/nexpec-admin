-- ============================================================================
--  20260801123200_supplier_job_chat.sql
--
--  Supplier ↔ Admin project chat — the third leg of the dual(now tri)-chat
--  model, mirroring job_inspector_admin EXACTLY:
--
--    conversations.kind ∈ {help_support, job_client_admin,
--                          job_inspector_admin, job_supplier_admin}
--
--  · A job_supplier_admin room is keyed to the SPAWNED source/FAT job (the
--    inspection job created when the supplier's quote was awarded), and may be
--    opened ONLY by the awarded supplier — the precise analogue of the
--    inspector gate (assigned_inspector_id = uid).
--  · RLS needs NO changes: the existing conversations/messages policies are
--    party-scoped by user_id (= the supplier here) OR admin. Anti-poaching is
--    preserved — the supplier sees only their own room with admin; the client
--    and inspector have separate rooms with zero cross-visibility.
--
--  Idempotent. Depends on 20260801123100 (enum value committed).
-- ============================================================================

BEGIN;

-- ── 1. Extend the kind-shape CHECK to include job_supplier_admin ────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_kind_shape') THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_kind_shape;
  END IF;
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_kind_shape
      CHECK (
        (kind IN ('job_client_admin','job_inspector_admin','job_supplier_admin') AND job_id IS NOT NULL)
        OR (kind = 'help_support' AND job_id IS NULL)
      ) NOT VALID;
END $$;

-- ── 2. Redefine ensure_job_conversation with the supplier branch ────────────
--  Verbatim mirror of the inspector blueprint + one new gated branch.
CREATE OR REPLACE FUNCTION public.ensure_job_conversation(
  p_job_id uuid,
  p_kind   text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_kind NOT IN ('job_client_admin','job_inspector_admin','job_supplier_admin') THEN
    RAISE EXCEPTION 'invalid conversation kind';
  END IF;

  -- Caller-role gate.
  --   Client/agency/enterprise → job_client_admin (must own the job).
  --   Inspector (assigned)      → job_inspector_admin.
  --   Supplier (awarded)        → job_supplier_admin (their accepted quote
  --                               spawned this source/FAT job).
  IF p_kind = 'job_client_admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND client_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the job''s client may open a job_client_admin room';
    END IF;
  ELSIF p_kind = 'job_inspector_admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND assigned_inspector_id = v_uid) THEN
      RAISE EXCEPTION 'not authorised: only the assigned inspector may open a job_inspector_admin room';
    END IF;
  ELSE -- job_supplier_admin
    IF NOT EXISTS (
      SELECT 1
        FROM public.supplier_rfqs r
        JOIN public.supplier_quotes q ON q.rfq_id = r.id
       WHERE r.spawned_job_id = p_job_id
         AND q.supplier_id = v_uid
         AND q.status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'not authorised: only the awarded supplier may open a job_supplier_admin room';
    END IF;
  END IF;

  SELECT id INTO v_conv_id FROM public.conversations
   WHERE job_id = p_job_id AND kind = p_kind::public.conversation_kind AND user_id = v_uid
   LIMIT 1;
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations(kind, user_id, job_id, title)
      VALUES (
        p_kind::public.conversation_kind, v_uid, p_job_id,
        CASE p_kind
          WHEN 'job_client_admin'    THEN 'Job chat · client side'
          WHEN 'job_inspector_admin' THEN 'Job chat · inspector side'
          WHEN 'job_supplier_admin'  THEN 'Job chat · supplier side'
        END
      )
      RETURNING id INTO v_conv_id;
  END IF;
  RETURN v_conv_id;
END $$;

GRANT EXECUTE ON FUNCTION public.ensure_job_conversation(uuid, text) TO authenticated;

-- ── 3. Self-test ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'conversation_kind' AND e.enumlabel = 'job_supplier_admin') THEN
    RAISE EXCEPTION 'SELFTEST job_supplier_admin enum value missing';
  END IF;
  RAISE NOTICE 'Supplier project chat ready: job_supplier_admin rooms gated to the awarded supplier.';
END $$;

COMMIT;
