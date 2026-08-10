-- ════════════════════════════════════════════════════════════════════════════
--  20260801348000_two_party_media_live_gate.sql
--
--  ROOT CAUSE OF THE STALE-MEDIA LEAK (direct_chat_access test 36).
--
--  nx_can_access_doc is an IF/RETURN chain — a DISJUNCTION. 20260801334000 and
--  340000 added correctly live-gated branches for the two-party kinds, but a
--  much older branch further down grants ANY message attachment to whoever
--  owns the conversation (cv.user_id) or is a party on its job, with no kind
--  filter and no live check. Adding a correct branch earlier cannot revoke
--  anything when a permissive branch still follows it.
--
--  open_direct_conversation attributes the room to the BUYER PRINCIPAL, so
--  cv.user_id IS the buyer. After Full → Professional the live gate correctly
--  went false — messaging was blocked, test 35 passed — but the buyer still
--  matched `cv.user_id = p_uid` in the legacy branch and was handed a fresh
--  signed URL for the INSPECTOR'S voice note. Cross-party, not the documented
--  sender-owns-their-own-upload case: the buyer never uploaded that file.
--  The inspector leaked symmetrically through the job-party arm.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Exclude the three two-party kinds from the legacy branch. Their media is
--  then authorized ONLY by their own branches, which call the canonical gates
--  nx_direct_chat_authorized / nx_supplier_inspector_chat_authorized /
--  nx_buyer_supplier_chat_authorized. No authorization rule is duplicated,
--  copied or re-derived — the legacy rule simply stops answering for channels
--  it predates and does not understand.
--
--  ── WHAT IS DELIBERATELY UNCHANGED ─────────────────────────────────────────
--  • Admin/super_admin still short-circuit at the top: monitoring keeps full
--    visibility of every channel's media.
--  • The storage.objects owner branch is untouched. A SENDER can still reach a
--    file they uploaded themselves after revocation. That is not disclosure —
--    they authored it and already hold the bytes — and it is a distinct,
--    separately tested behaviour from the cross-party leak fixed here.
--  • Every legacy kind keeps the legacy rule verbatim.
--  • No message or attachment is deleted. History stays stored; only the
--    ability to mint NEW cross-party URLs after revocation is withdrawn.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_can_access_doc(
  p_uid    uuid,
  p_bucket text,
  p_path   text
) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_uid IS NULL OR p_bucket IS NULL OR p_path IS NULL OR btrim(p_path) = '' THEN
    RETURN false;
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = p_uid;
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = p_bucket AND o.name = p_path AND o.owner = p_uid
  ) THEN
    RETURN true;
  END IF;

  -- ★★ DIRECT-ROOM ATTACHMENT (20260801334000). Images, files and voice notes
  --    obey EXACTLY the same live gate as text: a revoked party cannot mint a
  --    URL for a message they can no longer read, and the storage-owner branch
  --    above still lets each sender reach their own upload.
  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'job_client_inspector'::public.conversation_kind
       AND public.nx_direct_chat_authorized(c.job_id, c.contractor_id, p_uid)
  ) THEN RETURN true; END IF;

  -- ★★ SUPPLIER-INSPECTOR / BUYER-SUPPLIER ATTACHMENTS (20260801340000).
  --    Same shape as the direct-room branch above: media obeys EXACTLY the gate
  --    its message row obeys, so a supplier whose contract was voided cannot
  --    mint a URL for a drawing they can no longer read.
  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'job_supplier_inspector'::public.conversation_kind
       AND public.nx_supplier_inspector_chat_authorized(c.job_id, c.contractor_id, c.client_id, p_uid)
  ) THEN RETURN true; END IF;

  IF p_bucket = 'chat_attachments' AND EXISTS (
    SELECT 1
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND c.kind = 'buyer_supplier'::public.conversation_kind
       AND public.nx_buyer_supplier_chat_authorized(c.user_id, c.contractor_id, p_uid)
  ) THEN RETURN true; END IF;

  IF p_bucket = 'resumes' AND EXISTS (
    SELECT 1
      FROM public.applications a
      JOIN public.jobs      j  ON j.id = a.job_id
      JOIN public.profiles  pr ON pr.id = a.applicant_id
     WHERE (j.client_id = p_uid OR j.agency_id = p_uid)
       AND a.forwarded_to_client_at IS NOT NULL
       AND public.nx_job_effective_identity_mode(j.id) IN ('professional', 'full')
       AND NOT (j.status = ANY (public.nx_terminal_job_statuses()))
       AND a.status NOT IN ('rejected', 'withdrawn')
       AND NOT EXISTS (
             SELECT 1 FROM public.job_contracts jc
              WHERE jc.job_id = j.id
                AND jc.inspector_id = a.applicant_id
                AND jc.status = 'voided'
                AND NOT EXISTS (
                      SELECT 1 FROM public.job_contracts jc2
                       WHERE jc2.job_id = j.id
                         AND jc2.inspector_id = a.applicant_id
                         AND jc2.status <> 'voided'
                    )
           )
       AND (
             pr.resume_url LIKE '%' || p_path
          OR pr.cv_url     LIKE '%' || p_path
           )
       AND (
             p_path LIKE a.applicant_id::text || '/%'
          OR EXISTS (
               SELECT 1 FROM storage.objects o2
                WHERE o2.bucket_id = 'resumes'
                  AND o2.name = p_path
                  AND o2.owner = a.applicant_id
             )
           )
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.inspection_reports r
      JOIN public.jobs j ON j.id = r.job_id
     WHERE (r.photo_url LIKE '%' || p_path
            OR r.pdf_url LIKE '%' || p_path
            OR r.final_report_doc LIKE '%' || p_path)
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.contracts c
     WHERE c.document_url LIKE '%' || p_path
       AND (c.client_id = p_uid OR c.contractor_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_documents pd
      JOIN public.jobs j ON j.id = pd.job_id
     WHERE pd.file_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.template_url LIKE '%' || p_path
       AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
  ) THEN RETURN true; END IF;

  -- ★★ LEGACY CHAT-ATTACHMENT BRANCH — NOW KIND-SCOPED (20260801348000).
  --
  --    THIS WAS THE STALE-MEDIA LEAK. The branch grants any message attachment
  --    to whoever OWNS the conversation (cv.user_id) or is a party on its job.
  --    That was correct when every conversation was admin-mediated: room
  --    membership and job membership were the same thing, and neither could be
  --    revoked without the job itself changing.
  --
  --    The two-party kinds broke that equivalence. open_direct_conversation
  --    sets cv.user_id = the BUYER PRINCIPAL, so after a Full → Professional
  --    downgrade the buyer still matched `cv.user_id = p_uid` here and this
  --    branch returned true — overriding the live gate three branches above and
  --    handing the buyer a fresh signed URL for the INSPECTOR'S voice note.
  --    The inspector leaked symmetrically through the job-party arm.
  --
  --    An IF/RETURN chain is a disjunction: adding a correctly-gated branch
  --    earlier cannot revoke anything, because a later permissive branch still
  --    wins. The two-party kinds must therefore be EXCLUDED here so their own
  --    live-gated branches are the only thing that can authorize their media.
  --    No authorization logic is duplicated — this only stops the legacy rule
  --    from answering for channels it does not understand.
  IF EXISTS (
    SELECT 1 FROM public.messages m
      JOIN public.conversations cv ON cv.id = m.conversation_id
     WHERE m.attachment_url = p_path
       AND cv.kind NOT IN (
             'job_client_inspector'::public.conversation_kind,
             'job_supplier_inspector'::public.conversation_kind,
             'buyer_supplier'::public.conversation_kind
           )
       AND (
         cv.user_id = p_uid
         OR (cv.job_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.jobs j
               WHERE j.id = cv.job_id
                 AND (j.client_id = p_uid OR j.contractor_id = p_uid OR j.agency_id = p_uid)
            ))
       )
  ) THEN RETURN true; END IF;

  -- dispute-reports: the generated PDF is visible to the dispute's parties.
  -- ★ disputes.project_id is an FK to public.work_orders(id) — NOT the
  --   org/budget projects table, which has no client_id / inspector_id.
  --   Healed by 20260801252000. Never rewire this back.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
      JOIN public.work_orders w ON w.id = d.project_id
     WHERE d.report_url LIKE '%' || p_path
       AND (w.client_id = p_uid OR w.inspector_id = p_uid OR d.raised_by = p_uid)
  ) THEN RETURN true; END IF;

  RETURN false;  -- deny by default
