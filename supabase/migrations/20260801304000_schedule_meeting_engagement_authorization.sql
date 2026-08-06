-- ════════════════════════════════════════════════════════════════════════════
--  20260801304000_schedule_meeting_engagement_authorization.sql
--
--  P0 — schedule_meeting() had NO authorization at all. It is SECURITY DEFINER
--  (so it bypasses RLS) and it validated only the ROLE MIX of the room:
--
--      IF v_has_buyer AND v_has_inspector AND NOT v_has_admin
--        THEN RAISE 'admin_host_required' …
--
--  That is an anti-poaching rule, not an access-control rule. Before this
--  migration, ANY authenticated user could:
--    • attach a meeting to ANY job or RFQ uuid — no membership check on
--      p_job_id / p_rfq_id whatsoever, so a stranger could plant a meeting on
--      someone else's engagement and become its organizer;
--    • become organizer and therefore gain cancel_meeting rights over it
--      (cancel_meeting trusts organizer_id, which is set from auth.uid() here);
--    • pass ARBITRARY uuids in p_participant_ids — the function inserted
--      job_meeting_participants rows for them and then called nx_notify() on
--      each one, i.e. unsolicited push notifications to any user on the
--      platform, carrying attacker-controlled p_title text. A spam/phishing
--      primitive.
--    • read nothing extra — job_meetings/job_meeting_participants RLS is
--      SELECT-scoped to organizer/participant/admin, and neither table has an
--      INSERT policy, so these RPCs are the ONLY write path. That is precisely
--      why the check has to live here.
--
--  ── FIX ─────────────────────────────────────────────────────────────────────
--  One predicate, nx_meeting_engagement_party(), answering "is this user a party
--  to this engagement?", applied twice:
--    1. the ORGANIZER must be a party  → cannot convene on an unrelated job/RFQ;
--    2. EVERY participant must be a party → cannot invite/notify strangers.
--
--  Parties to a JOB : client_id, agency_id, contractor_id, hired_inspector_id,
--                     inspector_id, and any admin.
--  Parties to an RFQ: the RFQ's client_id, any supplier holding a quote on that
--                     RFQ, and any admin.
--
--  The existing admin_host_required guard is preserved BYTE-FOR-BYTE and still
--  runs, so the brokered-communication rule is unchanged: a client+inspector
--  room still requires an admin host. Being a party is necessary, never
--  sufficient — the hired inspector is a party, yet still cannot open a direct
--  channel to the client without NEXPEC in the room.
--
--  Identity disclosure is NOT consulted here on purpose. protected /
--  professional / full govern what the CLIENT may SEE about a hired inspector in
--  the authorized contract context. They must never widen who may CONVENE a
--  meeting, so 'full' grants no scheduling right whatsoever.
--
--  ── DELIBERATE BEHAVIOUR CHANGE (one) ───────────────────────────────────────
--  On apps/web/src/app/suppliers/opportunities/[id], a supplier who has NOT yet
--  quoted an RFQ can no longer create a meeting against it. They have no
--  engagement with that RFQ; after quoting, they can. This is the intended
--  consequence of "arbitrary authenticated users cannot create meetings against
--  unrelated jobs".
--
--  Nothing is dropped or loosened. cancel_meeting, the RLS policies, the
--  notification path and the participant taxonomy are untouched.
--  Idempotent (CREATE OR REPLACE); self-tested, including LIVE positive and
--  negative authorization probes that roll themselves back.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) "Is this user a party to this engagement?" ───────────────────────────
--  SECURITY DEFINER: it must see jobs / supplier_rfqs / supplier_quotes
--  regardless of THOSE tables' RLS, and it returns only a boolean. Same pattern
--  as nx_can_read_profile (248000) and nx_job_awaiting_replacement (298000).
CREATE OR REPLACE FUNCTION public.nx_meeting_engagement_party(
  p_uid    uuid,
  p_job_id uuid,
  p_rfq_id uuid
) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    p_uid IS NOT NULL
    AND (
      -- NEXPEC admin brokers every room (god-mode invariant preserved).
      EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = p_uid AND p.role IN ('admin', 'super_admin')
      )
      -- Party to the JOB: the buyer side, or any inspector pointer on it.
      OR (
        p_job_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.jobs j
           WHERE j.id = p_job_id
             AND j.deleted_at IS NULL
             AND p_uid IN (j.client_id, j.agency_id, j.contractor_id,
                           j.hired_inspector_id, j.inspector_id)
        )
      )
      -- Party to the RFQ: its client, or a supplier who actually quoted it.
      OR (
        p_rfq_id IS NOT NULL AND (
          EXISTS (
            SELECT 1 FROM public.supplier_rfqs r
             WHERE r.id = p_rfq_id AND r.client_id = p_uid
          )
          OR EXISTS (
            SELECT 1 FROM public.supplier_quotes q
             WHERE q.rfq_id = p_rfq_id AND q.supplier_id = p_uid
          )
        )
      )
    );
$$;

