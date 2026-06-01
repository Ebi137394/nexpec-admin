-- ════════════════════════════════════════════════════════════════════════════
--  20260718120000_flash_report_offline_idempotency.sql
--
--  MAKE THE FLASH-REPORT (NCR) RAISE FLOW OFFLINE-SAFE.
--
--  WHY
--  ───
--  Raising a Flash Report did three DIRECT network writes from the field screen
--  (flash_report_create RPC → storage.upload → flash_report_add_attachment RPC),
--  none routed through the offline outbox. With no signal the upload threw
--  "TypeError: Network request failed", the raise aborted, and nothing queued —
--  the inspector's NCR + evidence were lost. The mobile app now queues the whole
--  raise as ONE outbox op (src/core/offline) that drains FIFO when connectivity
--  returns. See [[project_outbox_routing_guardrail]] and the capture remediation.
--
--  Two things the queue needs from the server to be correct under at-least-once
--  delivery:
--    1. A CLIENT-KNOWN report id. flash_report_create generated the id server-
--       side (gen_random_uuid), so offline the client could not know the id the
--       attachments must reference. It now accepts an optional p_client_id; the
--       client generates the id, queues create + attachments under it, and they
--       drain in order. Idempotent: a replay of create returns the existing row.
--    2. Idempotent attachment insert. A retry of flash_report_add_attachment used
--       to insert a DUPLICATE evidence row. It now dedups on
--       (flash_report_id, storage_path) — the path is computed once at enqueue
--       and stored in the op payload, so retries reuse it.
--
--  SAFETY / COMPAT
--  ───────────────
--   • flash_report_create: signature changes (one new trailing param), so it is
--     DROP+CREATEd and EXECUTE is re-granted to authenticated (REVOKEd from
--     PUBLIC) exactly as the original. Body reproduced verbatim apart from the
--     idempotency guard + COALESCE(p_client_id, gen_random_uuid()).
--   • flash_report_add_attachment: same signature → CREATE OR REPLACE (grant
--     preserved). Body reproduced verbatim apart from ON CONFLICT DO NOTHING.
--   • Online callers that pass no p_client_id keep the exact prior behavior.
--   • Idempotent + re-runnable. flash_reports/flash_report_attachments exist by
--     apply time (created in the 20260512 flash-reports migration).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Attachment idempotency key: one evidence row per (report, storage path) ──
CREATE UNIQUE INDEX IF NOT EXISTS flash_report_attachments_report_path_key
  ON public.flash_report_attachments (flash_report_id, storage_path);

-- 2) flash_report_create — add p_client_id + idempotent replay ────────────────
DROP FUNCTION IF EXISTS public.flash_report_create(
  uuid, text, text, text, text, text, timestamptz);

CREATE FUNCTION public.flash_report_create(
  p_job_id          uuid,
  p_category        text,
  p_severity        text,
  p_title           text,
  p_description     text,
  p_location_text   text DEFAULT NULL,
  p_occurred_at     timestamptz DEFAULT NULL,
  p_client_id       uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor           uuid;
  v_job             public.jobs%ROWTYPE;
  v_role_snapshot   text;
  v_new_id          uuid;
  v_correlation     uuid := gen_random_uuid();
  v_severity_label  text;
BEGIN
  -- 1. Auth
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- 2. Validate the job + caller is a party
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  -- Determine reporter role snapshot. Order matters: contractor first,
  -- then client/agency, then super_admin.
  IF v_actor = v_job.contractor_id THEN
    v_role_snapshot := 'inspector';
  ELSIF v_actor = v_job.client_id THEN
    v_role_snapshot := 'client';
  ELSIF v_actor = v_job.agency_id THEN
    v_role_snapshot := 'agency';
  ELSIF EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role = 'super_admin'
  ) THEN
    v_role_snapshot := 'super_admin';
  ELSE
    RAISE EXCEPTION 'Only parties to the job (or super_admin) can raise a flash report'
      USING ERRCODE = '42501';
  END IF;

  -- ★ IDEMPOTENT REPLAY (offline outbox) ★ — if the client supplied an id and
  -- the report already exists, return it unchanged (no second insert / audit).
  -- Gated behind the party check above so only a party can resolve an id.
  IF p_client_id IS NOT NULL THEN
    SELECT id, correlation_id, reporter_role
      INTO v_new_id, v_correlation, v_role_snapshot
      FROM public.flash_reports
     WHERE id = p_client_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'id', v_new_id,
        'correlation_id', v_correlation,
        'reporter_role', v_role_snapshot
      );
    END IF;
  END IF;

  -- 3. Set audit correlation + intent BEFORE the insert
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Flash Report raised: ' || p_severity || '/' || p_category);

  -- 4. Insert the report (client-supplied id when present → offline-known id)
  INSERT INTO public.flash_reports (
    id, job_id, reporter_id, reporter_role,
    category, severity, title, description,
    location_text, occurred_at,
    status, correlation_id
  ) VALUES (
    COALESCE(p_client_id, gen_random_uuid()), p_job_id, v_actor, v_role_snapshot,
    p_category, p_severity, p_title, p_description,
    p_location_text, p_occurred_at,
    'open', v_correlation
  )
  RETURNING id INTO v_new_id;

  -- 5. Manual audit event — flash_reports has no audit trigger
  v_severity_label := CASE
    WHEN p_severity = 'critical' THEN 'critical'
    WHEN p_severity = 'major' THEN 'warning'
    ELSE 'info'
  END;

  INSERT INTO public.audit_events (
    event_type, severity,
    actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id,
    summary, delta, metadata, correlation_id
  ) VALUES (
    'flash_report.raised',
    v_severity_label,
    v_actor, v_role_snapshot, NULL,
    'flash_reports', v_new_id, p_job_id,
    'Flash Report raised — ' || p_severity || ' / ' || p_category || ': ' || p_title,
    jsonb_build_object('after', jsonb_build_object(
      'severity', p_severity, 'category', p_category, 'title', p_title
    )),
    jsonb_build_object(
      'intent', 'Flash Report raised',
      'flash_report_id', v_new_id,
      'severity', p_severity,
      'category', p_category
    ),
    v_correlation
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_new_id,
    'correlation_id', v_correlation,
    'reporter_role', v_role_snapshot
  );
