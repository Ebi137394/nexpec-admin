-- ════════════════════════════════════════════════════════════════════════════
--  20260801208000_ghost_mode_team_internal_chat.sql   (Ghost-Mode — Phase 4, 2/2)
--
--  The private agency/org team thread (`job_team_internal`) + GHOST MODE.
--
--  Mechanics:
--   • ONE internal room per mission, owned by the PRINCIPAL (COALESCE(agency_id,
--     client_id)) and SHARED by the org team. ensure_team_internal_conversation()
--     creates/returns it; only a teammate of the principal may open it.
--   • Team RLS: any teammate may READ; only NON-VIEWER teammates may POST.
--   • GHOST READ: the platform admin can already READ every message via the
--     pre-existing nx_is_admin() branches in msg_select_via_conv / "Admins can read
--     ALL messages" / conv_select_self_or_admin — so no new read grant is needed.
--   • GHOST INVISIBILITY (the hard part) is enforced at the DB:
--       1. RESTRICTIVE policy `msg_block_admin_post_internal` → the admin can NEVER
--          INSERT into an internal thread (a post would uncloak the ghost). Being
--          RESTRICTIVE, it AND-s with every permissive INSERT policy, so it cannot
--          be OR'd away.
--       2. send_message() is SECURITY DEFINER (bypasses RLS) → it carries the SAME
--          guard explicitly: internal threads accept posts only from non-viewer
--          teammates, never the admin.
--       3. tg_notify_messages() gets a job_team_internal branch that fans out to
--          TEAMMATES ONLY and short-circuits — the admin is never notified, so no
--          presence signal leaks. (Admin monitors via a pull surface.)
--
--  Idempotent. Additive (permissive team policies + one restrictive guard).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Team-access helpers for the internal kind (SECURITY DEFINER → no recursion)
CREATE OR REPLACE FUNCTION public.nx_can_team_access_internal(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.jobs j            ON j.id = c.job_id
    JOIN public.org_members o_own ON o_own.user_id = COALESCE(j.agency_id, j.client_id)
    JOIN public.org_members o_me  ON o_me.org_id = o_own.org_id
    WHERE c.id = p_conversation_id
      AND o_me.user_id = auth.uid()
      AND c.kind = 'job_team_internal'::public.conversation_kind
      AND c.user_id = COALESCE(j.agency_id, j.client_id)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.nx_can_team_manage_internal(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.jobs j            ON j.id = c.job_id
    JOIN public.org_members o_own ON o_own.user_id = COALESCE(j.agency_id, j.client_id)
    JOIN public.org_members o_me  ON o_me.org_id = o_own.org_id
    WHERE c.id = p_conversation_id
      AND o_me.user_id = auth.uid()
      AND o_me.role::text <> 'viewer'
      AND c.status = 'open'
      AND c.kind = 'job_team_internal'::public.conversation_kind
      AND c.user_id = COALESCE(j.agency_id, j.client_id)
  );
$fn$;

REVOKE ALL    ON FUNCTION public.nx_can_team_access_internal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_can_team_access_internal(uuid) TO authenticated, service_role;
REVOKE ALL    ON FUNCTION public.nx_can_team_manage_internal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_can_team_manage_internal(uuid) TO authenticated, service_role;

-- ── 2. ensure_team_internal_conversation: ONE principal-owned, shared room per job
CREATE OR REPLACE FUNCTION public.ensure_team_internal_conversation(p_job_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_principal uuid;
  v_conv      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;

  SELECT COALESCE(j.agency_id, j.client_id) INTO v_principal
    FROM public.jobs j WHERE j.id = p_job_id;
  IF v_principal IS NULL THEN
    RAISE EXCEPTION 'job not found or has no principal';
  END IF;

  -- Caller must be a teammate of the principal (shares an org). NOT the admin.
  IF NOT EXISTS (
    SELECT 1
    FROM public.org_members o_own
    JOIN public.org_members o_me ON o_me.org_id = o_own.org_id
    WHERE o_own.user_id = v_principal
      AND o_me.user_id  = v_uid
  ) THEN
    RAISE EXCEPTION 'not authorised: not a teammate of the job principal' USING errcode = '42501';
  END IF;

  -- Idempotent on (job, kind) alone → one shared internal room per mission.
  SELECT id INTO v_conv
    FROM public.conversations
   WHERE job_id = p_job_id
     AND kind = 'job_team_internal'::public.conversation_kind
     AND user_id = v_principal
   LIMIT 1;

  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (kind, user_id, job_id, title)
    VALUES ('job_team_internal'::public.conversation_kind, v_principal, p_job_id, 'Team internal')
    RETURNING id INTO v_conv;
  END IF;

  RETURN v_conv;
END
$fn$;

REVOKE ALL    ON FUNCTION public.ensure_team_internal_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_team_internal_conversation(uuid) TO authenticated, service_role;

-- ── 3. Permissive team policies (READ any teammate; POST non-viewer) ──────────
DROP POLICY IF EXISTS conv_team_internal_select ON public.conversations;
CREATE POLICY conv_team_internal_select ON public.conversations
  FOR SELECT TO authenticated
  USING (public.nx_can_team_access_internal(id));

DROP POLICY IF EXISTS msg_team_internal_select ON public.messages;
CREATE POLICY msg_team_internal_select ON public.messages
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.nx_can_team_access_internal(conversation_id));

DROP POLICY IF EXISTS msg_team_internal_insert ON public.messages;
CREATE POLICY msg_team_internal_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.nx_can_team_manage_internal(conversation_id));

