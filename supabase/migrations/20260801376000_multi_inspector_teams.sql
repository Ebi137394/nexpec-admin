-- ════════════════════════════════════════════════════════════════════════════
--  20260801376000_multi_inspector_teams.sql
--
--  MULTI-INSPECTOR JOBS — additive. Single-inspector jobs are untouched.
--
--  ── VERIFIED ABSENT BEFORE BUILDING ────────────────────────────────────────
--  No job_inspectors / inspector_team / co_inspector / crew object exists
--  anywhere in 120 migrations. `jobs` carries three single-inspector columns:
--  contractor_id, inspector_id, hired_inspector_id. This is genuinely new.
--
--  ── THE CENTRAL DESIGN DECISION ────────────────────────────────────────────
--  jobs.contractor_id REMAINS THE CONTRACTED INSPECTOR and is NOT touched by
--  anything here. It is the anchor for settlement, identity disclosure,
--  contracts and price blindness — every one of those systems reads it, and
--  moving it would ripple into the frozen payment domain.
--
--  job_inspectors is therefore the OPERATIONAL TEAM layer sitting beside it:
--      contractor_id  → who is contracted and paid (unchanged, manual)
--      job_inspectors → who actually works the job, in what discipline
--
--  A job with no job_inspectors rows behaves EXACTLY as it does today. The
--  reader function falls back to contractor_id, so every existing job is
--  automatically a valid one-inspector "team" with no backfill and no
--  migration of live data.
--
--  ── PAYMENT UNCHANGED ──────────────────────────────────────────────────────
--  Adding a team member creates NO payout, NO transaction, NO wallet effect and
--  does NOT touch admin_confirmed_at or any *_cents column. Settlement stays
--  manual and admin-initiated. Self-tested.
--
--  ── PRIVACY / IDENTITY ─────────────────────────────────────────────────────
--  Team membership names inspectors, so RLS does NOT expose the table to
--  clients. Buyers reach team composition only through
--  nx_job_inspector_team_public(), which respects
--  nx_job_effective_identity_mode() exactly as the rest of the product does:
--  under 'protected' the client sees roles and counts but never an identity.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) The team table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_inspectors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES public.jobs(id)     ON DELETE CASCADE,
  inspector_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role          text NOT NULL DEFAULT 'inspector',
  specialty_slug text,
  status        text NOT NULL DEFAULT 'assigned',
  is_lead       boolean NOT NULL DEFAULT false,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  assigned_by   uuid REFERENCES public.profiles(id),
  removed_at    timestamptz,
  removed_by    uuid REFERENCES public.profiles(id),
  -- Replacement history: the row this member superseded. Never deleted, so the
  -- full assignment history of a job is reconstructable.
  replaces_id   uuid REFERENCES public.job_inspectors(id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_inspectors_role_check CHECK (role = ANY (ARRAY[
    'lead','inspector','mechanical','electrical','welding_ndt',
    'coating','civil','specialist','trainee','observer'])),
  CONSTRAINT job_inspectors_status_check CHECK (status = ANY (ARRAY[
    'assigned','active','completed','replaced','removed'])),
  -- removal is recorded as a pair or not at all
  CONSTRAINT job_inspectors_removal_pair CHECK (
    (removed_at IS NULL AND removed_by IS NULL)
    OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)),
  -- a member who is gone must say so in status
  CONSTRAINT job_inspectors_removed_status CHECK (
    removed_at IS NULL OR status IN ('replaced','removed','completed'))
);

-- One ACTIVE membership per inspector per job. Historical rows are exempt, so
-- an inspector can be removed and later re-added without tripping this.
CREATE UNIQUE INDEX IF NOT EXISTS job_inspectors_one_active_idx
  ON public.job_inspectors (job_id, inspector_id)
  WHERE status IN ('assigned','active');

-- At most ONE lead per job among active members.
CREATE UNIQUE INDEX IF NOT EXISTS job_inspectors_one_lead_idx
  ON public.job_inspectors (job_id)
  WHERE is_lead AND status IN ('assigned','active');

CREATE INDEX IF NOT EXISTS job_inspectors_job_idx       ON public.job_inspectors (job_id, status);
CREATE INDEX IF NOT EXISTS job_inspectors_inspector_idx ON public.job_inspectors (inspector_id, status);

COMMENT ON TABLE public.job_inspectors IS
  'Operational inspection team for a job. ADDITIVE: jobs.contractor_id remains the contracted inspector and the anchor for settlement, identity disclosure and contracts. A job with no rows here behaves exactly as before — readers fall back to contractor_id. Adding a member moves no money.';

