-- ════════════════════════════════════════════════════════════════════════════
--  20260522130000_admin_review_job_rpc.sql
--  Phase 6 / Sprint 4 — Jobs Moderation oversight surface.
--
--  Adds moderation columns to jobs + a single RPC parameterised by
--  decision: 'approved' | 'edits_requested' | 'rejected'.
--
--    approved        → admin sign-off. moderation_status='approved',
--                      moderation_reviewed_{at,by} set. No status change.
--    edits_requested → admin sends back to the client.
--                      moderation_status='edits_requested', notes captured.
--    rejected        → admin cancels the job via the existing
--                      admin_cancel_job RPC under the hood, with the
--                      moderation_status also flipped for the queue.
--
--  Audit-stamped via audit_set_intent + audit_set_correlation. The
--  guard_jobs_status_transition trigger still validates any status flips.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Defensive moderation columns ────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS moderation_status        text NOT NULL DEFAULT 'pending_review';
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS moderation_reviewed_at   timestamptz;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS moderation_reviewed_by   uuid REFERENCES public.profiles(id);
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS moderation_notes         text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_moderation_status_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_moderation_status_check
      CHECK (moderation_status IN ('pending_review', 'approved', 'edits_requested', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS jobs_moderation_idx
  ON public.jobs (moderation_status, created_at DESC)
  WHERE moderation_status IN ('pending_review', 'edits_requested');

-- ── RPC ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_review_job(
  p_job_id   uuid,
  p_decision text,   -- 'approved' | 'edits_requested' | 'rejected'
  p_notes    text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        uuid;
  v_actor_role   text;
  v_job          public.jobs%ROWTYPE;
  v_correlation  uuid := gen_random_uuid();
  v_clean_notes  text;
  v_intent       text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;
  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can moderate jobs' USING ERRCODE = '42501';
  END IF;

  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_decision NOT IN ('approved', 'edits_requested', 'rejected') THEN
    RAISE EXCEPTION 'decision must be one of: approved, edits_requested, rejected (got: %)', p_decision
      USING ERRCODE = '22000';
  END IF;

  v_clean_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');
  IF v_clean_notes IS NULL AND p_decision <> 'approved' THEN
    RAISE EXCEPTION 'Notes are required for % decisions', p_decision USING ERRCODE = '22000';
  END IF;
  IF v_clean_notes IS NOT NULL AND length(v_clean_notes) > 1000 THEN
    v_clean_notes := left(v_clean_notes, 1000);
  END IF;

  v_intent := CASE p_decision
    WHEN 'approved'        THEN 'Job moderation: approved' || COALESCE(' — ' || v_clean_notes, '')
    WHEN 'edits_requested' THEN 'Job moderation: edits requested — ' || v_clean_notes
    WHEN 'rejected'        THEN 'Job moderation: rejected — ' || v_clean_notes
  END;
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent(v_intent);

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  -- Moderation only applies to non-terminal pre-dispatch jobs.
  IF v_job.status NOT IN ('open') AND p_decision <> 'approved' THEN
    -- Approved is allowed even after dispatch (post-hoc sign-off). Reject/
    -- edits make no sense once the job is assigned.
    RAISE EXCEPTION 'Cannot % a job already in % state', p_decision, v_job.status
      USING ERRCODE = '22000',
            HINT = 'Use the Disputes Board for assigned-or-later corrections.';
  END IF;

  -- Stamp moderation fields.
  UPDATE public.jobs
  SET moderation_status      = p_decision,
      moderation_reviewed_at = now(),
      moderation_reviewed_by = v_actor,
      moderation_notes       = v_clean_notes,
      updated_at             = now()
  WHERE id = p_job_id;

  -- For 'rejected', cascade to a hard cancel via the existing RPC so
  -- the state machine + audit chain stays consistent.
  IF p_decision = 'rejected' THEN
    PERFORM public.admin_cancel_job(p_job_id, 'Moderation rejection — ' || v_clean_notes);
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'job_id',            p_job_id,
    'moderation_status', p_decision,
    'job_status',        CASE WHEN p_decision = 'rejected' THEN 'cancelled' ELSE v_job.status END,
    'correlation_id',    v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.admin_review_job(uuid, text, text) IS
  'Super_admin reviews a job: approve / request edits / reject. Rejection cascades through admin_cancel_job. Audit-stamped.';

GRANT EXECUTE ON FUNCTION public.admin_review_job(uuid, text, text) TO authenticated;

COMMIT;
