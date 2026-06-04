-- ════════════════════════════════════════════════════════════════════════════
--  20260801122800_brokered_war_room.sql
--
--  CROSS-PARTY MEETING HUB — "Brokered War Room"
--
--  Schedule / share / launch a video link (Zoom · Teams · Meet · Jitsi) inside a
--  Job or RFQ workspace. BYO-link → $0, provider-agnostic, no OAuth: NEXPEC
--  stores, shares, notifies, launches, and AUDITS the link; it never hosts video.
--
--  ⚠ GOLDEN-RULE GUARD (the whole point): NEXPEC forbids direct client↔inspector
--  contact (anti-poaching). So any meeting whose participants include BOTH a
--  buyer-side party (client/agency/enterprise) AND an inspector-side party
--  (inspector/senior) MUST include an admin host in the room — enforced in
--  schedule_meeting(), not the UI. A naive cross-party call becomes a
--  NEXPEC-brokered war room; the broker stays on the call.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Meetings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_meetings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  rfq_id       uuid REFERENCES public.supplier_rfqs(id) ON DELETE CASCADE,
  organizer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title        text NOT NULL,
  provider     text NOT NULL DEFAULT 'other' CHECK (provider IN ('zoom','teams','meet','jitsi','other')),
  url          text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_min integer NOT NULL DEFAULT 30,
  status       text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- a meeting attaches to a Job or an RFQ (at least one)
  CONSTRAINT job_meetings_anchor_chk CHECK (job_id IS NOT NULL OR rfq_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS job_meetings_job_idx ON public.job_meetings (job_id, scheduled_at DESC) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_meetings_rfq_idx ON public.job_meetings (rfq_id, scheduled_at DESC) WHERE rfq_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.job_meeting_participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.job_meetings(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  party_role text NOT NULL CHECK (party_role IN ('client','inspector','vendor','admin')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS jmp_meeting_idx ON public.job_meeting_participants (meeting_id);
CREATE INDEX IF NOT EXISTS jmp_user_idx    ON public.job_meeting_participants (user_id);

-- ── 2) RLS — a participant (or organizer, or admin) sees a meeting ───────────
ALTER TABLE public.job_meetings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_meeting_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meetings_read ON public.job_meetings;
CREATE POLICY meetings_read ON public.job_meetings FOR SELECT USING (
  organizer_id = auth.uid()
  OR public.nx_is_admin()
  OR EXISTS (SELECT 1 FROM public.job_meeting_participants p WHERE p.meeting_id = job_meetings.id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS meeting_participants_read ON public.job_meeting_participants;
CREATE POLICY meeting_participants_read ON public.job_meeting_participants FOR SELECT USING (
  user_id = auth.uid()
  OR public.nx_is_admin()
  OR EXISTS (SELECT 1 FROM public.job_meeting_participants me WHERE me.meeting_id = job_meeting_participants.meeting_id AND me.user_id = auth.uid())
);

GRANT SELECT ON public.job_meetings, public.job_meeting_participants TO authenticated;

-- ── 3) schedule_meeting — convene + GOLDEN-RULE guard + notify ───────────────
CREATE OR REPLACE FUNCTION public.schedule_meeting(
  p_title        text,
  p_url          text,
  p_scheduled_at timestamptz,
  p_participant_ids uuid[],
  p_job_id       uuid DEFAULT NULL,
  p_rfq_id       uuid DEFAULT NULL,
  p_provider     text DEFAULT 'other',
  p_duration_min integer DEFAULT 30
) RETURNS public.job_meetings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_all          uuid[];
  v_has_buyer    boolean;
  v_has_inspector boolean;
  v_has_admin    boolean;
  v_meeting      public.job_meetings;
  v_pid          uuid;
  v_link         text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(p_title,'') = '' THEN RAISE EXCEPTION 'title_required'; END IF;
  IF coalesce(p_url,'') !~* '^https?://' THEN RAISE EXCEPTION 'valid_meeting_url_required'; END IF;
  IF p_job_id IS NULL AND p_rfq_id IS NULL THEN RAISE EXCEPTION 'job_or_rfq_required'; END IF;
  IF p_provider NOT IN ('zoom','teams','meet','jitsi','other') THEN p_provider := 'other'; END IF;

  -- participant set always includes the organizer
  v_all := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_participant_ids,'{}') || v_uid) AS x WHERE x IS NOT NULL);

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

REVOKE ALL ON FUNCTION public.schedule_meeting(text,text,timestamptz,uuid[],uuid,uuid,text,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.schedule_meeting(text,text,timestamptz,uuid[],uuid,uuid,text,integer) TO authenticated;

-- ── 4) cancel_meeting — organizer or admin ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_meeting(p_meeting_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_m public.job_meetings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_m FROM public.job_meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_meeting'; END IF;
  IF NOT (v_m.organizer_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.job_meetings SET status = 'cancelled', updated_at = now() WHERE id = p_meeting_id;
END $$;

REVOKE ALL ON FUNCTION public.cancel_meeting(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_meeting(uuid) TO authenticated;

-- ── 5) SELF-TEST ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.schedule_meeting(text,text,timestamptz,uuid[],uuid,uuid,text,integer)') IS NULL THEN RAISE EXCEPTION 'SELFTEST schedule_meeting missing'; END IF;
  IF to_regprocedure('public.cancel_meeting(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST cancel_meeting missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_meetings' AND policyname='meetings_read') THEN RAISE EXCEPTION 'SELFTEST meetings RLS missing'; END IF;
  RAISE NOTICE 'Brokered War Room installed: meetings + participants + golden-rule schedule_meeting + cancel + RLS.';
END $$;

COMMIT;