-- keep updated_at honest
CREATE OR REPLACE FUNCTION public.tg_touch_job_inspectors() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $t$
BEGIN NEW.updated_at := now(); RETURN NEW; END $t$;

DROP TRIGGER IF EXISTS trg_touch_job_inspectors ON public.job_inspectors;
CREATE TRIGGER trg_touch_job_inspectors
  BEFORE UPDATE ON public.job_inspectors
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_job_inspectors();

-- ── 2) RLS — team membership names inspectors, so no client read ────────────
ALTER TABLE public.job_inspectors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_inspectors_read ON public.job_inspectors;
CREATE POLICY job_inspectors_read ON public.job_inspectors
  FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    -- an inspector sees their own membership …
    OR inspector_id = auth.uid()
    -- … and their teammates on a job they are actively on
    OR EXISTS (
      SELECT 1 FROM public.job_inspectors me
       WHERE me.job_id = job_inspectors.job_id
         AND me.inspector_id = auth.uid()
         AND me.status IN ('assigned','active'))
    -- the contracted inspector sees the team even before joining it
    OR EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = job_inspectors.job_id
         AND j.contractor_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policy: writes go exclusively through the
-- admin-gated SECURITY DEFINER RPCs below.
REVOKE ALL ON TABLE public.job_inspectors FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.job_inspectors TO authenticated;
GRANT ALL    ON TABLE public.job_inspectors TO service_role;

