-- ============================================================================
-- request_milestone_release · inspector → admin ask for milestone payout
--
-- Context:
--   The original `release_milestone_payment` RPC (migration
--   20260517130000_release_milestone_payment_rpc.sql) was intentionally
--   deferred — that migration is a documented no-op because the deployed
--   `payments` table schema doesn't match the legacy payout payload.
--   See that file for the 4-question business decision tree.
--
--   This RPC fills the user-facing gap WITHOUT touching the payout
--   semantics. The inspector REQUESTS a milestone release; the admin's
--   existing process-payout flow EXECUTES the payout. Separation of
--   request from execution matches the audit_events pattern already
--   used elsewhere in the platform (see admin_resolve_dispute,
--   admin_counter_application, etc.).
--
-- What this RPC does:
--   1. Verify the caller is the assigned contractor on a job that's in
--      `in_progress` or `completed` status.
--   2. Insert an audit_events row of kind 'milestone_release_requested'
--      with the requested amount + optional note.
--   3. Insert one notification per admin via nx_notify so the admin
--      console surfaces the request.
--   4. Idempotency: refuse a second request within 10 minutes of the
--      previous one on the same job — avoids accidental double-taps.
--
-- What this RPC does NOT do:
--   • Touch the `payments` table.
--   • Move money.
--   • Mutate jobs.status or payout_status.
--   The admin's process-payout flow remains the only payout-execution
--   vector. This RPC is purely a request signal.
--
-- Signature:
--   public.request_milestone_release(
--     p_job_id       uuid,
--     p_amount_cents bigint DEFAULT NULL,  -- inspector's ask; null = "full milestone"
--     p_note         text   DEFAULT NULL   -- optional context
--   ) RETURNS jsonb { ok: bool, request_id: uuid, ... }
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.request_milestone_release(uuid, bigint, text);

CREATE OR REPLACE FUNCTION public.request_milestone_release(
  p_job_id       uuid,
  p_amount_cents bigint DEFAULT NULL,
  p_note         text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_job       RECORD;
  v_recent    timestamptz;
  v_event_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'request_milestone_release: not authenticated';
  END IF;

  -- Pull the job + verify caller is the assigned contractor.
  SELECT id, contractor_id, status, title
    INTO v_job
    FROM public.jobs
   WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_milestone_release: job not found';
  END IF;
  IF v_job.contractor_id IS NULL OR v_job.contractor_id <> v_uid THEN
    RAISE EXCEPTION 'request_milestone_release: only the assigned inspector may request';
  END IF;
  IF v_job.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'request_milestone_release: job must be in_progress or completed (got %)', v_job.status;
  END IF;
  IF p_amount_cents IS NOT NULL AND p_amount_cents < 0 THEN
    RAISE EXCEPTION 'request_milestone_release: amount must be non-negative';
  END IF;

  -- 10-minute idempotency window. Look up the most recent request for
  -- this job by this inspector via the audit log.
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT MAX(created_at) INTO v_recent
      FROM public.audit_events
     WHERE event_kind = 'milestone_release_requested'
       AND payload->>'job_id'       = p_job_id::text
       AND payload->>'requested_by' = v_uid::text;
    IF v_recent IS NOT NULL AND v_recent > NOW() - INTERVAL '10 minutes' THEN
      RAISE EXCEPTION 'request_milestone_release: a request is already pending — please wait before retrying';
    END IF;

    INSERT INTO public.audit_events(event_kind, actor_id, payload)
    VALUES (
      'milestone_release_requested',
      v_uid,
      jsonb_build_object(
        'job_id',       p_job_id,
        'job_title',    v_job.title,
        'requested_by', v_uid,
        'amount_cents', p_amount_cents,
        'note',         NULLIF(trim(coalesce(p_note, '')), ''),
        'requested_at', NOW()
      )
    )
    RETURNING id INTO v_event_id;
  END IF;

  -- Notify admins via the canonical nx_notify_admins helper if it exists.
  -- Falls back to a no-op if not — the audit row is the durable signal.
  BEGIN
    IF to_regprocedure('public.nx_notify_admins(text, text, text, text, uuid)') IS NOT NULL THEN
      PERFORM public.nx_notify_admins(
        'Milestone release requested',
        'An inspector has requested a milestone payout on "' || COALESCE(v_job.title, 'a job') || '". Open the job to review.',
        'milestone_release_requested',
        '/admin/jobs?inspect=' || p_job_id::text,
        p_job_id
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Notification failure is non-fatal; the audit row above is the truth.
    RAISE NOTICE 'request_milestone_release: notify_admins failed (non-fatal): %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok',         true,
    'request_id', v_event_id,
    'job_id',     p_job_id,
    'amount_cents', p_amount_cents,
    'requested_at', NOW()
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.request_milestone_release(uuid, bigint, text)
  TO authenticated;

COMMIT;

-- Verify:
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'request_milestone_release';
-- Smoke test (as the assigned inspector on a job in_progress):
--   SELECT public.request_milestone_release(
--     '<job-uuid>'::uuid,
--     50000,             -- $500 ask
--     'Milestone 1 of 3 complete; on-site report uploaded.'
--   );
