-- ════════════════════════════════════════════════════════════════════════════
--  20260801388000_visit_scoped_evidence.sql
--
--  PHASE 2F — VISIT-AWARE STRUCTURED INSPECTION / EVIDENCE. Additive.
--
--  ── WHAT WAS ALREADY TRUE (verified, not rebuilt) ──────────────────────────
--  20260801384000 added inspection_captures.visit_id and inspection_items
--  .visit_id (nullable, ON DELETE SET NULL) with partial indexes, and owns the
--  canonical visit RPCs. This migration adds NO evidence table, NO second
--  capture model and NO parallel item model. There is one evidence system.
--
--  ── THE CONCRETE GAP THIS CLOSES ───────────────────────────────────────────
--  The columns exist but NOTHING can populate them safely:
--
--   1. NO WRITER SETS visit_id. The only capture writer is the field wizard,
--      app/(inspector)/compliance/job/[id]/capture.tsx:375, :489, :556 — three
--      enqueueCaptureSave({ capture: {…} }) payloads with no visit_id key. The
--      outbox replays the payload verbatim (src/core/offline/operations.ts:294
--      `supabase.from('inspection_captures').insert(capture)`), so the column
--      flows through untouched once the screen supplies it — no offline change
--      is needed, and none is made. inspection_items has no app writer at all
--      (read-only at app/inspector/seal-report.tsx:170), and apps/web writes
--      neither table. The missing piece is a SERVER-SIDE RESOLVER telling the
--      screen which visit it is standing in — nx_job_active_visit_for below.
--
--   2. NOTHING VALIDATES visit_id. The FK proves the visit EXISTS, never that
--      it belongs to the same job. captures_insert_team_member (20260801378000)
--      checks only `inspector_id = auth.uid() AND nx_is_active_job_team_member
--      (job_id, auth.uid())`, so an authorised writer on job A could stamp
--      evidence with a visit from job B — cross-job evidence injection into a
--      SEALED chain. inspection_items_team_write does not even pin
--      inspector_id to the author. Both are closed here by BEFORE triggers,
--      which — unlike RLS, whose permissive policies OR together — cannot be
--      widened away by a later policy and also bind service_role writers.
--
--  ── COMPATIBILITY, DELIBERATELY ────────────────────────────────────────────
--   • visit_id NULL keeps its pre-existing meaning: job-level evidence. Every
--     legacy row is already NULL. NO BACKFILL, destructive or otherwise.
--   • The guards fire ONLY when visit_id is non-NULL and changing, so every
--     legacy write path is byte-for-byte unaffected.
--   • CRYPTOGRAPHIC SEALING IS UNTOUCHED. pi_seal_inspection_report hashes
--     captures by (capture_sha256, prev_capture_sha256) and items by the
--     canonical JSON of (id, description, status, photo_url, notes, location,
--     created_at). visit_id is in NEITHER pre-image, and the generate-vca
--     validator recomputes capture_sha256 from a canonical metadata object that
--     likewise excludes it. Stamping a visit therefore cannot change a root
--     hash, break a chain, or invalidate an issued affidavit. Self-tested.
--   • The per-job capture hash chain STAYS per-job. Visits do not shard it; a
--     per-visit chain would fork the pre-image and break every existing seal.
--   • The NCR bridge is untouched: nx_raise_ncr_from_inspection_item resolves
--     the job through the item's report and never reads visit_id.
--
--  ── ONE ASSIGNMENT TRUTH ───────────────────────────────────────────────────
--  Authorisation to record visit work reuses job_inspectors exactly as
--  nx_visit_assign_inspector does. A removed / replaced inspector fails
--  nx_is_active_job_team_member and is refused NEW visit work at the trigger,
--  while their historical rows keep their inspector_id forever.
--
--  ── PAYMENT ────────────────────────────────────────────────────────────────
--  Attributing evidence to a visit is operational. No payout, no transaction,
--  no wallet, no admin_confirmed_at, no *_cents. Self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) Read helpers ─────────────────────────────────────────────────────────
--  SECURITY DEFINER so the guards evaluate the same truth for every writer —
--  contractor, team member, admin or service_role — rather than whatever RLS
--  happens to reveal to the current session.

