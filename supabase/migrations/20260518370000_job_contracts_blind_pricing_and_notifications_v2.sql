-- ============================================================================
-- JOB CONTRACTS + BLIND PRICING + BULLETPROOF NOTIFICATIONS (Sprint 14)
--
-- 1. New table `job_contracts` — binding agreement for ONE inspection job.
--    Distinct from the existing `contracts` table (MSA / NDA / DPA).
--
-- 2. BLIND PRICING ENFORCEMENT:
--      • Base table `job_contracts` is admin-only at the SELECT level.
--      • Two role-specific VIEWS (`client_job_contracts_view`,
--        `inspector_job_contracts_view`) each project ONLY the columns that
--        role is allowed to see.
--      • SECURITY DEFINER sign-RPCs validate caller identity, then UPDATE
--        the base table — clients/inspectors can never reach the hidden
--        price column via PostgREST even if they craft a custom query.
--
-- 3. NOTIFICATIONS REWRITE — `public.create_system_notification(...)` is
--    a SECURITY DEFINER function callable from any trigger. It inserts
--    into `notifications` and bumps the profile unread counter,
--    completely bypassing RLS that has been silently swallowing prior
--    cross-role pushes.
--
-- 4. AUTO STATUS PROMOTION: when both parties sign, a trigger flips
--    `jobs.status` to 'in_progress' atomically.
-- ============================================================================

BEGIN;

-- ─── 1) Base table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_contracts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                   uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  application_id           uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  client_id                uuid NOT NULL,
  inspector_id             uuid NOT NULL,
  -- TWO prices. Blind to the OTHER party.
  client_price_cents       bigint NOT NULL,
  inspector_payout_cents   bigint NOT NULL,
  -- Generated contract text + optional client-uploaded custom template
  contract_text_md         text,
  custom_contract_url      text,
  -- State machine
  status                   text NOT NULL DEFAULT 'pending_client_signature',
  -- Signature evidence
  client_signed_at         timestamptz,
  client_signed_name       text,
  client_signed_ip         text,
  inspector_signed_at      timestamptz,
  inspector_signed_name    text,
  inspector_signed_ip      text,
  -- Cancellation
  voided_at                timestamptz,
  voided_by                uuid,
  voided_reason            text,
  -- Meta
  generated_by             uuid,
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT job_contracts_status_check CHECK (status IN (
    'pending_client_signature',
    'pending_inspector_signature',
    'fully_executed',
    'voided'
  )),
  CONSTRAINT job_contracts_prices_nonneg CHECK (
    client_price_cents >= 0 AND inspector_payout_cents >= 0
  )
);

-- One ACTIVE contract per job (voided rows don't block re-issue).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_job_contracts_active_per_job
  ON public.job_contracts(job_id)
  WHERE status <> 'voided';

CREATE INDEX IF NOT EXISTS idx_job_contracts_client
  ON public.job_contracts(client_id, status);
CREATE INDEX IF NOT EXISTS idx_job_contracts_inspector
  ON public.job_contracts(inspector_id, status);

CREATE OR REPLACE FUNCTION public.touch_job_contracts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_job_contracts_updated_at ON public.job_contracts;
CREATE TRIGGER trg_job_contracts_updated_at
  BEFORE UPDATE ON public.job_contracts
  FOR EACH ROW EXECUTE FUNCTION public.touch_job_contracts_updated_at();

-- ─── 2) Base-table RLS: admin-only direct access ───────────────────────
ALTER TABLE public.job_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_contracts_admin_select" ON public.job_contracts;
CREATE POLICY "job_contracts_admin_select"
  ON public.job_contracts FOR SELECT
  TO authenticated
  USING (public.nx_is_admin());

-- Direct INSERT/UPDATE/DELETE locked to admin — clients/inspectors mutate
-- ONLY via the SECURITY DEFINER sign-RPCs below.
DROP POLICY IF EXISTS "job_contracts_admin_mutate" ON public.job_contracts;
CREATE POLICY "job_contracts_admin_mutate"
  ON public.job_contracts FOR ALL
  TO authenticated
  USING (public.nx_is_admin())
  WITH CHECK (public.nx_is_admin());

-- Revoke broad table-level grants — only specific views grant access.
REVOKE ALL ON public.job_contracts FROM authenticated;
GRANT SELECT ON public.job_contracts TO authenticated; -- RLS still gates

-- ─── 3) Blind-pricing VIEWS ────────────────────────────────────────────
--
-- These views are the ONLY surface clients + inspectors should query. Each
-- projects strictly the columns that role is allowed to see. The WHERE
-- clause enforces row ownership independent of base-table RLS, so even if
-- the base RLS were ever loosened by mistake, the views remain safe.