END;
$$;

COMMENT ON FUNCTION public.flash_report_create(uuid, text, text, text, text, text, timestamptz, uuid) IS
  'Authoritative entry for raising a Flash Report. Snapshots the reporter role, sets audit correlation/intent, writes a flash_report.raised audit event. Accepts an optional client-supplied id (p_client_id) so the raise can be queued offline; idempotent replay returns the existing row (20260718).';

REVOKE EXECUTE ON FUNCTION public.flash_report_create(uuid, text, text, text, text, text, timestamptz, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.flash_report_create(uuid, text, text, text, text, text, timestamptz, uuid) TO authenticated;

-- 3) flash_report_add_attachment — idempotent on (report, storage_path) ───────
CREATE OR REPLACE FUNCTION public.flash_report_add_attachment(
  p_flash_report_id  uuid,
  p_kind             text,
  p_storage_path     text,
  p_mime_type        text DEFAULT NULL,
  p_size_bytes       bigint DEFAULT NULL,
  p_caption          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid;
  v_report     public.flash_reports%ROWTYPE;
  v_job        public.jobs%ROWTYPE;
  v_new_id     uuid;
  v_actor_role text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_report FROM public.flash_reports WHERE id = p_flash_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flash report not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = v_report.job_id;

  IF v_actor = v_job.contractor_id THEN
    v_actor_role := 'inspector';
  ELSIF v_actor = v_job.client_id THEN
    v_actor_role := 'client';
  ELSIF v_actor = v_job.agency_id THEN
    v_actor_role := 'agency';
  ELSIF EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role = 'super_admin'
  ) THEN
    v_actor_role := 'super_admin';
  ELSE
    RAISE EXCEPTION 'Not a party to this report''s job' USING ERRCODE = '42501';
  END IF;

  -- Closed reports are immutable
  IF v_report.status = 'closed' THEN
    RAISE EXCEPTION 'Cannot attach evidence to a closed report' USING ERRCODE = '22000';
  END IF;

  -- Storage path must point at our bucket sub-tree for this report.
  IF split_part(p_storage_path, '/', 1) <> v_report.id::text THEN
    RAISE EXCEPTION 'Storage path does not belong to this report' USING ERRCODE = '22000';
  END IF;

  -- ★ IDEMPOTENT (offline outbox) ★ — a retry re-delivers the same
  -- (report, storage_path); dedup to the original row, skipping a duplicate
  -- evidence record + audit event.
  INSERT INTO public.flash_report_attachments (
    flash_report_id, uploader_id, kind, storage_path,
    mime_type, size_bytes, caption
  ) VALUES (
    p_flash_report_id, v_actor, p_kind, p_storage_path,
    p_mime_type, p_size_bytes, p_caption
  )
  ON CONFLICT (flash_report_id, storage_path) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NULL THEN
    SELECT id INTO v_new_id
      FROM public.flash_report_attachments
     WHERE flash_report_id = p_flash_report_id
       AND storage_path = p_storage_path;
    RETURN jsonb_build_object('ok', true, 'attachment_id', v_new_id);
  END IF;

  -- Audit
  PERFORM public.audit_set_correlation(v_report.correlation_id);
  PERFORM public.audit_set_intent('Flash Report attachment added');

  INSERT INTO public.audit_events (
    event_type, severity,
    actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id,
    summary, delta, metadata, correlation_id
  ) VALUES (
    'flash_report.attachment_added',
    'info',
    v_actor, v_actor_role, NULL,
    'flash_reports', p_flash_report_id, v_report.job_id,
    'Evidence attached (' || p_kind || ')',
    '{}'::jsonb,
    jsonb_build_object(
      'flash_report_id', p_flash_report_id,
      'attachment_id', v_new_id,
      'kind', p_kind,
      'storage_path', p_storage_path,
      'mime_type', p_mime_type,
      'size_bytes', p_size_bytes
    ),
    v_report.correlation_id
  );

  RETURN jsonb_build_object('ok', true, 'attachment_id', v_new_id);
END;
$$;

COMMENT ON FUNCTION public.flash_report_add_attachment(uuid, text, text, text, bigint, text) IS
  'Records an uploaded evidence file against a flash report. Caller must be a party to the job; storage path must live under this report''s sub-tree; closed reports are immutable. Idempotent on (flash_report_id, storage_path) for offline-outbox at-least-once delivery (20260718).';

NOTIFY pgrst, 'reload schema';

COMMIT;
