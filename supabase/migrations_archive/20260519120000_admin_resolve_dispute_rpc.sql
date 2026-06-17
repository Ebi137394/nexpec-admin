-- ════════════════════════════════════════════════════════════════════════════
--  20260519120000_admin_resolve_dispute_rpc.sql
--  Phase 6 / Sprint 3 — Disputes Board resolution RPC.
--
--  One SECURITY DEFINER entry point for the three canonical dispute
--  resolutions:
--
--    completed   — admin rules in favour of the inspector. Job moves to
--                  `completed`, escrow can be released to the inspector
--                  by the payouts pipeline.
--    cancelled   — admin rules in favour of the client. Job moves to
--                  `cancelled` with cancel_reason captured. Refund logic
--                  is the payouts pipeline's concern; this RPC writes the
--                  state.
--    in_progress — admin returns the job to active work (mediation
--                  succeeded, parties agreed to continue).
--
--  Schema-side enforcement:
--    - Caller must be `super_admin` (RAISE 42501 otherwise).
--    - Job must currently be `disputed` (RAISE 22000 otherwise).
--    - Reason is required and capped at 1000 chars.
--    - FOR UPDATE lock on the jobs row prevents concurrent resolutions.
--    - Audit-annotated via audit_set_correlation + audit_set_intent — the
--      Industrial Black Box captures the resolution path AND the reason.
--    - The guard_jobs_status_transition trigger from Phase 5 re-validates
--      the disputed → {completed|cancelled|in_progress} transitions are
--      all legal, so a future schema change can't silently allow more.
--
--  Idempotent. Wrapped in a transaction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(
  p_job_id     uuid,
  p_resolution text,
  p_reason     text
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
  v_clean_reason text;
  v_intent       text;
BEGIN
  -- ── 1. Auth ────────────────────────────────────────────────────────
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super_admin can resolve disputes' USING ERRCODE = '42501';
  END IF;

  -- ── 2. Input validation ────────────────────────────────────────────
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id is required' USING ERRCODE = '22000';
  END IF;

  IF p_resolution NOT IN ('completed', 'cancelled', 'in_progress') THEN
    RAISE EXCEPTION 'resolution must be one of: completed, cancelled, in_progress (got: %)', p_resolution
      USING ERRCODE = '22000';
  END IF;

  v_clean_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required for dispute resolution' USING ERRCODE = '22000';
  END IF;
  IF length(v_clean_reason) > 1000 THEN
    v_clean_reason := left(v_clean_reason, 1000);
  END IF;

  -- ── 3. Audit annotation ────────────────────────────────────────────
  v_intent := CASE p_resolution
    WHEN 'completed'   THEN 'Dispute resolved → pay inspector — '   || v_clean_reason
    WHEN 'cancelled'   THEN 'Dispute resolved → refund client — '   || v_clean_reason
    WHEN 'in_progress' THEN 'Dispute resolved → return to work — '  || v_clean_reason
    ELSE                    'Dispute resolved — '                   || v_clean_reason
  END;

  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent(v_intent);

  -- ── 4. Lock + state guard ──────────────────────────────────────────
  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status <> 'disputed' THEN
    RAISE EXCEPTION 'Job is not in disputed state (current: %)', v_job.status
      USING ERRCODE = '22000',
            HINT = 'Only disputed jobs can be resolved via this RPC.';
  END IF;

  -- ── 5. Flip status ─────────────────────────────────────────────────
  -- guard_jobs_status_transition validates the disputed→{x} transition
  -- one more time at the trigger layer. Belt + braces.
  UPDATE public.jobs
  SET status        = p_resolution,
      updated_at    = now(),
      completed_at  = CASE WHEN p_resolution = 'completed' THEN now() ELSE completed_at END,
      cancelled_at  = CASE WHEN p_resolution = 'cancelled' THEN now() ELSE cancelled_at END,
      cancelled_by  = CASE WHEN p_resolution = 'cancelled' THEN v_actor ELSE cancelled_by END,
      cancel_reason = CASE WHEN p_resolution = 'cancelled' THEN v_clean_reason ELSE cancel_reason END
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'job_id',         p_job_id,
    'from_status',    'disputed',
    'to_status',      p_resolution,
    'correlation_id', v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.admin_resolve_dispute(uuid, text, text) IS
  'Super_admin resolves a disputed job. p_resolution ∈ {completed, cancelled, in_progress}. Reason required, audit-annotated. FOR UPDATE lock prevents concurrent resolutions.';

GRANT EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, text, text)
  TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS
-- ════════════════════════════════════════════════════════════════════════════

-- A. Function exists
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM pg_proc WHERE proname = 'admin_resolve_dispute';

-- B. Non-admin rejection (sign in as a non-super_admin):
-- SELECT public.admin_resolve_dispute('<job-id>', 'completed', 'reason');
-- Expected: ERROR 42501 — "Only super_admin can resolve disputes"

-- C. Invalid resolution rejection:
-- SELECT public.admin_resolve_dispute('<job-id>', 'archived', 'reason');
-- Expected: ERROR 22000 — "resolution must be one of: completed, cancelled, in_progress"

-- D. Missing reason rejection:
-- SELECT public.admin_resolve_dispute('<job-id>', 'completed', '');
-- Expected: ERROR 22000 — "A reason is required for dispute resolution"

-- E. State-guard rejection (job not in disputed state):
-- SELECT public.admin_resolve_dispute('<open-job-id>', 'completed', 'reason');
-- Expected: ERROR 22000 — "Job is not in disputed state (current: open)"

-- F. Happy path (admin resolves disputed job to completed):
-- SELECT public.admin_resolve_dispute('<disputed-job-id>', 'completed', 'Inspector report verified');
-- Expected: jsonb with ok=true, to_status='completed'. Verify in audit_events:
--   - One row event_type='job.completed' (severity info, summary 'Job marked completed')
--   - The audit row's metadata->>'intent' = 'Dispute resolved → pay inspector — Inspector report verified'
