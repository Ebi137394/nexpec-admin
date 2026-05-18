-- ════════════════════════════════════════════════════════════════════════════
--  20260520120000_admin_mark_payout_processed_rpc.sql
--  Phase 6 / Sprint 3 — close the financial lifecycle.
--
--  WHAT THIS LANDS
--  ───────────────
--    1. Four defensive columns on `jobs` that track the payout settlement:
--         payout_paid_at    timestamptz   — when the operator marked it paid
--         payout_reference  text          — Stripe tr_xxx OR "manual:<note>"
--         payout_notes      text          — optional operator note
--         payout_marked_by  uuid          — operator's profile id
--
--    2. `admin_mark_payout_processed(p_job_id, p_stripe_reference, p_notes)`
--       — SECURITY DEFINER, super_admin only, FOR UPDATE locked, audit-
--       annotated. Validates the job is in `completed` status and the
--       payout isn't already `paid`. Captures the Stripe transfer
--       reference verbatim into the audit event's intent.
--
--  THE STATE CONTRACT
--  ──────────────────
--    Pre:  jobs.status = 'completed' AND payout_status <> 'paid'
--    Post: jobs.payout_status = 'paid'
--          jobs.payout_paid_at = now()
--          jobs.payout_reference = <ref>
--          jobs.payout_notes = <notes>
--          jobs.payout_marked_by = auth.uid()
--          audit_events captures: actor, reason, correlation, before/after
--
--  Idempotent. Wrapped in a transaction.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Defensive column additions ───────────────────────────────────────────
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS payout_paid_at   timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS payout_reference text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS payout_notes     text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS payout_marked_by uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS jobs_pending_payout_idx
  ON public.jobs (updated_at DESC)
  WHERE status = 'completed' AND payout_status IS DISTINCT FROM 'paid';

-- ── RPC ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_payout_processed(
  p_job_id           uuid,
  p_stripe_reference text,
  p_notes            text DEFAULT NULL
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
  v_clean_ref    text;
  v_clean_notes  text;
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
    RAISE EXCEPTION 'Only super_admin can mark payouts processed' USING ERRCODE = '42501';
  END IF;

  -- ── 2. Input validation ────────────────────────────────────────────
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id is required' USING ERRCODE = '22000';
  END IF;

  v_clean_ref := NULLIF(TRIM(COALESCE(p_stripe_reference, '')), '');
  IF v_clean_ref IS NULL THEN
    RAISE EXCEPTION 'A reference is required (Stripe transfer id, or "manual:<context>")'
      USING ERRCODE = '22000';
  END IF;
  IF length(v_clean_ref) > 200 THEN
    v_clean_ref := left(v_clean_ref, 200);
  END IF;

  v_clean_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');
  IF v_clean_notes IS NOT NULL AND length(v_clean_notes) > 1000 THEN
    v_clean_notes := left(v_clean_notes, 1000);
  END IF;

  -- ── 3. Audit annotation ────────────────────────────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent(
    'Payout marked processed — ref ' || v_clean_ref ||
    COALESCE(' — ' || v_clean_notes, '')
  );

  -- ── 4. Lock + state guard ──────────────────────────────────────────
  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Job is not in completed state (current: %)', v_job.status
      USING ERRCODE = '22000',
            HINT = 'Only completed jobs can be marked as paid.';
  END IF;

  IF v_job.payout_status = 'paid' THEN
    RAISE EXCEPTION 'Job payout is already marked paid'
      USING ERRCODE = '22000',
            HINT = 'Refresh the queue — this row should not be visible.';
  END IF;

  -- ── 5. Settle ──────────────────────────────────────────────────────
  UPDATE public.jobs
  SET payout_status    = 'paid',
      payout_paid_at   = now(),
      payout_reference = v_clean_ref,
      payout_notes     = v_clean_notes,
      payout_marked_by = v_actor,
      updated_at       = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'job_id',         p_job_id,
    'payout_status',  'paid',
    'reference',      v_clean_ref,
    'paid_at',        now(),
    'correlation_id', v_correlation
  );
END;
$$;

COMMENT ON FUNCTION public.admin_mark_payout_processed(uuid, text, text) IS
  'Super_admin records that an inspector payout has been settled. Stripe transfer ref or manual:<context> is required. Audit-annotated. FOR UPDATE locked.';

GRANT EXECUTE ON FUNCTION public.admin_mark_payout_processed(uuid, text, text)
  TO authenticated;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS
-- ════════════════════════════════════════════════════════════════════════════

-- A. Function + columns exist
-- SELECT proname FROM pg_proc WHERE proname = 'admin_mark_payout_processed';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'jobs' AND column_name LIKE 'payout_%';

-- B. Non-admin rejection:
-- SELECT public.admin_mark_payout_processed('<job-id>', 'tr_abc', 'note');
-- Expected: ERROR 42501 — "Only super_admin can mark payouts processed"

-- C. Missing reference rejection:
-- SELECT public.admin_mark_payout_processed('<job-id>', '', null);
-- Expected: ERROR 22000 — "A reference is required (Stripe transfer id, or \"manual:<context>\")"

-- D. Wrong-state rejection:
-- SELECT public.admin_mark_payout_processed('<open-job-id>', 'tr_abc', null);
-- Expected: ERROR 22000 — "Job is not in completed state (current: open)"

-- E. Double-pay rejection:
-- SELECT public.admin_mark_payout_processed('<already-paid-job-id>', 'tr_abc', null);
-- Expected: ERROR 22000 — "Job payout is already marked paid"

-- F. Happy path (admin marks a completed-but-unpaid job):
-- SELECT public.admin_mark_payout_processed('<completed-job-id>', 'tr_3RkjzN2X5Lpqr', 'Stripe Connect transfer');
-- Expected: jsonb ok=true, payout_status='paid'. Verify in audit_events:
--   - One row event_type='jobs.updated' or similar with delta showing
--     payout_status: 'unpaid'/'unset' → 'paid'
--   - The audit row's metadata->>'intent' starts with 'Payout marked processed — ref tr_…'