DROP VIEW IF EXISTS public.client_job_contracts_view;
CREATE VIEW public.client_job_contracts_view AS
SELECT
  id, job_id, application_id, client_id, inspector_id,
  client_price_cents,           -- ← client sees their price only
  status,
  contract_text_md, custom_contract_url,
  client_signed_at, client_signed_name,
  inspector_signed_at,
  voided_at, voided_reason,
  created_at, updated_at
FROM public.job_contracts
WHERE client_id = auth.uid() OR public.nx_is_admin();

DROP VIEW IF EXISTS public.inspector_job_contracts_view;
CREATE VIEW public.inspector_job_contracts_view AS
SELECT
  id, job_id, application_id, client_id, inspector_id,
  inspector_payout_cents,       -- ← inspector sees their payout only
  status,
  contract_text_md, custom_contract_url,
  client_signed_at,
  inspector_signed_at, inspector_signed_name,
  voided_at, voided_reason,
  created_at, updated_at
FROM public.job_contracts
WHERE inspector_id = auth.uid() OR public.nx_is_admin();

GRANT SELECT ON public.client_job_contracts_view TO authenticated;
GRANT SELECT ON public.inspector_job_contracts_view TO authenticated;

-- ─── 4) NOTIFICATIONS REWRITE — bulletproof entry point ────────────────
--
-- Drop-in replacement that ALL triggers + RPCs use going forward. Bypasses
-- notifications-table RLS via SECURITY DEFINER. Logs (RAISE NOTICE) instead
-- of throwing so a notification failure NEVER blocks the calling action.

