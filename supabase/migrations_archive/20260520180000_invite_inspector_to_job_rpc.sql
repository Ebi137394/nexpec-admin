-- ============================================================================
-- invite_inspector_to_job · buyer → inspector invitation signal
--
-- Why this exists:
--   The applications.INSERT RLS policy requires `applicant_id = auth.uid()` —
--   i.e. inspectors apply on their own behalf, never the buyer. To let a
--   client/agency/enterprise INVITE a specific inspector to a job, we need
--   a SECURITY DEFINER RPC that bypasses the buyer-can't-write-applications
--   constraint, in a controlled way.
--
--   The cleanest additive shape: don't actually INSERT into applications.
--   Instead, emit a notification + audit signal. The inspector receives a
--   "You've been invited to bid on X" notification with a deep link to the
--   job; they then apply through the normal applications flow (consent
--   preserved — buyer can invite, but inspector still chooses to apply).
--
--   This keeps the existing applications.INSERT RLS untouched, keeps the
--   ApplicationsManager workflow intact, and adds a discovery primitive
--   without changing the authorisation model.
--
-- Idempotency:
--   The same buyer cannot invite the same inspector to the same job more
--   than once per 24 hours. Tracked via audit_events.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.invite_inspector_to_job(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.invite_inspector_to_job(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_message      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_job          RECORD;
  v_inspector    RECORD;
  v_buyer        RECORD;
  v_recent       timestamptz;
  v_event_id     uuid;
  v_buyer_label  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'invite_inspector_to_job: not authenticated';
  END IF;

  -- Verify the caller owns the job (client_id or agency_id matches).
  SELECT id, client_id, agency_id, title, status
    INTO v_job
    FROM public.jobs
   WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_inspector_to_job: job not found';
  END IF;
  IF v_uid <> COALESCE(v_job.client_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND v_uid <> COALESCE(v_job.agency_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND NOT public.nx_is_admin()
  THEN
    RAISE EXCEPTION 'invite_inspector_to_job: only the job owner (or admin) may invite';
  END IF;
  IF v_job.status NOT IN ('open', 'pending_approval') THEN
    RAISE EXCEPTION 'invite_inspector_to_job: job is not accepting invitations (status=%)', v_job.status;
  END IF;

  -- Verify target is actually an inspector profile.
  SELECT id, role, full_name, is_verified
    INTO v_inspector
    FROM public.profiles
   WHERE id = p_inspector_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_inspector_to_job: inspector not found';
  END IF;
  IF v_inspector.role <> 'inspector' THEN
    RAISE EXCEPTION 'invite_inspector_to_job: target profile is not an inspector (role=%)', v_inspector.role;
  END IF;

  -- 24-hour idempotency: same buyer + same job + same inspector.
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT MAX(created_at) INTO v_recent
      FROM public.audit_events
     WHERE event_kind = 'inspector_invited_to_job'
       AND payload->>'job_id'       = p_job_id::text
       AND payload->>'inspector_id' = p_inspector_id::text
       AND payload->>'invited_by'   = v_uid::text;
    IF v_recent IS NOT NULL AND v_recent > NOW() - INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'invite_inspector_to_job: this inspector was already invited to this job in the last 24 hours';
    END IF;

    INSERT INTO public.audit_events(event_kind, actor_id, payload)
    VALUES (
      'inspector_invited_to_job',
      v_uid,
      jsonb_build_object(
        'job_id',       p_job_id,
        'job_title',    v_job.title,
        'inspector_id', p_inspector_id,
        'invited_by',   v_uid,
        'message',      NULLIF(trim(coalesce(p_message, '')), ''),
        'invited_at',   NOW()
      )
    )
    RETURNING id INTO v_event_id;
  END IF;

  -- Pull a friendly buyer label for the notification copy.
  SELECT COALESCE(NULLIF(trim(company_name), ''), NULLIF(trim(full_name), ''), 'A NEXPEC buyer')
    INTO v_buyer_label
    FROM public.profiles
   WHERE id = v_uid;

  -- Notify the inspector via the canonical nx_notify helper.
  BEGIN
    IF to_regprocedure('public.nx_notify(uuid, text, text, text, text, uuid)') IS NOT NULL THEN
      PERFORM public.nx_notify(
        p_inspector_id,
        v_buyer_label || ' invited you to bid on a job',
        COALESCE(p_message, 'Open the job to review the brief and apply if you''re interested.'),
        'inspector_invited_to_job',
        '/job-details/' || p_job_id::text,
        p_job_id
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Notification failure is non-fatal — the audit row above is the truth.
    RAISE NOTICE 'invite_inspector_to_job: notify failed (non-fatal): %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok',           true,
    'invitation_id', v_event_id,
    'job_id',       p_job_id,
    'inspector_id', p_inspector_id,
    'invited_at',   NOW()
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.invite_inspector_to_job(uuid, uuid, text)
  TO authenticated;

COMMIT;

-- Verify:
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'invite_inspector_to_job';
-- Smoke test (as a client / agency owning a job in 'open' status):
--   SELECT public.invite_inspector_to_job(
--     '<job-uuid>'::uuid,
--     '<inspector-profile-uuid>'::uuid,
--     'We''d love your eyes on this — your API 510 experience is a great fit.'
--   );