-- ── 4. ★ RESTRICTIVE GHOST-BLOCK: the admin can NEVER post to an internal thread ─
--    RESTRICTIVE → AND-ed with every permissive INSERT policy; cannot be OR'd away.
DROP POLICY IF EXISTS msg_block_admin_post_internal ON public.messages;
CREATE POLICY msg_block_admin_post_internal ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    NOT (
      public.nx_is_admin()
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = messages.conversation_id
          AND c.kind = 'job_team_internal'::public.conversation_kind
      )
    )
  );

-- ── 5. send_message: kind-aware. DEFINER bypasses RLS, so carry the ghost guard. ─
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id  uuid,
  p_content          text DEFAULT NULL,
  p_attachment_url   text DEFAULT NULL,
  p_attachment_type  text DEFAULT NULL,
  p_attachment_name  text DEFAULT NULL
) RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_kind public.conversation_kind;
  v_row  public.messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id required';
  END IF;
  IF btrim(COALESCE(p_content, '')) = '' AND p_attachment_url IS NULL THEN
    RAISE EXCEPTION 'empty message (need content or attachment)';
  END IF;

  SELECT kind INTO v_kind FROM public.conversations WHERE id = p_conversation_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF v_kind = 'job_team_internal'::public.conversation_kind THEN
    -- GHOST INTEGRITY: internal threads accept posts ONLY from non-viewer
    -- teammates. There is deliberately NO admin branch — a platform-admin post
    -- would uncloak the ghost — and this explicit check neutralises the DEFINER
    -- RLS bypass (the RESTRICTIVE policy guards every other insert path).
    IF NOT public.nx_can_team_manage_internal(p_conversation_id) THEN
      RAISE EXCEPTION 'not authorised to post to this internal team thread' USING errcode = '42501';
    END IF;
  ELSE
    IF NOT (
          public.nx_is_admin()
       OR EXISTS (SELECT 1 FROM public.conversations c
                   WHERE c.id = p_conversation_id AND c.user_id = v_uid AND c.status = 'open')
       OR public.nx_can_team_manage_conversation(p_conversation_id)
    ) THEN
      RAISE EXCEPTION 'not authorised to post to this conversation' USING errcode = '42501';
    END IF;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, content,
                               attachment_url, attachment_type, attachment_name)
  VALUES (p_conversation_id, v_uid, btrim(COALESCE(p_content, '')),
          p_attachment_url, p_attachment_type, p_attachment_name)
  RETURNING * INTO v_row;

  RETURN v_row;
END
$fn$;

REVOKE ALL    ON FUNCTION public.send_message(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, text, text) TO authenticated, service_role;

-- ── 6. tg_notify_messages: internal branch fans out to TEAMMATES ONLY (no admin) ─
CREATE OR REPLACE FUNCTION public.tg_notify_messages() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_conv     RECORD;
  v_preview  text;
  v_owner    uuid;
  v_has_team boolean := false;
  v_is_admin boolean;
  v_title    text;
  r          RECORD;
