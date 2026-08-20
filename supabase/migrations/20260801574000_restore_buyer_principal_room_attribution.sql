-- ════════════════════════════════════════════════════════════════════════════
--  20260801574000_restore_buyer_principal_room_attribution.sql
--
--  RELEASE-BLOCKING REGRESSION FIX (found by the real pgTAP battery, not by
--  inspection: direct_chat_role_parity_test failed 14/42).
--
--  20260801570000 restored Full-mode direct chat by re-creating
--  open_direct_conversation from its ORIGINAL 20260801334000 body. That body
--  predates 20260801336000_direct_chat_role_parity, which had fixed room
--  attribution to use the buyer PRINCIPAL. Restoring the old body silently
--  reverted that fix, so on an AGENCY- or ENTERPRISE-owned job (where
--  jobs.client_id IS NULL and jobs.agency_id holds the principal) the insert
--  aborted against conversations.user_id NOT NULL — agency and enterprise
--  buyers could not open a Full-mode direct room at all, and every downstream
--  team/unread/admin-view assertion cascaded.
--
--  This migration re-applies the 336000 attribution on top of the restored
--  secure gate. Nothing else changes:
--    • the authorization gate (nx_direct_chat_authorized: buyer side or the
--      assigned inspector, active contract inspector, identity_mode='full',
--      job not cancelled/paid) is untouched
--    • admins still may not join a direct room (they observe via the
--      monitoring views)
--    • the anti-bypass hardening from 20260801568000 (broad OR-ed policies
--      exclude kind 'job_client_inspector') stays exactly as it is — this
--      function is SECURITY DEFINER and is the ONLY sanctioned creation path
--    • idempotent create-or-return semantics are preserved
--
--  The error text keeps the 570000 wording, which explains WHY a denial
--  happened ("Full access is set per job by a NEXPEC admin").
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.open_direct_conversation(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_job       RECORD;
  v_principal uuid;
  v_id        uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;

  -- Admin observes direct rooms through the monitoring views; it is never a
  -- party and must not materialise inside a two-party conversation.
  IF public.nx_is_admin() THEN
    RAISE EXCEPTION 'admins observe direct rooms via the monitoring view, not by joining'
      USING errcode = '42501';
  END IF;

  IF NOT public.nx_direct_chat_authorized(p_job_id, p_inspector_id, v_uid) THEN
    RAISE EXCEPTION 'direct chat is not authorized for this job/inspector relationship (Full access is set per job by a NEXPEC admin)'
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;

  -- Attribute the room to the buyer PRINCIPAL, never to client_id: on an
  -- agency/enterprise-owned job client_id is NULL (jobs_owner_xor) and
  -- conversations.user_id is NOT NULL. Whichever teammate opens the room, the
  -- room belongs to the buyer party — that is what makes it ONE shared room
  -- rather than one per seat.
  v_principal := COALESCE(v_job.agency_id, v_job.client_id);
  IF v_principal IS NULL THEN
    RAISE EXCEPTION 'job % has no buyer principal (jobs_owner_xor violated?)', p_job_id;
  END IF;

  SELECT id INTO v_id
    FROM public.conversations
   WHERE job_id = p_job_id
     AND contractor_id = p_inspector_id
     AND kind = 'job_client_inspector'::public.conversation_kind;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (
    job_id, client_id, contractor_id, kind, user_id, title, status
  ) VALUES (
    p_job_id,
    v_principal,
    p_inspector_id,
    'job_client_inspector'::public.conversation_kind,
    v_principal,
    'Direct — job ' || COALESCE(v_job.title, p_job_id::text),
    'open'
  )
  ON CONFLICT (job_id, contractor_id) WHERE kind = 'job_client_inspector'::public.conversation_kind
  DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.open_direct_conversation(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.open_direct_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_direct_conversation(uuid, uuid) TO authenticated, service_role;

-- ─── Selftest ───────────────────────────────────────────────────────────────
DO $selftest$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.open_direct_conversation(uuid,uuid)'::regprocedure) INTO v_def;
  IF v_def !~ 'COALESCE\(v_job.agency_id, v_job.client_id\)' THEN
    RAISE EXCEPTION 'SELFTEST: buyer-principal attribution missing again';
  END IF;
  IF v_def !~ 'nx_direct_chat_authorized' THEN
    RAISE EXCEPTION 'SELFTEST: the authorization gate was lost';
  END IF;
  IF v_def !~ 'nx_is_admin' THEN
    RAISE EXCEPTION 'SELFTEST: the admin-must-not-join rule was lost';
  END IF;
  -- The anti-bypass hardening must still be in force.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='conversations'
       AND policyname='conv_insert_self_or_admin'
       AND coalesce(with_check,'') NOT LIKE '%job_client_inspector%'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: hand-crafted direct-room INSERT is no longer blocked';
  END IF;
  RAISE NOTICE 'SELFTEST ok — buyer-principal attribution restored; gate, admin rule and anti-bypass intact';
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
