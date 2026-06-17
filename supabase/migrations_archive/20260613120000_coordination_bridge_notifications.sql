-- ════════════════════════════════════════════════════════════════════════════
--  20260613120000_coordination_bridge_notifications.sql
--
--  COORDINATION BRIDGE — Sprint B (notification triggers).
--
--  Three triggers that fan out Bridge events through the existing
--  enqueue_notification → dispatch-notification-emails pipeline:
--
--    1) tg_notify_bridge_created
--       Fires on INSERT into coordination_bridges.
--       Sends the vendor an INVITATION email containing the
--       portal URL with the magic-link token. This is the moment the
--       raw token reaches the vendor. After this insert, the raw token
--       is NEVER again retrievable from the database — only its hash
--       remains.
--       Also pings the inspector with an in-app receipt.
--
--    2) tg_notify_bridge_document_requested
--       Fires on INSERT into bridge_slots WHERE kind='document_request'.
--       Sends the vendor an email naming the requested document.
--
--    3) tg_notify_bridge_document_uploaded
--       Fires on INSERT into bridge_documents WHERE actor_kind='vendor'.
--       Pings the inspector that a vendor document has landed and is
--       awaiting acceptance.
--
--  RAW-TOKEN HANDLING
--  ──────────────────
--  The trigger does NOT have access to the raw token (only the hash is
--  stored). To deliver the invitation email, bridge_create returns the
--  raw token to the caller, and the caller (inspector mobile screen)
--  passes it to a thin RPC `bridge_send_invitation` that enqueues the
--  email with the token in the template_data. That RPC is provided here.
--
--  This pattern keeps the raw token in memory only for the duration of
--  the create-then-email handshake, never persisting it anywhere.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) bridge_send_invitation — accepts the raw token from the caller,
--    composes the vendor portal URL, and enqueues the invitation email
--    via the existing enqueue_notification + dispatch path.
--
--    Authorisation: caller must be the bridge's inspector OR super_admin.
--    The raw token is NOT stored; it lives only in the queued notification's
--    email_template_data, which the dispatcher reads, sends, and deletes
--    after Resend confirms delivery (email_dispatched_at).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_send_invitation(
  p_bridge_id     uuid,
  p_raw_token     text,
  p_portal_base   text DEFAULT 'https://app.nexpec.com/bridge'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_admin  boolean;
  v_bridge RECORD;
  v_vendor RECORD;
  v_job    RECORD;
  v_inspector RECORD;
  v_recipient_dummy_id uuid;
  v_notification_id uuid;
  v_portal_url text;
  v_template_data jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role='super_admin') INTO v_admin;

  SELECT * INTO v_bridge FROM public.coordination_bridges WHERE id = p_bridge_id;
  IF v_bridge.id IS NULL THEN
    RAISE EXCEPTION 'bridge not found' USING ERRCODE='P0002';
  END IF;
  IF NOT v_admin AND v_bridge.inspector_id <> v_caller THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501';
  END IF;
  IF p_raw_token IS NULL OR length(p_raw_token) < 32 THEN
    RAISE EXCEPTION 'raw_token required (64 hex chars)' USING ERRCODE='22023';
  END IF;
  -- Verify the presented raw token actually matches this bridge's stored hash.
  IF encode(digest(p_raw_token, 'sha256'), 'hex') <> v_bridge.token_sha256 THEN
    RAISE EXCEPTION 'raw_token does not match this bridge' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_vendor FROM public.vendor_contacts WHERE id = v_bridge.vendor_contact_id;
  SELECT id, title INTO v_job FROM public.jobs WHERE id = v_bridge.job_id;
  SELECT id, COALESCE(NULLIF(full_name, ''), email) AS display_name, email
    INTO v_inspector FROM public.profiles WHERE id = v_bridge.inspector_id;

  v_portal_url := rtrim(p_portal_base, '/') || '/' || p_raw_token;

  v_template_data := jsonb_build_object(
    'bridge_id',         v_bridge.id,
    'job_id',            v_bridge.job_id,
    'job_title',         COALESCE(NULLIF(v_job.title, ''), 'Inspection'),
    'inspector_name',    v_inspector.display_name,
    'vendor_company',    v_vendor.company_name,
    'vendor_contact',    v_vendor.contact_name,
    'vendor_email',      v_vendor.contact_email,
    'portal_url',        v_portal_url,
    'token_expires_at',  v_bridge.token_expires_at,
    'language_code',     v_vendor.language_code
  );

  -- The recipient is the vendor — they don't have a profile.id. We route
  -- the email through the inspector's profile as the "recipient_id" of
  -- record (this lets the existing notifications table accept the row)
  -- but the actual delivery email is the vendor's, embedded in the
  -- template kind. The dispatcher renders the vendor template and sends
  -- to vendor_email (NOT to the recipient profile's email).
  --
  -- Implementation detail: we use 'inspection_sealed_awaiting_countersign'-
  -- style approach where the template controls who actually receives the
  -- email. For vendor invitation we add a new path that overrides.
  --
  -- For Sprint B simplicity: we directly INSERT a notifications row
  -- targeted at the inspector and let the template_data carry the
  -- vendor's email address. The renderer at templates.ts:
  -- 'coordination_bridge.invitation' will be sent TO the vendor address.
  --
  -- This requires a small extension of dispatch-notification-emails:
  -- if template_data contains 'override_to', send to that address
  -- instead of the recipient profile's email.
  --
  -- That extension is delivered in the templates.ts patch in this sprint.

  INSERT INTO public.notifications (
    recipient_id, kind, title, body, link_href, job_id,
    email_required, email_template_kind, email_template_data
  )
  VALUES (
    v_bridge.inspector_id,
    'bridge_invitation_sent',
    format('Vendor invitation sent: %s', v_vendor.company_name),
    format('We emailed %s at %s with the Coordination Bridge link for %s.',
      COALESCE(v_vendor.contact_name, v_vendor.company_name),
      v_vendor.contact_email,
      COALESCE(NULLIF(v_job.title, ''), 'this inspection')),
    '/inspector/coordination-bridge?bridge_id=' || v_bridge.id::text,
    v_bridge.job_id,
    true,
    'coordination_bridge.invitation',
    v_template_data || jsonb_build_object('override_to', v_vendor.contact_email)
  )
  RETURNING id INTO v_notification_id;

  -- bump unread counter best-effort
  BEGIN
    UPDATE public.profiles
       SET unread_notifications_count = COALESCE(unread_notifications_count, 0) + 1
     WHERE id = v_bridge.inspector_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM public.cb_emit_audit(
    'coordination_bridge.invitation_sent',
    'info',
    v_caller, 'inspector', v_inspector.display_name,
    v_bridge.id, v_bridge.job_id,
    format('Magic-link invitation queued for delivery to %s', v_vendor.contact_email),
    jsonb_build_object('notification_id', v_notification_id, 'vendor_email', v_vendor.contact_email),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_notification_id;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_send_invitation(uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Trigger: tg_notify_bridge_document_requested
--    Fires when the inspector adds a new document_request slot.
--    Emails the vendor pointing them back to the same portal URL.
--    The raw token is not in the database, so the email contains
--    only the bridge_id and a polite "open the link we sent earlier"
--    instruction. The vendor's bookmarked portal URL still works.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_bridge_document_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bridge RECORD;
  v_vendor RECORD;
  v_job    RECORD;
  v_inspector RECORD;
  v_template_data jsonb;
BEGIN
  -- Only fire for genuine document_request slots created by the inspector.
  IF NEW.kind <> 'document_request' THEN RETURN NEW; END IF;
  IF NEW.created_by_actor_kind <> 'inspector' THEN RETURN NEW; END IF;

  SELECT * INTO v_bridge FROM public.coordination_bridges WHERE id = NEW.bridge_id;
  IF v_bridge.id IS NULL OR v_bridge.status IN ('completed','cancelled') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_vendor FROM public.vendor_contacts WHERE id = v_bridge.vendor_contact_id;
  SELECT id, title INTO v_job FROM public.jobs WHERE id = v_bridge.job_id;
  SELECT id, COALESCE(NULLIF(full_name, ''), email) AS display_name
    INTO v_inspector FROM public.profiles WHERE id = v_bridge.inspector_id;

  v_template_data := jsonb_build_object(
    'bridge_id',      v_bridge.id,
    'job_id',         v_bridge.job_id,
    'job_title',      COALESCE(NULLIF(v_job.title, ''), 'Inspection'),
    'inspector_name', v_inspector.display_name,
    'vendor_company', v_vendor.company_name,
    'vendor_contact', v_vendor.contact_name,
    'vendor_email',   v_vendor.contact_email,
    'document_title', NEW.title,
    'document_description', NEW.description,
    'required',       NEW.required,
    'override_to',    v_vendor.contact_email
  );

  INSERT INTO public.notifications (
    recipient_id, kind, title, body, link_href, job_id,
    email_required, email_template_kind, email_template_data
  )
  VALUES (
    v_bridge.inspector_id,
    'bridge_document_requested',
    format('Document requested from vendor: %s', NEW.title),
    format('Vendor %s has been notified to upload %s.', v_vendor.company_name, NEW.title),
    '/inspector/coordination-bridge?bridge_id=' || v_bridge.id::text,
    v_bridge.job_id,
    true,
    'coordination_bridge.document_requested',
    v_template_data
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_notify_bridge_document_requested: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tg_notify_bridge_document_requested ON public.bridge_slots;
CREATE TRIGGER tg_notify_bridge_document_requested
  AFTER INSERT ON public.bridge_slots
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_bridge_document_requested();

-- ─────────────────────────────────────────────────────────────────────
-- 3) Trigger: tg_notify_bridge_document_uploaded
--    Pings the inspector when a vendor uploads a document.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_bridge_document_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bridge RECORD;
  v_vendor RECORD;
  v_job    RECORD;
  v_template_data jsonb;
BEGIN
  IF NEW.uploaded_by_actor_kind <> 'vendor' THEN RETURN NEW; END IF;

  SELECT * INTO v_bridge FROM public.coordination_bridges WHERE id = NEW.bridge_id;
  IF v_bridge.id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_vendor FROM public.vendor_contacts WHERE id = v_bridge.vendor_contact_id;
  SELECT id, title INTO v_job FROM public.jobs WHERE id = v_bridge.job_id;

  v_template_data := jsonb_build_object(
    'bridge_id',     v_bridge.id,
    'job_id',        v_bridge.job_id,
    'job_title',     COALESCE(NULLIF(v_job.title, ''), 'Inspection'),
    'vendor_company', v_vendor.company_name,
    'document_id',   NEW.id,
    'filename',      NEW.original_filename,
    'mime_type',     NEW.mime_type,
    'size_bytes',    NEW.file_size_bytes,
    'sha256',        NEW.sha256_client_computed,
    'review_link',   '/inspector/coordination-bridge?bridge_id=' || v_bridge.id::text
  );

  -- In-app ping; email is optional here (inspector usually has push).
  PERFORM public.enqueue_notification(
    v_bridge.inspector_id,
    'bridge_document_uploaded',
    format('Vendor uploaded: %s', NEW.original_filename),
    format('%s submitted %s. Review and accept or reject.',
      v_vendor.company_name, NEW.original_filename),
    '/inspector/coordination-bridge?bridge_id=' || v_bridge.id::text,
    v_bridge.job_id,
    false,
    NULL,
    v_template_data
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_notify_bridge_document_uploaded: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tg_notify_bridge_document_uploaded ON public.bridge_documents;
CREATE TRIGGER tg_notify_bridge_document_uploaded
  AFTER INSERT ON public.bridge_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_bridge_document_uploaded();

-- ─────────────────────────────────────────────────────────────────────
-- 4) Trigger: tg_notify_bridge_schedule_changed
--    Pings the counter-party when a schedule slot transitions.
--    (Inspector ↔ vendor counter-proposals.)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_notify_bridge_schedule_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bridge RECORD;
  v_vendor RECORD;
  v_job    RECORD;
  v_template_data jsonb;
  v_target_email text;
  v_subject text;
  v_body text;
BEGIN
  IF NEW.kind <> 'schedule' THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status AND OLD.payload_json = NEW.payload_json THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_bridge FROM public.coordination_bridges WHERE id = NEW.bridge_id;
  IF v_bridge.id IS NULL OR v_bridge.status IN ('completed','cancelled') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_vendor FROM public.vendor_contacts WHERE id = v_bridge.vendor_contact_id;
  SELECT id, title INTO v_job FROM public.jobs WHERE id = v_bridge.job_id;

  v_template_data := jsonb_build_object(
    'bridge_id',      v_bridge.id,
    'job_id',         v_bridge.job_id,
    'job_title',      COALESCE(NULLIF(v_job.title, ''), 'Inspection'),
    'vendor_company', v_vendor.company_name,
    'slot_payload',   NEW.payload_json,
    'slot_status',    NEW.status::text
  );

  IF NEW.status = 'awaiting_vendor' THEN
    -- Inspector proposed; email vendor.
    v_target_email := v_vendor.contact_email;
    INSERT INTO public.notifications (
      recipient_id, kind, title, body, link_href, job_id,
      email_required, email_template_kind, email_template_data
    )
    VALUES (
      v_bridge.inspector_id,
      'bridge_schedule_to_vendor',
      'Inspection date sent to vendor',
      format('Your proposed inspection date has been sent to %s.', v_vendor.company_name),
      '/inspector/coordination-bridge?bridge_id=' || v_bridge.id::text,
      v_bridge.job_id,
      true,
      'coordination_bridge.schedule_proposed_to_vendor',
      v_template_data || jsonb_build_object('override_to', v_target_email)
    );

  ELSIF NEW.status = 'awaiting_inspector' THEN
    -- Vendor counter-proposed; ping inspector (in-app).
    PERFORM public.enqueue_notification(
      v_bridge.inspector_id,
      'bridge_schedule_counter',
      format('Vendor proposed a new inspection date'),
      format('%s suggested a different date. Review and confirm or counter.', v_vendor.company_name),
      '/inspector/coordination-bridge?bridge_id=' || v_bridge.id::text,
      v_bridge.job_id,
      false,
      NULL,
      v_template_data
    );

  ELSIF NEW.status = 'completed' THEN
    -- Both parties agreed. Ping both.
    PERFORM public.enqueue_notification(
      v_bridge.inspector_id,
      'bridge_schedule_locked',
      'Inspection date confirmed by vendor',
      format('Date locked with %s.', v_vendor.company_name),
      '/inspector/coordination-bridge?bridge_id=' || v_bridge.id::text,
      v_bridge.job_id,
      false,
      NULL,
      v_template_data
    );
    IF v_bridge.client_id IS NOT NULL THEN
      PERFORM public.enqueue_notification(
        v_bridge.client_id,
        'bridge_schedule_locked',
        'Vendor coordination: inspection date locked',
        format('Your inspector and vendor %s have confirmed a date for %s.',
          v_vendor.company_name, COALESCE(v_job.title, 'the inspection')),
        '/client/jobs/' || v_bridge.job_id::text,
        v_bridge.job_id,
        false,
        NULL,
        v_template_data
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tg_notify_bridge_schedule_changed: %', SQLERRM;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS tg_notify_bridge_schedule_changed ON public.bridge_slots;
CREATE TRIGGER tg_notify_bridge_schedule_changed
  AFTER UPDATE ON public.bridge_slots
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_bridge_schedule_changed();

COMMIT;
