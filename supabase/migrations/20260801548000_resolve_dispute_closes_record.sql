-- ════════════════════════════════════════════════════════════════════════════
--  20260801548000_resolve_dispute_closes_record.sql
--
--  DEFECT D25b (P1, audit): admin_resolve_dispute flipped jobs.status but left
--  the job_disputes row 'open' with resolved_by / resolved_at /
--  resolution_notes all NULL. Behaviourally proven on Staging right after the
--  D25 fix landed: resolve returned ok, the job read completed, and the
--  dispute record still said open/NULL/NULL. The audit trail claimed the
--  dispute was never handled, and any open-dispute count stayed wrong forever.
--
--  Fix appends step 5b (see inline comment for the status mapping). Everything
--  else is byte-identical to the D25 body.
--  Rollback: supabase/rollback/20260801548000_rollback.sql.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(p_job_id uuid, p_resolution text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      cancelled_at  = CASE WHEN p_resolution = 'cancelled' THEN now() ELSE cancelled_at END,
      cancelled_by  = CASE WHEN p_resolution = 'cancelled' THEN v_actor ELSE cancelled_by END,
      cancel_reason = CASE WHEN p_resolution = 'cancelled' THEN v_clean_reason ELSE cancel_reason END
  WHERE id = p_job_id;

  -- ── 5b. Close the dispute RECORD, not just the job (D25b) ──────────
  -- Resolving used to flip only jobs.status; job_disputes stayed 'open'
  -- forever with no actor, timestamp or notes — the audit trail said the
  -- dispute was never handled. Status mapping follows the CHECK constraint's
  -- vocabulary: completed → resolved_paid (the work stands, settlement can
  -- proceed), cancelled → resolved_refunded. A resolution back to
  -- 'in_progress' deliberately leaves the record open: work resumes and the
  -- dispute stays visible for follow-up.
  IF p_resolution IN ('completed','cancelled') THEN
    UPDATE public.job_disputes
       SET status           = CASE p_resolution
                                WHEN 'completed' THEN 'resolved_paid'
                                ELSE 'resolved_refunded' END,
           resolved_by      = v_actor,
           resolved_at      = now(),
           resolution_notes = v_clean_reason,
           updated_at       = now()
     WHERE job_id = p_job_id AND status = 'open' AND deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'job_id',         p_job_id,
    'from_status',    'disputed',
    'to_status',      p_resolution,
    'correlation_id', v_correlation
  );
END;
$function$
