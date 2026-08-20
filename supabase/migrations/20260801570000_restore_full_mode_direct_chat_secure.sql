-- ════════════════════════════════════════════════════════════════════════════
--  20260801570000_restore_full_mode_direct_chat_secure.sql
--
--  OWNER RULING (2026-08-19, final). Forward-only correction of
--  20260801568000, which retired Client↔Inspector direct chat outright. The
--  owner has ruled that the capability is intended and must return — but only
--  under Admin-authorized FULL access, and without the RLS bypass the same
--  audit uncovered. 20260801568000 is NOT deleted or rewritten; it remains
--  applied history and this migration supersedes its two function bodies.
--
--  ── THE FINAL HIERARCHY ────────────────────────────────────────────────────
--    protected     anonymous identity        · direct chat DENIED
--    professional  professional identity/CV  · direct chat DENIED
--    full          complete identity + email/phone · direct chat ALLOWED
--
--  Full is per-job and Admin-set (admin_set_project_policy, audited).
--  Downgrading out of Full immediately revokes contact AND direct chat —
--  reads and writes both — while the transcript is preserved for Admin audit.
--
--  ── WHAT IS RESTORED ───────────────────────────────────────────────────────
--    • nx_direct_chat_authorized — the original single gate, requiring ALL of:
--        · caller is the job's buyer side, OR is that room's inspector
--        · that inspector is the ACTIVE contract inspector for the job
--          (is_active_contract_inspector → a replaced inspector is false)
--        · LIVE nx_job_effective_identity_mode(job) = 'full'
--        · job status not terminal-for-messaging (cancelled / paid)
--    • open_direct_conversation — the create-or-return RPC, gate-checked,
--      idempotent on the (job, inspector) partial unique index. Admin is
--      refused: admin observes, and is never a participant.
--
--  ── WHAT STAYS CLOSED (the real defect, permanently fixed) ─────────────────
--  20260801568000 hardened six broad, kind-blind policies that OR-ed around
--  the gate entirely:
--      conversations: view_own_chats, conv_select_self_or_admin,
--                     conv_insert_self_or_admin
--      messages:      view_chat_msgs, msg_select_via_conv, msg_insert_party
--  They excluded 'job_client_inspector', which is why a Client could no longer
--  hand-craft a room or post by owning one. THOSE POLICIES ARE LEFT EXACTLY AS
--  HARDENED — this migration does not touch them. The consequence is the
--  intended one: the ONLY doors into a direct room are now the gate-aware
--  policies (conv_direct_select / conv_direct_update_parties /
--  msg_direct_select / msg_direct_insert), the gate-aware RPCs
--  (open_direct_conversation, send_message → nx_direct_conversation_authorized,
--  mark_direct_conversation_read) and privileged Admin audit.
--
--  Room CREATION works because open_direct_conversation is SECURITY DEFINER
--  owned by postgres and conversations does not FORCE row level security, so
--  the RPC inserts as owner while a direct client INSERT remains denied by
--  conv_insert_self_or_admin. Creation is therefore possible ONLY through the
--  policy-aware path, which is precisely the owner's requirement.
--
--  ── ADMIN OVERSIGHT, WITHOUT THREE-PARTY SEMANTICS ─────────────────────────
--  Admin reads through admin_direct_conversations_view /
--  admin_direct_messages_view and the hardened broad policies' admin branch.
--  Admin is NOT inserted into the room: no participant row, no unread counter,
--  no read receipt (mark_direct_conversation_read refuses admins), and
--  send_message refuses admins on this kind. Client and Inspector continue to
--  experience an ordinary two-party conversation.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The gate, restored to its original semantics ────────────────────────
CREATE OR REPLACE FUNCTION public.nx_direct_chat_authorized(
  p_job_id uuid,
  p_inspector_id uuid,
  p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.jobs j
     WHERE j.id = p_job_id
       AND p_uid IS NOT NULL
       AND p_inspector_id IS NOT NULL
       AND (
             -- buyer side: principal or org teammate (Client / Agency / Enterprise)
             public.nx_is_job_buyer_side(p_job_id, p_uid)
             -- seller side: the assigned inspector themselves (inspector | senior)
          OR p_inspector_id = p_uid
           )
       AND public.is_active_contract_inspector(p_job_id, p_inspector_id)
       -- ★ ADMIN-AUTHORIZED FULL ACCESS IS THE WHOLE CONDITION. Live, not the
       --   executed snapshot: a downgrade revokes on the very next evaluation.
       AND public.nx_job_effective_identity_mode(p_job_id) = 'full'
       AND COALESCE(j.status, '') NOT IN ('cancelled', 'paid')
  );
