-- ════════════════════════════════════════════════════════════════════════════
--  20260722120000_god_mode_admin_root_sql_rpcs.sql
--
--  GOD-MODE completeness: the earlier sweep (20260721) only scanned
--  supabase/migrations/. Two workflow RPCs live ONLY in loose root-level .sql
--  scripts and still hard-code a super_admin-only gate, so a literal `admin`
--  account is blocked from them. This widens both to role IN ('admin','super_admin')
--  (= nx_is_admin), reproduced VERBATIM from source with only the role predicate
--  changed. Self-guarding: each is wrapped so a missing dependency is skipped
--  (RAISE NOTICE) instead of aborting. CREATE OR REPLACE preserves ACLs.
--    • admin_dispatch_job        (hire-loop-hardening.sql) — the dispatch money RPC
--    • flash_report_transition   (20260512160000_flash_reports.sql)
-- ════════════════════════════════════════════════════════════════════════════


-- admin_dispatch_job  [verbatim from hire-loop-hardening.sql, role predicate widened]
DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.admin_dispatch_job(
  p_job_id              uuid,
  p_application_id      uuid,
  p_client_price_cents  bigint,
  p_payout_cents        bigint,
  p_payout_status       text DEFAULT 'unpaid'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor             uuid;
  v_actor_role        text;
  v_job               public.jobs%ROWTYPE;
  v_app               public.applications%ROWTYPE;
  v_correlation       uuid := gen_random_uuid();
  v_rejected_count    int  := 0;
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- ── 2. Authorization: super_admin only ───────────────────────────
  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can dispatch jobs' USING ERRCODE = '42501';
  END IF;

  -- ── 3. Input validation ──────────────────────────────────────────
  IF p_job_id IS NULL OR p_application_id IS NULL THEN
    RAISE EXCEPTION 'job_id and application_id are required' USING ERRCODE = '22000';
  END IF;
  IF p_client_price_cents IS NULL OR p_client_price_cents <= 0 THEN
    RAISE EXCEPTION 'Client price must be greater than zero' USING ERRCODE = '22000';
  END IF;
  IF p_payout_cents IS NULL OR p_payout_cents <= 0 THEN
    RAISE EXCEPTION 'Inspector payout must be greater than zero' USING ERRCODE = '22000';
  END IF;
  IF p_payout_cents > p_client_price_cents THEN
    RAISE EXCEPTION 'Inspector payout cannot exceed client price' USING ERRCODE = '22000';
  END IF;

  -- ── 4. Audit grouping (Phase 5 integration) ──────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Admin Confirm & Dispatch (Spread Editor)');

  -- ── 5. Lock the job row to prevent concurrent dispatch ───────────
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status <> 'open' THEN
    RAISE EXCEPTION 'Job is not in open state (current: %)', v_job.status
      USING ERRCODE = '22000';
  END IF;
  IF v_job.contractor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job already has a contractor assigned' USING ERRCODE = '22000';
  END IF;

  -- ── 6. Lock and validate the target application ──────────────────
  SELECT * INTO v_app
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_app.job_id IS DISTINCT FROM p_job_id THEN
    RAISE EXCEPTION 'Application does not belong to this job' USING ERRCODE = '22000';
  END IF;
  IF v_app.status <> 'CLIENT_SELECTED' THEN
    RAISE EXCEPTION 'Application is not in CLIENT_SELECTED state (current: %)', v_app.status
      USING ERRCODE = '22000';
  END IF;
  IF v_app.applicant_id IS NULL THEN
    RAISE EXCEPTION 'Application has no applicant_id' USING ERRCODE = '22000';
  END IF;

  -- ── 7. Promote target application: CLIENT_SELECTED → hired ───────
  UPDATE public.applications
  SET status     = 'hired',
      updated_at = now()
  WHERE id = p_application_id;

  -- ── 8. Lock job: open → assigned + contractor + confirmation ─────
  UPDATE public.jobs
  SET status              = 'assigned',
      contractor_id       = v_app.applicant_id,
      client_price_cents  = p_client_price_cents,
      payout_amount_cents = p_payout_cents,
      payout_status       = COALESCE(p_payout_status, 'unpaid'),
      admin_confirmed_at  = now(),
      admin_confirmed_by  = v_actor,
      updated_at          = now()
  WHERE id = p_job_id;

  -- ── 9. Reject every other non-terminal application on this job ───
  --     (HIRE-003: this was silently swallowed in the old path; now
  --     it's inside the transaction. If anything blocks it, the
  --     whole dispatch rolls back.)
  WITH rejected AS (
    UPDATE public.applications
    SET status     = 'rejected',
        updated_at = now()
    WHERE job_id = p_job_id
      AND id <> p_application_id
      AND status IN ('pending', 'shortlisted', 'CLIENT_SELECTED', 'offered')
    RETURNING id
  )
  SELECT count(*) INTO v_rejected_count FROM rejected;

  -- ── 10. Return summary ───────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                true,
    'job_id',            p_job_id,
    'application_id',    p_application_id,
    'contractor_id',     v_app.applicant_id,
    'rejected_siblings', v_rejected_count,
    'correlation_id',    v_correlation
  );
END;
$$;
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode-root skip: admin_dispatch_job (%)', SQLERRM;
END $nx_guard$;


