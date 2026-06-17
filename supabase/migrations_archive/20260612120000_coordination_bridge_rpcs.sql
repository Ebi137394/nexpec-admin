-- ════════════════════════════════════════════════════════════════════════════
--  20260612120000_coordination_bridge_rpcs.sql
--
--  COORDINATION BRIDGE — Sprint A (state machine + token RPCs).
--
--  Two RPC families:
--
--    A) Inspector-side (callable by authenticated inspectors)
--       • bridge_create
--       • bridge_add_document_request
--       • bridge_propose_schedule
--       • bridge_accept_document
--       • bridge_reject_document
--       • bridge_cancel
--       • bridge_complete
--       • bridge_rotate_token
--       • bridge_fetch_for_inspector
--
--    B) Vendor-side (callable ONLY by service-role via the vendor-bridge-auth
--       Edge Function, never directly by anon or authenticated)
--       • bridge_vendor_resolve_token
--       • bridge_vendor_get_state
--       • bridge_vendor_accept_schedule
--       • bridge_vendor_counter_schedule
--       • bridge_vendor_register_uploaded_document
--       • bridge_vendor_declare_site_access
--       • bridge_vendor_sign_arrival
--
--  TOKEN MODEL
--  ───────────
--  Raw token = encode(gen_random_bytes(32), 'hex')  → 64 hex chars (256 bits).
--  Stored as SHA-256(raw_token) in coordination_bridges.token_sha256.
--  Raw token is returned EXACTLY ONCE from bridge_create / bridge_rotate_token
--  and emailed to the vendor. We never persist it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- Helper: SHA-256(text) → hex
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cb_sha256_hex(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  IF p_text IS NULL THEN RETURN NULL; END IF;
  RETURN encode(digest(p_text, 'sha256'), 'hex');
END
$fn$;

REVOKE ALL ON FUNCTION public.cb_sha256_hex(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cb_sha256_hex(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Helper: resolve actor profile (role + display label).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cb_actor_profile(p_user_id uuid)
RETURNS TABLE (actor_role text, actor_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  SELECT p.role,
         COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, 'Unknown')
    FROM public.profiles p
   WHERE p.id = p_user_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.cb_actor_profile(uuid) FROM PUBLIC, anon;

-- ════════════════════════════════════════════════════════════════════
-- A) INSPECTOR-SIDE RPCs
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- A.1) bridge_create — initiate a new Coordination Bridge.
--
--   Creates a vendor_contact (or reuses existing-by-email if found),
--   creates the coordination_bridges row, seeds the standard slot set
--   (schedule, site_access, pre_inspection_ack, arrival_ack), generates
--   the magic-link token, returns the RAW TOKEN to the caller exactly
--   once. The caller (inspector mobile screen or web action) is then
--   responsible for emailing it to the vendor via the existing
--   notification fanout (Sprint B trigger handles this automatically).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_create(
  p_job_id              uuid,
  p_company_name        text,
  p_contact_name        text,
  p_contact_email       text,
  p_contact_phone       text DEFAULT NULL,
  p_country_code        text DEFAULT NULL,
  p_timezone            text DEFAULT NULL,
  p_language_code       text DEFAULT 'en',
  p_token_ttl_days      integer DEFAULT 60
) RETURNS TABLE (
  bridge_id    uuid,
  raw_token    text,
  expires_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_caller       uuid := auth.uid();
  v_is_admin     boolean;
  v_job          RECORD;
  v_existing_vc  uuid;
  v_vendor_id    uuid;
  v_bridge_id    uuid := gen_random_uuid();
  v_raw_token    text;
  v_token_hash   text;
  v_expires_at   timestamptz;
  v_actor_role   text;
  v_actor_label  text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_caller AND role = 'super_admin'
  ) INTO v_is_admin;

  -- Validate the job + caller authorisation.
  SELECT id, client_id, contractor_id, title
    INTO v_job
    FROM public.jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job % not found', p_job_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_admin AND v_job.contractor_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'only the assigned inspector or NEXPEC Admin may open a Coordination Bridge'
      USING ERRCODE = '42501';
  END IF;

  -- One bridge per job (UNIQUE constraint).
  IF EXISTS (SELECT 1 FROM public.coordination_bridges WHERE job_id = p_job_id) THEN
    RAISE EXCEPTION 'a Coordination Bridge already exists for job %; cancel it first', p_job_id
      USING ERRCODE = '23505';
  END IF;

  -- Validate inputs.
  IF p_company_name IS NULL OR length(trim(p_company_name)) = 0 THEN
    RAISE EXCEPTION 'company_name required' USING ERRCODE = '22023';
  END IF;
  IF p_contact_email IS NULL OR p_contact_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'valid contact_email required' USING ERRCODE = '22023';
  END IF;
  IF p_token_ttl_days IS NULL OR p_token_ttl_days < 1 OR p_token_ttl_days > 365 THEN
    p_token_ttl_days := 60;
  END IF;

  -- Reuse vendor_contact if the same inspector previously invited the same email.
  -- Falls back to creating a fresh row.
  SELECT id INTO v_existing_vc
    FROM public.vendor_contacts
   WHERE created_by_user_id = COALESCE(v_job.contractor_id, v_caller)
     AND lower(contact_email) = lower(p_contact_email)
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_existing_vc IS NOT NULL THEN
    v_vendor_id := v_existing_vc;
    UPDATE public.vendor_contacts
       SET company_name   = COALESCE(NULLIF(trim(p_company_name), ''), company_name),
           contact_name   = COALESCE(NULLIF(trim(p_contact_name), ''),  contact_name),
           contact_phone  = COALESCE(NULLIF(trim(p_contact_phone), ''), contact_phone),
           country_code   = COALESCE(NULLIF(trim(p_country_code), ''),  country_code),
           timezone       = COALESCE(NULLIF(trim(p_timezone), ''),      timezone),
           language_code  = COALESCE(NULLIF(trim(p_language_code), ''), language_code)
     WHERE id = v_vendor_id;
  ELSE
    INSERT INTO public.vendor_contacts (
      company_name, contact_name, contact_email, contact_phone,
      country_code, timezone, language_code, created_by_user_id
    )
    VALUES (
      trim(p_company_name),
      NULLIF(trim(p_contact_name), ''),
      lower(trim(p_contact_email)),
      NULLIF(trim(p_contact_phone), ''),
      NULLIF(trim(p_country_code), ''),
      NULLIF(trim(p_timezone), ''),
      COALESCE(NULLIF(trim(p_language_code), ''), 'en'),
      COALESCE(v_job.contractor_id, v_caller)
    )
    RETURNING id INTO v_vendor_id;
  END IF;

  -- Generate the magic-link token.
  v_raw_token  := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + (p_token_ttl_days || ' days')::interval;

  -- Create the bridge.
  INSERT INTO public.coordination_bridges (
    id, job_id, vendor_contact_id, inspector_id, client_id,
    status, token_sha256, token_issued_at, token_expires_at
  )
  VALUES (
    v_bridge_id, p_job_id, v_vendor_id,
    COALESCE(v_job.contractor_id, v_caller),
    v_job.client_id,
    'pending_invite', v_token_hash, now(), v_expires_at
  );

  -- Seed standard slots.
  INSERT INTO public.bridge_slots (bridge_id, kind, status, title, description, required, sort_order, created_by_user_id, created_by_actor_kind)
  VALUES
    (v_bridge_id, 'schedule',          'awaiting_vendor', 'Confirm inspection date',
     'Propose or confirm the date and time the inspector will visit your site.', true, 10,
     v_caller, 'inspector'),
    (v_bridge_id, 'site_access',       'awaiting_vendor', 'Declare site access requirements',
     'PPE requirements, escort needs, badge protocol, entry hours.', true, 20,
     v_caller, 'inspector'),
    (v_bridge_id, 'pre_inspection_ack','awaiting_vendor', 'Acknowledge inspection scope',
     'Confirm the scope of work and that you are ready to host the inspection.', true, 30,
     v_caller, 'inspector'),
    (v_bridge_id, 'arrival_ack',       'pending',         'Sign inspector arrival',
     'Sign on the day of the inspection to confirm the inspector arrived on site.', true, 90,
     v_caller, 'inspector');

  -- Audit emit.
  SELECT actor_role, actor_label INTO v_actor_role, v_actor_label
    FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.created',
    'info',
    v_caller,
    COALESCE(v_actor_role, 'inspector'),
    v_actor_label,
    v_bridge_id,
    p_job_id,
    format('Inspector opened a Coordination Bridge for vendor %s', p_company_name),
    jsonb_build_object(
      'vendor_contact_id', v_vendor_id,
      'vendor_company',    trim(p_company_name),
      'vendor_email',      lower(trim(p_contact_email)),
      'token_expires_at',  v_expires_at,
      'token_ttl_days',    p_token_ttl_days
    ),
    jsonb_build_object('job_id', p_job_id::text, 'bridge_id', v_bridge_id::text)
  );

  RETURN QUERY SELECT v_bridge_id, v_raw_token, v_expires_at;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_create(
  uuid, text, text, text, text, text, text, text, integer
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- A.2) bridge_add_document_request
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_add_document_request(
  p_bridge_id    uuid,
  p_title        text,
  p_description  text DEFAULT NULL,
  p_required     boolean DEFAULT true,
  p_max_size_mb  integer DEFAULT 50
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  v_bridge   RECORD;
  v_slot_id  uuid;
  v_next_so  integer;
  v_role     text;
  v_label    text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_caller AND role = 'super_admin'
  ) INTO v_is_admin;

  SELECT id, job_id, inspector_id, status
    INTO v_bridge
    FROM public.coordination_bridges WHERE id = p_bridge_id;
  IF v_bridge.id IS NULL THEN
    RAISE EXCEPTION 'bridge % not found', p_bridge_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_is_admin AND v_bridge.inspector_id <> v_caller THEN
    RAISE EXCEPTION 'only the assigned inspector or NEXPEC Admin may add document requests'
      USING ERRCODE = '42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) + 10
    INTO v_next_so
    FROM public.bridge_slots
   WHERE bridge_id = p_bridge_id AND kind = 'document_request';

  INSERT INTO public.bridge_slots (
    bridge_id, kind, status, title, description, required, sort_order,
    payload_json, created_by_user_id, created_by_actor_kind
  )
  VALUES (
    p_bridge_id, 'document_request', 'awaiting_vendor',
    trim(p_title),
    NULLIF(trim(p_description), ''),
    COALESCE(p_required, true),
    40 + v_next_so,
    jsonb_build_object(
      'max_size_bytes', GREATEST(1, COALESCE(p_max_size_mb, 50)) * 1024 * 1024,
      'mime_hints',     ARRAY[]::text[]
    ),
    v_caller, 'inspector'
  )
  RETURNING id INTO v_slot_id;

  SELECT actor_role, actor_label INTO v_role, v_label FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.document_requested',
    'info',
    v_caller, COALESCE(v_role, 'inspector'), v_label,
    p_bridge_id, v_bridge.job_id,
    format('Inspector requested document "%s"', trim(p_title)),
    jsonb_build_object(
      'slot_id',  v_slot_id,
      'title',    trim(p_title),
      'required', COALESCE(p_required, true)
    ),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', p_bridge_id::text)
  );

  RETURN v_slot_id;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_add_document_request(uuid, text, text, boolean, integer)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- A.3) bridge_propose_schedule
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_propose_schedule(
  p_bridge_id    uuid,
  p_proposed_at  timestamptz,
  p_timezone     text DEFAULT 'UTC',
  p_notes        text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller  uuid := auth.uid();
  v_admin   boolean;
  v_bridge  RECORD;
  v_slot    RECORD;
  v_role    text;
  v_label   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role='super_admin') INTO v_admin;
  SELECT * INTO v_bridge FROM public.coordination_bridges WHERE id = p_bridge_id;
  IF v_bridge.id IS NULL THEN
    RAISE EXCEPTION 'bridge not found' USING ERRCODE='P0002';
  END IF;
  IF NOT v_admin AND v_bridge.inspector_id <> v_caller THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE='22023';
  END IF;
  IF p_proposed_at IS NULL OR p_proposed_at < now() - interval '1 day' THEN
    RAISE EXCEPTION 'proposed_at must be a near-future timestamp' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_slot
    FROM public.bridge_slots
   WHERE bridge_id = p_bridge_id AND kind = 'schedule'
   LIMIT 1;
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'schedule slot missing — bridge corrupted' USING ERRCODE='P0002';
  END IF;

  UPDATE public.bridge_slots
     SET status                   = 'awaiting_vendor',
         payload_json             = jsonb_build_object(
           'proposed_at',       p_proposed_at,
           'timezone',          COALESCE(p_timezone, 'UTC'),
           'proposed_by_kind',  'inspector',
           'notes',             p_notes
         ),
         last_action_at           = now(),
         last_action_by_user_id   = v_caller,
         last_action_by_actor_kind = 'inspector',
         last_action_note         = p_notes
   WHERE id = v_slot.id;

  SELECT actor_role, actor_label INTO v_role, v_label FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.schedule_proposed',
    'info',
    v_caller, COALESCE(v_role, 'inspector'), v_label,
    p_bridge_id, v_bridge.job_id,
    format('Inspector proposed inspection at %s (%s)', p_proposed_at, p_timezone),
    jsonb_build_object(
      'slot_id',     v_slot.id,
      'proposed_at', p_proposed_at,
      'timezone',    p_timezone
    ),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', p_bridge_id::text)
  );

  RETURN v_slot.id;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_propose_schedule(uuid, timestamptz, text, text)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- A.4) bridge_accept_document / bridge_reject_document
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_accept_document(p_document_id uuid)
RETURNS public.bridge_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller  uuid := auth.uid();
  v_admin   boolean;
  v_doc     public.bridge_documents%ROWTYPE;
  v_bridge  RECORD;
  v_result  public.bridge_documents%ROWTYPE;
  v_role    text;
  v_label   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role='super_admin') INTO v_admin;
  SELECT * INTO v_doc FROM public.bridge_documents WHERE id = p_document_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'document not found' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_bridge FROM public.coordination_bridges WHERE id = v_doc.bridge_id;
  IF NOT v_admin AND v_bridge.inspector_id <> v_caller THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501';
  END IF;
  IF v_doc.accepted_at IS NOT NULL THEN
    RETURN v_doc; -- idempotent
  END IF;
  IF v_doc.rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'document was rejected; vendor must resubmit' USING ERRCODE='22023';
  END IF;

  UPDATE public.bridge_documents
     SET accepted_at = now(),
         accepted_by_user_id = v_caller
   WHERE id = p_document_id
   RETURNING * INTO v_result;

  -- Mark associated slot completed if it was a document_request slot.
  IF v_result.slot_id IS NOT NULL THEN
    UPDATE public.bridge_slots
       SET status = 'completed',
           completed_at = now(),
           last_action_at = now(),
           last_action_by_user_id = v_caller,
           last_action_by_actor_kind = 'inspector'
     WHERE id = v_result.slot_id AND kind = 'document_request';
  END IF;

  SELECT actor_role, actor_label INTO v_role, v_label FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.document_accepted',
    'info',
    v_caller, COALESCE(v_role,'inspector'), v_label,
    v_bridge.id, v_bridge.job_id,
    format('Inspector accepted document %s', v_doc.original_filename),
    jsonb_build_object(
      'document_id',  v_doc.id,
      'slot_id',      v_doc.slot_id,
      'filename',     v_doc.original_filename,
      'sha256',       v_doc.sha256_client_computed
    ),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_accept_document(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bridge_reject_document(
  p_document_id uuid,
  p_reason      text
) RETURNS public.bridge_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller  uuid := auth.uid();
  v_admin   boolean;
  v_doc     public.bridge_documents%ROWTYPE;
  v_bridge  RECORD;
  v_result  public.bridge_documents%ROWTYPE;
  v_role    text;
  v_label   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='28000';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'rejection reason required (>= 3 chars)' USING ERRCODE='22023';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role='super_admin') INTO v_admin;
  SELECT * INTO v_doc FROM public.bridge_documents WHERE id = p_document_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'document not found' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_bridge FROM public.coordination_bridges WHERE id = v_doc.bridge_id;
  IF NOT v_admin AND v_bridge.inspector_id <> v_caller THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501';
  END IF;
  IF v_doc.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'document already accepted; cannot reject' USING ERRCODE='22023';
  END IF;

  UPDATE public.bridge_documents
     SET rejected_at = now(),
         rejected_by_user_id = v_caller,
         rejected_reason = trim(p_reason)
   WHERE id = p_document_id
   RETURNING * INTO v_result;

  -- Re-open the slot so the vendor can resubmit.
  IF v_result.slot_id IS NOT NULL THEN
    UPDATE public.bridge_slots
       SET status = 'awaiting_vendor',
           last_action_at = now(),
           last_action_by_user_id = v_caller,
           last_action_by_actor_kind = 'inspector',
           last_action_note = format('Document rejected: %s', trim(p_reason))
     WHERE id = v_result.slot_id;
  END IF;

  SELECT actor_role, actor_label INTO v_role, v_label FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.document_rejected',
    'warning',
    v_caller, COALESCE(v_role,'inspector'), v_label,
    v_bridge.id, v_bridge.job_id,
    format('Inspector rejected document %s — %s', v_doc.original_filename, trim(p_reason)),
    jsonb_build_object(
      'document_id', v_doc.id,
      'slot_id',     v_doc.slot_id,
      'reason',      trim(p_reason)
    ),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_reject_document(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- A.5) bridge_cancel / bridge_complete / bridge_rotate_token
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_cancel(
  p_bridge_id uuid,
  p_reason    text
) RETURNS public.coordination_bridges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller  uuid := auth.uid();
  v_admin   boolean;
  v_bridge  public.coordination_bridges%ROWTYPE;
  v_result  public.coordination_bridges%ROWTYPE;
  v_role    text;
  v_label   text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role='super_admin') INTO v_admin;
  SELECT * INTO v_bridge FROM public.coordination_bridges WHERE id = p_bridge_id;
  IF v_bridge.id IS NULL THEN
    RAISE EXCEPTION 'bridge not found' USING ERRCODE='P0002';
  END IF;
  IF NOT v_admin
     AND v_bridge.inspector_id <> v_caller
     AND v_bridge.client_id    IS DISTINCT FROM v_caller
  THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501';
  END IF;
  IF v_bridge.status = 'cancelled' THEN
    RETURN v_bridge;
  END IF;
  IF v_bridge.status = 'completed' THEN
    RAISE EXCEPTION 'cannot cancel a completed bridge' USING ERRCODE='22023';
  END IF;

  UPDATE public.coordination_bridges
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_user_id = v_caller,
         cancellation_reason  = NULLIF(trim(p_reason), ''),
         token_revoked_at     = COALESCE(token_revoked_at, now())
   WHERE id = p_bridge_id
   RETURNING * INTO v_result;

  SELECT actor_role, actor_label INTO v_role, v_label FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.cancelled',
    'warning',
    v_caller, COALESCE(v_role, 'inspector'), v_label,
    p_bridge_id, v_bridge.job_id,
    format('Coordination Bridge cancelled — %s', COALESCE(NULLIF(trim(p_reason),''), 'no reason')),
    jsonb_build_object('reason', NULLIF(trim(p_reason),'')),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', p_bridge_id::text)
  );

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_cancel(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bridge_complete(p_bridge_id uuid)
RETURNS public.coordination_bridges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller  uuid := auth.uid();
  v_admin   boolean;
  v_bridge  public.coordination_bridges%ROWTYPE;
  v_result  public.coordination_bridges%ROWTYPE;
  v_role    text;
  v_label   text;
  v_unresolved int;
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
  IF v_bridge.status = 'completed' THEN
    RETURN v_bridge;
  END IF;

  -- Don't enforce required-slots-complete at the schema level — allow the
  -- inspector to explicitly close out even with imperfect coordination.
  -- The audit trail records what was open at close time.
  SELECT count(*) INTO v_unresolved
    FROM public.bridge_slots
   WHERE bridge_id = p_bridge_id
     AND required = true
     AND status NOT IN ('completed','rejected');

  UPDATE public.coordination_bridges
     SET status = 'completed',
         completed_at = now(),
         token_revoked_at = COALESCE(token_revoked_at, now())
   WHERE id = p_bridge_id
   RETURNING * INTO v_result;

  SELECT actor_role, actor_label INTO v_role, v_label FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.completed',
    CASE WHEN v_unresolved > 0 THEN 'warning' ELSE 'info' END,
    v_caller, COALESCE(v_role,'inspector'), v_label,
    p_bridge_id, v_bridge.job_id,
    format('Coordination Bridge completed (%s unresolved required slot%s)',
      v_unresolved, CASE WHEN v_unresolved = 1 THEN '' ELSE 's' END),
    jsonb_build_object('unresolved_required_slots', v_unresolved),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', p_bridge_id::text)
  );

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_complete(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bridge_rotate_token(
  p_bridge_id      uuid,
  p_token_ttl_days integer DEFAULT 60
) RETURNS TABLE (raw_token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_caller    uuid := auth.uid();
  v_admin     boolean;
  v_bridge    RECORD;
  v_raw       text;
  v_hash      text;
  v_expires   timestamptz;
  v_role      text;
  v_label     text;
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
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'cannot rotate token for a % bridge', v_bridge.status USING ERRCODE='22023';
  END IF;
  IF p_token_ttl_days IS NULL OR p_token_ttl_days < 1 OR p_token_ttl_days > 365 THEN
    p_token_ttl_days := 60;
  END IF;

  v_raw     := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash    := encode(digest(v_raw, 'sha256'), 'hex');
  v_expires := now() + (p_token_ttl_days || ' days')::interval;

  UPDATE public.coordination_bridges
     SET token_sha256     = v_hash,
         token_issued_at  = now(),
         token_expires_at = v_expires,
         token_revoked_at = NULL
   WHERE id = p_bridge_id;

  SELECT actor_role, actor_label INTO v_role, v_label FROM public.cb_actor_profile(v_caller);

  PERFORM public.cb_emit_audit(
    'coordination_bridge.token_rotated',
    'info',
    v_caller, COALESCE(v_role,'inspector'), v_label,
    p_bridge_id, v_bridge.job_id,
    'Magic-link token rotated (previous token now invalid).',
    jsonb_build_object('token_expires_at', v_expires),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', p_bridge_id::text)
  );

  RETURN QUERY SELECT v_raw, v_expires;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_rotate_token(uuid, integer) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- B) VENDOR-SIDE RPCs (called only by vendor-bridge-auth Edge Function
--    using the service-role key; REVOKE'd from authenticated and anon).
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- B.1) bridge_vendor_resolve_token — hash the raw token, look up the
--      bridge, validate expiry + revocation, return bridge identity.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_resolve_token(p_raw_token text)
RETURNS TABLE (
  bridge_id          uuid,
  job_id             uuid,
  vendor_contact_id  uuid,
  status             public.coordination_bridge_status,
  token_expires_at   timestamptz,
  token_revoked_at   timestamptz,
  inspector_id       uuid,
  client_id          uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash text;
BEGIN
  IF p_raw_token IS NULL OR length(p_raw_token) < 32 THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE='42501';
  END IF;
  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');

  RETURN QUERY
  SELECT cb.id, cb.job_id, cb.vendor_contact_id, cb.status,
         cb.token_expires_at, cb.token_revoked_at,
         cb.inspector_id, cb.client_id
    FROM public.coordination_bridges cb
   WHERE cb.token_sha256 = v_hash;
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_resolve_token(text) FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- B.2) bridge_vendor_touch — record vendor activity (first-seen + last-seen).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_touch(p_raw_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash text;
  v_bridge_id uuid;
  v_job_id uuid;
BEGIN
  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');
  SELECT id, job_id INTO v_bridge_id, v_job_id
    FROM public.coordination_bridges WHERE token_sha256 = v_hash;
  IF v_bridge_id IS NULL THEN RETURN; END IF;

  UPDATE public.coordination_bridges
     SET vendor_first_seen_at = COALESCE(vendor_first_seen_at, now()),
         vendor_last_seen_at  = now(),
         vendor_session_count = vendor_session_count + 1,
         status               = CASE
                                  WHEN status = 'pending_invite' THEN 'in_progress'
                                  ELSE status
                                END
   WHERE id = v_bridge_id;

  PERFORM public.cb_emit_audit(
    'coordination_bridge.vendor_session',
    'info',
    NULL, 'vendor', NULL,
    v_bridge_id, v_job_id,
    'Vendor opened the Coordination Bridge.',
    '{}'::jsonb,
    jsonb_build_object('job_id', v_job_id::text, 'bridge_id', v_bridge_id::text)
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_touch(text) FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- B.3) bridge_vendor_accept_schedule
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_accept_schedule(
  p_raw_token text,
  p_slot_id   uuid
) RETURNS public.bridge_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash    text;
  v_bridge  RECORD;
  v_slot    public.bridge_slots%ROWTYPE;
  v_result  public.bridge_slots%ROWTYPE;
  v_proposed timestamptz;
BEGIN
  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');

  SELECT cb.id, cb.job_id, cb.status, cb.token_expires_at, cb.token_revoked_at, cb.inspector_id
    INTO v_bridge
    FROM public.coordination_bridges cb
   WHERE cb.token_sha256 = v_hash;
  IF v_bridge.id IS NULL THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE='42501';
  END IF;
  IF v_bridge.token_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'token revoked' USING ERRCODE='42501';
  END IF;
  IF v_bridge.token_expires_at < now() THEN
    RAISE EXCEPTION 'token expired' USING ERRCODE='42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_slot
    FROM public.bridge_slots
   WHERE id = p_slot_id AND bridge_id = v_bridge.id AND kind = 'schedule';
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'schedule slot not found' USING ERRCODE='P0002';
  END IF;

  v_proposed := (v_slot.payload_json ->> 'proposed_at')::timestamptz;
  IF v_proposed IS NULL THEN
    RAISE EXCEPTION 'no scheduled time has been proposed yet' USING ERRCODE='22023';
  END IF;

  UPDATE public.bridge_slots
     SET status = 'completed',
         completed_at = now(),
         payload_json = v_slot.payload_json
           || jsonb_build_object(
                'agreed_at',        v_proposed,
                'agreed_by_kind',   'vendor',
                'agreed_at_utc',    now()
              ),
         last_action_at = now(),
         last_action_by_actor_kind = 'vendor'
   WHERE id = p_slot_id
   RETURNING * INTO v_result;

  PERFORM public.cb_emit_audit(
    'coordination_bridge.schedule_accepted',
    'info',
    NULL, 'vendor', NULL,
    v_bridge.id, v_bridge.job_id,
    format('Vendor accepted scheduled inspection at %s', v_proposed),
    jsonb_build_object('slot_id', p_slot_id, 'agreed_at', v_proposed),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_accept_schedule(text, uuid)
  FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- B.4) bridge_vendor_counter_schedule
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_counter_schedule(
  p_raw_token   text,
  p_slot_id     uuid,
  p_proposed_at timestamptz,
  p_timezone    text,
  p_notes       text DEFAULT NULL
) RETURNS public.bridge_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash    text;
  v_bridge  RECORD;
  v_slot    public.bridge_slots%ROWTYPE;
  v_result  public.bridge_slots%ROWTYPE;
BEGIN
  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');
  SELECT cb.id, cb.job_id, cb.status, cb.token_expires_at, cb.token_revoked_at
    INTO v_bridge
    FROM public.coordination_bridges cb
   WHERE cb.token_sha256 = v_hash;
  IF v_bridge.id IS NULL OR v_bridge.token_revoked_at IS NOT NULL OR v_bridge.token_expires_at < now() THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE='42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE='22023';
  END IF;
  IF p_proposed_at IS NULL OR p_proposed_at < now() - interval '1 day' THEN
    RAISE EXCEPTION 'proposed_at must be a near-future timestamp' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_slot
    FROM public.bridge_slots
   WHERE id = p_slot_id AND bridge_id = v_bridge.id AND kind = 'schedule';
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'schedule slot not found' USING ERRCODE='P0002';
  END IF;

  UPDATE public.bridge_slots
     SET status = 'awaiting_inspector',
         payload_json = jsonb_build_object(
           'proposed_at',      p_proposed_at,
           'timezone',         COALESCE(p_timezone, 'UTC'),
           'proposed_by_kind', 'vendor',
           'notes',            p_notes,
           'previous_payload', v_slot.payload_json
         ),
         last_action_at = now(),
         last_action_by_actor_kind = 'vendor',
         last_action_note = p_notes
   WHERE id = p_slot_id
   RETURNING * INTO v_result;

  PERFORM public.cb_emit_audit(
    'coordination_bridge.schedule_counter_proposed',
    'info',
    NULL, 'vendor', NULL,
    v_bridge.id, v_bridge.job_id,
    format('Vendor counter-proposed inspection at %s', p_proposed_at),
    jsonb_build_object('slot_id', p_slot_id, 'proposed_at', p_proposed_at, 'timezone', p_timezone),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_counter_schedule(text, uuid, timestamptz, text, text)
  FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- B.5) bridge_vendor_register_uploaded_document
--      The Edge Function generates a signed-URL upload for the vendor's
--      browser. After upload completes, the browser calls back here
--      to register the document row (file already in storage).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_register_uploaded_document(
  p_raw_token     text,
  p_slot_id       uuid,
  p_storage_path  text,
  p_filename      text,
  p_mime_type     text,
  p_size_bytes    bigint,
  p_sha256        text
) RETURNS public.bridge_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash    text;
  v_bridge  RECORD;
  v_slot    public.bridge_slots%ROWTYPE;
  v_doc_id  uuid := gen_random_uuid();
  v_result  public.bridge_documents%ROWTYPE;
BEGIN
  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');
  SELECT cb.id, cb.job_id, cb.status, cb.token_expires_at, cb.token_revoked_at,
         cb.vendor_contact_id
    INTO v_bridge
    FROM public.coordination_bridges cb
   WHERE cb.token_sha256 = v_hash;
  IF v_bridge.id IS NULL OR v_bridge.token_revoked_at IS NOT NULL OR v_bridge.token_expires_at < now() THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE='42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE='22023';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'sha256 must be 64 lowercase hex chars' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_slot
    FROM public.bridge_slots
   WHERE id = p_slot_id AND bridge_id = v_bridge.id AND kind = 'document_request';
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'document_request slot not found' USING ERRCODE='P0002';
  END IF;

  INSERT INTO public.bridge_documents (
    id, bridge_id, slot_id,
    uploaded_by_actor_kind, uploaded_via_token,
    uploaded_by_vendor_contact_id,
    storage_bucket, storage_path,
    original_filename, mime_type, file_size_bytes,
    sha256_client_computed
  )
  VALUES (
    v_doc_id, v_bridge.id, p_slot_id,
    'vendor', true,
    v_bridge.vendor_contact_id,
    'bridge-documents', p_storage_path,
    p_filename, p_mime_type, p_size_bytes,
    lower(p_sha256)
  )
  RETURNING * INTO v_result;

  UPDATE public.bridge_slots
     SET status = 'awaiting_inspector',
         last_action_at = now(),
         last_action_by_actor_kind = 'vendor'
   WHERE id = p_slot_id;

  PERFORM public.cb_emit_audit(
    'coordination_bridge.document_uploaded',
    'info',
    NULL, 'vendor', NULL,
    v_bridge.id, v_bridge.job_id,
    format('Vendor uploaded document %s (%s bytes)', p_filename, COALESCE(p_size_bytes::text, '?')),
    jsonb_build_object(
      'document_id',   v_doc_id,
      'slot_id',       p_slot_id,
      'filename',      p_filename,
      'mime_type',     p_mime_type,
      'size_bytes',    p_size_bytes,
      'sha256',        lower(p_sha256)
    ),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_register_uploaded_document(text, uuid, text, text, text, bigint, text)
  FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- B.6) bridge_vendor_declare_site_access
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_declare_site_access(
  p_raw_token text,
  p_slot_id   uuid,
  p_payload   jsonb
) RETURNS public.bridge_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash   text;
  v_bridge RECORD;
  v_slot   public.bridge_slots%ROWTYPE;
  v_result public.bridge_slots%ROWTYPE;
BEGIN
  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');
  SELECT cb.id, cb.job_id, cb.status, cb.token_expires_at, cb.token_revoked_at
    INTO v_bridge
    FROM public.coordination_bridges cb
   WHERE cb.token_sha256 = v_hash;
  IF v_bridge.id IS NULL OR v_bridge.token_revoked_at IS NOT NULL OR v_bridge.token_expires_at < now() THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE='42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE='22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_slot
    FROM public.bridge_slots
   WHERE id = p_slot_id AND bridge_id = v_bridge.id AND kind = 'site_access';
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'site_access slot not found' USING ERRCODE='P0002';
  END IF;

  UPDATE public.bridge_slots
     SET status = 'awaiting_inspector',
         payload_json = p_payload || jsonb_build_object('declared_at', now()),
         last_action_at = now(),
         last_action_by_actor_kind = 'vendor'
   WHERE id = p_slot_id
   RETURNING * INTO v_result;

  PERFORM public.cb_emit_audit(
    'coordination_bridge.site_access_declared',
    'info',
    NULL, 'vendor', NULL,
    v_bridge.id, v_bridge.job_id,
    'Vendor declared site access requirements.',
    jsonb_build_object('slot_id', p_slot_id, 'payload', p_payload),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_declare_site_access(text, uuid, jsonb)
  FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- B.7) bridge_vendor_sign_arrival
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_sign_arrival(
  p_raw_token  text,
  p_slot_id    uuid,
  p_typed_name text,
  p_ip         text DEFAULT NULL
) RETURNS public.bridge_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash   text;
  v_bridge RECORD;
  v_slot   public.bridge_slots%ROWTYPE;
  v_result public.bridge_slots%ROWTYPE;
BEGIN
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN
    RAISE EXCEPTION 'typed_name required' USING ERRCODE='22023';
  END IF;

  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');
  SELECT cb.id, cb.job_id, cb.status, cb.token_expires_at, cb.token_revoked_at
    INTO v_bridge
    FROM public.coordination_bridges cb
   WHERE cb.token_sha256 = v_hash;
  IF v_bridge.id IS NULL OR v_bridge.token_revoked_at IS NOT NULL OR v_bridge.token_expires_at < now() THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE='42501';
  END IF;
  IF v_bridge.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'bridge is %; cannot mutate', v_bridge.status USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_slot
    FROM public.bridge_slots
   WHERE id = p_slot_id AND bridge_id = v_bridge.id AND kind = 'arrival_ack';
  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'arrival_ack slot not found' USING ERRCODE='P0002';
  END IF;

  UPDATE public.bridge_slots
     SET status = 'completed',
         completed_at = now(),
         payload_json = jsonb_build_object(
           'typed_name', trim(p_typed_name),
           'ip',         p_ip,
           'signed_at',  now(),
           'by_kind',    'vendor'
         ),
         last_action_at = now(),
         last_action_by_actor_kind = 'vendor'
   WHERE id = p_slot_id
   RETURNING * INTO v_result;

  PERFORM public.cb_emit_audit(
    'coordination_bridge.arrival_signed',
    'info',
    NULL, 'vendor', NULL,
    v_bridge.id, v_bridge.job_id,
    format('Vendor "%s" signed inspector arrival.', trim(p_typed_name)),
    jsonb_build_object(
      'slot_id', p_slot_id,
      'typed_name', trim(p_typed_name),
      'ip', p_ip
    ),
    jsonb_build_object('job_id', v_bridge.job_id::text, 'bridge_id', v_bridge.id::text)
  );

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_sign_arrival(text, uuid, text, text)
  FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- B.8) bridge_vendor_get_state — read-side projection for the vendor.
--      Returns ONLY what the vendor is permitted to see:
--        - bridge basic state (status, expires_at)
--        - job title + a tiny inspector display label
--        - all slots
--        - documents the vendor uploaded (not inspector-side)
--      NEVER exposes: pricing, full inspector profile, other parties,
--                     audit trail, inspector private notes.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_vendor_get_state(p_raw_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_hash text;
  v_bridge RECORD;
  v_job RECORD;
  v_inspector RECORD;
  v_slots jsonb;
  v_documents jsonb;
  v_vendor RECORD;
BEGIN
  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');

  SELECT * INTO v_bridge
    FROM public.coordination_bridges
   WHERE token_sha256 = v_hash;
  IF v_bridge.id IS NULL THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE='42501';
  END IF;

  SELECT id, title, location_city, scheduled_date
    INTO v_job FROM public.jobs WHERE id = v_bridge.job_id;
  SELECT id, COALESCE(NULLIF(full_name, ''), email) AS display_name
    INTO v_inspector FROM public.profiles WHERE id = v_bridge.inspector_id;
  SELECT id, company_name, contact_name, contact_email, language_code, timezone
    INTO v_vendor FROM public.vendor_contacts WHERE id = v_bridge.vendor_contact_id;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'sort_order', row->>'created_at'), '[]'::jsonb)
    INTO v_slots
    FROM (
      SELECT jsonb_build_object(
        'id',           s.id,
        'kind',         s.kind,
        'status',       s.status,
        'title',        s.title,
        'description',  s.description,
        'required',     s.required,
        'sort_order',   s.sort_order,
        'payload',      s.payload_json,
        'created_at',   s.created_at,
        'last_action_at', s.last_action_at,
        'completed_at', s.completed_at
      ) AS row
        FROM public.bridge_slots s
       WHERE s.bridge_id = v_bridge.id
    ) sub;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at' DESC), '[]'::jsonb)
    INTO v_documents
    FROM (
      SELECT jsonb_build_object(
        'id',          d.id,
        'slot_id',     d.slot_id,
        'filename',    d.original_filename,
        'mime_type',   d.mime_type,
        'size_bytes',  d.file_size_bytes,
        'sha256',      d.sha256_client_computed,
        'created_at',  d.created_at,
        'accepted_at', d.accepted_at,
        'rejected_at', d.rejected_at,
        'rejected_reason', d.rejected_reason
      ) AS row
        FROM public.bridge_documents d
       WHERE d.bridge_id = v_bridge.id
         AND d.uploaded_by_actor_kind = 'vendor'
    ) sub;

  RETURN jsonb_build_object(
    'bridge', jsonb_build_object(
      'id',                v_bridge.id,
      'status',            v_bridge.status,
      'token_expires_at',  v_bridge.token_expires_at,
      'token_revoked_at',  v_bridge.token_revoked_at,
      'created_at',        v_bridge.created_at,
      'completed_at',      v_bridge.completed_at,
      'cancelled_at',      v_bridge.cancelled_at
    ),
    'job', jsonb_build_object(
      'id',             v_job.id,
      'title',          COALESCE(v_job.title, 'Inspection'),
      'location_city',  v_job.location_city,
      'scheduled_date', v_job.scheduled_date
    ),
    'inspector', jsonb_build_object(
      'display_name', v_inspector.display_name
    ),
    'vendor', jsonb_build_object(
      'id',            v_vendor.id,
      'company_name',  v_vendor.company_name,
      'contact_name',  v_vendor.contact_name,
      'contact_email', v_vendor.contact_email,
      'language_code', v_vendor.language_code,
      'timezone',      v_vendor.timezone
    ),
    'slots',     v_slots,
    'documents', v_documents
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.bridge_vendor_get_state(text) FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- A.6) bridge_fetch_for_inspector — full state from the inspector's POV
--      (the inspector private notes ARE included; client-side fetcher
--      uses a different RPC that strips them).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bridge_fetch_for_inspector(p_bridge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_admin  boolean;
  v_bridge public.coordination_bridges%ROWTYPE;
  v_vendor public.vendor_contacts%ROWTYPE;
  v_slots jsonb;
  v_docs  jsonb;
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

  SELECT * INTO v_vendor FROM public.vendor_contacts WHERE id = v_bridge.vendor_contact_id;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'sort_order', row->>'created_at'), '[]'::jsonb)
    INTO v_slots
    FROM (
      SELECT to_jsonb(s) AS row FROM public.bridge_slots s
       WHERE s.bridge_id = p_bridge_id
    ) sub;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'created_at' DESC), '[]'::jsonb)
    INTO v_docs
    FROM (
      SELECT to_jsonb(d) AS row FROM public.bridge_documents d
       WHERE d.bridge_id = p_bridge_id
    ) sub;

  RETURN jsonb_build_object(
    'bridge',    to_jsonb(v_bridge),
    'vendor',    to_jsonb(v_vendor),
    'slots',     v_slots,
    'documents', v_docs
  );
END
$fn$;

GRANT EXECUTE ON FUNCTION public.bridge_fetch_for_inspector(uuid) TO authenticated;

COMMIT;
