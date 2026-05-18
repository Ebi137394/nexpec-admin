-- ════════════════════════════════════════════════════════════════════════════
--  20260512160000_flash_reports.sql
--  NEXPEC — Flash Reports / Non-Conformance Reports (NCR) v1.
--
--  Industrial-grade incident channel. Inspectors, clients, agencies — and
--  the platform admin — raise mid-job concerns about calibration, missing
--  documentation, safety hazards, procedure deviation, defects, or client
--  interference. Reports carry attachments (evidence), a state machine,
--  audit correlation, and admin-grade visibility.
--
--  These are legal documents. Once written, they're never silently mutated.
--  Edits flow through transitions (state machine) and through comments
--  layered on top (v2). All mutations write to audit_events so the
--  Industrial Black Box has a tamper-evident trail.
--
--  What lands here
--  ───────────────
--    1. public.flash_reports — the report itself, job-scoped.
--    2. public.flash_report_attachments — photo/PDF evidence.
--    3. Storage bucket flash-report-attachments (NOT public).
--    4. RLS on both tables: job-parties + super_admin only.
--    5. RPCs (SECURITY DEFINER, audit-correlated):
--         flash_report_create()
--         flash_report_transition()
--         flash_report_add_attachment()
--    6. Indexes for the per-job timeline and admin's critical queue.
--
--  Reversible. Down path at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
--  UP
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. flash_reports table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.flash_reports (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
                                  -- RESTRICT, not CASCADE. NCRs are legal records;
                                  -- deleting a job mustn't silently nuke them.

  reporter_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reporter_role       text        NOT NULL,
                                  -- Snapshot of the reporter's role at raise time
                                  -- ('inspector','client','agency','super_admin').
                                  -- Survives later role/permission changes.

  -- The body
  category            text        NOT NULL,
  severity            text        NOT NULL,
  title               text        NOT NULL,
  description         text        NOT NULL,

  -- Optional context
  location_text       text,
  occurred_at         timestamptz,        -- when the issue happened (may pre-date creation)

  -- Lifecycle / state machine
  status              text        NOT NULL DEFAULT 'open',
  acknowledged_at     timestamptz,
  acknowledged_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_notes    text,

  -- Audit grouping — raise + ack + resolve share one correlation id
  correlation_id      uuid        NOT NULL DEFAULT gen_random_uuid(),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT flash_reports_category_check
    CHECK (category IN (
      'calibration',
      'documentation',
      'safety',
      'procedure',
      'defect',
      'client_interference',
      'other'
    )),
  CONSTRAINT flash_reports_severity_check
    CHECK (severity IN ('observation','minor','major','critical')),
  CONSTRAINT flash_reports_status_check
    CHECK (status IN ('open','acknowledged','in_remediation','resolved','closed','disputed')),
  CONSTRAINT flash_reports_reporter_role_check
    CHECK (reporter_role IN ('inspector','client','agency','super_admin')),
  CONSTRAINT flash_reports_title_len
    CHECK (length(title) BETWEEN 8 AND 160),
  CONSTRAINT flash_reports_description_len
    CHECK (length(description) BETWEEN 20 AND 5000),
  CONSTRAINT flash_reports_resolution_pair
    CHECK (
      (resolved_at IS NULL AND resolved_by IS NULL)
      OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    ),
  CONSTRAINT flash_reports_acknowledgement_pair
    CHECK (
      (acknowledged_at IS NULL AND acknowledged_by IS NULL)
      OR (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)
    )
);

COMMENT ON TABLE public.flash_reports IS
  'NEXPEC Flash Reports / Non-Conformance Reports (NCRs). Raised by any job party during an active job. State machine + attachments + audit-correlated. Legal record — never silently mutated.';