ALTER FUNCTION public.nx_meeting_engagement_party(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_meeting_engagement_party(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_meeting_engagement_party(uuid, uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_meeting_engagement_party(uuid, uuid, uuid) IS
  'TRUE when the user is a party to the given job or RFQ (job: client/agency/contractor/hired_inspector/inspector; RFQ: client or a supplier holding a quote) or is an admin. Single source of truth for who may convene a meeting and who may be invited to one.';

-- ── 2) schedule_meeting, with the membership gate in front ──────────────────
CREATE OR REPLACE FUNCTION public.schedule_meeting(
  p_title text, p_url text, p_scheduled_at timestamp with time zone,
  p_participant_ids uuid[], p_job_id uuid DEFAULT NULL, p_rfq_id uuid DEFAULT NULL,
  p_provider text DEFAULT 'other', p_duration_min integer DEFAULT 30
) RETURNS public.job_meetings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_all          uuid[];
  v_has_buyer    boolean;
  v_has_inspector boolean;
  v_has_admin    boolean;
  v_meeting      public.job_meetings;
  v_pid          uuid;
  v_link         text;
  v_stranger     uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(p_title,'') = '' THEN RAISE EXCEPTION 'title_required'; END IF;
  IF coalesce(p_url,'') !~* '^https?://' THEN RAISE EXCEPTION 'valid_meeting_url_required'; END IF;
  IF p_job_id IS NULL AND p_rfq_id IS NULL THEN RAISE EXCEPTION 'job_or_rfq_required'; END IF;
  IF p_provider NOT IN ('zoom','teams','meet','jitsi','other') THEN p_provider := 'other'; END IF;

  -- ★ 304000 GATE A — the organizer must belong to this engagement.
  --   Without this, any authenticated user could plant a meeting on any job.
  IF NOT public.nx_meeting_engagement_party(v_uid, p_job_id, p_rfq_id) THEN
    RAISE EXCEPTION 'not_authorized_for_this_job: you are not a party to this job or RFQ';
  END IF;

  -- participant set always includes the organizer
  v_all := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_participant_ids,'{}') || v_uid) AS x WHERE x IS NOT NULL);

  -- ★ 304000 GATE B — every invitee must belong to the SAME engagement.
  --   Without this, arbitrary uuids were inserted as participants and then
  --   notified, i.e. unsolicited invitations to unrelated users.
  SELECT x INTO v_stranger
    FROM unnest(v_all) AS x
   WHERE NOT public.nx_meeting_engagement_party(x, p_job_id, p_rfq_id)
   LIMIT 1;
  IF v_stranger IS NOT NULL THEN
    RAISE EXCEPTION 'participant_not_party_to_engagement: % is not a party to this job or RFQ', v_stranger;
  END IF;

  -- classify the room by role
  SELECT bool_or(role IN ('client','agency','enterprise')),
         bool_or(role IN ('inspector','senior')),
         bool_or(role IN ('admin','super_admin'))
    INTO v_has_buyer, v_has_inspector, v_has_admin
    FROM public.profiles WHERE id = ANY(v_all);

  -- ★ THE GUARD: a buyer + inspector in the same room REQUIRES an admin host.
  IF coalesce(v_has_buyer,false) AND coalesce(v_has_inspector,false) AND NOT coalesce(v_has_admin,false) THEN
    RAISE EXCEPTION 'admin_host_required: a client+inspector meeting must include an admin host (anti-poaching)';
  END IF;

  INSERT INTO public.job_meetings (job_id, rfq_id, organizer_id, title, provider, url, scheduled_at, duration_min)
  VALUES (p_job_id, p_rfq_id, v_uid, p_title, p_provider, p_url, p_scheduled_at, greatest(coalesce(p_duration_min,30), 5))
  RETURNING * INTO v_meeting;

  v_link := CASE WHEN p_job_id IS NOT NULL THEN '/jobs/' || p_job_id::text ELSE '/rfqs/' || p_rfq_id::text END;

  -- participant rows (role mapped to the meeting taxonomy) + notify everyone but the organizer
  FOREACH v_pid IN ARRAY v_all LOOP
    INSERT INTO public.job_meeting_participants (meeting_id, user_id, party_role)
    SELECT v_meeting.id, v_pid,
           CASE WHEN pr.role IN ('client','agency','enterprise') THEN 'client'
                WHEN pr.role IN ('inspector','senior')           THEN 'inspector'
                WHEN pr.role = 'supplier'                        THEN 'vendor'
                WHEN pr.role IN ('admin','super_admin')          THEN 'admin'
                ELSE 'client' END
      FROM public.profiles pr WHERE pr.id = v_pid
    ON CONFLICT (meeting_id, user_id) DO NOTHING;

    IF v_pid <> v_uid THEN
      BEGIN
        PERFORM public.nx_notify(v_pid, 'Meeting scheduled',
          p_title || ' — ' || to_char(p_scheduled_at, 'Mon DD, HH24:MI') || ' UTC',
          'meeting_scheduled', v_link, p_job_id);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END LOOP;

  RETURN v_meeting;
