-- ════════════════════════════════════════════════════════════════════════════
--  20260801270000_admin_review_job_dedup_notification.sql
--
--  BUG: approving a job produced TWO identical "Job approved" notifications.
--
--  ROOT CAUSE: two writers fire on the same approval UPDATE —
--    1. AFTER-UPDATE trigger  trg_notify_jobs → tg_notify_jobs()  sends one
--       whenever moderation_status changes (covers EVERY write path: admin_review_job,
--       jobModerationSimple, diagnostics, direct edits, raw SQL).
--    2. admin_review_job ALSO called notify_safe(...) manually — a second, path-
--       specific copy of the exact same 'Job approved' message.
--
--  FIX: the trigger is the single, all-paths source of truth for job-moderation
--  notifications (same philosophy as the 268000 publish-on-approval invariant),
--  so remove the redundant manual notify_safe from admin_review_job. This yields
--  EXACTLY ONE notification per approval and also stops re-approve double-clicks
--  from spamming (trigger only fires when moderation_status actually changes,
--  whereas the old manual call fired every invocation).
--
--  Only the notify block is removed; the publish-on-approval CASE (from 266000)
--  and every other line are preserved byte-for-byte. safeupdate-safe (UPDATE is
--  WHERE-qualified). Idempotent; self-tested.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_review_job(
  p_job_id uuid, p_decision text, p_notes text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_job             RECORD;
  v_correlation_id  uuid := gen_random_uuid();
  v_new_job_status  text;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_decision NOT IN ('approved','edits_requested','rejected') THEN
    RAISE EXCEPTION 'invalid decision (must be approved | edits_requested | rejected)';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  v_new_job_status := CASE
    WHEN p_decision = 'rejected' THEN 'cancelled'
    -- ★ Approval PUBLISHES a pending job so inspectors can see + apply and the
    --   client stops showing "Awaiting Admin Approval". Never downgrade a job
    --   that has already moved past posting. (Also enforced by the DB-layer
    --   invariant trigger trg_jobs_publish_on_approval — migration 268000.)
    WHEN p_decision = 'approved' AND v_job.status = 'pending_approval' THEN 'open'
    ELSE v_job.status
  END;

  UPDATE public.jobs SET
    moderation_status      = p_decision,
    moderation_notes       = p_notes,
    moderation_reviewed_at = NOW(),
    moderation_reviewed_by = auth.uid(),
    status                 = v_new_job_status,
    cancelled_at           = CASE WHEN p_decision='rejected' THEN NOW() ELSE v_job.cancelled_at END,
    cancelled_by           = CASE WHEN p_decision='rejected' THEN auth.uid() ELSE v_job.cancelled_by END,
    cancel_reason          = CASE WHEN p_decision='rejected' THEN p_notes ELSE v_job.cancel_reason END,
    updated_at             = NOW()
  WHERE id = p_job_id;

  -- ★ DEDUP (270000): the client-facing approval push is emitted exactly once by
  --   the AFTER-UPDATE trigger trg_notify_jobs (which sees the moderation_status
  --   change above and fires for EVERY write path). The old manual push call that
  --   lived here was a duplicate copy → removed to guarantee ONE per approval.
  --   (Self-test below asserts this body contains no direct notification call.)

  RETURN jsonb_build_object(
    'ok',                true,
    'job_id',            v_job.id,
    'moderation_status', p_decision,
    'job_status',        v_new_job_status,
    'correlation_id',    v_correlation_id::text
  );
END $$;

ALTER FUNCTION public.admin_review_job(uuid, text, text) OWNER TO postgres;

-- ── Self-test ────────────────────────────────────────────────────────────────
--   (1) admin_review_job no longer emits its own notification (no notify_safe /
--       nx_notify in the body) → the trigger is the sole source.
--   (2) it still publishes on approval (266000 regression guard).
--   (3) the single all-paths source trg_notify_jobs is still installed + enabled.
DO $test$
DECLARE
  v_def text;
  v_trg RECORD;
BEGIN
  v_def := pg_get_functiondef('public.admin_review_job(uuid,text,text)'::regprocedure);

  IF v_def ~* '\mnotify_safe\M' OR v_def ~* '\mnx_notify\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin_review_job still emits its own notification (duplicate source not removed)';
  END IF;

  IF position($q$'approved' AND v_job.status = 'pending_approval' THEN 'open'$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin_review_job no longer publishes the job on approval (266000 regression)';
  END IF;

  SELECT t.tgenabled INTO v_trg
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'jobs'
     AND c.relnamespace = 'public'::regnamespace
     AND t.tgname = 'trg_notify_jobs';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SELFTEST FAILED: trg_notify_jobs (the single notification source) is missing';
  END IF;
  IF v_trg.tgenabled = 'D' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: trg_notify_jobs is DISABLED — approvals would emit ZERO notifications';
  END IF;

  RAISE NOTICE 'dedup LIVE: admin_review_job emits no notification; trg_notify_jobs is the single source → exactly one per approval.';
END
$test$;

COMMIT;