CREATE INDEX IF NOT EXISTS flash_reports_job_idx
  ON public.flash_reports (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS flash_reports_reporter_idx
  ON public.flash_reports (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS flash_reports_open_critical_idx
  ON public.flash_reports (severity, status, created_at DESC)
  WHERE status IN ('open','acknowledged','in_remediation','disputed');


-- ─── 2. flash_report_attachments ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.flash_report_attachments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  flash_report_id     uuid        NOT NULL REFERENCES public.flash_reports(id) ON DELETE CASCADE,
  uploader_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  kind                text        NOT NULL,
  storage_path        text        NOT NULL,
  mime_type           text,
  size_bytes          bigint,
  caption             text,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT flash_report_attachments_kind_check
    CHECK (kind IN ('photo','pdf','document','other')),
  CONSTRAINT flash_report_attachments_size_check
    CHECK (size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 50 * 1024 * 1024)) -- 50 MB cap
);

COMMENT ON TABLE public.flash_report_attachments IS
  'Evidence attached to a flash report. Photos/PDFs/documents stored in the flash-report-attachments storage bucket; this table holds the metadata + path. ON DELETE CASCADE from parent — orphaned blobs are cleaned via a janitor job (v2).';

CREATE INDEX IF NOT EXISTS flash_report_attachments_report_idx
  ON public.flash_report_attachments (flash_report_id, created_at DESC);


-- ─── 3. RLS policies on flash_reports ──────────────────────────────────────
-- Reads: any party to the job (client, agency, contractor) + super_admin.
-- Inserts: blocked at table level — go through flash_report_create RPC so
--          we capture the reporter role snapshot + audit correlation.
-- Updates: blocked at table level — go through flash_report_transition RPC.
-- Deletes: super_admin only (rare; for spam / accidental duplicates).

ALTER TABLE public.flash_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flash_reports_select_parties ON public.flash_reports;
DROP POLICY IF EXISTS flash_reports_select_admin   ON public.flash_reports;
DROP POLICY IF EXISTS flash_reports_no_insert      ON public.flash_reports;
DROP POLICY IF EXISTS flash_reports_no_update      ON public.flash_reports;
DROP POLICY IF EXISTS flash_reports_delete_admin   ON public.flash_reports;

CREATE POLICY flash_reports_select_parties
  ON public.flash_reports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = flash_reports.job_id
        AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
    )
  );

CREATE POLICY flash_reports_select_admin
  ON public.flash_reports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- No INSERT / UPDATE policies — direct writes are denied. Use the RPCs.

CREATE POLICY flash_reports_delete_admin
  ON public.flash_reports
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );


-- ─── 4. RLS policies on flash_report_attachments ───────────────────────────
-- Mirror the parent: parties to the job (resolved via the parent report's
-- job_id) + super_admin can SELECT. INSERTs go through the RPC.

ALTER TABLE public.flash_report_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fr_attachments_select_parties ON public.flash_report_attachments;
DROP POLICY IF EXISTS fr_attachments_select_admin   ON public.flash_report_attachments;
DROP POLICY IF EXISTS fr_attachments_delete_admin   ON public.flash_report_attachments;

CREATE POLICY fr_attachments_select_parties
  ON public.flash_report_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.flash_reports fr
      JOIN public.jobs j ON j.id = fr.job_id
      WHERE fr.id = flash_report_attachments.flash_report_id
        AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
    )
  );

CREATE POLICY fr_attachments_select_admin
  ON public.flash_report_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

CREATE POLICY fr_attachments_delete_admin
  ON public.flash_report_attachments
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );


-- ─── 5. Storage bucket + policies ──────────────────────────────────────────
-- Bucket is NOT public — evidence files must require an authenticated
-- party. The app uses createSignedUrl() (15 min TTL) when rendering a
-- thumbnail to the user.