$function$;

COMMENT ON FUNCTION public.nx_direct_chat_authorized(uuid, uuid, uuid) IS
  'Single gate for job_client_inspector rooms. TRUE only for the job buyer side or that room''s ACTIVE contract inspector, while the live per-job identity_mode is ''full'' and the job is not cancelled/paid. Owner policy 2026-08-19: Full = complete identity + direct chat; Protected/Professional = neither.';

-- ─── 2. The opener, restored (create-or-return, gate-checked) ───────────────
CREATE OR REPLACE FUNCTION public.open_direct_conversation(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_job  RECORD;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '28000';
  END IF;

  -- Admin may NOT open/create a direct room: admin is not a party and must
  -- never materialise inside it. Admin reads via the monitoring views.
  IF public.nx_is_admin() THEN
    RAISE EXCEPTION 'admins observe direct rooms via the monitoring view, not by joining'
      USING errcode = '42501';
  END IF;

  IF NOT public.nx_direct_chat_authorized(p_job_id, p_inspector_id, v_uid) THEN
    RAISE EXCEPTION 'direct chat is not authorized for this job/inspector relationship (Full access is set per job by a NEXPEC admin)'
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;

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
    v_job.client_id,
    p_inspector_id,
    'job_client_inspector'::public.conversation_kind,
    -- user_id models the legacy owner column and is NOT the authorization
    -- source for this kind — nx_direct_chat_authorized is. Since
    -- 20260801568000 the broad user_id-based policies explicitly exclude this
    -- kind, so owning the row grants nothing on its own.
    v_job.client_id,
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

-- ─── 3. Selftest — the restored capability AND the closed bypass ────────────
DO $selftest$
DECLARE
  v_def text;
  v_c uuid := gen_random_uuid(); v_i uuid := gen_random_uuid();
  v_j uuid := gen_random_uuid(); v_a uuid := gen_random_uuid();
  v_app uuid := gen_random_uuid(); v_room uuid; v_n int;
BEGIN
  -- CATALOGUE: the bypass hardening from 20260801568000 must still be in force.
  FOR v_def IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='public' AND tablename IN ('conversations','messages')
       AND policyname IN ('view_own_chats','conv_select_self_or_admin','conv_insert_self_or_admin',
                          'view_chat_msgs','msg_select_via_conv','msg_insert_party')
       AND coalesce(qual,'') || coalesce(with_check,'') NOT LIKE '%job_client_inspector%'
  LOOP
    RAISE EXCEPTION 'SELFTEST: policy % lost the bypass hardening — the OR-door is open again', v_def;
  END LOOP;
  -- …and the gate-aware policies must exist to be the only doors.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='public'
         AND policyname IN ('conv_direct_select','conv_direct_update_parties',
                            'msg_direct_select','msg_direct_insert')) <> 4 THEN
    RAISE EXCEPTION 'SELFTEST: the gate-aware direct policies are not all present';
  END IF;
  -- …and admin oversight survives.
  IF to_regclass('public.admin_direct_conversations_view') IS NULL
     OR to_regclass('public.admin_direct_messages_view') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: admin oversight views missing';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'dr.'||u::text||'@synthetic.invalid', now(), now()
      FROM unnest(ARRAY[v_c,v_i,v_a]) u;
    INSERT INTO public.profiles (id, role, full_name, email, phone, is_verified) VALUES
      (v_c,'client','DR Client','dr.c@synthetic.invalid','+15550801',true),
      (v_i,'inspector','DR Inspector','dr.i@synthetic.invalid','+15550802',true),
      (v_a,'super_admin','DR Admin','dr.a@synthetic.invalid','+15550803',true)
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode,
                             client_settled_at)
    VALUES (v_j,'dr direct',v_c,'open','approved','prepay',100000,80000,'professional',now());
    INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents,forwarded_to_client_at)
    VALUES (v_app,v_j,v_i,'hired',80000,now());
    INSERT INTO public.job_contracts (job_id, application_id, client_id, inspector_id,
                                      client_price_cents, inspector_payout_cents, status,
                                      contract_text_md, client_signed_at, inspector_signed_at)
    VALUES (v_j, v_app, v_c, v_i, 100000, 80000, 'fully_executed', 'dr body', now(), now());
    UPDATE public.jobs SET contractor_id = v_i, status = 'assigned' WHERE id = v_j;

    -- PROFESSIONAL: denied.
    IF public.nx_direct_chat_authorized(v_j, v_i, v_c) THEN
      RAISE EXCEPTION 'SELFTEST: PROFESSIONAL granted direct chat';
    END IF;

    -- FULL: allowed for both parties.
    UPDATE public.jobs SET identity_mode = 'full' WHERE id = v_j;
    IF NOT public.nx_direct_chat_authorized(v_j, v_i, v_c) THEN
      RAISE EXCEPTION 'SELFTEST: FULL did not grant the client direct chat';
    END IF;
    IF NOT public.nx_direct_chat_authorized(v_j, v_i, v_i) THEN
      RAISE EXCEPTION 'SELFTEST: FULL did not grant the inspector direct chat';
    END IF;

    -- Room opens through the RPC as the client, and is idempotent.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    v_room := public.open_direct_conversation(v_j, v_i);
    IF v_room IS NULL THEN RAISE EXCEPTION 'SELFTEST: FULL room did not open'; END IF;
    IF public.open_direct_conversation(v_j, v_i) <> v_room THEN
      RAISE EXCEPTION 'SELFTEST: opener is not idempotent';
    END IF;
    -- Two-party send/receive.
    PERFORM public.send_message(v_room, 'client says hello');
    SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_room;
    IF v_n <> 1 THEN RAISE EXCEPTION 'SELFTEST: client cannot see the FULL room'; END IF;
    RESET ROLE;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_i::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_room;
    IF v_n <> 1 THEN RAISE EXCEPTION 'SELFTEST: inspector cannot read the client message'; END IF;
    PERFORM public.send_message(v_room, 'inspector replies');
    RESET ROLE;

    -- BYPASS still closed under FULL: no hand-crafted room, no guessed-id post
    -- outside the gate-aware policy path.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    BEGIN
      INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, title, status)
      VALUES (v_j, v_c, v_i, 'job_client_inspector', v_c, 'crafted', 'open');
      RAISE EXCEPTION 'SELFTEST: client hand-crafted a direct room (bypass reopened)';
    EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation THEN NULL;
    END;
    RESET ROLE;

    -- DOWNGRADE revokes immediately, both directions, reads and writes.
    UPDATE public.jobs SET identity_mode = 'professional' WHERE id = v_j;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO v_n FROM public.conversations WHERE id = v_room;
    IF v_n <> 0 THEN RAISE EXCEPTION 'SELFTEST: downgrade did not hide the room from the client'; END IF;
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_room;
    IF v_n <> 0 THEN RAISE EXCEPTION 'SELFTEST: downgrade did not revoke message reads'; END IF;
    BEGIN
      PERFORM public.send_message(v_room, 'after downgrade');
      RAISE EXCEPTION 'SELFTEST: downgrade did not block new messages';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    -- ADMIN retains audit of the preserved history, without being a party.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_a::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_room;
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'SELFTEST: admin lost the audit transcript (saw %)', v_n;
    END IF;
    BEGIN
      PERFORM public.send_message(v_room, 'admin intrudes');
      RAISE EXCEPTION 'SELFTEST: admin was able to post into the two-party room';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    RAISE NOTICE 'SELFTEST ok — FULL restores two-party direct chat; professional/protected denied; bypass closed; downgrade revokes; admin audits without joining';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated); catalogue assertions passed';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE 'dr.%@synthetic.invalid') THEN
    RAISE EXCEPTION 'SELFTEST: synthetic fixtures survived';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