CREATE OR REPLACE FUNCTION public.nx_visit_job_id(p_visit_id uuid)
RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT v.job_id FROM public.job_visits v WHERE v.id = p_visit_id;
$fn$;

ALTER FUNCTION public.nx_visit_job_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_visit_job_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_visit_job_id(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_visit_job_id(uuid) IS
  'The job a visit belongs to. Used by the evidence guards to prove a capture or item cannot be stamped with another job''s visit.';

--  Can this user attribute NEW work to this visit?
--  'cancelled' and 'rescheduled' are closed: a superseded visit row is history
--  (nx_job_visits already hides it), and new evidence must not accrue to it.
--  'completed' and 'no_show' stay OPEN on purpose — an offline outbox drains
--  after the visit ends, and the proof of a no-show IS evidence.
CREATE OR REPLACE FUNCTION public.nx_can_record_visit_work(
  p_visit_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.job_visits v
      JOIN public.jobs j ON j.id = v.job_id
     WHERE v.id = p_visit_id
       AND v.status NOT IN ('cancelled', 'rescheduled')
       AND (public.nx_is_admin(p_uid)
            OR j.contractor_id = p_uid
            -- ONE assignment truth: job team membership, same as
            -- nx_visit_assign_inspector. Removal revokes this by construction.
            OR public.nx_is_active_job_team_member(v.job_id, p_uid)));
$fn$;

ALTER FUNCTION public.nx_can_record_visit_work(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_can_record_visit_work(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_can_record_visit_work(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_can_record_visit_work(uuid, uuid) IS
  'True when the user may attribute NEW evidence to this visit: the visit is not cancelled or superseded, and the user is admin, the job contractor, or an ACTIVE job-team member. Reuses job_inspectors so a removed inspector loses new-work rights automatically while their history stays attributed.';

-- ── 2) Capture guard ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_guard_capture_visit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $t$
DECLARE
  v_visit_job uuid;
  v_status    text;
  v_uid       uuid := auth.uid();
BEGIN
  SELECT v.job_id, v.status INTO v_visit_job, v_status
    FROM public.job_visits v WHERE v.id = NEW.visit_id;

  IF v_visit_job IS NULL THEN
    RAISE EXCEPTION 'visit % does not exist', NEW.visit_id USING errcode = '23503';
  END IF;

  -- The whole point: job + visit must be ONE coherent unit.
  IF v_visit_job IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION
      'visit % belongs to job %, not job % — evidence cannot cross jobs',
      NEW.visit_id, v_visit_job, NEW.job_id USING errcode = '23514';
  END IF;

  -- Structural, so it also binds service_role and any future server writer.
  IF v_status IN ('cancelled', 'rescheduled') THEN
    RAISE EXCEPTION
      'visit % is % — no new evidence may be attributed to a cancelled or superseded visit',
      NEW.visit_id, v_status USING errcode = '23514';
  END IF;

  -- Actor rules apply to an authenticated session only. auth.uid() is NULL for
  -- service_role and for migrations, which must keep working.
  IF v_uid IS NOT NULL AND NOT public.nx_can_record_visit_work(NEW.visit_id, v_uid) THEN
    RAISE EXCEPTION
      'not authorised to record work on visit %', NEW.visit_id USING errcode = '42501';
  END IF;

  RETURN NEW;
END $t$;

ALTER FUNCTION public.tg_guard_capture_visit() OWNER TO postgres;

-- Two triggers, not one: a WHEN clause on a combined INSERT OR UPDATE trigger
-- cannot reference OLD, and we must not re-validate an UPDATE that leaves
-- visit_id alone (that would retro-block edits to historical evidence).
DROP TRIGGER IF EXISTS trg_guard_capture_visit_ins ON public.inspection_captures;
CREATE TRIGGER trg_guard_capture_visit_ins
  BEFORE INSERT ON public.inspection_captures
  FOR EACH ROW WHEN (NEW.visit_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_guard_capture_visit();

DROP TRIGGER IF EXISTS trg_guard_capture_visit_upd ON public.inspection_captures;
CREATE TRIGGER trg_guard_capture_visit_upd
  BEFORE UPDATE OF visit_id ON public.inspection_captures
  FOR EACH ROW WHEN (NEW.visit_id IS NOT NULL AND NEW.visit_id IS DISTINCT FROM OLD.visit_id)
  EXECUTE FUNCTION public.tg_guard_capture_visit();

-- ── 3) Structured-item guard ────────────────────────────────────────────────
--  Same rules, resolved through the item's report, PLUS attribution integrity:
--  inspection_items_team_write never pinned inspector_id to the author, so one
--  teammate could file a visit result under another's name. Scoped to
--  visit-stamped rows so no legacy item write changes behaviour.
CREATE OR REPLACE FUNCTION public.tg_guard_item_visit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $t$
DECLARE
  v_report_job uuid;
  v_visit_job  uuid;
  v_status     text;
  v_uid        uuid := auth.uid();
BEGIN
  SELECT r.job_id INTO v_report_job
    FROM public.inspection_reports r WHERE r.id = NEW.report_id;
  IF v_report_job IS NULL THEN
    RAISE EXCEPTION 'inspection report % does not exist', NEW.report_id USING errcode = '23503';
  END IF;

  SELECT v.job_id, v.status INTO v_visit_job, v_status
    FROM public.job_visits v WHERE v.id = NEW.visit_id;
  IF v_visit_job IS NULL THEN
    RAISE EXCEPTION 'visit % does not exist', NEW.visit_id USING errcode = '23503';
  END IF;

  IF v_visit_job IS DISTINCT FROM v_report_job THEN
    RAISE EXCEPTION
      'visit % belongs to job %, but this report belongs to job % — an item cannot cross jobs',
      NEW.visit_id, v_visit_job, v_report_job USING errcode = '23514';
  END IF;

  IF v_status IN ('cancelled', 'rescheduled') THEN
    RAISE EXCEPTION
      'visit % is % — no new result may be recorded against a cancelled or superseded visit',
      NEW.visit_id, v_status USING errcode = '23514';
  END IF;

  IF v_uid IS NOT NULL AND NOT public.nx_can_record_visit_work(NEW.visit_id, v_uid) THEN
    RAISE EXCEPTION
      'not authorised to record work on visit %', NEW.visit_id USING errcode = '42501';
  END IF;

  -- Attribution: a visit-scoped result is signed by whoever recorded it. NULL
  -- keeps its legacy meaning ("the report's inspector"); an admin may file on
  -- someone's behalf; nobody else may put another name on their own work.
  IF v_uid IS NOT NULL
     AND NOT public.nx_is_admin(v_uid)
     AND NEW.inspector_id IS NOT NULL
     AND NEW.inspector_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION
      'a visit-scoped item must be attributed to its author, not to %', NEW.inspector_id
      USING errcode = '42501';
  END IF;

  RETURN NEW;
END $t$;

ALTER FUNCTION public.tg_guard_item_visit() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_guard_item_visit_ins ON public.inspection_items;
CREATE TRIGGER trg_guard_item_visit_ins
  BEFORE INSERT ON public.inspection_items
  FOR EACH ROW WHEN (NEW.visit_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_guard_item_visit();

DROP TRIGGER IF EXISTS trg_guard_item_visit_upd ON public.inspection_items;
CREATE TRIGGER trg_guard_item_visit_upd
  BEFORE UPDATE OF visit_id ON public.inspection_items
  FOR EACH ROW WHEN (NEW.visit_id IS NOT NULL AND NEW.visit_id IS DISTINCT FROM OLD.visit_id)
  EXECUTE FUNCTION public.tg_guard_item_visit();

-- ── 4) The resolver the capture screen needs ────────────────────────────────
--  "Which visit am I standing in?" answered server-side, so the field wizard
--  gains a visit WITHOUT a new picker, a new screen or a second workflow.
--  It never guesses: when the answer is not unambiguous it returns visit_id
--  NULL, and NULL is the pre-existing job-level meaning — the safe default.
CREATE OR REPLACE FUNCTION public.nx_job_active_visit_for(
  p_job_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_job    RECORD;
  v_live   int;
  v_row    RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;
  IF p_uid IS DISTINCT FROM v_caller AND NOT public.nx_is_admin(v_caller) THEN
    RAISE EXCEPTION 'you may only resolve your own active visit' USING errcode = '42501';
  END IF;

  SELECT j.client_id, j.agency_id, j.contractor_id INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  IF NOT (
    public.nx_is_admin(v_caller)
    OR v_caller IS NOT DISTINCT FROM v_job.client_id
    OR v_caller IS NOT DISTINCT FROM v_job.agency_id
    OR v_caller IS NOT DISTINCT FROM v_job.contractor_id
    OR public.nx_is_active_job_team_member(p_job_id, v_caller)
  ) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  SELECT count(*) INTO v_live FROM public.job_visits v
   WHERE v.job_id = p_job_id AND v.status IN ('planned', 'scheduled', 'in_progress');

  -- LEGACY: no explicit visits. Exactly today's behaviour — job-level evidence.
  IF v_live = 0 THEN
    RETURN jsonb_build_object('visit_id', NULL, 'legacy', true,
                              'ambiguous', false, 'candidates', 0);
  END IF;

  -- 1) A visit this person is actually allocated to wins.
  SELECT v.id, v.visit_number, v.title, v.status, v.scheduled_start INTO v_row
    FROM public.job_visits v
    JOIN public.job_visit_assignments a ON a.visit_id = v.id
    JOIN public.job_inspectors ji       ON ji.id = a.job_inspector_id
   WHERE v.job_id = p_job_id
     AND v.status IN ('planned', 'scheduled', 'in_progress')
     AND ji.inspector_id = p_uid
     AND ji.status IN ('assigned', 'active')
   ORDER BY (v.status = 'in_progress') DESC, v.scheduled_start NULLS LAST, v.visit_number
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'visit_id', v_row.id, 'visit_number', v_row.visit_number, 'title', v_row.title,
      'status', v_row.status, 'scheduled_start', v_row.scheduled_start,
      'allocated', true, 'legacy', false, 'ambiguous', false, 'candidates', v_live);
  END IF;

  -- 2) Not allocated, but the job has exactly ONE live visit — unambiguous.
  IF v_live = 1 THEN
    SELECT v.id, v.visit_number, v.title, v.status, v.scheduled_start INTO v_row
      FROM public.job_visits v
     WHERE v.job_id = p_job_id AND v.status IN ('planned', 'scheduled', 'in_progress')
     LIMIT 1;
    RETURN jsonb_build_object(
      'visit_id', v_row.id, 'visit_number', v_row.visit_number, 'title', v_row.title,
      'status', v_row.status, 'scheduled_start', v_row.scheduled_start,
      'allocated', false, 'legacy', false, 'ambiguous', false, 'candidates', 1);
  END IF;

  -- 3) Several live visits and no allocation: REFUSE TO GUESS. Mis-attributed
  --    evidence is worse than job-level evidence.
  RETURN jsonb_build_object('visit_id', NULL, 'legacy', false,
                            'ambiguous', true, 'candidates', v_live);
