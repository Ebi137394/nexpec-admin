-- ════════════════════════════════════════════════════════════════════════════
--  20260801186000_agency_team_chat_rls.sql   (Agency Team Workspaces — Set 2, chat)
--
--  Extends the SILOED chat to the owning org's team — WITHOUT breaching the silo.
--
--  The silo is explicit in conversation_kind:
--     job_client_admin     ← the BUYER (client/agency) ↔ admin channel
--     job_inspector_admin  ← the INSPECTOR ↔ admin channel   (must stay private)
--  Chat is always brokered through admin; client↔inspector never exists.
--
--  Team access is granted ONLY to the job's buyer-side conversation, and ONLY
--  when it belongs to the job's owning principal:
--     c.kind = 'job_client_admin'  AND  c.user_id = COALESCE(j.agency_id, j.client_id)
--  → an agency teammate sees the agency↔admin thread for their org's jobs, and
--    can NEVER see the inspector↔admin thread (different kind + different user_id).
--    Team access ⊆ the principal's scope; the silo is preserved by construction.
--
--  VIEW = any org member; POST = role <> 'viewer' on an OPEN thread. Helpers are
--  SECURITY DEFINER so the policies don't recurse into conversations/jobs RLS.
--  Idempotent. ADDITIVE (permissive policies only).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.nx_can_team_access_conversation(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.jobs j           ON j.id = c.job_id
    JOIN public.org_members o_owner ON o_owner.user_id = COALESCE(j.agency_id, j.client_id)
    JOIN public.org_members o_me    ON o_me.org_id = o_owner.org_id
    WHERE c.id = p_conversation_id
      AND o_me.user_id = auth.uid()
      AND c.kind = 'job_client_admin'::public.conversation_kind   -- buyer-side silo only
      AND c.user_id = COALESCE(j.agency_id, j.client_id)          -- the principal's thread
  );
$fn$;

CREATE OR REPLACE FUNCTION public.nx_can_team_manage_conversation(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.jobs j           ON j.id = c.job_id
    JOIN public.org_members o_owner ON o_owner.user_id = COALESCE(j.agency_id, j.client_id)
    JOIN public.org_members o_me    ON o_me.org_id = o_owner.org_id
    WHERE c.id = p_conversation_id
      AND o_me.user_id = auth.uid()
      AND o_me.role::text <> 'viewer'                             -- post = non-viewer roles
      AND c.kind = 'job_client_admin'::public.conversation_kind
      AND c.user_id = COALESCE(j.agency_id, j.client_id)
      AND c.status = 'open'
  );
$fn$;

REVOKE ALL    ON FUNCTION public.nx_can_team_access_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_can_team_access_conversation(uuid) TO authenticated, service_role;
REVOKE ALL    ON FUNCTION public.nx_can_team_manage_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nx_can_team_manage_conversation(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_can_team_access_conversation(uuid) IS
  'True if auth.uid() is a teammate of the job owner AND the conversation is the buyer-side (job_client_admin) thread owned by the principal. Team VIEW; never the inspector silo.';
COMMENT ON FUNCTION public.nx_can_team_manage_conversation(uuid) IS
  'Like nx_can_team_access_conversation but excludes viewers and requires status=open → team POST.';

-- ── Permissive team policies (ADD access; existing silo policies unchanged) ────
DROP POLICY IF EXISTS conv_team_select ON public.conversations;
CREATE POLICY conv_team_select ON public.conversations
  FOR SELECT TO authenticated
  USING (public.nx_can_team_access_conversation(id));

DROP POLICY IF EXISTS msg_team_select ON public.messages;
CREATE POLICY msg_team_select ON public.messages
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.nx_can_team_access_conversation(conversation_id));

DROP POLICY IF EXISTS msg_team_insert ON public.messages;
CREATE POLICY msg_team_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.nx_can_team_manage_conversation(conversation_id));

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $test$
BEGIN
  IF to_regprocedure('public.nx_can_team_access_conversation(uuid)') IS NULL
     OR to_regprocedure('public.nx_can_team_manage_conversation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: team chat helpers missing';
  END IF;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc
          WHERE proname IN ('nx_can_team_access_conversation','nx_can_team_manage_conversation')
            AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'SELFTEST: team chat helpers must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='conv_team_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='msg_team_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='msg_team_insert') THEN
    RAISE EXCEPTION 'SELFTEST: team chat policies missing';
  END IF;
  RAISE NOTICE 'Agency team chat RLS OK (buyer-side thread only; inspector silo preserved).';
END $test$;

COMMIT;