INSERT INTO storage.buckets (id, name, public)
VALUES ('flash-report-attachments', 'flash-report-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS fr_storage_select_parties ON storage.objects;
DROP POLICY IF EXISTS fr_storage_insert_parties ON storage.objects;
DROP POLICY IF EXISTS fr_storage_delete_admin   ON storage.objects;

-- SELECT: any party to the job whose flash report this object belongs to.
-- Path convention: {flash_report_id}/{uploader_id}/{filename}
-- We extract flash_report_id from the path and join through to the job.
CREATE POLICY fr_storage_select_parties
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'flash-report-attachments'
    AND (
      EXISTS (
        SELECT 1
        FROM public.flash_reports fr
        JOIN public.jobs j ON j.id = fr.job_id
        WHERE fr.id::text = split_part(name, '/', 1)
          AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'super_admin'
      )
    )
  );

-- INSERT: the uploader writes to their own subpath under a parent flash
-- report they're a party to. The RPC layer additionally validates this;
-- the storage policy is defense-in-depth.
CREATE POLICY fr_storage_insert_parties
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'flash-report-attachments'
    AND split_part(name, '/', 2) = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.flash_reports fr
      JOIN public.jobs j ON j.id = fr.job_id
      WHERE fr.id::text = split_part(name, '/', 1)
        AND auth.uid() IN (j.client_id, j.agency_id, j.contractor_id)
    )
  );

CREATE POLICY fr_storage_delete_admin
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'flash-report-attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );


-- ─── 6. RPC: flash_report_create ───────────────────────────────────────────
-- Single authoritative entry point for raising a report. SECURITY DEFINER
-- so it can write audit_events directly. Snapshots the reporter role.
-- Critical-severity raises emit a critical audit event so admin's Black
-- Box surfaces them immediately.

