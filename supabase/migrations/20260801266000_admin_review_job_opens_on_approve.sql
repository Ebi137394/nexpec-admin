-- ════════════════════════════════════════════════════════════════════════════
--  20260801266000_admin_review_job_opens_on_approve.sql
--
--  BUG (major workflow break): after an admin APPROVES a job, the client still
--  saw "Awaiting Admin Approval" and inspectors couldn't see the job at all.
--
--  ROOT CAUSE: admin_review_job set moderation_status='approved' but left
--  jobs.status unchanged (`ELSE v_job.status`), so an approved job stayed
--  status='pending_approval'. The inspector open-jobs feed requires BOTH
--  status='open' AND moderation_status='approved' (openJobs.ts), so it was
--  filtered out; the client status label reads jobs.status, so it stayed
--  "Awaiting Admin Approval".
--
--  FIX: on approval, PUBLISH the job — flip status pending_approval → 'open'.
--  Jobs already further along (assigned/in_progress/completed) are left as-is
--  if moderation is re-run. Only this one CASE branch changes; the rest of the
--  function is byte-identical to baseline. safeupdate-safe (UPDATE is WHERE-
--  qualified). Idempotent; self-tested.
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
    --   that has already moved past posting.
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

  BEGIN
    PERFORM public.notify_safe(
      COALESCE(v_job.client_id, v_job.agency_id),
      'job_moderated',
      CASE p_decision
        WHEN 'approved'        THEN 'Job approved'
        WHEN 'edits_requested' THEN 'Edits requested on your job'
        WHEN 'rejected'        THEN 'Job rejected'
        ELSE 'Job moderation update'
      END,
      COALESCE(p_notes, v_job.title),
      '/client/jobs/' || v_job.id::text,
      v_job.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok',                true,
    'job_id',            v_job.id,
    'moderation_status', p_decision,
    'job_status',        v_new_job_status,
    'correlation_id',    v_correlation_id::text
  );
END $$;

ALTER FUNCTION public.admin_review_job(uuid, text, text) OWNER TO postgres;

-- One-time heal: any job already approved-but-stuck (approved moderation yet
-- still pending_approval, not cancelled) gets published now.
UPDATE public.jobs
   SET status = 'open', updated_at = NOW()
 WHERE moderation_status = 'approved'
   AND status = 'pending_approval';

DO $test$
DECLARE v_def text; v_stuck int;
BEGIN
  v_def := pg_get_functiondef('public.admin_review_job(uuid,text,text)'::regprocedure);
  IF position($q$'approved' AND v_job.status = 'pending_approval' THEN 'open'$q$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: admin_review_job does not open the job on approval';
  END IF;
  SELECT count(*) INTO v_stuck FROM public.jobs
   WHERE moderation_status = 'approved' AND status = 'pending_approval';
  IF v_stuck > 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: % approved jobs still stuck at pending_approval', v_stuck;
  END IF;
  RAISE NOTICE 'admin_review_job now publishes on approval; % previously-stuck job(s) healed.', v_stuck;
END
$test$;

COMMIT;
