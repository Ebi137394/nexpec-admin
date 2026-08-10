-- ════════════════════════════════════════════════════════════════════════════
--  20260801398000_itp_points_foundation.sql
--
--  PHASE 3 — ITP (Inspection & Test Plan). Additive extension of the EXISTING
--  structured inspection architecture. There is no ITP v2 here because there
--  was no ITP v1: verified absent — no itp/hold_point/witness/checkpoint table,
--  no point_type or acceptance_criteria column, no ITP RPC anywhere in 135
--  migrations.
--
--  ── THE CANONICAL CONTRACT (frozen here before anything else is built) ─────
--  NEXPEC already has the two halves an ITP needs, and they are kept:
--      inspection_scope_templates        the reusable template catalogue
--      inspection_evidence_requirements  WHAT evidence to capture per template
--  What is missing is the QUALITY-CONTROL layer above them: at which stage does
--  work stop, who must attend, what is the acceptance criterion, and who signed.
--
--  So ITP adds exactly two tables and reuses everything else:
--      itp_points         DEFINITION, template-scoped. Reusable across jobs,
--                         exactly like the evidence requirements it sits beside
--                         and may point at.
--      itp_point_results  EXECUTION, per (job, visit, point). Attribution,
--                         result, sign-off, release.
--
--  Deliberate reuse rather than duplication:
--    • evidence          itp_points.evidence_requirement_id → the EXISTING
--                        inspection_evidence_requirements row. An ITP point does
--                        not re-declare what to photograph.
--    • visits            itp_point_results.visit_id → job_visits (nullable:
--                        NULL means job-level, the pre-visit meaning)
--    • inspectors        itp_point_results.inspector_id, gated by the SAME
--                        nx_is_active_job_team_member predicate as evidence
--    • NCR               a failed point raises an ordinary flash report through
--                        flash_report_create — no second NCR system, same
--                        decision as 20260801366000 for inspection items
--
--  ── POINT SEMANTICS ────────────────────────────────────────────────────────
--    normal        recorded and moves on
--    hold          WORK STOPS until an authorised party releases it. This is the
--                  only type that blocks, and it is the reason the type is not
--                  merely a label.
--    witness       a named party must attend; recorded with who witnessed
--    review        document/records review rather than physical inspection
--    surveillance  ongoing monitoring; recurring by nature, pairs with the
--                  surveillance visit kind from 20260801384000
--
--  ── WHAT THIS MIGRATION DOES NOT DO ────────────────────────────────────────
--  No money. Recording, signing off or releasing a point moves nothing and does
--  not touch admin_confirmed_at. Self-tested.
--  No QCP yet — Phase 4 builds on this, it is not pre-empted here.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) DEFINITION — the plan ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.itp_points (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES public.inspection_scope_templates(id) ON DELETE CASCADE,

  stage        text NOT NULL,
  sequence_no  int  NOT NULL,
  point_type   text NOT NULL DEFAULT 'normal',

  title        text NOT NULL,
  requirement  text,
  acceptance_criteria text,
  -- Free text on purpose: "the responsible party" is a contractual role
  -- (contractor / third-party / client rep / notified body) that varies per
  -- client and does not map onto a NEXPEC account.
  responsible_party   text,
  reference_document  text,

  -- REUSE, not redeclaration: the evidence this point expects is an existing
  -- inspection_evidence_requirements row.
  evidence_requirement_id uuid REFERENCES public.inspection_evidence_requirements(id) ON DELETE SET NULL,

  -- A hold point blocks by default; witness/review may require sign-off without
  -- blocking. Both are explicit so the behaviour is data, not inference.
  blocks_progress  boolean NOT NULL DEFAULT false,
  requires_signoff boolean NOT NULL DEFAULT false,

  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT itp_points_type_check CHECK (point_type = ANY (ARRAY[
    'normal','hold','witness','review','surveillance'])),
  CONSTRAINT itp_points_sequence_positive CHECK (sequence_no > 0),
  -- A hold point that does not block is a contradiction; catching it in the
  -- schema is cheaper than discovering it on site.
  CONSTRAINT itp_points_hold_blocks CHECK (point_type <> 'hold' OR blocks_progress)
);

CREATE UNIQUE INDEX IF NOT EXISTS itp_points_template_seq_idx
  ON public.itp_points (template_id, sequence_no) WHERE is_active;
CREATE INDEX IF NOT EXISTS itp_points_template_stage_idx
  ON public.itp_points (template_id, stage, sequence_no);

COMMENT ON TABLE public.itp_points IS
  'ITP point DEFINITION, scoped to an inspection_scope_template so one plan serves many jobs. Sits above inspection_evidence_requirements and may reference one rather than redeclaring what to capture. Only hold points block progress, enforced by itp_points_hold_blocks.';

