-- ════════════════════════════════════════════════════════════════════════════
--  20260801336000_direct_chat_role_parity.sql
--
--  Makes Full-mode direct chat correct for EVERY buyer-side account type, not
--  just a personal Client. 20260801334000 was written around jobs.client_id and
--  is wrong for Agency- and Enterprise-owned work.
--
--  ── THE DEFECT THIS FIXES (a hard launch blocker) ──────────────────────────
--  jobs carries CONSTRAINT jobs_owner_xor:
--        (client_id IS NOT NULL AND agency_id IS NULL)
--     OR (client_id IS NULL     AND agency_id IS NOT NULL)
--  An Agency/Enterprise-owned job therefore has client_id = NULL. 334000's
--  open_direct_conversation inserts conversations.user_id = jobs.client_id, and
--  conversations.user_id is NOT NULL — so on an agency-owned job the RPC did not
--  merely mis-attribute the room, it raised a not-null violation and NO agency
--  job could ever open one. tg_direct_message_fanout had the matching bug:
--  v_recipient := v_c.client_id resolved to NULL, silently dropping the
--  notification.
--
--  ── THE CANONICAL BUYER PRINCIPAL ──────────────────────────────────────────
--  NEXPEC already answers "who owns this job" in exactly one way, in
--  nx_can_team_access_job / nx_can_team_manage_job (20260801208000):
--        COALESCE(j.agency_id, j.client_id)
--  This migration adopts that expression instead of inventing a second answer.
--
--  ── ORG / WORKSPACE PARITY ─────────────────────────────────────────────────
--  Agency and Enterprise accounts operate through organizations / org_members
--  (roles: owner, procurement_admin, project_lead, viewer). Job access already
--  flows through the org, so direct chat must too, or a procurement_admin who
--  runs the job day to day would be locked out while the org owner — who may
--  never open the app — is the only one who can talk to the inspector.
--
--  VIEWER IS DELIBERATELY EXCLUDED. nx_can_team_manage_job already draws that
--  line for every acting capability on a job. Direct chat is the single place
--  where a Full-mode inspector's real identity and contact details are exposed
--  to the buyer side; widening that to every read-only seat in a large
--  enterprise multiplies the disclosure surface for people who cannot act on
--  the job anyway. Viewers keep full job visibility and admins keep complete
--  oversight, so nothing becomes unauditable.
--
--  ── ROLE MATRIX (from public.job_meeting_participants, NEXPEC's own mapping) ─
--     client | agency | enterprise → buyer side   → direct chat when Full
--     inspector | senior          → seller side   → direct chat when Full
--     supplier                    → 'vendor'      → NO direct chat, see below
--     admin | super_admin         → observer      → monitoring views only
--
--  ── WHY SUPPLIER GETS NOTHING HERE ─────────────────────────────────────────
--  Suppliers are not a forgotten buyer type; they are the INSPECTED PARTY. The
--  RFQ award trigger spawns the inspection job with client_id = rfq.client_id
--  and location = the SUPPLIER'S OWN FACILITY ("Inspect the fabrication/service
--  at the supplier facility (FAT / QA-QC) before shipment"). The supplier is the
--  subject of the inspection, so a private supplier↔inspector channel with no
--  admin in it would let the inspected party lobby their own inspector. That is
--  an integrity failure, not a missing feature. Note this is a statement about
--  the RELATIONSHIP, not the role name: nothing here reads profiles.role, so a
--  supplier-role account that legitimately raises its own RFQ becomes that job's
--  client_id and is authorized through the ordinary buyer branch.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The canonical buyer principal ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_buyer_principal(p_job_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(j.agency_id, j.client_id) FROM public.jobs j WHERE j.id = p_job_id;
$$;
ALTER FUNCTION public.nx_job_buyer_principal(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_buyer_principal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_buyer_principal(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_job_buyer_principal(uuid) IS
  'The single buyer-side owner of a job: COALESCE(agency_id, client_id), guaranteed to be exactly one user by CONSTRAINT jobs_owner_xor. Same expression nx_can_team_access_job uses — do not introduce a second definition of job ownership.';

-- ── 2. Buyer side, including the org team ───────────────────────────────────
--  uid-PARAMETERISED ON PURPOSE. nx_can_team_manage_job reads auth.uid()
--  internally, which is useless to nx_can_access_doc: storage URL minting runs
--  as service_role and passes the acting user explicitly. Re-expressing the
--  same org rule with an explicit uid is what lets attachments obey exactly the
--  rule that message rows obey.
CREATE OR REPLACE FUNCTION public.nx_is_job_buyer_side(
  p_job_id uuid,
  p_uid    uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_uid IS NOT NULL AND (
    -- the principal themselves (personal Client, or the Agency/Enterprise account)
    public.nx_job_buyer_principal(p_job_id) = p_uid
    -- …or a non-viewer teammate in the principal's organization
    OR EXISTS (
      SELECT 1
        FROM public.org_members o_owner
        JOIN public.org_members o_me ON o_me.org_id = o_owner.org_id
       WHERE o_owner.user_id = public.nx_job_buyer_principal(p_job_id)
         AND o_me.user_id    = p_uid
         AND o_me.role::text <> 'viewer'
    )
  );
$$;
ALTER FUNCTION public.nx_is_job_buyer_side(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_job_buyer_side(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_job_buyer_side(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_is_job_buyer_side(uuid, uuid) IS
  'True when p_uid is the job''s buyer principal (Client, Agency or Enterprise account) or a non-viewer member of that principal''s organization. Mirrors nx_can_team_manage_job but takes an explicit uid so storage authorization can reuse it. Viewers are excluded: they cannot act on a job, and direct chat exposes Full-mode inspector identity.';

-- ── 3. The gate, now buyer-neutral ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_direct_chat_authorized(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_uid          uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
       AND public.nx_job_effective_identity_mode(p_job_id) = 'full'
       AND COALESCE(j.status, '') NOT IN ('cancelled', 'paid')
  );
$$;
COMMENT ON FUNCTION public.nx_direct_chat_authorized(uuid, uuid, uuid) IS
  'THE single authority for Full-mode buyer↔inspector direct chat. Buyer side is nx_is_job_buyer_side (Client, Agency, Enterprise, and their non-viewer org teammates); seller side is the active contract inspector. Also requires live identity_mode = full and a non-terminal job. Consulted by RLS, send_message, the direct-chat RPCs and nx_can_access_doc, so no conversation id, attachment or stale reference can bypass it. Deliberately reads NO profiles.role: authorization follows the relationship, not the account label.';

-- ── 4. Room creation, principal-attributed ──────────────────────────────────
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

  IF public.nx_is_admin() THEN
    RAISE EXCEPTION 'admins observe direct rooms via the monitoring view, not by joining'
      USING errcode = '42501';
  END IF;

  IF NOT public.nx_direct_chat_authorized(p_job_id, p_inspector_id, v_uid) THEN
    RAISE EXCEPTION 'direct chat is not authorized for this job/inspector relationship'
      USING errcode = '42501';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;

  -- ★ THE FIX. Attribute the room to the buyer PRINCIPAL, never to client_id.
  --   On an agency-owned job client_id is NULL and conversations.user_id is
  --   NOT NULL, so the old expression aborted the insert outright. Whichever
  --   teammate happens to open the room, the room belongs to the buyer party.
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

-- ── 5. Fan-out to the whole authorized buyer side ───────────────────────────
CREATE OR REPLACE FUNCTION public.tg_direct_message_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c         RECORD;
  v_principal uuid;
  v_target    uuid;
  v_href      text;
BEGIN
  SELECT * INTO v_c FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND OR v_c.kind <> 'job_client_inspector'::public.conversation_kind THEN
    RETURN NEW;
  END IF;

  v_principal := public.nx_job_buyer_principal(v_c.job_id);
  v_href      := '/chat/direct/' || NEW.conversation_id::text;

  IF NEW.sender_id = v_c.contractor_id THEN
    -- Inspector → buyer side. ONE counter for the whole buyer party: the room
    -- belongs to the organization, not to a seat, so it behaves like a shared
    -- inbox. Whoever reads it clears it for the team, which is the same
    -- semantic org members already get on the job itself.
    UPDATE public.conversations
       SET unread_for_client      = unread_for_client + 1,
           last_message_at        = NOW(),
           last_message_preview   = left(COALESCE(NEW.content, '[attachment]'), 120),
           updated_at             = NOW()
     WHERE id = NEW.conversation_id;

    -- …but notify every authorized buyer-side human, not just the principal.
    -- On an Enterprise job the principal may be a workspace account nobody
    -- watches, while the procurement_admin running the job needs to know.
    FOR v_target IN
      SELECT DISTINCT u FROM (
        SELECT v_principal AS u
        UNION
        SELECT o_me.user_id
          FROM public.org_members o_owner
          JOIN public.org_members o_me ON o_me.org_id = o_owner.org_id
         WHERE o_owner.user_id = v_principal
           AND o_me.role::text <> 'viewer'
      ) s
      WHERE u IS NOT NULL AND u <> NEW.sender_id
    LOOP
      BEGIN
        PERFORM public.create_system_notification(
          v_target, 'New direct message',
          left(COALESCE(NEW.content, 'Sent an attachment'), 120),
          'message', v_href, v_c.job_id);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;

  ELSE
    -- Buyer side → inspector. Exactly one recipient by construction.
    UPDATE public.conversations
       SET unread_for_inspector   = unread_for_inspector + 1,
           last_message_at        = NOW(),
           last_message_preview   = left(COALESCE(NEW.content, '[attachment]'), 120),
           updated_at             = NOW()
     WHERE id = NEW.conversation_id;

    BEGIN
      PERFORM public.create_system_notification(
        v_c.contractor_id, 'New direct message',
        left(COALESCE(NEW.content, 'Sent an attachment'), 120),
        'message', v_href, v_c.job_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 6. Admin monitoring, buyer-neutral ──────────────────────────────────────
--  The old views exposed client_id / client_name, which read NULL on every
--  agency-owned room and would have shown an admin a blank counterparty on
--  exactly the jobs most likely to need oversight. Renaming is safe: both views
--  are new in this same unreleased batch.
DROP VIEW IF EXISTS public.admin_direct_messages_view;
DROP VIEW IF EXISTS public.admin_direct_conversations_view;

CREATE VIEW public.admin_direct_conversations_view
WITH (security_barrier = 'true') AS
SELECT
  c.id            AS conversation_id,
  c.job_id,
  j.title         AS job_title,
  j.status        AS job_status,
  public.nx_job_effective_identity_mode(c.job_id) AS identity_mode,
  public.nx_job_buyer_principal(c.job_id)         AS buyer_id,
  bp.full_name    AS buyer_name,
  CASE WHEN j.agency_id IS NOT NULL THEN 'agency' ELSE 'client' END AS buyer_kind,
  bp.role         AS buyer_role,
  c.contractor_id AS inspector_id,
  ip.full_name    AS inspector_name,
  c.created_at,
  c.last_message_at,
  c.unread_for_client    AS unread_for_buyer,
  c.unread_for_inspector,
  (SELECT count(*) FROM public.messages m
    WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS message_count
FROM public.conversations c
JOIN public.jobs j        ON j.id = c.job_id
LEFT JOIN public.profiles bp ON bp.id = public.nx_job_buyer_principal(c.job_id)
LEFT JOIN public.profiles ip ON ip.id = c.contractor_id
WHERE c.kind = 'job_client_inspector'::public.conversation_kind
  AND public.nx_is_admin();

ALTER VIEW public.admin_direct_conversations_view OWNER TO postgres;
REVOKE ALL ON public.admin_direct_conversations_view FROM PUBLIC, anon;
GRANT SELECT ON public.admin_direct_conversations_view TO authenticated, service_role;
COMMENT ON VIEW public.admin_direct_conversations_view IS
  'Admin-only index of Full-mode direct rooms, buyer-neutral: buyer_id/buyer_name/buyer_kind resolve through nx_job_buyer_principal so Agency- and Enterprise-owned jobs render correctly. Carries NO payout, margin, spread or negotiation column — GR2 blindness here is unfetched, not merely unrendered.';

CREATE VIEW public.admin_direct_messages_view
WITH (security_barrier = 'true') AS
SELECT
  m.id,
  m.conversation_id,
  c.job_id,
  m.sender_id,
  sp.full_name AS sender_name,
  sp.role      AS sender_role,
  CASE WHEN m.sender_id = c.contractor_id THEN 'inspector' ELSE 'buyer' END AS sender_party,
  m.content,
  m.attachment_url,
  m.attachment_type,
  m.attachment_name,
  m.created_at,
  m.is_read,
  m.deleted_at
FROM public.messages m
JOIN public.conversations c ON c.id = m.conversation_id
LEFT JOIN public.profiles sp ON sp.id = m.sender_id
WHERE c.kind = 'job_client_inspector'::public.conversation_kind
  AND public.nx_is_admin();

ALTER VIEW public.admin_direct_messages_view OWNER TO postgres;
REVOKE ALL ON public.admin_direct_messages_view FROM PUBLIC, anon;
GRANT SELECT ON public.admin_direct_messages_view TO authenticated, service_role;
COMMENT ON VIEW public.admin_direct_messages_view IS
  'Admin-only transcript of Full-mode direct rooms: text, attachments, timestamps, sender party (inspector|buyer) and the sender''s account role. Read-only by construction — admin never appears in the room and reading here cannot change is_read or either unread counter.';

-- ── 7. Self-tests ───────────────────────────────────────────────────────────
DO $verify$
DECLARE v text;
BEGIN
  -- the gate must no longer read jobs.client_id directly
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.nx_direct_chat_authorized(uuid,uuid,uuid)'::regprocedure);
  IF v ~* '\mj\.client_id\M' THEN
    RAISE EXCEPTION 'ROLE PARITY: the gate still keys on jobs.client_id directly';
  END IF;
  IF v !~* 'nx_is_job_buyer_side' THEN
    RAISE EXCEPTION 'ROLE PARITY: the gate does not consult nx_is_job_buyer_side';
  END IF;

  -- authorization must never branch on an account label
  IF v ~* 'profiles\.role|''enterprise''|''agency''|''supplier''' THEN
    RAISE EXCEPTION 'ROLE PARITY: the gate branches on a role NAME instead of the relationship';
  END IF;

  -- room creation must not be able to write a NULL owner again
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.open_direct_conversation(uuid,uuid)'::regprocedure);
  IF v !~* 'COALESCE\(\s*v_job\.agency_id\s*,\s*v_job\.client_id\s*\)' THEN
    RAISE EXCEPTION 'ROLE PARITY: open_direct_conversation does not use the buyer principal';
  END IF;

  -- fanout must not resolve the recipient from client_id
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.tg_direct_message_fanout()'::regprocedure);
  IF v ~* 'v_recipient\s*:=\s*v_c\.client_id' THEN
    RAISE EXCEPTION 'ROLE PARITY: fanout still targets conversations.client_id';
  END IF;
  IF v !~* 'nx_job_buyer_principal' THEN
    RAISE EXCEPTION 'ROLE PARITY: fanout does not resolve the buyer principal';
  END IF;

  -- viewers must stay excluded
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.nx_is_job_buyer_side(uuid,uuid)'::regprocedure);
  IF v !~* 'viewer' THEN
    RAISE EXCEPTION 'ROLE PARITY: org viewers are no longer excluded from direct chat';
  END IF;

  -- the trigger must still be attached after the function swap
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'direct_message_fanout' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLE PARITY: the direct_message_fanout trigger is missing';
  END IF;

  -- admin views must be buyer-neutral and still money-free
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name = 'admin_direct_conversations_view'
                    AND column_name = 'buyer_id') THEN
    RAISE EXCEPTION 'ROLE PARITY: the admin index view has no buyer_id';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name IN ('admin_direct_conversations_view','admin_direct_messages_view')
                AND (column_name ~* 'payout|margin|spread|price_cents|commission')) THEN
    RAISE EXCEPTION 'GR2: a money column leaked into an admin direct-chat view';
  END IF;
END
$verify$;

COMMIT;