CREATE OR REPLACE FUNCTION public.flash_report_create(
  p_job_id          uuid,
  p_category        text,
  p_severity        text,
  p_title           text,
  p_description     text,
  p_location_text   text DEFAULT NULL,
  p_occurred_at     timestamptz DEFAULT NULL
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

  -- 3. Set audit correlation + intent BEFORE the insert
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent('Flash Report raised: ' || p_severity || '/' || p_category);

  -- 4. Insert the report
  INSERT INTO public.flash_reports (
    id, job_id, reporter_id, reporter_role,
    category, severity, title, description,
    location_text, occurred_at,
    status, correlation_id
  ) VALUES (
    gen_random_uuid(), p_job_id, v_actor, v_role_snapshot,
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

COMMENT ON FUNCTION public.flash_report_create(uuid, text, text, text, text, text, timestamptz) IS
  'Authoritative entry for raising a Flash Report. Snapshots the reporter role, sets audit correlation/intent, and writes a flash_report.raised audit event with critical severity for severity=critical reports.';

REVOKE EXECUTE ON FUNCTION public.flash_report_create(uuid, text, text, text, text, text, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.flash_report_create(uuid, text, text, text, text, text, timestamptz) TO authenticated;


-- ─── 7. RPC: flash_report_transition ───────────────────────────────────────
-- State machine enforcement. Each transition has role-based guards. All
-- transitions are audit-logged and inherit the report's correlation_id.

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
  IF v_actor_profile = 'super_admin' THEN
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
    IF v_actor = v_report.reporter_id AND v_actor_role <> 'super_admin' THEN
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
    IF v_actor_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Only admin can close a resolved report' USING ERRCODE = '42501';
    END IF;
    v_legal := true;

  ELSIF v_report.status IN ('open','acknowledged','in_remediation')
        AND p_to_status = 'disputed' THEN
    -- Anyone EXCEPT super_admin can raise a dispute (admin resolves disputes)
    IF v_actor_role = 'super_admin' THEN
      RAISE EXCEPTION 'Admin does not dispute reports — admin resolves disputes'
        USING ERRCODE = '42501';
    END IF;
    v_legal := true;
    v_event_severity := 'warning';

  ELSIF v_report.status = 'disputed' AND p_to_status = 'acknowledged' THEN
    IF v_actor_role <> 'super_admin' THEN
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

COMMENT ON FUNCTION public.flash_report_transition(uuid, text, text) IS
  'State-machine-enforced transitions for a Flash Report. Role guards: ack by non-reporter party, in_remediation/resolved by inspector or admin, close by admin only, dispute by any party except admin (admin resolves disputes).';

REVOKE EXECUTE ON FUNCTION public.flash_report_transition(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.flash_report_transition(uuid, text, text) TO authenticated;


-- ─── 8. RPC: flash_report_add_attachment ───────────────────────────────────
-- Called by the client AFTER the file has been uploaded to storage. We
-- record the metadata + path on the parent report. Validates party
-- membership + size cap. Storage RLS is defense-in-depth — this RPC is
-- the canonical write surface.

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

  INSERT INTO public.flash_report_attachments (
    flash_report_id, uploader_id, kind, storage_path,
    mime_type, size_bytes, caption
  ) VALUES (
    p_flash_report_id, v_actor, p_kind, p_storage_path,
    p_mime_type, p_size_bytes, p_caption
  )
  RETURNING id INTO v_new_id;

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
  'Records an uploaded evidence file against a flash report. Caller must be a party to the job and the storage path must live under this report''s bucket sub-tree. Closed reports are immutable.';

REVOKE EXECUTE ON FUNCTION public.flash_report_add_attachment(uuid, text, text, text, bigint, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.flash_report_add_attachment(uuid, text, text, text, bigint, text) TO authenticated;


-- ─── 9. updated_at touch trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._touch_updated_at_flash_reports()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flash_reports_touch_updated_at ON public.flash_reports;
CREATE TRIGGER flash_reports_touch_updated_at
  BEFORE UPDATE ON public.flash_reports
  FOR EACH ROW
  EXECUTE FUNCTION public._touch_updated_at_flash_reports();

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
--  SMOKE TESTS — run after the migration
-- ────────────────────────────────────────────────────────────────────────────

-- A. Tables + indexes
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public'
--  AND table_name IN ('flash_reports','flash_report_attachments');                -- 2 rows

-- B. RLS enabled, no INSERT/UPDATE policy on flash_reports
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname='flash_reports';     -- relrowsecurity=t
-- SELECT policyname, cmd FROM pg_policies WHERE tablename='flash_reports';        -- only SELECT + DELETE

-- C. Storage bucket created
-- SELECT id, public FROM storage.buckets WHERE id='flash-report-attachments';     -- public=f

-- D. End-to-end raise + ack
-- BEGIN;
--   SELECT flash_report_create(
--     p_job_id := '<job-uuid>',
--     p_category := 'safety',
--     p_severity := 'major',
--     p_title := 'Loose scaffold board near tank manway',
--     p_description := 'A scaffold board on the south side of T-201 is unsecured. Slip/trip hazard for the inspection crew.'
--   );
--   SELECT id, status FROM flash_reports ORDER BY created_at DESC LIMIT 1;
-- ROLLBACK;
-- Expected: row with status='open' + 1 audit_events row of type 'flash_report.raised'.


-- ────────────────────────────────────────────────────────────────────────────
--  DOWN (manual rollback)
-- ────────────────────────────────────────────────────────────────────────────
--  BEGIN;
--    DROP POLICY IF EXISTS fr_storage_delete_admin   ON storage.objects;
--    DROP POLICY IF EXISTS fr_storage_insert_parties ON storage.objects;
--    DROP POLICY IF EXISTS fr_storage_select_parties ON storage.objects;
--    DELETE FROM storage.buckets WHERE id = 'flash-report-attachments';
--    DROP FUNCTION IF EXISTS public.flash_report_add_attachment(uuid, text, text, text, bigint, text);
--    DROP FUNCTION IF EXISTS public.flash_report_transition(uuid, text, text);
--    DROP FUNCTION IF EXISTS public.flash_report_create(uuid, text, text, text, text, text, timestamptz);
--    DROP TRIGGER IF EXISTS flash_reports_touch_updated_at ON public.flash_reports;
--    DROP FUNCTION IF EXISTS public._touch_updated_at_flash_reports();
--    DROP TABLE IF EXISTS public.flash_report_attachments;
--    DROP TABLE IF EXISTS public.flash_reports;
--  COMMIT;
