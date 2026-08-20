-- ════════════════════════════════════════════════════════════════════════════
--  20260801568000_retire_client_inspector_direct_chat.sql
--
--  OWNER COMMUNICATION POLICY (2026-08-19, supersedes 20260801334000
--  "full_mode_direct_chat"):
--
--      Direct Client ↔ Inspector messaging is NOT ALLOWED — from the
--      contract, application, inspector detail, job, report, web, mobile,
--      any deep link or hidden route. Full identity disclosure may release
--      the inspector's email/phone under the approved Full policy, but it
--      MUST NOT change the in-platform messaging authorization model.
--
--      Allowed lanes are unchanged:
--        • Client  ↔ NEXPEC admin      (kind 'job_client_admin')
--        • Inspector ↔ NEXPEC admin    (kind 'job_inspector_admin')
--        • Senior/QA reviewer ↔ working inspector — via the senior-review
--          round channel (report_senior_reviews.comments, RLS
--          report_senior_reviews_author_read / _reviewer) and the admin lane
--        • buyer org internal team, supplier lanes, help & support
--
--  ── WHAT THE AUDIT FOUND (reproduced on Staging, not inferred) ─────────────
--  Two independent exposures, the second far wider than the first:
--
--   1. GATED-BY-MODE. nx_direct_chat_authorized() returned TRUE for the whole
--      buyer side whenever nx_job_effective_identity_mode(job) = 'full', so
--      raising a job to Full silently created a Client↔Inspector messaging
--      right — precisely the coupling the owner has now prohibited.
--
--   2. UNGATED BY ANYTHING. RLS policies are OR-ed, and the legacy broad
--      policies never looked at `kind`:
--        conversations.view_own_chats           client_id/contractor_id = uid
--        conversations.conv_select_self_or_admin user_id = uid
--        conversations.conv_insert_self_or_admin user_id = uid   (INSERT!)
--        messages.view_chat_msgs                 client_id/contractor_id = uid
--        messages.msg_select_via_conv            conv.user_id = uid
--        messages.msg_insert_party               conv.user_id = uid   (INSERT!)
--      A Client could therefore INSERT a conversation row of kind
--      'job_client_inspector' naming any inspector, own it (user_id = self),
--      post messages into it and read replies — by direct API call, in ANY
--      identity mode, with the Full gate entirely irrelevant. The UI never
--      offered this; the backend allowed it.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  The room kind is retired for every non-admin, at the authority:
--    • nx_direct_chat_authorized() is now constant FALSE. Every dependent
--      policy (conv_direct_select/update, msg_direct_select/insert) closes
--      with it, and nx_job_chat_counterparts stops reporting an inspector id
--      or can_chat_inspector to buyers — so the Web and Mobile affordances
--      (JobChatActions) disappear on their own, with no UI policy of their own.
--    • open_direct_conversation() fails closed with an explicit policy error.
--    • Every broad policy above now excludes kind 'job_client_inspector'
--      unless the caller is an admin.
--
--  ADMIN RETAINS FULL READ for audit/mediation, and existing rooms and their
--  message history are PRESERVED (this is an authorization change, not a
--  deletion): historical rows simply stop being reachable by the parties.
--  No other conversation kind, and no unrelated RLS, is touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The gate: retired ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_direct_chat_authorized(
  p_job_id uuid,
  p_inspector_id uuid,
  p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- OWNER POLICY 2026-08-19: direct Client↔Inspector rooms are not authorized
  -- for anyone, in any identity mode, on any job state. Kept as a function
  -- (rather than dropped) so every dependent policy and caller keeps
  -- resolving and simply fails closed.
  SELECT false;
$function$;

COMMENT ON FUNCTION public.nx_direct_chat_authorized(uuid, uuid, uuid) IS
  'RETIRED by owner policy 2026-08-19: direct Client<->Inspector messaging is not allowed in any identity mode. Always false. Allowed lanes: job_client_admin, job_inspector_admin, senior-review rounds.';

-- ─── 2. The opener: fails closed with a policy-explicit error ───────────────
CREATE OR REPLACE FUNCTION public.open_direct_conversation(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'DIRECT_CLIENT_INSPECTOR_CHAT_DISABLED: direct Client-to-Inspector messaging is not permitted. Use the NEXPEC admin channel (job_client_admin) instead.'
    USING errcode = '42501';
END;
$$;

ALTER FUNCTION public.open_direct_conversation(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.open_direct_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_direct_conversation(uuid, uuid) TO authenticated, service_role;

-- ─── 3. Close the broad OR-doors on conversations ───────────────────────────
--  Each policy below is its existing predicate PLUS the kind exclusion.

DROP POLICY IF EXISTS view_own_chats ON public.conversations;
CREATE POLICY view_own_chats ON public.conversations
FOR SELECT USING (
  (auth.uid() = client_id OR auth.uid() = contractor_id)
  AND (kind <> 'job_client_inspector'::public.conversation_kind OR public.nx_is_admin())
);

DROP POLICY IF EXISTS conv_select_self_or_admin ON public.conversations;
CREATE POLICY conv_select_self_or_admin ON public.conversations
FOR SELECT USING (
  (user_id = auth.uid() OR public.nx_is_admin())
  AND (kind <> 'job_client_inspector'::public.conversation_kind OR public.nx_is_admin())
);

DROP POLICY IF EXISTS conv_insert_self_or_admin ON public.conversations;
CREATE POLICY conv_insert_self_or_admin ON public.conversations
FOR INSERT WITH CHECK (
  (user_id = auth.uid() OR public.nx_is_admin())
  -- Nobody may hand-craft a direct Client↔Inspector room any more, admin
  -- included: admin observes, it is not a party (unchanged intent from
  -- 20260801334000).
  AND kind <> 'job_client_inspector'::public.conversation_kind
);

-- ─── 4. Close the broad OR-doors on messages ────────────────────────────────

DROP POLICY IF EXISTS view_chat_msgs ON public.messages;
CREATE POLICY view_chat_msgs ON public.messages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = messages.conversation_id
       AND (c.client_id = auth.uid() OR c.contractor_id = auth.uid())
       AND (c.kind <> 'job_client_inspector'::public.conversation_kind OR public.nx_is_admin())
  )
);

DROP POLICY IF EXISTS msg_select_via_conv ON public.messages;
CREATE POLICY msg_select_via_conv ON public.messages
FOR SELECT USING (
  deleted_at IS NULL
  AND (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = messages.conversation_id
         AND c.user_id = auth.uid()
         AND c.kind <> 'job_client_inspector'::public.conversation_kind
    )
  )
);

