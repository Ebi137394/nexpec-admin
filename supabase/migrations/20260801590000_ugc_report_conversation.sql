-- ════════════════════════════════════════════════════════════════════════════
--  20260801590000_ugc_report_conversation.sql
--
--  STORE-COMPLIANCE: user-generated-content reporting (Apple Guideline 1.2,
--  Google Play UGC policy). NEXPEC carries party-to-party chat, so reviewers
--  expect an in-app way to report objectionable content. The pre-submission
--  audit found none.
--
--  Design: the smallest mechanism that reaches a real moderator. A report is
--  routed into the reporter's existing help_support conversation — the lane
--  admins already staff (admin/support-inbox on mobile, admin/messages on web)
--  and the one lane a PENDING account may also use. No new moderation surface,
--  no new table; one RPC plus an audit row.
--
--  The RPC is SECURITY DEFINER because the reporter must be able to file even
--  where RLS would not let them write (e.g. pending accounts, retired rooms):
--  it validates participation itself before writing anything.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.report_conversation(
  p_conversation_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_conv    public.conversations%ROWTYPE;
  v_support uuid;
  v_reason  text := NULLIF(btrim(COALESCE(p_reason,'')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'REPORT_REASON_REQUIRED' USING ERRCODE = '22000';
  END IF;
  v_reason := left(v_reason, 500);

  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  --  Only a participant may report the room. Participation is any of the
  --  three party columns; admins may always file (they moderate anyway).
  IF v_uid NOT IN (COALESCE(v_conv.client_id,'00000000-0000-0000-0000-000000000000'),
                   COALESCE(v_conv.contractor_id,'00000000-0000-0000-0000-000000000000'),
                   COALESCE(v_conv.user_id,'00000000-0000-0000-0000-000000000000'))
     AND NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'NOT_A_PARTICIPANT' USING ERRCODE = '42501';
  END IF;

  --  Find or create the reporter's support lane.
  SELECT id INTO v_support FROM public.conversations
   WHERE kind = 'help_support' AND user_id = v_uid AND status <> 'closed'
   ORDER BY created_at DESC LIMIT 1;
  IF v_support IS NULL THEN
    INSERT INTO public.conversations (kind, user_id, title, status)
    VALUES ('help_support', v_uid, 'Content report', 'open')
    RETURNING id INTO v_support;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_support, v_uid,
          '⚑ CONTENT REPORT — conversation ' || p_conversation_id::text ||
          ' (' || v_conv.kind::text || ')' || E'\nReason: ' || v_reason);

  INSERT INTO public.audit_events
    (event_type, severity, actor_id, subject_table, subject_id, job_id, summary, metadata)
  VALUES ('ugc.conversation_reported', 'warning', v_uid,
          'conversations', p_conversation_id, v_conv.job_id,
          'User reported a conversation for moderation',
          jsonb_build_object('reason', v_reason, 'kind', v_conv.kind::text,
                             'routed_to_support', v_support));

  RETURN v_support;
END;
$fn$;

REVOKE ALL ON FUNCTION public.report_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_conversation(uuid, text) TO authenticated, service_role;

-- ── SELFTEST — rolls itself back ────────────────────────────────────────────
DO $verify$
DECLARE
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_conv uuid := gen_random_uuid(); v_sup uuid; v_n int; v_ok boolean; v_err text;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'ugc.'||u::text||'@synthetic.invalid', now(), now(), now()
      FROM unnest(ARRAY[v_a, v_b]) u;
    INSERT INTO public.profiles (id, role, full_name, email, is_verified, marketplace_activated) VALUES
      (v_a,'client','UGC A','ugc.a@synthetic.invalid', true, true),
      (v_b,'inspector','UGC B','ugc.b@synthetic.invalid', true, true);
    INSERT INTO public.conversations (id, kind, user_id, client_id, title, status)
    VALUES (v_conv,'help_support', v_a, v_a, 'ugc test room','open');

    -- participant files a report
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_a,'role','authenticated')::text, true);
    v_sup := public.report_conversation(v_conv, 'Selftest: objectionable content');
    SELECT count(*) INTO v_n FROM public.messages
     WHERE conversation_id = v_sup AND content LIKE '⚑ CONTENT REPORT%';
    IF v_n <> 1 THEN RAISE EXCEPTION 'U1 FAILED: report message not delivered (%)', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.audit_events
     WHERE event_type='ugc.conversation_reported' AND subject_id=v_conv;
    IF v_n <> 1 THEN RAISE EXCEPTION 'U2 FAILED: report not audited'; END IF;

    -- a non-participant may NOT report someone else's room
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_b,'role','authenticated')::text, true);
    v_ok := false;
    BEGIN
      PERFORM public.report_conversation(v_conv, 'not my room');
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_ok THEN RAISE EXCEPTION 'U3 FAILED: non-participant filed a report'; END IF;
    IF v_err NOT LIKE '%NOT_A_PARTICIPANT%' THEN
      RAISE EXCEPTION 'U3 FAILED: wrong refusal: %', v_err;
    END IF;

    -- empty reason refused
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_a,'role','authenticated')::text, true);
    v_ok := false;
    BEGIN
      PERFORM public.report_conversation(v_conv, '   ');
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'U4 FAILED: empty reason accepted'; END IF;

    RAISE EXCEPTION 'VERIFY_ROLLBACK_SENTINEL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'VERIFY_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims','',true);
  SELECT count(*) INTO v_n FROM public.profiles WHERE id IN (v_a,v_b);
  IF v_n <> 0 THEN RAISE EXCEPTION 'REVOCATION FAILED: % synthetic rows survive', v_n; END IF;
  RAISE NOTICE '════ UGC report mechanism proved: participant reports route to the staffed support lane with audit; non-participants and empty reasons refused ════';
END
$verify$;

COMMIT;