-- ── 2) EXECUTION — what actually happened ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.itp_point_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id      uuid NOT NULL REFERENCES public.itp_points(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES public.jobs(id)       ON DELETE CASCADE,
  -- NULL = job-level, matching the meaning inspection_captures.visit_id already
  -- carries for pre-visit evidence.
  visit_id      uuid REFERENCES public.job_visits(id) ON DELETE SET NULL,

  result        text NOT NULL DEFAULT 'pending',
  inspector_id  uuid REFERENCES public.profiles(id),
  recorded_at   timestamptz,
  comments      text,

  -- Sign-off and release are DISTINCT: signing says "I attest this point was
  -- performed"; releasing says "work may continue past this hold". Conflating
  -- them would let an inspector release their own hold point.
  signed_off_by uuid REFERENCES public.profiles(id),
  signed_off_at timestamptz,
  witnessed_by  text,

  released_by   uuid REFERENCES public.profiles(id),
  released_at   timestamptz,
  release_note  text,

  -- The NCR raised from a failure, if any. Ordinary flash report.
  flash_report_id uuid REFERENCES public.flash_reports(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT itp_results_result_check CHECK (result = ANY (ARRAY[
    'pending','passed','failed','waived','not_applicable'])),
  CONSTRAINT itp_results_signoff_pair CHECK (
    (signed_off_by IS NULL AND signed_off_at IS NULL)
    OR (signed_off_by IS NOT NULL AND signed_off_at IS NOT NULL)),
  CONSTRAINT itp_results_release_pair CHECK (
    (released_by IS NULL AND released_at IS NULL)
    OR (released_by IS NOT NULL AND released_at IS NOT NULL)),
  CONSTRAINT itp_results_recorded_pair CHECK (
    result = 'pending' OR (inspector_id IS NOT NULL AND recorded_at IS NOT NULL))
);

-- One live result per point per job per visit. Job-level (visit_id NULL) needs
-- its own partial index because NULL is not equal to itself in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS itp_results_point_job_visit_idx
  ON public.itp_point_results (point_id, job_id, visit_id) WHERE visit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS itp_results_point_job_novisit_idx
  ON public.itp_point_results (point_id, job_id) WHERE visit_id IS NULL;
CREATE INDEX IF NOT EXISTS itp_results_job_idx    ON public.itp_point_results (job_id, result);
CREATE INDEX IF NOT EXISTS itp_results_visit_idx  ON public.itp_point_results (visit_id) WHERE visit_id IS NOT NULL;

COMMENT ON TABLE public.itp_point_results IS
  'ITP point EXECUTION per (job, visit, point). visit_id NULL means job-level, the same meaning inspection_captures.visit_id carries. Sign-off and release are separate columns on purpose: signing attests the point was performed, releasing permits work to continue past a hold — an inspector must not be able to release their own hold.';

CREATE OR REPLACE FUNCTION public.tg_touch_itp() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $t$
BEGIN NEW.updated_at := now(); RETURN NEW; END $t$;

DROP TRIGGER IF EXISTS trg_touch_itp_points ON public.itp_points;
CREATE TRIGGER trg_touch_itp_points BEFORE UPDATE ON public.itp_points
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_itp();
DROP TRIGGER IF EXISTS trg_touch_itp_results ON public.itp_point_results;
CREATE TRIGGER trg_touch_itp_results BEFORE UPDATE ON public.itp_point_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_itp();

-- ── 3) RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.itp_points        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itp_point_results ENABLE ROW LEVEL SECURITY;

-- The PLAN is not confidential: it is the quality scope a buyer is purchasing.
DROP POLICY IF EXISTS itp_points_read ON public.itp_points;
CREATE POLICY itp_points_read ON public.itp_points
  FOR SELECT TO authenticated USING (true);

-- RESULTS follow the job audience, exactly like evidence.
DROP POLICY IF EXISTS itp_results_read ON public.itp_point_results;
CREATE POLICY itp_results_read ON public.itp_point_results
  FOR SELECT TO authenticated
  USING (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = itp_point_results.job_id
         AND (auth.uid() = j.client_id OR auth.uid() = j.agency_id
              OR auth.uid() = j.contractor_id))
    OR public.nx_is_active_job_team_member(itp_point_results.job_id, auth.uid())
  );