END $fn$;

ALTER FUNCTION public.nx_job_active_visit_for(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_active_visit_for(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_active_visit_for(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_job_active_visit_for(uuid, uuid) IS
  'Which visit this user should be capturing against on this job, resolved server-side so the existing field wizard needs no new UI. Prefers a visit the user is allocated to, else the job''s single live visit, else returns visit_id NULL with ambiguous=true rather than guessing. A job with no explicit visits returns visit_id NULL with legacy=true, which is the pre-existing job-level meaning. Returns no pricing column.';

-- ── 5) Visit-aware evidence reader ──────────────────────────────────────────
--  Derived entirely from the existing inspection_captures / inspection_items
--  rows — no counters, no materialised second record of the truth.
CREATE OR REPLACE FUNCTION public.nx_visit_evidence_summary(p_job_id uuid)
RETURNS TABLE (
  visit_id         uuid,
  visit_number     int,
  title            text,
  status           text,
  scheduled_start  timestamptz,
  capture_count    int,
  item_count       int,
  contributor_count int,
  is_job_level     boolean
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

  SELECT j.client_id, j.agency_id, j.contractor_id INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found' USING errcode = 'P0002';
  END IF;

  IF NOT (
    public.nx_is_admin(v_uid)
    OR v_uid IS NOT DISTINCT FROM v_job.client_id
    OR v_uid IS NOT DISTINCT FROM v_job.agency_id
    OR v_uid IS NOT DISTINCT FROM v_job.contractor_id
    OR public.nx_is_active_job_team_member(p_job_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'not authorized for this job' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH caps AS (
    SELECT c.visit_id AS vid, c.inspector_id
      FROM public.inspection_captures c WHERE c.job_id = p_job_id
  ), items AS (
    SELECT i.visit_id AS vid, COALESCE(i.inspector_id, r.inspector_id) AS inspector_id
      FROM public.inspection_items i
      JOIN public.inspection_reports r ON r.id = i.report_id
     WHERE r.job_id = p_job_id
  )
  -- One row per visit, including superseded/cancelled ones: evidence recorded
  -- before a visit was rescheduled is history and must stay visible.
  SELECT v.id, v.visit_number, v.title, v.status, v.scheduled_start,
         (SELECT count(*)::int FROM caps  WHERE caps.vid  = v.id),
         (SELECT count(*)::int FROM items WHERE items.vid = v.id),
         (SELECT count(DISTINCT x.inspector_id)::int FROM (
            SELECT caps.inspector_id FROM caps  WHERE caps.vid  = v.id
            UNION
            SELECT items.inspector_id FROM items WHERE items.vid = v.id) x
           WHERE x.inspector_id IS NOT NULL),
         false
    FROM public.job_visits v
   WHERE v.job_id = p_job_id

  UNION ALL

  -- The job-level bucket: visit_id NULL, the pre-existing meaning of every
  -- legacy row. Always returned, so legacy evidence is never orphaned.
  SELECT NULL::uuid, NULL::int, 'Job-level evidence'::text, NULL::text, NULL::timestamptz,
         (SELECT count(*)::int FROM caps  WHERE caps.vid  IS NULL),
         (SELECT count(*)::int FROM items WHERE items.vid IS NULL),
         (SELECT count(DISTINCT x.inspector_id)::int FROM (
            SELECT caps.inspector_id FROM caps  WHERE caps.vid  IS NULL
            UNION
            SELECT items.inspector_id FROM items WHERE items.vid IS NULL) x
           WHERE x.inspector_id IS NOT NULL),
         true
  ORDER BY 9, 2;
END $fn$;

ALTER FUNCTION public.nx_visit_evidence_summary(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_visit_evidence_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_visit_evidence_summary(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_visit_evidence_summary(uuid) IS
  'Evidence per visit for a job, DERIVED from inspection_captures and inspection_items rather than any new table, plus a job-level (visit_id NULL) bucket so legacy evidence is never orphaned. Item attribution falls back to the report''s inspector exactly as nx_report_contributors does. Returns no pricing column.';

-- ── 6) Index for the per-visit rollup ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS inspection_captures_job_visit_idx
  ON public.inspection_captures (job_id, visit_id);

-- ── 7) Self-tests ───────────────────────────────────────────────────────────
DO $test$
DECLARE
  dcap  text := pg_get_functiondef('public.tg_guard_capture_visit()'::regprocedure);
  ditem text := pg_get_functiondef('public.tg_guard_item_visit()'::regprocedure);
  dres  text := pg_get_functiondef('public.nx_job_active_visit_for(uuid,uuid)'::regprocedure);
  dsum  text := pg_get_functiondef('public.nx_visit_evidence_summary(uuid)'::regprocedure);
  dseal text;
BEGIN
  -- The columns this migration depends on must already exist (384000).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_captures'
                    AND column_name='visit_id') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspection_captures.visit_id is missing — 20260801384000 did not apply';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='inspection_items'
                    AND column_name='visit_id') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: inspection_items.visit_id is missing — 20260801384000 did not apply';
  END IF;

  -- visit_id MUST stay nullable: NULL is the legacy job-level meaning.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='inspection_captures'
                AND column_name='visit_id' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: capture visit_id became NOT NULL — legacy job-level evidence would be invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='inspection_items'
                AND column_name='visit_id' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: item visit_id became NOT NULL — legacy job-level evidence would be invalid';
  END IF;

  -- All four guards installed, and each fires ONLY on a non-NULL visit_id.
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal
         AND c.relname IN ('inspection_captures','inspection_items')
         AND t.tgname IN ('trg_guard_capture_visit_ins','trg_guard_capture_visit_upd',
                          'trg_guard_item_visit_ins','trg_guard_item_visit_upd')) <> 4 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the visit evidence guards are not all installed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE NOT t.tgisinternal
       AND t.tgname IN ('trg_guard_capture_visit_ins','trg_guard_capture_visit_upd',
                        'trg_guard_item_visit_ins','trg_guard_item_visit_upd')
       AND position('visit_id IS NOT NULL' IN pg_get_triggerdef(t.oid)) = 0) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a guard fires on visit_id NULL — legacy writes would be affected';
  END IF;

  -- The cross-job rule must be structural, not incidental.
  IF position('cannot cross jobs' IN dcap) = 0 OR position('cannot cross jobs' IN ditem) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a guard lost its cross-job check';
  END IF;
  IF position('nx_can_record_visit_work' IN dcap) = 0
     OR position('nx_can_record_visit_work' IN ditem) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a guard does not check visit work authorisation';
  END IF;
  -- ONE assignment truth.
  IF position('nx_is_active_job_team_member' IN
              pg_get_functiondef('public.nx_can_record_visit_work(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: visit work authorisation bypasses the job team — that is a second assignment architecture';
  END IF;

  -- NO SECOND EVIDENCE SYSTEM.
  IF to_regclass('public.visit_captures') IS NOT NULL
     OR to_regclass('public.visit_evidence') IS NOT NULL
     OR to_regclass('public.inspection_captures_v2') IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a second evidence table exists';
  END IF;

  -- CRYPTOGRAPHIC SEALING: visit_id must stay OUTSIDE every hash pre-image,
  -- otherwise stamping a visit would silently invalidate issued seals.
  IF to_regprocedure('public.pi_seal_inspection_report(uuid)') IS NOT NULL THEN
    dseal := pg_get_functiondef('public.pi_seal_inspection_report(uuid)'::regprocedure);
    IF position('visit_id' IN dseal) > 0 THEN
      RAISE EXCEPTION 'SELFTEST FAILED: the seal pre-image now references visit_id — existing seals would no longer verify';
    END IF;
  END IF;

  -- The per-job capture chain must not be re-sharded per visit.
  IF dcap ~* 'prev_capture_sha256' OR ditem ~* 'prev_capture_sha256' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a visit guard touches the capture hash chain';
  END IF;

  -- The NCR bridge must be untouched.
  IF to_regprocedure('public.nx_raise_ncr_from_inspection_item(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the inspection-item NCR bridge disappeared';
  END IF;

  -- The resolver must default to job-level rather than guess.
  IF position('ambiguous' IN dres) = 0 OR position('legacy' IN dres) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the active-visit resolver lost its no-guess fallback';
  END IF;

  -- MONEY-FREE.
  IF dcap  ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents)\M'
     OR ditem ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents)\M'
     OR dres  ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents)\M'
     OR dsum  ~* '\m(payout|wallet|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a visit evidence function names a money surface';
  END IF;

  RAISE NOTICE 'visit-scoped evidence ready: one evidence system, job+visit+inspector coherent, NULL still job-level, seals untouched, money-free.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