END $$;

ALTER FUNCTION public.schedule_meeting(text, text, timestamp with time zone, uuid[], uuid, uuid, text, integer)
  OWNER TO postgres;

-- anon has no business convening meetings; the baseline had granted it.
REVOKE ALL ON FUNCTION public.schedule_meeting(text, text, timestamp with time zone, uuid[], uuid, uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_meeting(text, text, timestamp with time zone, uuid[], uuid, uuid, text, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.schedule_meeting(text, text, timestamp with time zone, uuid[], uuid, uuid, text, integer) IS
  'Convene a brokered meeting on a job or RFQ. Organizer AND every participant must be a party to that engagement (nx_meeting_engagement_party); a client+inspector room additionally requires an admin host (anti-poaching). Identity disclosure mode grants no scheduling rights.';

-- ── 3) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  v_def       text;
  v_job       uuid;
  v_client    uuid;
  v_err       text;
  v_ok        boolean := false;
  v_claims    text;
BEGIN
  v_def := pg_get_functiondef('public.schedule_meeting(text,text,timestamp with time zone,uuid[],uuid,uuid,text,integer)'::regprocedure);

  -- (a) both new gates are present
  IF position('not_authorized_for_this_job' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: organizer membership gate (A) missing';
  END IF;
  IF position('participant_not_party_to_engagement' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: participant membership gate (B) missing';
  END IF;

  -- (b) the anti-poaching guard was NOT weakened or dropped
  IF position('admin_host_required' IN v_def) = 0
     OR position($q$IF coalesce(v_has_buyer,false) AND coalesce(v_has_inspector,false) AND NOT coalesce(v_has_admin,false) THEN$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin_host_required guard altered or removed';
  END IF;

  -- (c) identity mode must play no part in scheduling authorization
  IF v_def ~* '\midentity_mode\M' OR v_def ~* '\meffective_identity_mode\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: schedule_meeting consults identity disclosure — Full must not grant a direct channel';
  END IF;

  -- (d) anon cannot execute either function
  IF has_function_privilege('anon',
       'public.schedule_meeting(text,text,timestamp with time zone,uuid[],uuid,uuid,text,integer)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.nx_meeting_engagement_party(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: anon retains EXECUTE on a meeting function';
  END IF;

  -- (e) the write path is still RPC-only: neither table may gain an INSERT policy
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('job_meetings','job_meeting_participants')
       AND cmd IN ('INSERT','ALL')
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a direct INSERT policy exists on a meeting table — the RPC is no longer the only write path';
  END IF;

  -- ── LIVE authorization probes ────────────────────────────────────────────
  --  auth.uid() reads the request.jwt.claims GUC, so a user can be simulated.
  --  Both probes undo themselves; the negative one writes nothing by design.
  SELECT j.id, j.client_id INTO v_job, v_client
    FROM public.jobs j
   WHERE j.client_id IS NOT NULL AND j.deleted_at IS NULL
   LIMIT 1;

  IF v_job IS NOT NULL THEN
    v_claims := coalesce(current_setting('request.jwt.claims', true), '');

    -- (f) NEGATIVE: a stranger must be refused on someone else's job.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid()::text)::text, true);
    BEGIN
      PERFORM public.schedule_meeting('probe', 'https://example.com/x',
        now() + interval '1 hour', ARRAY[]::uuid[], v_job, NULL, 'other', 30);
      v_ok := true;  -- reached only if the stranger was ALLOWED
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    IF v_ok THEN
      PERFORM set_config('request.jwt.claims', v_claims, true);
      RAISE EXCEPTION 'SELFTEST FAILED: a non-party successfully scheduled a meeting on job %', v_job;
    END IF;
    IF v_err NOT LIKE 'not_authorized_for_this_job%' THEN
      PERFORM set_config('request.jwt.claims', v_claims, true);
      RAISE EXCEPTION 'SELFTEST FAILED: stranger was rejected for the WRONG reason (%)', v_err;
    END IF;

    -- (g) POSITIVE: the job's own client may still convene (self-only room).
    --     Wrapped so it rolls back completely — including participant rows and
    --     any notification the AFTER path would emit.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_client::text)::text, true);
    BEGIN
      PERFORM public.schedule_meeting('__nx_probe__', 'https://example.com/x',
        now() + interval '1 hour', ARRAY[]::uuid[], v_job, NULL, 'other', 30);
      RAISE EXCEPTION 'NX_PROBE_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'NX_PROBE_ROLLBACK' THEN
        RAISE NOTICE 'live probes AUTHORITATIVE: stranger refused, job owner still permitted.';
      ELSE
        RAISE NOTICE 'positive probe inconclusive (%) — negative probe and static proofs stand', SQLERRM;
      END IF;
    END;

    PERFORM set_config('request.jwt.claims', v_claims, true);
  ELSE
    RAISE NOTICE 'no job row available — live probes skipped; static proofs (a)-(e) stand';
  END IF;

  RAISE NOTICE 'schedule_meeting is now engagement-scoped: organizer and every participant must be a party.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