-- Writing a result requires being ON the job right now — the same predicate
-- that governs evidence, so a removed inspector cannot record a point either.
DROP POLICY IF EXISTS itp_results_write ON public.itp_point_results;
CREATE POLICY itp_results_write ON public.itp_point_results
  FOR INSERT TO authenticated
  WITH CHECK (
    public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = itp_point_results.job_id AND j.contractor_id = auth.uid())
    OR public.nx_is_active_job_team_member(itp_point_results.job_id, auth.uid())
  );

REVOKE ALL ON TABLE public.itp_points        FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.itp_point_results FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.itp_points               TO authenticated;
GRANT SELECT, INSERT ON TABLE public.itp_point_results TO authenticated;
GRANT ALL ON TABLE public.itp_points         TO service_role;
GRANT ALL ON TABLE public.itp_point_results  TO service_role;

-- ── 4) Reader: the plan and its live state for a job ────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_itp(p_job_id uuid, p_visit_id uuid DEFAULT NULL)
RETURNS TABLE (
  point_id        uuid,
  stage           text,
  sequence_no     int,
  point_type      text,
  title           text,
  requirement     text,
  acceptance_criteria text,
  responsible_party   text,
  reference_document  text,
  blocks_progress boolean,
  requires_signoff boolean,
  result          text,
  inspector_id    uuid,
  recorded_at     timestamptz,
  signed_off_at   timestamptz,
  released_at     timestamptz,
  flash_report_id uuid,
  is_blocking_now boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT j.client_id, j.agency_id, j.contractor_id, j.scope_template_id
    INTO v_job FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  IF NOT (
    public.nx_is_admin()
    OR v_uid IS NOT DISTINCT FROM v_job.client_id
    OR v_uid IS NOT DISTINCT FROM v_job.agency_id
    OR v_uid IS NOT DISTINCT FROM v_job.contractor_id
    OR public.nx_is_active_job_team_member(p_job_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  IF v_job.scope_template_id IS NULL THEN
    RETURN;   -- no plan attached; a quality job simply has no ITP
  END IF;

  RETURN QUERY
    SELECT p.id, p.stage, p.sequence_no, p.point_type, p.title, p.requirement,
           p.acceptance_criteria, p.responsible_party, p.reference_document,
           p.blocks_progress, p.requires_signoff,
           COALESCE(r.result, 'pending'), r.inspector_id, r.recorded_at,
           r.signed_off_at, r.released_at, r.flash_report_id,
           -- Blocking NOW = a blocking point that is neither passed/waived/NA
           -- nor explicitly released.
           (p.blocks_progress
            AND COALESCE(r.result, 'pending') NOT IN ('passed','waived','not_applicable')
            AND r.released_at IS NULL)
      FROM public.itp_points p
      LEFT JOIN public.itp_point_results r
             ON r.point_id = p.id
            AND r.job_id  = p_job_id
            AND (r.visit_id IS NOT DISTINCT FROM p_visit_id)
     WHERE p.template_id = v_job.scope_template_id
       AND p.is_active
     ORDER BY p.stage, p.sequence_no;
END $fn$;

ALTER FUNCTION public.nx_job_itp(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_itp(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_itp(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_itp(uuid, uuid) IS
  'The ITP for a job (from its scope template) with live per-point state, optionally scoped to a visit. is_blocking_now marks an unreleased blocking point. Returns no pricing column. A job with no scope_template_id simply has no ITP.';

-- ── 5) Is the job held? ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_job_itp_blocking_points(p_job_id uuid, p_visit_id uuid DEFAULT NULL)
RETURNS int
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT count(*)::int FROM public.nx_job_itp(p_job_id, p_visit_id) t
   WHERE t.is_blocking_now;
$fn$;

ALTER FUNCTION public.nx_job_itp_blocking_points(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_itp_blocking_points(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_itp_blocking_points(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_itp_blocking_points(uuid, uuid) IS
  'How many hold points currently block progress. ADVISORY at this layer — it reports, it does not veto a job transition. Wiring it into the lifecycle is a separate, explicit decision.';

-- ── 6) Record a result ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_itp_record_result(
  p_point_id uuid,
  p_job_id   uuid,
  p_result   text,
  p_visit_id uuid DEFAULT NULL,
  p_comments text DEFAULT NULL,
  p_witnessed_by text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_point RECORD;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;
  IF p_result NOT IN ('pending','passed','failed','waived','not_applicable') THEN
    RAISE EXCEPTION 'invalid result %', p_result USING errcode = '22023';
  END IF;

  -- SAME authorisation as evidence: on the job right now, or admin.
  IF NOT (
    public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.contractor_id = v_uid)
    OR public.nx_is_active_job_team_member(p_job_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'not authorized to record on this job' USING errcode = '42501';
  END IF;

  SELECT * INTO v_point FROM public.itp_points WHERE id = p_point_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'itp point not found or inactive' USING errcode = 'P0002';
  END IF;

  -- A witness point must say who witnessed it, or the record is worthless.
  IF v_point.point_type = 'witness'
     AND p_result IN ('passed','failed')
     AND NULLIF(btrim(coalesce(p_witnessed_by, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a witness point requires who witnessed it' USING errcode = '22023';
  END IF;

  INSERT INTO public.itp_point_results
    (point_id, job_id, visit_id, result, inspector_id, recorded_at, comments, witnessed_by)
  VALUES (p_point_id, p_job_id, p_visit_id, p_result, v_uid, now(),
          NULLIF(btrim(coalesce(p_comments, '')), ''),
          NULLIF(btrim(coalesce(p_witnessed_by, '')), ''))
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- A result already exists for this (point, job, visit): update it in place.
    UPDATE public.itp_point_results
       SET result = p_result, inspector_id = v_uid, recorded_at = now(),
           comments = COALESCE(NULLIF(btrim(coalesce(p_comments,'')), ''), comments),
           witnessed_by = COALESCE(NULLIF(btrim(coalesce(p_witnessed_by,'')), ''), witnessed_by)
     WHERE point_id = p_point_id AND job_id = p_job_id
       AND visit_id IS NOT DISTINCT FROM p_visit_id
     RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'result_id', v_id, 'result', p_result,
                            'point_type', v_point.point_type,
                            'blocks_progress', v_point.blocks_progress);
END $fn$;

ALTER FUNCTION public.nx_itp_record_result(uuid, uuid, text, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_itp_record_result(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_itp_record_result(uuid, uuid, text, uuid, text, text) TO authenticated, service_role;

-- ── 7) Release a hold — NOT the recording inspector ─────────────────────────
CREATE OR REPLACE FUNCTION public.nx_itp_release_hold(
  p_result_id uuid, p_note text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.*, p.point_type, p.blocks_progress, j.client_id, j.agency_id
    INTO v_row
    FROM public.itp_point_results r
    JOIN public.itp_points p ON p.id = r.point_id
    JOIN public.jobs       j ON j.id = r.job_id
   WHERE r.id = p_result_id
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'itp result not found' USING errcode = 'P0002';
  END IF;

  IF NOT v_row.blocks_progress THEN
    RAISE EXCEPTION 'this point does not block progress; nothing to release'
      USING errcode = '22023';
  END IF;

  -- Releasing a hold is an ACCEPTANCE decision, not an inspection act. It
  -- belongs to the admin or the buyer side; the inspector who recorded the
  -- point must not be able to clear their own hold.
  IF NOT (public.nx_is_admin()
          OR v_uid IS NOT DISTINCT FROM v_row.client_id
          OR v_uid IS NOT DISTINCT FROM v_row.agency_id) THEN
    RAISE EXCEPTION 'only an admin or the buyer may release a hold point'
      USING errcode = '42501';
  END IF;

  IF v_row.released_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'result_id', p_result_id);
  END IF;

  UPDATE public.itp_point_results
     SET released_by = v_uid, released_at = now(),
         release_note = NULLIF(btrim(coalesce(p_note, '')), '')
   WHERE id = p_result_id;

  BEGIN
    INSERT INTO public.job_events (job_id, actor_id, event_type, metadata)
    VALUES (v_row.job_id, v_uid, 'status_change',
            jsonb_build_object('area','itp','action','release_hold',
                               'result_id', p_result_id, 'point_id', v_row.point_id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'itp release audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'result_id', p_result_id);
END $fn$;

ALTER FUNCTION public.nx_itp_release_hold(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_itp_release_hold(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_itp_release_hold(uuid, text) TO authenticated, service_role;

-- ── 8) Failed point → the EXISTING NCR system ───────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_raise_ncr_from_itp_point(
  p_result_id uuid,
  p_severity  text DEFAULT 'major',
  p_category  text DEFAULT 'defect',
  p_note      text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql
    -- SECURITY INVOKER on purpose, exactly as 20260801366000: running as the
    -- caller keeps flash_report_create's own job-party check the single source
    -- of authorisation. A definer here would silently bypass it.
    SECURITY INVOKER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_row   RECORD;
  v_res   jsonb;
  v_new   uuid;
  v_title text;
  v_desc  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.id, r.job_id, r.result, r.comments, r.flash_report_id,
         p.title, p.stage, p.acceptance_criteria, p.point_type
    INTO v_row
    FROM public.itp_point_results r
    JOIN public.itp_points p ON p.id = r.point_id
   WHERE r.id = p_result_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'itp result not found' USING errcode = 'P0002';
  END IF;

  IF v_row.flash_report_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'flash_report_id', v_row.flash_report_id,
                              'idempotent', true);
  END IF;

  IF v_row.result <> 'failed' THEN
    RAISE EXCEPTION 'only a FAILED ITP point can raise an NCR (result: %)', v_row.result
      USING errcode = '22023';
  END IF;

  v_title := left('ITP ' || v_row.point_type || ' point failed: ' || v_row.title, 200);
  -- flash_reports_description_len requires 20..5000 characters.
  v_desc  := 'An ITP point was recorded as FAILED.' || E'\n\n'
             || 'Stage: '  || COALESCE(NULLIF(btrim(v_row.stage), ''), 'unspecified') || E'\n'
             || 'Point: '  || COALESCE(NULLIF(btrim(v_row.title), ''), 'unspecified') || E'\n'
             || 'Acceptance criteria: '
             || COALESCE(NULLIF(btrim(v_row.acceptance_criteria), ''), 'not recorded') || E'\n'
             || 'Inspector comments: '
             || COALESCE(NULLIF(btrim(v_row.comments), ''), 'none') || E'\n'
             || COALESCE(E'\n' || btrim(p_note), '');

  v_res := public.flash_report_create(
    v_row.job_id, p_category, p_severity, v_title, v_desc, NULL, now());

  v_new := NULLIF(v_res->>'id', '')::uuid;
  IF v_new IS NULL THEN v_new := NULLIF(v_res->>'flash_report_id', '')::uuid; END IF;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'flash_report_create returned no id: %', v_res USING errcode = 'P0002';
  END IF;

  UPDATE public.itp_point_results SET flash_report_id = v_new WHERE id = p_result_id;

  RETURN jsonb_build_object('ok', true, 'flash_report_id', v_new, 'result_id', p_result_id);
END $fn$;

ALTER FUNCTION public.nx_raise_ncr_from_itp_point(uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_raise_ncr_from_itp_point(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_raise_ncr_from_itp_point(uuid, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_raise_ncr_from_itp_point(uuid, text, text, text) IS
  'Raises an NCR from a FAILED ITP point by delegating to the existing flash_report_create. No second NCR system, same decision as 20260801366000 for inspection items. SECURITY INVOKER so the existing job-party check applies. Idempotent per result.';

-- ── 9) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  drec text := pg_get_functiondef('public.nx_itp_record_result(uuid,uuid,text,uuid,text,text)'::regprocedure);
  drel text := pg_get_functiondef('public.nx_itp_release_hold(uuid,text)'::regprocedure);
  dncr text := pg_get_functiondef('public.nx_raise_ncr_from_itp_point(uuid,text,text,text)'::regprocedure);
BEGIN
  IF to_regclass('public.itp_points') IS NULL OR to_regclass('public.itp_point_results') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: ITP tables were not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                  AND tablename='itp_point_results' AND rowsecurity) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: RLS not enabled on itp_point_results';
  END IF;

  -- REUSE, not duplication: the definition must reference the existing
  -- evidence requirements rather than redeclaring evidence.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='itp_points'
                    AND column_name='evidence_requirement_id') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: itp_points does not reuse inspection_evidence_requirements';
  END IF;

  -- Recording uses the SAME team predicate as evidence.
  IF position('nx_is_active_job_team_member' IN drec) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: ITP recording does not use the canonical team predicate';
  END IF;

  -- SEPARATION OF DUTIES: release must not be open to the recording inspector.
  IF position('only an admin or the buyer may release' IN drel) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: hold release is not restricted to admin/buyer';
  END IF;

  -- NCR: delegate, never write flash_reports directly.
  IF position('flash_report_create' IN dncr) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP NCR bridge does not delegate to flash_report_create';
  END IF;
  IF dncr ~* 'INSERT\s+INTO\s+(public\.)?flash_reports\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP NCR bridge writes flash_reports directly — that is NCR v2';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='nx_raise_ncr_from_itp_point' AND prosecdef) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the NCR bridge is SECURITY DEFINER and would bypass authorisation';
  END IF;

  -- MONEY-FREE.
  IF drec ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents)\M'
     OR drel ~* '\m(payout|wallet|transactions|admin_confirmed_at)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP function names a money surface';
  END IF;

  -- The pre-existing structured-inspection objects must be intact.
  IF to_regclass('public.inspection_evidence_requirements') IS NULL
     OR to_regclass('public.inspection_captures') IS NULL
     OR to_regclass('public.flash_reports') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a pre-existing inspection object is missing';
  END IF;

  RAISE NOTICE 'ITP foundation ready: reuses evidence requirements, hold release separated from recording, NCR delegated.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