END;
$$;

ALTER FUNCTION public.nx_can_access_doc(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_access_doc(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_can_access_doc(uuid, text, text) TO service_role;

DO $verify$
DECLARE v text;
BEGIN
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_can_access_doc(uuid,text,text)'::regprocedure);

  -- The legacy branch must now be kind-scoped.
  IF v !~ 'cv\.kind NOT IN' THEN
    RAISE EXCEPTION 'LEAK: the legacy chat-attachment branch is not kind-scoped — two-party media can still bypass its live gate';
  END IF;

  -- All three live gates must still be consulted for their own channels.
  IF v !~ 'nx_direct_chat_authorized' THEN
    RAISE EXCEPTION 'buyer-inspector media is no longer live-gated';
  END IF;
  IF v !~ 'nx_supplier_inspector_chat_authorized' THEN
    RAISE EXCEPTION 'supplier-inspector media is no longer live-gated';
  END IF;
  IF v !~ 'nx_buyer_supplier_chat_authorized' THEN
    RAISE EXCEPTION 'buyer-supplier media is no longer live-gated';
  END IF;

  -- Admin monitoring must keep its short-circuit.
  IF v !~ 'super_admin' THEN
    RAISE EXCEPTION 'REGRESSION: admin lost blanket document visibility';
  END IF;

  -- The dispute branch healed by 20260801252000 must survive every rewrite.
  IF v ~* '(FROM|JOIN)[[:space:]]+public\.projects\M' THEN
    RAISE EXCEPTION 'REGRESSION: nx_can_access_doc reintroduced public.projects (see 252000)';
  END IF;
  IF v !~ 'work_orders' THEN
    RAISE EXCEPTION 'REGRESSION: the dispute-document branch was lost';
  END IF;

  -- The résumé branch (326000/328000) must survive.
  IF v !~ 'resumes' THEN
    RAISE EXCEPTION 'REGRESSION: the resume branch was lost';
  END IF;
END
$verify$;

-- Guard against reintroducing the fixture defect this migration was amended
-- for: a migration-time proof must never create a super_admin, because it
-- would be the only active one and cleanup would trip LAST_SUPER_ADMIN.
DO $noguard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.role = 'super_admin'
       AND p.email LIKE '%@selftest.nx'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: a migration proof created a super_admin fixture — use role = ''admin''';
  END IF;
END
$noguard$;

-- Behavioural proof: a downgraded buyer must NOT reach the inspector's file,
-- while the same call succeeds while the relationship is live, and the sender
-- keeps their own upload throughout.
DO $behaviour$
--  ── FIXTURE ISOLATION (hardened after a PRODUCTION failure) ────────────────
--  This proof failed on Production with
--      SELFTEST: admin monitoring lost access to direct-chat media
--  while passing on a freshly reset local database. The product path is fine —
--  nx_can_access_doc still short-circuits on v_role IN ('admin','super_admin')
--  — so the difference was the FIXTURE, not the gate.
--
--  The original block used hard-coded ids with ON CONFLICT (id) DO NOTHING.
--  On a non-empty database that is silent failure by design: if a row with
--  that id already exists with any other role, DO NOTHING keeps the old row,
--  nx_can_access_doc reads that role, and the assertion blames the product for
--  a fixture that was never created. Local resets are empty, so it only ever
--  showed up against real data.
--
--  Fixed the same way 350000/352000/354000 were: every id is generated, the
--  profiles upsert is DO UPDATE (never DO NOTHING) so Production's auth
--  provisioning trigger cannot leave a default role behind, and the fixture
--  asserts its own preconditions for EVERY principal before any product
--  assertion runs — so a fixture problem reports itself instead of
--  masquerading as a security regression.
DECLARE
  v_pre       RECORD;
  v_pre_email text;
  v_pre_role  text;
  v_buyer uuid := gen_random_uuid();
  v_insp  uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_job   uuid := gen_random_uuid();
  v_tag   text := 'nx348-' || replace(gen_random_uuid()::text,'-','') || '@selftest.nx';
  v_conv  uuid;
  v_att   text := gen_random_uuid()::text || '/proof-note.m4a';
  v_role  text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_buyer,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','b.'||v_tag,now(),now()),
    (v_insp, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i.'||v_tag,now(),now()),
    (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','a.'||v_tag,now(),now());
  INSERT INTO public.profiles (id, email, role) VALUES
    (v_buyer,'b.'||v_tag,'client'), (v_insp,'i.'||v_tag,'inspector'),
    (v_admin,'a.'||v_tag,'admin')
  -- ── PRODUCTION AUTH PROVISIONING ─────────────────────────────────────────
  --  Production provisions public.profiles automatically from auth.users (a
  --  handle_new_user-style trigger absent from a bare local stack). The
  --  auth.users INSERT above may therefore ALREADY have created these rows with
  --  a default role, so a bare INSERT hits profiles_pkey. DO UPDATE (never DO
  --  NOTHING) is correct and safe here for one specific reason: every id is
  --  gen_random_uuid() minted inside THIS transaction and its auth.users INSERT
  --  just succeeded, so the only row that can possibly conflict is the one the
  --  provisioning trigger just derived from our own fixture. DO NOTHING would
  --  silently leave the provisioned default role in place — which is exactly how
  --  the first Production attempt produced a false 'admin lost access' failure.
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role  = EXCLUDED.role;

  -- ── FIXTURE PRECONDITION: every generated principal, not just admin ───────
  --  Asserted BEFORE any product assertion, so a provisioning difference can
  --  never be misread as a product regression.
  FOR v_pre IN SELECT * FROM (VALUES (v_buyer,'b.'||v_tag,'client'), (v_insp,'i.'||v_tag,'inspector'),
    (v_admin,'a.'||v_tag,'admin')) AS t(id, email, role)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_pre.id) THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: auth.users row missing for generated % principal % — fixture/provisioning failure, not a product regression', v_pre.role, v_pre.id;
    END IF;
    SELECT p.email, p.role INTO v_pre_email, v_pre_role
      FROM public.profiles p WHERE p.id = v_pre.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: public.profiles row missing for generated % principal % — fixture/provisioning failure, not a product regression', v_pre.role, v_pre.id;
    END IF;
    IF v_pre_email IS DISTINCT FROM v_pre.email OR v_pre_role IS DISTINCT FROM v_pre.role THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: generated principal % resolved to email=% role=% but the fixture requires email=% role=% — an auth-provisioning trigger overwrote the fixture identity; this is a fixture/provisioning failure, not a product regression', v_pre.id, COALESCE(v_pre_email,'<null>'), COALESCE(v_pre_role,'<null>'), v_pre.email, v_pre.role;
    END IF;
  END LOOP;


  -- ★ PRECONDITION, ASSERTED. If a trigger or default rewrites the role, this
  --   names the real problem instead of letting the admin assertion below fail
  --   as though the gate had regressed. role='admin' (never 'super_admin') so
  --   cleanup cannot trip the LAST_SUPER_ADMIN invariant from 20260801278000.
  SELECT role INTO v_role FROM public.profiles WHERE id = v_admin;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'SELFTEST FIXTURE: the admin principal has role % (expected admin) — fixture problem, not a gate regression', COALESCE(v_role,'<missing>');
  END IF;

  INSERT INTO public.jobs (id, title, client_id, status, moderation_status, identity_mode)
  VALUES (v_job, 'media selftest 348000', v_buyer, 'in_progress', 'approved', 'full');
  INSERT INTO public.job_contracts (job_id, client_id, inspector_id, status,
                                    client_price_cents, inspector_payout_cents)
  VALUES (v_job, v_buyer, v_insp, 'fully_executed', 100000, 80000);

  INSERT INTO public.conversations (job_id, client_id, contractor_id, kind, user_id, status)
  VALUES (v_job, v_buyer, v_insp, 'job_client_inspector', v_buyer, 'open')
  RETURNING id INTO v_conv;
  INSERT INTO public.messages (conversation_id, sender_id, content, attachment_url, attachment_type)
  VALUES (v_conv, v_insp, NULL, v_att, 'audio/m4a');

  IF NOT public.nx_can_access_doc(v_buyer, 'chat_attachments', v_att) THEN
    RAISE EXCEPTION 'SELFTEST: the buyer cannot reach the inspector''s file while the relationship is LIVE';
  END IF;

  -- Downgrade. Messaging and media must revoke together.
  UPDATE public.jobs SET identity_mode = 'professional' WHERE id = v_job;

  IF public.nx_can_access_doc(v_buyer, 'chat_attachments', v_att) THEN
    RAISE EXCEPTION 'SELFTEST: STALE MEDIA — the downgraded buyer can still mint the inspector''s attachment';
  END IF;
  IF public.nx_can_access_doc(v_insp, 'chat_attachments', v_att) THEN
    RAISE EXCEPTION 'SELFTEST: STALE MEDIA — the downgraded inspector can still mint it through the room';
  END IF;

  -- Admin monitoring must be unaffected.
  IF NOT public.nx_can_access_doc(v_admin, 'chat_attachments', v_att) THEN
    RAISE EXCEPTION 'SELFTEST: admin monitoring lost access to direct-chat media';
  END IF;

  -- History must remain stored.
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = v_conv) THEN
    RAISE EXCEPTION 'SELFTEST: revocation deleted history';
  END IF;

  -- ── CLEANUP. The messages INSERT fires tg_direct_message_fanout, which
  --    writes a notifications row — permanent residue if missed.
  DELETE FROM public.notifications WHERE recipient_id IN (v_buyer, v_insp, v_admin);
  DELETE FROM public.messages      WHERE conversation_id = v_conv;
  DELETE FROM public.conversations WHERE id = v_conv OR job_id = v_job;
  DELETE FROM public.job_contracts WHERE job_id = v_job;
  DELETE FROM public.jobs          WHERE id = v_job;
  DELETE FROM public.profiles      WHERE id IN (v_buyer, v_insp, v_admin);
  DELETE FROM auth.users           WHERE id IN (v_buyer, v_insp, v_admin);

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id IN (v_buyer, v_insp, v_admin))
     OR EXISTS (SELECT 1 FROM auth.users   WHERE id IN (v_buyer, v_insp, v_admin))
     OR EXISTS (SELECT 1 FROM public.jobs  WHERE id = v_job)
     OR EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv)
     OR EXISTS (SELECT 1 FROM public.notifications WHERE recipient_id IN (v_buyer, v_insp, v_admin)) THEN
    RAISE EXCEPTION 'SELFTEST: the behavioural proof left fixtures behind';
  END IF;

  RAISE NOTICE 'Two-party media follows the live gate; admin monitoring and history intact; fixtures removed.';
END
$behaviour$;

COMMIT;