-- ── 3) Canonical reader, with single-inspector fallback ─────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_inspectors(p_job_id uuid)
RETURNS TABLE (
  inspector_id uuid,
  full_name    text,
  role         text,
  specialty_slug text,
  status       text,
  is_lead      boolean,
  assigned_at  timestamptz,
  is_contracted boolean,
  from_fallback boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_job  RECORD;
  v_n    int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT j.contractor_id, j.client_id, j.agency_id INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  -- Authorization: admin, a job party, or a team member.
  IF NOT (
      public.nx_is_admin()
      OR v_uid = v_job.contractor_id
      OR v_uid IS NOT DISTINCT FROM v_job.client_id
      OR v_uid IS NOT DISTINCT FROM v_job.agency_id
      OR EXISTS (SELECT 1 FROM public.job_inspectors ji
                  WHERE ji.job_id = p_job_id AND ji.inspector_id = v_uid
                    AND ji.status IN ('assigned','active'))
  ) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  SELECT count(*) INTO v_n FROM public.job_inspectors ji
   WHERE ji.job_id = p_job_id AND ji.status IN ('assigned','active');

  IF v_n = 0 THEN
    -- FALLBACK: every pre-existing single-inspector job is a valid team of one.
    IF v_job.contractor_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
      SELECT p.id, p.full_name, 'lead'::text, NULL::text, 'active'::text,
             true, NULL::timestamptz, true, true
        FROM public.profiles p WHERE p.id = v_job.contractor_id;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT ji.inspector_id, p.full_name, ji.role, ji.specialty_slug, ji.status,
           ji.is_lead, ji.assigned_at,
           (ji.inspector_id IS NOT DISTINCT FROM v_job.contractor_id),
           false
      FROM public.job_inspectors ji
      LEFT JOIN public.profiles p ON p.id = ji.inspector_id
     WHERE ji.job_id = p_job_id AND ji.status IN ('assigned','active')
     ORDER BY ji.is_lead DESC, ji.assigned_at;
END $fn$;

ALTER FUNCTION public.nx_job_inspectors(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_inspectors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_inspectors(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_inspectors(uuid) IS
  'The job team. Falls back to jobs.contractor_id when no explicit team exists, so every pre-existing single-inspector job reads as a team of one with no backfill. Returns no pricing column.';

-- ── 4) Client-facing view of the team, identity-mode aware ──────────────────
CREATE OR REPLACE FUNCTION public.nx_job_inspector_team_public(p_job_id uuid)
RETURNS TABLE (role text, specialty_slug text, is_lead boolean, display_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_mode text;
  v_job  RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;
  SELECT j.client_id, j.agency_id INTO v_job FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not found' USING errcode = 'P0002'; END IF;
  IF NOT (public.nx_is_admin()
          OR v_uid IS NOT DISTINCT FROM v_job.client_id
          OR v_uid IS NOT DISTINCT FROM v_job.agency_id) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  v_mode := public.nx_job_effective_identity_mode(p_job_id);

  RETURN QUERY
    SELECT t.role, t.specialty_slug, t.is_lead,
           CASE WHEN public.nx_is_admin() OR v_mode IN ('professional','full')
                THEN t.full_name
                ELSE NULL END
      FROM public.nx_job_inspectors(p_job_id) t;
END $fn$;

ALTER FUNCTION public.nx_job_inspector_team_public(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_inspector_team_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_inspector_team_public(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_inspector_team_public(uuid) IS
  'Buyer-facing team composition. Roles and counts always; NAMES only when nx_job_effective_identity_mode() permits (professional/full) or the caller is an admin. Under protected mode the client sees the shape of the team but no identity.';

-- ── 5) Admin team management ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_add_inspector(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_role         text    DEFAULT 'inspector',
  p_specialty    text    DEFAULT NULL,
  p_is_lead      boolean DEFAULT false,
  p_note         text    DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_job   RECORD;
  v_prof  RECORD;
  v_id    uuid;
  v_conflicts int := 0;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT j.id, j.client_id, j.agency_id, j.contractor_id, j.scheduled_date
    INTO v_job FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not found' USING errcode = 'P0002'; END IF;

  SELECT p.id, p.role, p.full_name INTO v_prof
    FROM public.profiles p WHERE p.id = p_inspector_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inspector not found' USING errcode = 'P0002'; END IF;
  IF v_prof.role NOT IN ('inspector','senior','agency') THEN
    RAISE EXCEPTION 'profile % is not an inspector (role %)', p_inspector_id, v_prof.role
      USING errcode = '22023';
  END IF;

  -- The buyer side of a job may never be a member of its own inspection team.
  IF p_inspector_id IS NOT DISTINCT FROM v_job.client_id
     OR p_inspector_id IS NOT DISTINCT FROM v_job.agency_id THEN
    RAISE EXCEPTION 'the job owner cannot be an inspector on their own job'
      USING errcode = '42501';
  END IF;

  -- Idempotent: already an active member → return it unchanged.
  SELECT ji.id INTO v_id FROM public.job_inspectors ji
   WHERE ji.job_id = p_job_id AND ji.inspector_id = p_inspector_id
     AND ji.status IN ('assigned','active');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'membership_id', v_id, 'idempotent', true);
  END IF;

  -- SCHEDULING CONFLICT: same calendar day, another active assignment.
  -- Reported, not blocked — the admin decides, exactly as elsewhere in dispatch.
  IF v_job.scheduled_date IS NOT NULL THEN
    SELECT count(*) INTO v_conflicts
      FROM public.job_inspectors ji
      JOIN public.jobs j2 ON j2.id = ji.job_id
     WHERE ji.inspector_id = p_inspector_id
       AND ji.status IN ('assigned','active')
       AND j2.id <> p_job_id
       AND j2.scheduled_date IS NOT NULL
       AND j2.scheduled_date::date = v_job.scheduled_date::date;
  END IF;

  IF p_is_lead THEN
    -- Demote any existing lead; the partial unique index enforces the invariant.
    UPDATE public.job_inspectors
       SET is_lead = false
     WHERE job_id = p_job_id AND is_lead AND status IN ('assigned','active');
  END IF;

  INSERT INTO public.job_inspectors
    (job_id, inspector_id, role, specialty_slug, status, is_lead, assigned_by, note)
  VALUES (p_job_id, p_inspector_id,
          CASE WHEN p_is_lead THEN 'lead' ELSE COALESCE(NULLIF(btrim(p_role), ''), 'inspector') END,
          NULLIF(btrim(coalesce(p_specialty, '')), ''),
          'assigned', COALESCE(p_is_lead, false), v_admin,
          NULLIF(btrim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.job_events (job_id, actor_id, event_type, metadata)
    VALUES (p_job_id, v_admin, 'contractor_assigned',
            jsonb_build_object('area','job_inspectors','action','add',
                               'membership_id', v_id, 'inspector_id', p_inspector_id,
                               'role', p_role, 'is_lead', p_is_lead,
                               'schedule_conflicts', v_conflicts));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'job_inspectors audit failed: %', SQLERRM;
  END;

  BEGIN
    PERFORM public.notify_safe(p_inspector_id, 'assignment',
      'You have been added to an inspection team',
      'You were assigned to a job as ' || COALESCE(NULLIF(p_role,''),'inspector') || '.',
      '/inspector/jobs/' || p_job_id::text, p_job_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'job_inspectors notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'membership_id', v_id,
                            'schedule_conflicts', v_conflicts);
END $fn$;

ALTER FUNCTION public.nx_job_add_inspector(uuid, uuid, text, text, boolean, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_add_inspector(uuid, uuid, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_add_inspector(uuid, uuid, text, text, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_job_remove_inspector(
  p_job_id uuid, p_inspector_id uuid, p_reason text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  UPDATE public.job_inspectors
     SET status = 'removed', removed_at = now(), removed_by = v_admin,
         is_lead = false,
         note = COALESCE(NULLIF(btrim(coalesce(p_reason,'')), ''), note)
   WHERE job_id = p_job_id AND inspector_id = p_inspector_id
     AND status IN ('assigned','active')
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
                              'detail', 'no active membership');
  END IF;

  BEGIN
    INSERT INTO public.job_events (job_id, actor_id, event_type, metadata)
    VALUES (p_job_id, v_admin, 'contractor_unassigned',
            jsonb_build_object('area','job_inspectors','action','remove',
                               'membership_id', v_id, 'inspector_id', p_inspector_id,
                               'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'job_inspectors audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'membership_id', v_id);
END $fn$;

ALTER FUNCTION public.nx_job_remove_inspector(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_remove_inspector(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_remove_inspector(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_job_replace_team_member(
  p_job_id uuid, p_outgoing uuid, p_incoming uuid, p_reason text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_admin uuid := auth.uid();
  v_old   RECORD;
  v_new   uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  SELECT * INTO v_old FROM public.job_inspectors
   WHERE job_id = p_job_id AND inspector_id = p_outgoing
     AND status IN ('assigned','active') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active membership for the outgoing inspector' USING errcode = 'P0002';
  END IF;

  -- Mark the outgoing member REPLACED — never deleted, so history survives.
  UPDATE public.job_inspectors
     SET status = 'replaced', removed_at = now(), removed_by = v_admin, is_lead = false,
         note = COALESCE(NULLIF(btrim(coalesce(p_reason,'')), ''), note)
   WHERE id = v_old.id;

  PERFORM public.nx_job_add_inspector(p_job_id, p_incoming, v_old.role,
                                      v_old.specialty_slug, v_old.is_lead, p_reason);

  SELECT id INTO v_new FROM public.job_inspectors
   WHERE job_id = p_job_id AND inspector_id = p_incoming
     AND status IN ('assigned','active');

  UPDATE public.job_inspectors SET replaces_id = v_old.id WHERE id = v_new;

  RETURN jsonb_build_object('ok', true, 'replaced_membership_id', v_old.id,
                            'new_membership_id', v_new);
END $fn$;

ALTER FUNCTION public.nx_job_replace_team_member(uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_replace_team_member(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_replace_team_member(uuid, uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_job_set_lead(p_job_id uuid, p_inspector_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE v_n int;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;
  UPDATE public.job_inspectors SET is_lead = false
   WHERE job_id = p_job_id AND is_lead AND status IN ('assigned','active');
  UPDATE public.job_inspectors SET is_lead = true, role = 'lead'
   WHERE job_id = p_job_id AND inspector_id = p_inspector_id
     AND status IN ('assigned','active');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'inspector is not an active member of this job' USING errcode = 'P0002';
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'lead', p_inspector_id);
END $fn$;

ALTER FUNCTION public.nx_job_set_lead(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_set_lead(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_set_lead(uuid, uuid) TO authenticated, service_role;

-- ── 6) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dadd text := pg_get_functiondef('public.nx_job_add_inspector(uuid,uuid,text,text,boolean,text)'::regprocedure);
  dpub text := pg_get_functiondef('public.nx_job_inspector_team_public(uuid)'::regprocedure);
BEGIN
  IF to_regclass('public.job_inspectors') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: job_inspectors was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='job_inspectors' AND rowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: RLS is not enabled on job_inspectors';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='job_inspectors_one_lead_idx') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the single-lead invariant index is missing';
  END IF;

  -- PAYMENT: team management must never touch money.
  IF dadd ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents|balance)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nx_job_add_inspector touches a money surface';
  END IF;

  -- PRIVACY: the buyer-facing reader must consult the identity mode.
  IF position('nx_job_effective_identity_mode' IN dpub) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the client-facing team view ignores identity mode';
  END IF;

  -- BACKWARD COMPATIBILITY: contractor_id must not be written anywhere here.
  IF dadd ~* 'UPDATE\s+public\.jobs' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: team management mutates public.jobs — contractor_id must stay the settlement anchor';
  END IF;

  -- No direct client write path to the table.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='job_inspectors' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a non-SELECT policy exists — writes must go through the admin RPCs';
  END IF;

  RAISE NOTICE 'multi-inspector teams ready: additive, contractor_id untouched, money-free, identity-aware.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
