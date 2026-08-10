-- ════════════════════════════════════════════════════════════════════════════
--  20260801370000_invite_inspector_audit_repair.sql
--
--  THIRD live 42703 of the same family. Repair, not redesign.
--
--  invite_inspector_to_job (baseline:12849) is called from a LIVE mobile screen
--  (app/inspector-directory.tsx:281 — "message, send"). It fails on every call:
--
--    • it INSERTs audit_events(event_kind, actor_id, payload) — neither
--      event_kind nor payload exists on that table (the real columns are
--      event_type and metadata), and
--    • it omits subject_table, subject_id and summary, all of which are NOT
--      NULL with no default. So even with the names corrected it would throw
--      23502.
--    • its own 24-hour duplicate-invite guard reads the same two phantom
--      columns, so the guard could never have worked either.
--
--  Inviting an inspector to a job has therefore never worked from the app.
--
--  FIX — mechanical, and the other 95 lines are reproduced byte-for-byte from
--  the baseline (extracted programmatically, substitutions asserted):
--      event_kind  → event_type
--      payload     → metadata          (in the guard SELECT and the INSERT)
--      + subject_table = 'jobs', subject_id = p_job_id, job_id = p_job_id,
--        summary = 'Inspector invited to job'
--
--  Nothing about the invite semantics, authorization, rate limit or messaging
--  changes. It simply stops erroring.
--
--  ── STILL BROKEN, DELIBERATELY NOT TOUCHED — FROZEN PAYMENT DOMAIN ─────────
--  The same sweep found three more live functions with this defect. All three
--  are payment functions, so they are REPORTED, NOT FIXED, pending explicit
--  direction:
--      handle_job_cancellation   INSERTs transactions(wallet_id …) — no such column
--      handle_job_completion     INSERTs transactions(wallet_id, net_amount,
--                                fee_amount …) — none of the three exist  (x2 sites)
--      request_milestone_release INSERTs audit_events(event_kind, payload)
--  The first two mean settlement bookkeeping raises 42703 at the moment it runs.
--  request_milestone_release's defect is only in its AUDIT write, but the
--  function is squarely inside the frozen domain, so it is left alone too.
--  See docs/CAPABILITY-RECONCILIATION.md.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION "public"."invite_inspector_to_job"("p_job_id" "uuid", "p_inspector_id" "uuid", "p_message" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_job          RECORD;
  v_inspector    RECORD;
  v_recent       timestamptz;
  v_event_id     uuid;
  v_buyer_label  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'invite_inspector_to_job: not authenticated';
  END IF;

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

  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT MAX(created_at) INTO v_recent
      FROM public.audit_events
     WHERE event_type = 'inspector_invited_to_job'
       AND metadata->>'job_id'       = p_job_id::text
       AND metadata->>'inspector_id' = p_inspector_id::text
       AND metadata->>'invited_by'   = v_uid::text;
    IF v_recent IS NOT NULL AND v_recent > NOW() - INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'invite_inspector_to_job: this inspector was already invited to this job in the last 24 hours';
    END IF;

    INSERT INTO public.audit_events(event_type, actor_id, subject_table, subject_id,
                                  job_id, summary, metadata)
    VALUES (
      'inspector_invited_to_job',
      v_uid,
      'jobs',
      p_job_id,
      p_job_id,
      'Inspector invited to job',
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

  SELECT COALESCE(NULLIF(trim(company_name), ''), NULLIF(trim(full_name), ''), 'A NEXPEC buyer')
    INTO v_buyer_label
    FROM public.profiles
   WHERE id = v_uid;

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
    RAISE NOTICE 'invite_inspector_to_job: notify failed (non-fatal): %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok',            true,
    'invitation_id', v_event_id,
    'job_id',        p_job_id,
    'inspector_id',  p_inspector_id,
    'invited_at',    NOW()
  );
END
$$;

DO $test$
DECLARE d text := pg_get_functiondef('public.invite_inspector_to_job(uuid,uuid,text)'::regprocedure);
BEGIN
  IF d ~* '\mevent_kind\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: invite_inspector_to_job still writes audit_events.event_kind';
  END IF;
  IF d ~* '\mpayload\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: invite_inspector_to_job still references audit_events.payload';
  END IF;
  IF position('subject_table' IN d) = 0 OR position('subject_id' IN d) = 0 OR position('summary' IN d) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the NOT NULL audit columns are not supplied — the INSERT would 23502';
  END IF;
  IF d ~* '\m(payout|wallet|transactions|admin_confirmed_at)\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the invite repair touches a money surface';
  END IF;
  RAISE NOTICE 'invite_inspector_to_job repaired: audit write uses the real audit_events shape.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