BEGIN
  SELECT id, user_id, kind, title, job_id INTO v_conv
    FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_preview := COALESCE(
    NULLIF(LEFT(NEW.content, 140), ''),
    CASE WHEN NEW.attachment_url IS NOT NULL THEN '📎 Attachment' ELSE 'New message' END
  );
  v_is_admin := public.nx_is_admin(NEW.sender_id);

  -- ★ GHOST BRANCH: internal team thread → notify TEAMMATES ONLY, never admins.
  --   Short-circuits so no admin-notifying branch below can ever run. v_conv.user_id
  --   is the principal; the org is resolved from their membership.
  IF v_conv.kind = 'job_team_internal'::public.conversation_kind THEN
    FOR r IN
      SELECT DISTINCT om.user_id
      FROM public.org_members om
      WHERE om.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_conv.user_id)
        AND om.user_id <> NEW.sender_id
    LOOP
      PERFORM public.nx_notify(
        r.user_id, 'New internal team message', v_preview, 'message',
        '/client/jobs/' || COALESCE(v_conv.job_id::text, ''), v_conv.job_id);
    END LOOP;
    RETURN NEW;
  END IF;

  IF v_conv.kind = 'job_client_admin'::public.conversation_kind AND v_conv.job_id IS NOT NULL THEN
    SELECT COALESCE(j.agency_id, j.client_id) INTO v_owner
      FROM public.jobs j WHERE j.id = v_conv.job_id;
    IF v_owner IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM public.org_members WHERE user_id = v_owner) INTO v_has_team;
    END IF;
  END IF;

  IF v_has_team THEN
    IF NOT v_is_admin THEN
      PERFORM public.nx_notify_admins(
        COALESCE(NULLIF(v_conv.title, ''), 'New message'), v_preview, 'message',
        '/admin/messages/' || v_conv.id::text, v_conv.job_id);
    END IF;
    v_title := CASE WHEN v_is_admin THEN 'NEXPEC Admin replied' ELSE 'New team message' END;
    FOR r IN
      SELECT DISTINCT om.user_id
      FROM public.org_members om
      WHERE om.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_owner)
        AND om.user_id <> NEW.sender_id
    LOOP
      PERFORM public.nx_notify(
        r.user_id, v_title, v_preview, 'message',
        '/client/jobs/' || v_conv.job_id::text, v_conv.job_id);
    END LOOP;

  ELSE
    IF NEW.sender_id = v_conv.user_id THEN
      PERFORM public.nx_notify_admins(
        COALESCE(NULLIF(v_conv.title, ''), 'New message'), v_preview, 'message',
        '/admin/messages/' || v_conv.id::text, v_conv.job_id);
    ELSE
      PERFORM public.nx_notify(
        v_conv.user_id, 'NEXPEC Admin replied', v_preview, 'message',
        CASE WHEN v_conv.kind = 'job_inspector_admin'::public.conversation_kind
             THEN '/inspector/messages/' || v_conv.id::text
             ELSE '/client/messages/' || v_conv.id::text END,
        v_conv.job_id);
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tg_notify_messages failed: %', SQLERRM;
  RETURN NEW;
END
$fn$;

-- ── 7. Self-tests ─────────────────────────────────────────────────────────────
DO $test$
DECLARE v_def text;
BEGIN
  IF to_regprocedure('public.ensure_team_internal_conversation(uuid)') IS NULL
     OR to_regprocedure('public.nx_can_team_access_internal(uuid)') IS NULL
     OR to_regprocedure('public.nx_can_team_manage_internal(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: ghost-mode helpers/RPC missing';
  END IF;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc
          WHERE proname IN ('ensure_team_internal_conversation','nx_can_team_access_internal','nx_can_team_manage_internal')
            AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'SELFTEST: ghost-mode helpers must be SECURITY DEFINER';
  END IF;
  -- The RESTRICTIVE ghost-block must exist AND be RESTRICTIVE.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages'
                 AND policyname='msg_block_admin_post_internal' AND permissive='RESTRICTIVE') THEN
    RAISE EXCEPTION 'SELFTEST: msg_block_admin_post_internal missing or not RESTRICTIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='conv_team_internal_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='msg_team_internal_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='msg_team_internal_insert') THEN
    RAISE EXCEPTION 'SELFTEST: team-internal access policies missing';
  END IF;
  -- send_message + notify must be kind-aware for job_team_internal.
  v_def := pg_get_functiondef(to_regprocedure('public.send_message(uuid,text,text,text,text)'));
  IF position('job_team_internal' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: send_message is not ghost-aware (no job_team_internal branch)';
  END IF;
  v_def := pg_get_functiondef(to_regprocedure('public.tg_notify_messages()'));
  IF position('job_team_internal' in v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST: tg_notify_messages has no job_team_internal (ghost) branch';
  END IF;
  RAISE NOTICE 'Ghost-Mode internal team chat OK (team RLS + RESTRICTIVE admin-post block + ghost-aware send/notify).';
END
$test$;

COMMIT;