DROP POLICY IF EXISTS msg_insert_party ON public.messages;
CREATE POLICY msg_insert_party ON public.messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = messages.conversation_id
         AND c.user_id = auth.uid()
         AND c.status = 'open'
         AND c.kind <> 'job_client_inspector'::public.conversation_kind
    )
  )
);

-- ─── 5. Selftest — the communication role matrix ────────────────────────────
DO $selftest$
DECLARE
  v_def text;
  v_client uuid := gen_random_uuid();
  v_insp   uuid := gen_random_uuid();
  v_job    uuid := gen_random_uuid();
  v_conv   uuid := gen_random_uuid();
  v_admin_conv uuid := gen_random_uuid();
  v_n int;
  v_ok boolean;
BEGIN
  -- CATALOGUE: the gate is retired and no policy re-opens the kind.
  IF public.nx_direct_chat_authorized(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()) THEN
    RAISE EXCEPTION 'SELFTEST: direct chat gate is still granting';
  END IF;
  FOR v_def IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='public' AND tablename IN ('conversations','messages')
       AND policyname IN ('view_own_chats','conv_select_self_or_admin','conv_insert_self_or_admin',
                          'view_chat_msgs','msg_select_via_conv','msg_insert_party')
       AND coalesce(qual,'') || coalesce(with_check,'') NOT LIKE '%job_client_inspector%'
  LOOP
    RAISE EXCEPTION 'SELFTEST: policy % still ignores the retired room kind', v_def;
  END LOOP;
  -- The ALLOWED lanes must survive untouched.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations'
                  AND policyname = 'conv_team_internal_select') THEN
    RAISE EXCEPTION 'SELFTEST: team-internal lane was lost';
  END IF;
  IF to_regprocedure('public.nx_supplier_inspector_chat_authorized(uuid,uuid,uuid,uuid)') IS NULL
     AND to_regprocedure('public.nx_supplier_inspector_chat_authorized(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: supplier-inspector lane function disappeared';
  END IF;

  -- BEHAVIOURAL (local only; Staging skips — the persistent suite carries it).
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'cc.'||u::text||'@synthetic.invalid', now(), now()
      FROM unnest(ARRAY[v_client,v_insp]) u;
    INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
      (v_client,'client','CC Client','cc.c@synthetic.invalid',true),
      (v_insp,'inspector','CC Inspector','cc.i@synthetic.invalid',true)
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
    -- Job stays 'open' with no contractor: the retired gate no longer consults
    -- the engagement at all, and dispatching here would trip the (unrelated)
    -- funding guard. identity_mode='full' is the point — the strongest case.
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode)
    VALUES (v_job,'cc comms',v_client,'open','approved','prepay',100000,80000,'full');

    -- Pre-existing direct room (as the legacy feature would have created).
    INSERT INTO public.conversations (id, job_id, client_id, contractor_id, kind, user_id, title, status)
    VALUES (v_conv, v_job, v_client, v_insp, 'job_client_inspector', v_client, 'legacy direct', 'open');
    INSERT INTO public.messages (conversation_id, sender_id, content)
    VALUES (v_conv, v_client, 'legacy message');
    -- The allowed Client↔Admin lane.
    INSERT INTO public.conversations (id, job_id, client_id, kind, user_id, title, status)
    VALUES (v_admin_conv, v_job, v_client, 'job_client_admin', v_client, 'admin lane', 'open');

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_client::text||'","role":"authenticated"}', true);

    -- Client → Inspector : DENIED (read)
    SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_conv;
    IF v_n <> 0 THEN RAISE EXCEPTION 'SELFTEST: client still reads the direct room (FULL mode)'; END IF;
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_conv;
    IF v_n <> 0 THEN RAISE EXCEPTION 'SELFTEST: client still reads direct-room messages'; END IF;

    -- Client → Inspector : DENIED (craft a new room by direct API call)
    BEGIN
      INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, title, status)
      VALUES (v_job, v_client, v_insp, 'job_client_inspector', v_client, 'crafted', 'open');
      RAISE EXCEPTION 'SELFTEST: client CRAFTED a direct Client-Inspector room';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
    END;

    -- Client → Admin lane : ALLOWED
    SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_admin_conv;
    IF v_n <> 1 THEN RAISE EXCEPTION 'SELFTEST: the Client<->Admin lane was broken (saw %)', v_n; END IF;
    RESET ROLE;

    -- Inspector → Client direct : DENIED
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_insp::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_conv;
    IF v_n <> 0 THEN RAISE EXCEPTION 'SELFTEST: inspector still reads the direct room'; END IF;
    RESET ROLE;

    RAISE NOTICE 'SELFTEST ok — Client<->Inspector direct messaging denied both directions; admin lane intact';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated); catalogue assertions passed';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE 'cc.%@synthetic.invalid') THEN
    RAISE EXCEPTION 'SELFTEST: synthetic fixtures survived';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