CREATE OR REPLACE FUNCTION public.create_system_notification(
  p_user_id  uuid,
  p_title    text,
  p_body     text,
  p_type     text,
  p_link     text DEFAULT NULL,
  p_job_id   uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications(recipient_id, kind, title, body, link_href, job_id)
    VALUES (p_user_id, p_type, p_title, p_body, p_link, p_job_id)
    RETURNING id INTO v_id;

  -- Bump the cached unread counter — try / catch so a missing column
  -- never blocks the notify.
  BEGIN
    UPDATE public.profiles
       SET unread_notifications_count = COALESCE(unread_notifications_count, 0) + 1
     WHERE id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'create_system_notification: counter bump failed: %', SQLERRM;
  END;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'create_system_notification(%, %): %', p_user_id, p_title, SQLERRM;
  RETURN NULL;
END $fn$;

GRANT EXECUTE ON FUNCTION public.create_system_notification(uuid, text, text, text, text, uuid) TO authenticated;

-- Admin-broadcast helper (loops over admin profiles)
CREATE OR REPLACE FUNCTION public.create_admin_notification(
  p_title  text,
  p_body   text,
  p_type   text,
  p_link   text DEFAULT NULL,
  p_job_id uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r RECORD; v_count int := 0;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role IN ('admin', 'super_admin')
  LOOP
    PERFORM public.create_system_notification(r.id, p_title, p_body, p_type, p_link, p_job_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $fn$;

GRANT EXECUTE ON FUNCTION public.create_admin_notification(text, text, text, text, uuid) TO authenticated;

-- ─── 5) Sign RPCs — the only way clients/inspectors mutate contracts ──

CREATE OR REPLACE FUNCTION public.admin_generate_job_contract(
  p_application_id      uuid,
  p_client_price_cents  bigint,
  p_inspector_payout_cents bigint,
  p_contract_text_md    text DEFAULT NULL,
  p_custom_contract_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_app  RECORD;
  v_id   uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_client_price_cents < 0 OR p_inspector_payout_cents < 0 THEN
    RAISE EXCEPTION 'prices must be non-negative';
  END IF;

  SELECT a.id, a.job_id, a.applicant_id, j.client_id
    INTO v_app
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
   WHERE a.id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  -- Void any prior active contract for this job
  UPDATE public.job_contracts
     SET status = 'voided',
         voided_at = NOW(),
         voided_by = auth.uid(),
         voided_reason = 'Superseded by new generation'
   WHERE job_id = v_app.job_id AND status <> 'voided';

  INSERT INTO public.job_contracts(
    job_id, application_id, client_id, inspector_id,
    client_price_cents, inspector_payout_cents,
    contract_text_md, custom_contract_url,
    status, generated_by
  )
  VALUES (
    v_app.job_id, v_app.id, v_app.client_id, v_app.applicant_id,
    p_client_price_cents, p_inspector_payout_cents,
    p_contract_text_md, p_custom_contract_url,
    'pending_client_signature', auth.uid()
  )
  RETURNING id INTO v_id;

  -- Notify client
  PERFORM public.create_system_notification(
    v_app.client_id,
    'Contract ready for signature',
    'Admin has prepared the contract for your job. Review and sign to commit funds.',
    'contract_assigned',
    '/client/contracts/job/' || v_id::text,
    v_app.job_id
  );

  RETURN jsonb_build_object('ok', true, 'contract_id', v_id);
END $fn$;

GRANT EXECUTE ON FUNCTION public.admin_generate_job_contract(uuid, bigint, bigint, text, text) TO authenticated;

-- Client sign
CREATE OR REPLACE FUNCTION public.client_sign_job_contract(
  p_contract_id uuid,
  p_typed_name  text,
  p_ip          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF v_c.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'only the client can sign this contract';
  END IF;
  IF v_c.status <> 'pending_client_signature' THEN
    RAISE EXCEPTION 'contract not awaiting client signature (status=%)', v_c.status;
  END IF;
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN
    RAISE EXCEPTION 'type your full legal name to sign';
  END IF;

  UPDATE public.job_contracts SET
    client_signed_at   = NOW(),
    client_signed_name = trim(p_typed_name),
    client_signed_ip   = p_ip,
    status             = 'pending_inspector_signature'
  WHERE id = p_contract_id;

  -- Notify inspector
  PERFORM public.create_system_notification(
    v_c.inspector_id,
    'Client signed — your turn',
    'Open the contract to sign and accept the assignment.',
    'contract_assigned',
    '/inspector/contracts/job/' || p_contract_id::text,
    v_c.job_id
  );

  -- Notify admins (audit)
  PERFORM public.create_admin_notification(
    'Client signed a job contract',
    'Awaiting inspector signature.',
    'contract_assigned',
    '/admin/jobs?inspect=' || v_c.job_id::text,
    v_c.job_id
  );

  RETURN jsonb_build_object('ok', true, 'status', 'pending_inspector_signature');
END $fn$;

GRANT EXECUTE ON FUNCTION public.client_sign_job_contract(uuid, text, text) TO authenticated;

-- Inspector sign
CREATE OR REPLACE FUNCTION public.inspector_sign_job_contract(
  p_contract_id uuid,
  p_typed_name  text,
  p_ip          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF v_c.inspector_id <> auth.uid() THEN
    RAISE EXCEPTION 'only the assigned inspector can sign';
  END IF;
  IF v_c.status <> 'pending_inspector_signature' THEN
    RAISE EXCEPTION 'contract not awaiting inspector signature (status=%)', v_c.status;
  END IF;
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN
    RAISE EXCEPTION 'type your full legal name to sign';
  END IF;

  UPDATE public.job_contracts SET
    inspector_signed_at   = NOW(),
    inspector_signed_name = trim(p_typed_name),
    inspector_signed_ip   = p_ip,
    status                = 'fully_executed'
  WHERE id = p_contract_id;

  -- Atomically flip job status to in_progress + write the canonical
  -- pricing onto the job row.
  UPDATE public.jobs SET
    status                 = 'in_progress',
    hired_inspector_id     = v_c.inspector_id,
    inspector_payout_cents = v_c.inspector_payout_cents,
    payout_amount_cents    = v_c.inspector_payout_cents,
    client_price_cents     = v_c.client_price_cents,
    updated_at             = NOW()
  WHERE id = v_c.job_id;

  -- Notify client + inspector + admins
  PERFORM public.create_system_notification(
    v_c.client_id, 'Contract fully executed',
    'Inspector signed. Job is now in progress.',
    'contract_assigned',
    '/client/jobs/' || v_c.job_id::text, v_c.job_id);
  PERFORM public.create_system_notification(
    v_c.inspector_id, 'Job confirmed',
    'You signed the contract. Job is now in progress on your dashboard.',
    'assignment',
    '/inspector/jobs/' || v_c.job_id::text, v_c.job_id);
  PERFORM public.create_admin_notification(
    'Contract fully executed',
    'Both parties signed. Job moved to in_progress.',
    'contract_assigned',
    '/admin/jobs?inspect=' || v_c.job_id::text, v_c.job_id);

  RETURN jsonb_build_object('ok', true, 'status', 'fully_executed');
END $fn$;

GRANT EXECUTE ON FUNCTION public.inspector_sign_job_contract(uuid, text, text) TO authenticated;

-- ─── 6) Trigger-fired notifications — clean, isolated, idempotent ───────

-- Jobs (new + status / moderation_status changes)
CREATE OR REPLACE FUNCTION public.tg_jobs_notifications_v2()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_client uuid;
  v_inspector uuid;
  v_title text;
BEGIN
  v_client    := COALESCE(NEW.client_id, NEW.agency_id);
  v_inspector := COALESCE(NEW.hired_inspector_id, NEW.inspector_id);
  v_title     := COALESCE(NULLIF(NEW.title, ''), 'Inspection job');

  IF TG_OP = 'INSERT' THEN
    PERFORM public.create_admin_notification(
      'New job posted', v_title, 'job_moderated',
      '/admin/jobs?inspect=' || NEW.id::text, NEW.id);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
      IF v_client IS NOT NULL THEN
        PERFORM public.create_system_notification(
          v_client,
          CASE NEW.moderation_status
            WHEN 'approved' THEN 'Job approved'
            WHEN 'rejected' THEN 'Job rejected'
            WHEN 'edits_requested' THEN 'Edits requested on your job'
            ELSE 'Job moderation updated'
          END,
          v_title, 'job_moderated',
          '/client/jobs/' || NEW.id::text, NEW.id);
      END IF;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF v_inspector IS NOT NULL THEN
        PERFORM public.create_system_notification(
          v_inspector,
          CASE NEW.status
            WHEN 'in_progress' THEN 'Job in progress'
            WHEN 'completed'   THEN 'Job marked complete'
            WHEN 'cancelled'   THEN 'Job cancelled'
            ELSE 'Job status updated'
          END,
          v_title, 'assignment',
          '/inspector/jobs/' || NEW.id::text, NEW.id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_jobs_notifications_v2: %', SQLERRM;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jobs_notifications_v2 ON public.jobs;
CREATE TRIGGER trg_jobs_notifications_v2
  AFTER INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_notifications_v2();

-- Applications
CREATE OR REPLACE FUNCTION public.tg_applications_notifications_v2()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_client uuid; v_title text;
BEGIN
  SELECT COALESCE(client_id, agency_id), COALESCE(NULLIF(title,''), 'your job')
    INTO v_client, v_title
    FROM public.jobs WHERE id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    IF v_client IS NOT NULL THEN
      PERFORM public.create_system_notification(
        v_client, 'New inspector application',
        'An inspector applied to ' || v_title || '. Review their profile.',
        'application_status',
        '/client/jobs/' || NEW.job_id::text || '/applications',
        NEW.job_id);
    END IF;
    PERFORM public.create_admin_notification(
      'New application',
      'Inspector applied to "' || v_title || '".',
      'application_status',
      '/admin/jobs?inspect=' || NEW.job_id::text, NEW.job_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.applicant_id IS NOT NULL THEN
      PERFORM public.create_system_notification(
        NEW.applicant_id,
        CASE NEW.status
          WHEN 'accepted'        THEN 'Application accepted'
          WHEN 'rejected'        THEN 'Application not selected'
          WHEN 'CLIENT_SELECTED' THEN 'Client picked you — admin reviewing'
          WHEN 'withdrawn'       THEN 'Application withdrawn'
          ELSE 'Application updated'
        END,
        v_title, 'application_status',
        '/inspector/jobs/' || NEW.job_id::text, NEW.job_id);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_applications_notifications_v2: %', SQLERRM;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_applications_notifications_v2 ON public.applications;
CREATE TRIGGER trg_applications_notifications_v2
  AFTER INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_applications_notifications_v2();

-- Job contracts — covered by the sign-RPCs above, but a safety net here
-- in case anyone INSERTs directly via admin path.
CREATE OR REPLACE FUNCTION public.tg_job_contracts_notifications()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending_client_signature' THEN
    PERFORM public.create_system_notification(
      NEW.client_id, 'Contract ready for signature',
      'Open the contract to review and sign.',
      'contract_assigned',
      '/client/contracts/job/' || NEW.id::text, NEW.job_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_job_contracts_notifications: %', SQLERRM;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_job_contracts_notifications ON public.job_contracts;
CREATE TRIGGER trg_job_contracts_notifications
  AFTER INSERT ON public.job_contracts
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_contracts_notifications();

-- ─── 7) Realtime publication ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime'
       AND schemaname='public'
       AND tablename='notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication: %', SQLERRM;
END $$;

-- ─── 8) Sanity ping ────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role IN ('admin','super_admin')
  LOOP
    PERFORM public.create_system_notification(
      r.id, '🚀 Job contracts + notifications v2 live',
      'New triggers installed via create_system_notification. The pipeline is bulletproof now.',
      'system', '/admin/diagnostics', NULL);
  END LOOP;
END $$;

COMMIT;
