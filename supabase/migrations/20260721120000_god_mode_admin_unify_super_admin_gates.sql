-- ════════════════════════════════════════════════════════════════════════════
--  20260721120000_god_mode_admin_unify_super_admin_gates.sql  (self-guarding)
--
--  SINGLE GOD-MODE ADMIN RULE — platform-wide RLS/RPC unification.
--  Widens every inline role='super_admin' gate to role IN ('admin','super_admin')
--  (= nx_is_admin()). admin contains super_admin; PURELY ADDITIVE.
--
--  SELF-GUARDING: the live DB is not 1:1 with migration history (some feature
--  tables were never applied), so each object is wrapped in a DO block that
--  EXECUTEs the DDL and SKIPS it (RAISE NOTICE) when a dependency is missing
--  (undefined_table/function/object/column). Any real error still surfaces.
--  Re-runnable + idempotent (CREATE OR REPLACE / DROP+CREATE POLICY).
-- ════════════════════════════════════════════════════════════════════════════


-- ─── FUNCTIONS (widened, guarded) ───

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public._actor_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role IN ('admin','super_admin')
  );
$$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public._actor_is_super_admin (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_accept_document (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
    SELECT 1 FROM public.profiles WHERE id = v_caller AND role IN ('admin','super_admin')
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_add_document_request (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_cancel (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_complete (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
    SELECT 1 FROM public.profiles WHERE id = v_caller AND role IN ('admin','super_admin')
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_create (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_fetch_for_inspector (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_propose_schedule (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_reject_document (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;
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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_rotate_token (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;

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
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.bridge_send_invitation (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.can_assemble_evidence_for(
  p_job_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job        record;
  v_dept_org   uuid;
  v_user_role  text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Platform Owner — universal.
  SELECT role INTO v_user_role FROM public.profiles WHERE id = p_user_id;
  IF v_user_role IN ('admin','super_admin') THEN
    RETURN true;
  END IF;

  -- Pull job's identifying ids.
  SELECT id, client_id, contractor_id, department_id
    INTO v_job
    FROM public.jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RETURN false;
  END IF;

  -- Job parties get their own evidence pack.
  IF v_job.client_id = p_user_id OR v_job.contractor_id = p_user_id THEN
    RETURN true;
  END IF;

  -- Enterprise Admin gate — elevated role on the org that owns the
  -- attributed department. Project leads + viewers are deliberately
  -- excluded (signature IPs + approval comments are need-to-know).
  IF v_job.department_id IS NOT NULL THEN
    SELECT org_id INTO v_dept_org FROM public.departments WHERE id = v_job.department_id;
    IF v_dept_org IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.org_members
         WHERE org_id  = v_dept_org
           AND user_id = p_user_id
           AND role IN ('owner', 'procurement_admin')
      ) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.can_assemble_evidence_for (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.can_manage_org_structure(
  p_org_id  uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND role IN ('admin','super_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id  = p_org_id
        AND user_id = p_user_id
        AND role IN ('owner', 'procurement_admin')
    );
$$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.can_manage_org_structure (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.detect_vendor_coordination_latency(
  p_org_id uuid,
  p_lookback_days integer DEFAULT 90
) RETURNS TABLE (
  vendor_contact_id   uuid,
  vendor_company      text,
  bridges_count       integer,
  median_doc_days     numeric,
  max_counter_rounds  integer,
  severity            text,
  evidence            jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_admin  boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_caller AND role IN ('admin','super_admin')) INTO v_admin;
  IF NOT v_admin
     AND NOT EXISTS (
       SELECT 1 FROM public.org_members
        WHERE org_id = p_org_id AND user_id = v_caller
          AND role IN ('owner', 'procurement_admin')
     )
  THEN
    RAISE EXCEPTION 'not authorised to read compliance posture for this org' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  WITH org_jobs AS (
    SELECT j.id AS job_id, j.created_at
      FROM public.jobs j
      JOIN public.departments d ON d.id = j.department_id
     WHERE d.org_id = p_org_id
       AND j.created_at >= now() - (GREATEST(1, COALESCE(p_lookback_days, 90)) || ' days')::interval
  ),
  org_bridges AS (
    SELECT cb.id, cb.vendor_contact_id, cb.job_id, cb.created_at, cb.completed_at, cb.cancelled_at
      FROM public.coordination_bridges cb
      JOIN org_jobs oj ON oj.job_id = cb.job_id
  ),
  doc_latency AS (
    SELECT b.vendor_contact_id,
           b.id AS bridge_id,
           extract(epoch from (d.accepted_at - s.created_at)) / 86400.0 AS days_to_accept
      FROM org_bridges b
      JOIN public.bridge_slots s     ON s.bridge_id = b.id AND s.kind = 'document_request'
      JOIN public.bridge_documents d ON d.slot_id = s.id AND d.accepted_at IS NOT NULL
  ),
  schedule_counters AS (
    SELECT b.vendor_contact_id, b.id AS bridge_id,
           COUNT(*) FILTER (
             WHERE a.event_type = 'coordination_bridge.schedule_counter_proposed'
                OR a.event_type = 'coordination_bridge.schedule_proposed'
           ) AS rounds
      FROM org_bridges b
      LEFT JOIN public.audit_events a
             ON a.subject_table = 'coordination_bridges'
            AND a.subject_id = b.id
     GROUP BY b.vendor_contact_id, b.id
  ),
  vendor_agg AS (
    SELECT
      ob.vendor_contact_id,
      COUNT(DISTINCT ob.id)::int AS bridges_count,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY dl.days_to_accept), 0) AS median_doc_days,
      COALESCE(MAX(sc.rounds), 0)::int AS max_counter_rounds
    FROM org_bridges ob
    LEFT JOIN doc_latency       dl ON dl.vendor_contact_id = ob.vendor_contact_id
    LEFT JOIN schedule_counters sc ON sc.bridge_id = ob.id
   GROUP BY ob.vendor_contact_id
  )
  SELECT
    va.vendor_contact_id,
    vc.company_name AS vendor_company,
    va.bridges_count,
    round(va.median_doc_days::numeric, 2) AS median_doc_days,
    va.max_counter_rounds,
    CASE
      WHEN va.median_doc_days > 14 OR va.max_counter_rounds >= 5 THEN 'critical'
      WHEN va.median_doc_days > 5  OR va.max_counter_rounds >= 3 THEN 'warning'
      ELSE 'info'
    END AS severity,
    jsonb_build_object(
      'vendor_company',     vc.company_name,
      'vendor_email',       vc.contact_email,
      'bridges_count',      va.bridges_count,
      'median_doc_days',    round(va.median_doc_days::numeric, 2),
      'max_counter_rounds', va.max_counter_rounds,
      'lookback_days',      COALESCE(p_lookback_days, 90)
    ) AS evidence
    FROM vendor_agg va
    JOIN public.vendor_contacts vc ON vc.id = va.vendor_contact_id
   WHERE va.bridges_count >= 1
     AND (va.median_doc_days > 5 OR va.max_counter_rounds >= 3)
   ORDER BY severity DESC, va.median_doc_days DESC;
END
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.detect_vendor_coordination_latency (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
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
    SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role IN ('admin','super_admin')
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
$$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.flash_report_add_attachment (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.flash_report_create(
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
    SELECT 1 FROM public.profiles p WHERE p.id = v_actor AND p.role IN ('admin','super_admin')
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
$$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.flash_report_create (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.pi_countersign_inspection_report(p_report_id uuid)
RETURNS public.pi_report_seals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller        uuid := auth.uid();
  v_is_admin      boolean;
  v_seal          public.pi_report_seals%ROWTYPE;
  v_job_client_id uuid;
  v_signed_at     timestamptz := now();
  v_signature     text;
  v_audit_id      uuid;
  v_actor_role    text;
  v_result        public.pi_report_seals%ROWTYPE;
BEGIN
  -- ────────── Auth ──────────
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_caller AND role IN ('admin','super_admin')
  ) INTO v_is_admin;

  v_actor_role := CASE WHEN v_is_admin THEN 'super_admin' ELSE 'client' END;

  -- ────────── Load seal ──────────
  SELECT * INTO v_seal
    FROM public.pi_report_seals
   WHERE report_id = p_report_id;

  IF v_seal.id IS NULL THEN
    RAISE EXCEPTION 'report % has not been sealed yet — inspector must seal first', p_report_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency.
  IF v_seal.client_signed_at IS NOT NULL THEN
    RETURN v_seal;
  END IF;

  -- ────────── Authorization: client of the job, or admin ──────────
  SELECT client_id INTO v_job_client_id
    FROM public.jobs
   WHERE id = v_seal.job_id;

  IF NOT v_is_admin
     AND (v_job_client_id IS NULL OR v_job_client_id <> v_caller)
  THEN
    RAISE EXCEPTION 'only the client of this job or NEXPEC Admin may countersign'
      USING ERRCODE = '42501';
  END IF;

  -- ────────── Compute client signature ──────────
  v_signature := encode(
    digest(
      v_caller::text || '|'
      || to_char(v_signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || v_seal.root_sha256,
      'sha256'
    ),
    'hex'
  );

  -- ────────── Audit event ──────────
  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role,
    subject_table, subject_id, job_id, summary, delta, metadata
  )
  VALUES (
    'compliance.inspection_report.countersigned',
    'info',
    v_caller,
    v_actor_role,
    'pi_report_seals',
    v_seal.id,
    v_seal.job_id,
    format('Client countersigned seal %s for report %s', v_seal.id, p_report_id),
    jsonb_build_object(
      'seal_id',                 v_seal.id,
      'root_sha256',             v_seal.root_sha256,
      'client_signature_sha256', v_signature,
      'client_signed_at',        v_signed_at
    ),
    jsonb_build_object(
      'seal_id',   v_seal.id::text,
      'root_hash', v_seal.root_sha256
    )
  )
  RETURNING id INTO v_audit_id;

  -- ────────── Apply countersignature ──────────
  UPDATE public.pi_report_seals
     SET client_signed_at        = v_signed_at,
         client_signed_by        = v_caller,
         client_signature_sha256 = v_signature,
         updated_at              = now()
   WHERE id = v_seal.id
  RETURNING * INTO v_result;

  RETURN v_result;
END
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.pi_countersign_inspection_report (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.pi_fetch_report_seal(p_report_id uuid)
RETURNS public.pi_report_seals
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  v_result   public.pi_report_seals%ROWTYPE;
  v_can_see  boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_result
    FROM public.pi_report_seals
   WHERE report_id = p_report_id;

  IF v_result.id IS NULL THEN
    -- No seal — return all-NULL row. Caller checks id IS NULL.
    RETURN v_result;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_caller AND role IN ('admin','super_admin')
  ) INTO v_is_admin;

  v_can_see :=
    v_is_admin
    OR v_result.inspector_id = v_caller
    OR EXISTS (
         SELECT 1 FROM public.jobs
          WHERE id = v_result.job_id AND client_id = v_caller
       );

  IF NOT v_can_see THEN
    RAISE EXCEPTION 'not authorised to view this seal' USING ERRCODE = '42501';
  END IF;

  RETURN v_result;
END
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.pi_fetch_report_seal (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
CREATE OR REPLACE FUNCTION public.pi_seal_inspection_report(p_report_id uuid)
RETURNS public.pi_report_seals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_caller             uuid := auth.uid();
  v_is_admin           boolean;
  v_report             public.inspection_reports%ROWTYPE;
  v_existing           public.pi_report_seals%ROWTYPE;

  v_seal_id            uuid := gen_random_uuid();
  v_sealed_at          timestamptz := now();

  v_captures_count     integer := 0;
  v_items_count        integer := 0;
  v_chain_verified     boolean := true;
  v_chain_break_at     uuid;

  v_prev_hash          text;
  v_captures_concat    text := '';
  v_items_concat       text := '';
  v_vendor_concat      text := '';
  v_ai_concat          text := '';

  v_captures_root      text;
  v_items_root         text;
  v_report_meta_sha    text;
  v_vendor_root        text;
  v_ai_root            text;
  v_ai_count           integer := 0;
  v_root               text;
  v_inspector_sig      text;

  v_audit_id           uuid;
  v_actor_role         text;

  v_capture            RECORD;
  v_item               RECORD;
  v_vendor_doc         RECORD;
  v_ai                 RECORD;
  v_item_jsonb         jsonb;
  v_report_jsonb       jsonb;
  v_ai_jsonb           jsonb;

  v_result             public.pi_report_seals%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND role IN ('admin','super_admin'))
    INTO v_is_admin;
  v_actor_role := CASE WHEN v_is_admin THEN 'super_admin' ELSE 'inspector' END;

  SELECT * INTO v_report FROM public.inspection_reports WHERE id = p_report_id;
  IF v_report.id IS NULL THEN
    RAISE EXCEPTION 'inspection report % not found', p_report_id USING ERRCODE = 'P0002';
  END IF;
  IF v_report.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'inspection report % is deleted', p_report_id USING ERRCODE = '22023';
  END IF;
  IF NOT v_is_admin AND v_report.inspector_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'only the report author or NEXPEC Admin may seal this report'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.pi_report_seals WHERE report_id = p_report_id;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- ── Captures root + chain ──
  v_prev_hash := NULL;
  FOR v_capture IN
    SELECT id, capture_sha256, prev_capture_sha256, sort_index, captured_at
      FROM public.inspection_captures
     WHERE job_id = v_report.job_id
     ORDER BY sort_index ASC, captured_at ASC NULLS LAST, id ASC
  LOOP
    v_captures_count := v_captures_count + 1;
    IF v_captures_count = 1 THEN
      IF v_capture.prev_capture_sha256 IS NOT NULL THEN
        v_chain_verified := false;
        v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
      END IF;
    ELSE
      IF v_capture.prev_capture_sha256 IS DISTINCT FROM v_prev_hash THEN
        v_chain_verified := false;
        v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
      END IF;
    END IF;
    IF v_capture.capture_sha256 IS NULL THEN
      v_chain_verified := false;
      v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
    END IF;
    v_captures_concat := v_captures_concat || COALESCE(v_capture.capture_sha256, '') || '|';
    v_prev_hash := v_capture.capture_sha256;
  END LOOP;
  v_captures_root := encode(digest(v_captures_concat, 'sha256'), 'hex');

  -- ── Items root ──
  FOR v_item IN
    SELECT id, description, status, photo_url, notes, location, created_at
      FROM public.inspection_items
     WHERE report_id = p_report_id
     ORDER BY created_at ASC NULLS LAST, id ASC
  LOOP
    v_items_count := v_items_count + 1;
    v_item_jsonb := jsonb_build_object(
      'id', v_item.id, 'description', v_item.description, 'status', v_item.status,
      'photo_url', v_item.photo_url, 'notes', v_item.notes, 'location', v_item.location,
      'created_at', v_item.created_at
    );
    v_items_concat := v_items_concat || public.pi_canonical_json(v_item_jsonb) || '|';
  END LOOP;
  v_items_root := encode(digest(v_items_concat, 'sha256'), 'hex');

  -- ── Report metadata hash ──
  v_report_jsonb := jsonb_build_object(
    'id', v_report.id, 'job_id', v_report.job_id, 'inspector_id', v_report.inspector_id,
    'status', v_report.status, 'notes', v_report.notes, 'pdf_url', v_report.pdf_url,
    'final_report_doc', v_report.final_report_doc, 'is_published', v_report.is_published,
    'is_client_approved', v_report.is_client_approved, 'signed_docs_url', v_report.signed_docs_url,
    'created_at', v_report.created_at
  );
  v_report_meta_sha := encode(digest(public.pi_canonical_json(v_report_jsonb), 'sha256'), 'hex');

  -- ── Vendor-chain root (Sprint C) ──
  IF to_regclass('public.bridge_documents') IS NOT NULL THEN
    FOR v_vendor_doc IN
      SELECT d.sha256_client_computed, d.accepted_at, d.id
        FROM public.bridge_documents d
        JOIN public.coordination_bridges cb ON cb.id = d.bridge_id
       WHERE cb.job_id = v_report.job_id
         AND d.uploaded_by_actor_kind = 'vendor'
         AND d.accepted_at IS NOT NULL
       ORDER BY d.accepted_at ASC NULLS LAST, d.id ASC
    LOOP
      v_vendor_concat := v_vendor_concat || COALESCE(v_vendor_doc.sha256_client_computed, '') || '|';
    END LOOP;
  END IF;
  v_vendor_root := encode(digest(v_vendor_concat, 'sha256'), 'hex');

  -- ── AI-detection root (NEW · Provable AI) ──
  -- Hash chain over every HUMAN-ACCEPTED AI detection for this report, each
  -- bound to the exact signed model (slug+version+sha256). Ordered by
  -- created_at then id for deterministic re-derivation. Folding this into the
  -- root makes every accepted AI suggestion tamper-evident under the seal.
  IF to_regclass('public.ai_detections') IS NOT NULL THEN
    FOR v_ai IN
      SELECT id, defect_id, label, confidence, severity, model_slug, model_version, model_sha256
        FROM public.ai_detections
       WHERE accepted_by_human = true
         AND ( report_id = p_report_id
               OR (report_id IS NULL AND job_id = v_report.job_id) )
       ORDER BY created_at ASC NULLS LAST, id ASC
    LOOP
      v_ai_count := v_ai_count + 1;
      v_ai_jsonb := jsonb_build_object(
        'id', v_ai.id, 'defect_id', v_ai.defect_id, 'label', v_ai.label,
        'confidence', v_ai.confidence, 'severity', v_ai.severity,
        'model_slug', v_ai.model_slug, 'model_version', v_ai.model_version,
        'model_sha256', v_ai.model_sha256
      );
      v_ai_concat := v_ai_concat || public.pi_canonical_json(v_ai_jsonb) || '|';
    END LOOP;
  END IF;
  v_ai_root := encode(digest(v_ai_concat, 'sha256'), 'hex');

  -- ── Compose root (5-component, lexicographic) ──
  WITH parts(s) AS (
    VALUES (v_captures_root), (v_items_root), (v_report_meta_sha), (v_vendor_root), (v_ai_root)
  )
  SELECT encode(digest(string_agg(s, '|' ORDER BY s), 'sha256'), 'hex')
    INTO v_root FROM parts;

  v_inspector_sig := encode(
    digest(
      v_report.inspector_id::text || '|'
      || to_char(v_sealed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || v_root,
      'sha256'
    ), 'hex'
  );

  -- ── Audit + seal write ──
  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id, summary, delta, metadata
  )
  VALUES (
    'compliance.inspection_report.sealed',
    'info',
    v_caller, v_actor_role, NULL,
    'inspection_reports', p_report_id, v_report.job_id,
    format('Sealed inspection report %s (captures=%s, items=%s, ai=%s, chain=%s)',
      p_report_id, v_captures_count, v_items_count, v_ai_count,
      CASE WHEN v_chain_verified THEN 'intact' ELSE 'broken' END),
    jsonb_build_object(
      'seal_id',                   v_seal_id,
      'root_sha256',               v_root,
      'captures_root_sha256',      v_captures_root,
      'items_root_sha256',         v_items_root,
      'report_meta_sha256',        v_report_meta_sha,
      'vendor_chain_root_sha256',  v_vendor_root,
      'ai_root_sha256',            v_ai_root,
      'ai_count',                  v_ai_count,
      'inspector_signature_sha256', v_inspector_sig,
      'captures_count',            v_captures_count,
      'items_count',               v_items_count,
      'chain_verified',            v_chain_verified,
      'chain_break_at_capture_id', v_chain_break_at,
      'algorithm',                 'sha256/canonical-json/v3'
    ),
    jsonb_build_object('seal_id', v_seal_id::text, 'root_hash', v_root)
  )
  RETURNING id INTO v_audit_id;

  INSERT INTO public.pi_report_seals (
    id, report_id, job_id, inspector_id,
    algorithm,
    root_sha256, captures_root_sha256, items_root_sha256, report_meta_sha256,
    ai_root_sha256, ai_count,
    captures_count, items_count,
    chain_verified, chain_break_at_capture_id,
    inspector_sealed_at, inspector_signature_sha256,
    audit_event_id
  )
  VALUES (
    v_seal_id,
    p_report_id, v_report.job_id, v_report.inspector_id,
    'sha256/canonical-json/v3',
    v_root, v_captures_root, v_items_root, v_report_meta_sha,
    v_ai_root, v_ai_count,
    v_captures_count, v_items_count,
    v_chain_verified, v_chain_break_at,
    v_sealed_at, v_inspector_sig,
    v_audit_id
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END
$fn$
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_function OR undefined_object OR undefined_column THEN
  RAISE NOTICE 'godmode skip: public.pi_seal_inspection_report (%)', SQLERRM;
END $nx_guard$;


-- ─── POLICIES (widened, guarded) ───

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS bridge_documents_select_admin ON public.bridge_documents
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY bridge_documents_select_admin
  ON public.bridge_documents FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: bridge_documents_select_admin ON public.bridge_documents (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS bridge_slots_select_admin ON public.bridge_slots
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY bridge_slots_select_admin
  ON public.bridge_slots FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: bridge_slots_select_admin ON public.bridge_slots (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS contact_submissions_admin_select ON public.contact_submissions
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY contact_submissions_admin_select
  ON public.contact_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('admin','super_admin')
    )
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: contact_submissions_admin_select ON public.contact_submissions (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS contact_submissions_admin_update ON public.contact_submissions
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY contact_submissions_admin_update
  ON public.contact_submissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('admin','super_admin')
    )
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: contact_submissions_admin_update ON public.contact_submissions (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS contact_submissions_admin_delete ON public.contact_submissions
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY contact_submissions_admin_delete
  ON public.contact_submissions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('admin','super_admin')
    )
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: contact_submissions_admin_delete ON public.contact_submissions (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS coordination_bridges_select_admin ON public.coordination_bridges
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY coordination_bridges_select_admin
  ON public.coordination_bridges FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: coordination_bridges_select_admin ON public.coordination_bridges (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS department_members_select_admin ON public.department_members
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY department_members_select_admin
  ON public.department_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')
  ))
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: department_members_select_admin ON public.department_members (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS departments_select_admin ON public.departments
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY departments_select_admin
  ON public.departments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')
  ))
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: departments_select_admin ON public.departments (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS fx_refresh_runs_select_admin ON public.fx_refresh_runs
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY fx_refresh_runs_select_admin
  ON public.fx_refresh_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND role IN ('admin','super_admin')
    )
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: fx_refresh_runs_select_admin ON public.fx_refresh_runs (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS org_invitations_select_admin ON public.org_invitations
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY org_invitations_select_admin
  ON public.org_invitations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin'))
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: org_invitations_select_admin ON public.org_invitations (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS org_members_select_admin ON public.org_members
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY org_members_select_admin
  ON public.org_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')
  ))
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: org_members_select_admin ON public.org_members (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS organizations_select_admin ON public.organizations
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY organizations_select_admin
  ON public.organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')
  ))
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: organizations_select_admin ON public.organizations (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS organizations_admin_write ON public.organizations
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY organizations_admin_write
  ON public.organizations FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin')
  ))
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: organizations_admin_write ON public.organizations (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS pi_report_seals_select_admin ON public.pi_report_seals
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY pi_report_seals_select_admin
  ON public.pi_report_seals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND role IN ('admin','super_admin')
    )
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: pi_report_seals_select_admin ON public.pi_report_seals (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS platform_settings_admin_write ON public.platform_settings
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY platform_settings_admin_write
  ON public.platform_settings FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','super_admin'))
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: platform_settings_admin_write ON public.platform_settings (%)', SQLERRM;
END $nx_guard$;

DO $nx_guard$
BEGIN
  EXECUTE $nx_ddl$
DROP POLICY IF EXISTS vendor_contacts_select_admin ON public.vendor_contacts
$nx_ddl$;
  EXECUTE $nx_ddl$
CREATE POLICY vendor_contacts_select_admin
  ON public.vendor_contacts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  )
$nx_ddl$;
EXCEPTION WHEN undefined_table OR undefined_object THEN
  RAISE NOTICE 'godmode skip: vendor_contacts_select_admin ON public.vendor_contacts (%)', SQLERRM;
END $nx_guard$;
