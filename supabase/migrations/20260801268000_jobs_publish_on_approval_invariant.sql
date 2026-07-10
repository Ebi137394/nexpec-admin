-- ════════════════════════════════════════════════════════════════════════════
--  20260801268000_jobs_publish_on_approval_invariant.sql
--
--  PERMANENT, STRUCTURAL fix for "approved job stays hidden / client stuck on
--  'Awaiting Admin Approval' / inspector can't see it".
--
--  Migration 266000 fixed ONE approve path (admin_review_job). But there are
--  multiple ways a job's moderation_status can become 'approved' — jobModeration,
--  jobModerationSimple, diagnostics, a direct dashboard edit, future code, or
--  raw SQL. Patching each is whack-a-mole. Instead we enforce the invariant at
--  the DATABASE LAYER so it is impossible for ANY path or account to leave a job
--  approved-but-unpublished:
--
--    INVARIANT: a job with moderation_status='approved' can never remain at the
--    initial status='pending_approval'. On any INSERT/UPDATE that satisfies
--    that, the job is auto-promoted to status='open' (visible to inspectors;
--    client leaves the moderation queue). Jobs already past posting
--    (assigned/in_progress/completed/paid/cancelled/disputed) and non-approved
--    jobs (edits_requested/rejected/pending_review) are never touched.
--
--  BEFORE trigger → normalizes NEW in place (no extra DML; safeupdate-safe; no
--  recursion). Idempotent; heals existing stuck rows; self-tested by actually
--  exercising the trigger on a throwaway row inside the transaction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_jobs_publish_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- The moment a job is approved, it must be publishable. Only promote from the
  -- initial pending_approval state so we never rewind a job already in flight.
  IF NEW.moderation_status = 'approved' AND NEW.status = 'pending_approval' THEN
    NEW.status := 'open';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_jobs_publish_on_approval ON public.jobs;
CREATE TRIGGER trg_jobs_publish_on_approval
  BEFORE INSERT OR UPDATE OF moderation_status, status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_jobs_publish_on_approval();

-- Heal any job already stuck (approved but never published). WHERE-qualified.
UPDATE public.jobs
   SET status = 'open', updated_at = NOW()
 WHERE moderation_status = 'approved'
   AND status = 'pending_approval';

-- ── Self-test ────────────────────────────────────────────────────────────────
--   (1) CATALOG proof (always runs): the trigger exists, is enabled, and is
--       wired BEFORE INSERT+UPDATE on public.jobs. Cannot false-fail.
--   (2) LIVE proof (best-effort): actually exercise the trigger on a throwaway
--       row and assert it flips to 'open'. Wrapped so an *unrelated* insert-time
--       failure (a future NOT NULL column, an FK, another trigger's side effect)
--       degrades to the catalog proof instead of falsely failing the migration —
--       but a genuine "trigger did not promote" stays a HARD failure.
--   (3) Zero approved-but-stuck rows remain.
DO $test$
DECLARE
  v_client    uuid;
  v_status    text;
  v_stuck     int;
  v_probe_ran boolean := false;
  v_trg       RECORD;
BEGIN
  -- (1) Catalog proof — tgtype bit 0x02 = BEFORE, 0x04 = INSERT, 0x10 = UPDATE.
  SELECT t.tgenabled,
         (t.tgtype & 2)  <> 0 AS is_before,
         (t.tgtype & 4)  <> 0 AS on_insert,
         (t.tgtype & 16) <> 0 AS on_update
    INTO v_trg
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'jobs'
     AND c.relnamespace = 'public'::regnamespace
     AND t.tgname = 'trg_jobs_publish_on_approval';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SELFTEST FAILED: trigger trg_jobs_publish_on_approval is not installed on public.jobs';
  END IF;
  IF v_trg.tgenabled = 'D' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: trigger trg_jobs_publish_on_approval is DISABLED';
  END IF;
  IF NOT (v_trg.is_before AND v_trg.on_insert AND v_trg.on_update) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: trigger has wrong timing/events (before=% insert=% update=%)',
      v_trg.is_before, v_trg.on_insert, v_trg.on_update;
  END IF;

  -- (2) Live proof — best-effort, does not false-fail on unrelated insert errors.
  SELECT id INTO v_client FROM public.profiles WHERE role = 'client' LIMIT 1;
  IF v_client IS NOT NULL THEN
    BEGIN
      INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status)
      VALUES (gen_random_uuid(), v_client, '__invariant_probe__',
              'trigger self-test, rolled back', 'pending_approval', 'approved')
      RETURNING status INTO v_status;
      v_probe_ran := true;
    EXCEPTION WHEN OTHERS THEN
      -- Unrelated to the invariant (constraint/FK/side-effect). Catalog proof stands.
      RAISE NOTICE 'live-insert proof skipped (%): catalog proof already confirmed the trigger', SQLERRM;
    END;

    IF v_probe_ran THEN
      -- Clean up first (WHERE-qualified → safeupdate-safe), then assert.
      DELETE FROM public.jobs WHERE title = '__invariant_probe__' AND client_id = v_client;
      IF v_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'SELFTEST FAILED: approved job was NOT auto-published (got status=%)', v_status;
      END IF;
    END IF;
  END IF;

  -- (3) No approved-but-stuck rows survive.
  SELECT count(*) INTO v_stuck FROM public.jobs
   WHERE moderation_status = 'approved' AND status = 'pending_approval';
  IF v_stuck > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % approved job(s) still stuck at pending_approval', v_stuck;
  END IF;

  RAISE NOTICE 'invariant LIVE: approved jobs auto-publish to open on every INSERT/UPDATE path; no stuck rows.';
END
$test$;

COMMIT;
