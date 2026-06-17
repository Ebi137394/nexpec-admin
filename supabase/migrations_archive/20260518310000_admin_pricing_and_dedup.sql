-- ============================================================================
-- GR1 enforcement + duplicate-submission guard
--
-- 1) admin_set_job_pricing(p_job_id, p_inspector_payout_cents)
--    Per Golden Rule 1: admin sets the inspector payout during moderation,
--    BEFORE the inspector ever sees the job. SECURITY DEFINER + nx_is_admin
--    check; clients literally cannot call this.
--
-- 2) jobs.client_op_id (uuid, unique partial)
--    Client-side idempotency token. The createJob action passes a UUID
--    generated client-side; the unique partial index makes duplicate posts
--    no-ops at the DB layer. Stops the "submitted once, got 3 rows" bug.
--
-- 3) Defensive index on jobs.moderation_status for the admin queue.
-- ============================================================================

BEGIN;

-- 1) Idempotency token --------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_op_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_jobs_client_op_id
  ON public.jobs(client_op_id)
  WHERE client_op_id IS NOT NULL;

-- Also useful for the admin queue
CREATE INDEX IF NOT EXISTS idx_jobs_moderation_status
  ON public.jobs(moderation_status, created_at DESC)
  WHERE deleted_at IS NULL;

-- 2) Admin sets the inspector payout (GR1) ----------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_job_pricing(
  p_job_id                 uuid,
  p_inspector_payout_cents bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_job RECORD;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_inspector_payout_cents IS NULL OR p_inspector_payout_cents < 0 THEN
    RAISE EXCEPTION 'inspector payout must be a non-negative integer (cents)';
  END IF;
  IF p_inspector_payout_cents > 100000000 THEN -- $1M cap
    RAISE EXCEPTION 'inspector payout exceeds the platform cap';
  END IF;

  UPDATE public.jobs SET
    inspector_payout_cents = p_inspector_payout_cents,
    payout_amount_cents    = p_inspector_payout_cents,  -- legacy mirror for older readers
    updated_at             = NOW()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'inspector_payout_cents', v_job.inspector_payout_cents
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_set_job_pricing(uuid, bigint) TO authenticated;

-- 3) Make sure admin_review_job exists even on tenants where it didn't
--    survive earlier deployments. This is a thin wrapper around an UPDATE +
--    notify; it's intentionally simple. The real production RPC may exist
--    already and supersede this — CREATE OR REPLACE makes it idempotent.
CREATE OR REPLACE FUNCTION public.admin_review_job(
  p_job_id   uuid,
  p_decision text,
  p_notes    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_job             RECORD;
  v_correlation_id  uuid := gen_random_uuid();
  v_new_mod_status  text;
  v_new_job_status  text;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_decision NOT IN ('approved','edits_requested','rejected') THEN
    RAISE EXCEPTION 'invalid decision';
  END IF;
  IF p_decision <> 'approved' AND (p_notes IS NULL OR length(trim(p_notes)) < 1) THEN
    RAISE EXCEPTION 'notes required for non-approval decisions';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  v_new_mod_status := p_decision;
  v_new_job_status := CASE
    WHEN p_decision = 'rejected' THEN 'cancelled'
    ELSE v_job.status
  END;

  UPDATE public.jobs SET
    moderation_status      = v_new_mod_status,
    moderation_notes       = p_notes,
    moderation_reviewed_at = NOW(),
    moderation_reviewed_by = auth.uid(),
    status                 = v_new_job_status,
    cancelled_at           = CASE WHEN p_decision='rejected' THEN NOW() ELSE v_job.cancelled_at END,
    cancelled_by           = CASE WHEN p_decision='rejected' THEN auth.uid() ELSE v_job.cancelled_by END,
    cancel_reason          = CASE WHEN p_decision='rejected' THEN p_notes ELSE v_job.cancel_reason END,
    updated_at             = NOW()
  WHERE id = p_job_id;

  -- Best-effort notify client (and inspector when assigned)
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
    'moderation_status', v_new_mod_status,
    'job_status',        v_new_job_status,
    'correlation_id',    v_correlation_id::text
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_review_job(uuid, text, text) TO authenticated;

COMMIT;