-- flash_report_transition  [verbatim from 20260512160000_flash_reports.sql, role predicate widened]
DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.flash_report_transition(
  p_id        uuid,
  p_to_status text,
  p_notes     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          uuid;
  v_actor_role     text;     -- effective role for THIS job + this caller
  v_actor_profile  text;     -- profiles.role
  v_report         public.flash_reports%ROWTYPE;
  v_job            public.jobs%ROWTYPE;
  v_legal          boolean := false;
  v_now            timestamptz := now();
  v_event_severity text := 'info';
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_report FROM public.flash_reports WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flash report not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = v_report.job_id;

  SELECT role INTO v_actor_profile FROM public.profiles WHERE id = v_actor;

  -- Caller's effective role on this job
  IF v_actor_profile IN ('admin','super_admin') THEN
    v_actor_role := 'super_admin';
  ELSIF v_actor = v_job.contractor_id THEN
    v_actor_role := 'inspector';
  ELSIF v_actor = v_job.client_id THEN
    v_actor_role := 'client';
  ELSIF v_actor = v_job.agency_id THEN
    v_actor_role := 'agency';
  ELSE
    RAISE EXCEPTION 'You are not a party to this report''s job'
      USING ERRCODE = '42501';
  END IF;

  -- ── State-machine guards ────────────────────────────────────────
  -- open → acknowledged   : any non-reporter party (so the reporter
  --                         can't ack their own report) or admin
  -- acknowledged → in_remediation : inspector or admin
  -- in_remediation → resolved     : inspector or admin
  -- resolved → closed             : admin only
  -- (open|acknowledged|in_remediation) → disputed : any party except admin
  -- disputed → acknowledged       : admin only

  IF v_report.status = 'open' AND p_to_status = 'acknowledged' THEN
    IF v_actor = v_report.reporter_id AND v_actor_role NOT IN ('admin','super_admin') THEN
      RAISE EXCEPTION 'Reporters cannot acknowledge their own report'
        USING ERRCODE = '42501';
    END IF;
    v_legal := true;

  ELSIF v_report.status = 'acknowledged' AND p_to_status = 'in_remediation' THEN
    IF v_actor_role NOT IN ('inspector','super_admin') THEN
      RAISE EXCEPTION 'Only the inspector or admin can move to in_remediation'
        USING ERRCODE = '42501';
    END IF;
    v_legal := true;

  ELSIF v_report.status = 'in_remediation' AND p_to_status = 'resolved' THEN
    IF v_actor_role NOT IN ('inspector','super_admin') THEN
      RAISE EXCEPTION 'Only the inspector or admin can resolve the report'
        USING ERRCODE = '42501';
    END IF;
    v_legal := true;

  ELSIF v_report.status = 'resolved' AND p_to_status = 'closed' THEN
    IF v_actor_role NOT IN ('admin','super_admin') THEN
      RAISE EXCEPTION 'Only admin can close a resolved report' USING ERRCODE = '42501';
    END IF;
    v_legal := true;

  ELSIF v_report.status IN ('open','acknowledged','in_remediation')
        AND p_to_status = 'disputed' THEN
    -- Anyone EXCEPT super_admin can raise a dispute (admin resolves disputes)
    IF v_actor_role IN ('admin','super_admin') THEN
      RAISE EXCEPTION 'Admin does not dispute reports — admin resolves disputes'
        USING ERRCODE = '42501';
    END IF;
    v_legal := true;
    v_event_severity := 'warning';

  ELSIF v_report.status = 'disputed' AND p_to_status = 'acknowledged' THEN
    IF v_actor_role NOT IN ('admin','super_admin') THEN
      RAISE EXCEPTION 'Only admin can resolve a dispute' USING ERRCODE = '42501';
    END IF;
    v_legal := true;
  END IF;

  IF NOT v_legal THEN
    RAISE EXCEPTION 'Illegal transition % → %', v_report.status, p_to_status
      USING ERRCODE = '22000';
  END IF;

  -- ── Apply the transition + side effects ─────────────────────────
  PERFORM public.audit_set_correlation(v_report.correlation_id);
  PERFORM public.audit_set_intent(
    'Flash Report transition: ' || v_report.status || ' → ' || p_to_status
  );

  -- Field updates depending on the destination status
  IF p_to_status = 'acknowledged' AND v_report.acknowledged_at IS NULL THEN
    UPDATE public.flash_reports
      SET status = p_to_status,
          acknowledged_at = v_now,
          acknowledged_by = v_actor,
          updated_at = v_now
    WHERE id = p_id;

  ELSIF p_to_status = 'resolved' THEN
    UPDATE public.flash_reports
      SET status = p_to_status,
          resolved_at = v_now,
          resolved_by = v_actor,
          resolution_notes = COALESCE(p_notes, resolution_notes),
          updated_at = v_now
    WHERE id = p_id;

  ELSE
    UPDATE public.flash_reports
      SET status = p_to_status,
          resolution_notes = COALESCE(p_notes, resolution_notes),
          updated_at = v_now
    WHERE id = p_id;
  END IF;

  -- Audit
  INSERT INTO public.audit_events (
    event_type, severity,
    actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id,
    summary, delta, metadata, correlation_id
  ) VALUES (
    'flash_report.transition',
    v_event_severity,
    v_actor, v_actor_role, NULL,
    'flash_reports', p_id, v_report.job_id,
    'Flash Report ' || v_report.status || ' → ' || p_to_status,
    jsonb_build_object(
      'before', jsonb_build_object('status', v_report.status),
      'after',  jsonb_build_object('status', p_to_status)
    ),
    jsonb_build_object(
      'flash_report_id', p_id,
      'from', v_report.status,
      'to', p_to_status,
      'notes', p_notes
    ),
    v_report.correlation_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', p_id,
    'from', v_report.status,
    'to', p_to_status
  );
END;
$$;
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode-root skip: flash_report_transition (%)', SQLERRM;
END $nx_guard$;
