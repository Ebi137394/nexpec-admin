-- ════════════════════════════════════════════════════════════════════════════
--  rollback_identity_replacement.sql  (NOT a migration — run manually to revert)
--
--  Reverses 20260801284000 / 286000 / 288000. Ordered so dependencies drop
--  before the objects they reference. Restores the three CREATE-OR-REPLACE'd
--  functions and the client view to their pre-feature (baseline) definitions.
--
--  Steps 1–6 are fully reversible and lossless. Step 7 (DROP COLUMN) is
--  DESTRUCTIVE (loses identity_mode / replacement_mode / snapshots / approval
--  provenance) and is left commented — uncomment only if you truly want the
--  columns gone. Leaving the columns in place is harmless (defaults reproduce
--  legacy behaviour).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Triggers + trigger functions -------------------------------------------------
DROP TRIGGER IF EXISTS trg_job_contracts_identity_snapshot ON public.job_contracts;
DROP TRIGGER IF EXISTS trg_job_contracts_reject_brokered_job ON public.job_contracts;
DROP FUNCTION IF EXISTS public.tg_job_contracts_identity_snapshot();
DROP FUNCTION IF EXISTS public.tg_job_contracts_reject_brokered_job();

-- 2) New RPCs + helpers + reminder ------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_set_project_policy(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_void_contract(uuid, text);
DROP FUNCTION IF EXISTS public.admin_replace_inspector(uuid, uuid, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.is_active_contract_inspector(uuid, uuid);
DROP FUNCTION IF EXISTS public.inspector_assignment_end(uuid, uuid);

-- Cron reminder (unschedule then drop the function)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('nx_identity_replacement_reminders'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $cron$;
DROP FUNCTION IF EXISTS public.nx_identity_replacement_reminders();

-- 3) New RLS policies -------------------------------------------------------------
DROP POLICY IF EXISTS job_contracts_inspector_select_own ON public.job_contracts;
DROP POLICY IF EXISTS captures_select_own_inspector ON public.inspection_captures;
DROP POLICY IF EXISTS captures_update_requires_active_inspector ON public.inspection_captures;
DROP POLICY IF EXISTS reports_insert_requires_active_inspector ON public.inspection_reports;
DROP POLICY IF EXISTS reports_update_requires_active_inspector ON public.inspection_reports;
DROP POLICY IF EXISTS messages_insert_requires_active_inspector ON public.messages;

-- 4) Restore client_job_contracts_view to baseline (16 columns) --------------------
CREATE OR REPLACE VIEW public.client_job_contracts_view AS
 SELECT id, job_id, application_id, client_id, inspector_id, client_price_cents,
        status, contract_text_md, custom_contract_url, client_signed_at,
        client_signed_name, inspector_signed_at, voided_at, voided_reason,
        created_at, updated_at
   FROM public.job_contracts
  WHERE (client_id = auth.uid()) OR public.nx_is_admin();

-- 5) Restore send_message to the PRE-FEATURE (20260801208000, ghost-mode-aware)
--    definition — NOT the older 198000 body — so rolling back never clobbers the
--    ghost guard. Only the former-inspector cutoff (added by 288000) is removed.
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id uuid, p_content text DEFAULT NULL, p_attachment_url text DEFAULT NULL,
  p_attachment_type text DEFAULT NULL, p_attachment_name text DEFAULT NULL
) RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_kind public.conversation_kind; v_row public.messages;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING errcode = '28000'; END IF;
  IF p_conversation_id IS NULL THEN RAISE EXCEPTION 'conversation_id required'; END IF;
  IF btrim(COALESCE(p_content, '')) = '' AND p_attachment_url IS NULL THEN
    RAISE EXCEPTION 'empty message (need content or attachment)'; END IF;
  SELECT kind INTO v_kind FROM public.conversations WHERE id = p_conversation_id;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'conversation not found'; END IF;
  IF v_kind = 'job_team_internal'::public.conversation_kind THEN
    IF NOT public.nx_can_team_manage_internal(p_conversation_id) THEN
      RAISE EXCEPTION 'not authorised to post to this internal team thread' USING errcode = '42501'; END IF;
  ELSE
    IF NOT (
          public.nx_is_admin()
       OR EXISTS (SELECT 1 FROM public.conversations c
                   WHERE c.id = p_conversation_id AND c.user_id = v_uid AND c.status = 'open')
       OR public.nx_can_team_manage_conversation(p_conversation_id)
    ) THEN RAISE EXCEPTION 'not authorised to post to this conversation' USING errcode = '42501'; END IF;
  END IF;
  INSERT INTO public.messages (conversation_id, sender_id, content, attachment_url, attachment_type, attachment_name)
  VALUES (p_conversation_id, v_uid, btrim(COALESCE(p_content, '')), p_attachment_url, p_attachment_type, p_attachment_name)
  RETURNING * INTO v_row;
  RETURN v_row;
END $fn$;

-- 6) Restore client_sign_job_contract / inspector_sign_job_contract to baseline
--    (drop the added audit_events inserts). Bodies identical to the baseline.
CREATE OR REPLACE FUNCTION public.client_sign_job_contract(
  "p_contract_id" uuid, "p_typed_name" text, "p_ip" text DEFAULT NULL::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF v_c.client_id <> auth.uid() THEN RAISE EXCEPTION 'only the client can sign this contract'; END IF;
  IF v_c.status <> 'pending_client_signature' THEN RAISE EXCEPTION 'contract not awaiting client signature (status=%)', v_c.status; END IF;
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN RAISE EXCEPTION 'type your full legal name to sign'; END IF;
  UPDATE public.job_contracts SET client_signed_at=NOW(), client_signed_name=trim(p_typed_name), client_signed_ip=p_ip, status='pending_inspector_signature' WHERE id=p_contract_id;
  UPDATE public.jobs SET status='assigned', hired_inspector_id=v_c.inspector_id, updated_at=NOW() WHERE id=v_c.job_id AND status='open';
  BEGIN PERFORM public.create_system_notification(v_c.inspector_id,'Client signed — your turn','Open the contract to sign and accept the assignment.','contract_assigned','/inspector/contracts/job/'||p_contract_id::text,v_c.job_id); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM public.create_admin_notification('Client signed a job contract','Awaiting inspector signature. Job moved to assigned.','contract_assigned','/admin/jobs?inspect='||v_c.job_id::text,v_c.job_id); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'status', 'pending_inspector_signature');
END $$;

CREATE OR REPLACE FUNCTION public.inspector_sign_job_contract(
  "p_contract_id" uuid, "p_typed_name" text, "p_ip" text DEFAULT NULL::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM public.job_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF v_c.inspector_id <> auth.uid() THEN RAISE EXCEPTION 'only the assigned inspector can sign'; END IF;
  IF v_c.status <> 'pending_inspector_signature' THEN RAISE EXCEPTION 'contract not awaiting inspector signature (status=%)', v_c.status; END IF;
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN RAISE EXCEPTION 'type your full legal name to sign'; END IF;
  UPDATE public.job_contracts SET inspector_signed_at=NOW(), inspector_signed_name=trim(p_typed_name), inspector_signed_ip=p_ip, status='fully_executed' WHERE id=p_contract_id;
  UPDATE public.jobs SET status='assigned', hired_inspector_id=v_c.inspector_id, updated_at=NOW() WHERE id=v_c.job_id AND status='open';
  UPDATE public.jobs SET status='in_progress', hired_inspector_id=v_c.inspector_id, inspector_payout_cents=v_c.inspector_payout_cents, payout_amount_cents=v_c.inspector_payout_cents, client_price_cents=v_c.client_price_cents, updated_at=NOW() WHERE id=v_c.job_id AND status='assigned';
  BEGIN
    PERFORM public.create_system_notification(v_c.client_id,'Contract fully executed','Inspector signed. Job is now in progress.','contract_assigned','/client/jobs/'||v_c.job_id::text,v_c.job_id);
    PERFORM public.create_system_notification(v_c.inspector_id,'Job confirmed','You signed the contract. Job is now in progress on your dashboard.','assignment','/inspector/jobs/'||v_c.job_id::text,v_c.job_id);
    PERFORM public.create_admin_notification('Contract fully executed','Both parties signed. Job moved to in_progress.','contract_assigned','/admin/jobs?inspect='||v_c.job_id::text,v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'status', 'fully_executed');
END $$;

-- 7) OPTIONAL destructive column drop (loses feature data). Uncomment to fully remove.
-- ALTER TABLE public.job_contracts
--   DROP CONSTRAINT IF EXISTS job_contracts_client_approval_type_check,
--   DROP CONSTRAINT IF EXISTS job_contracts_admin_auth_complete,
--   DROP CONSTRAINT IF EXISTS job_contracts_client_sig_no_admin_auth,
--   DROP CONSTRAINT IF EXISTS job_contracts_effective_identity_mode_check,
--   DROP COLUMN IF EXISTS client_approval_type,
--   DROP COLUMN IF EXISTS admin_authorized_by,
--   DROP COLUMN IF EXISTS admin_authorized_at,
--   DROP COLUMN IF EXISTS admin_authorization_reason,
--   DROP COLUMN IF EXISTS effective_identity_mode;
-- ALTER TABLE public.jobs
--   DROP CONSTRAINT IF EXISTS jobs_identity_mode_check,
--   DROP CONSTRAINT IF EXISTS jobs_replacement_mode_check,
--   DROP COLUMN IF EXISTS identity_mode,
--   DROP COLUMN IF EXISTS replacement_mode;

NOTIFY pgrst, 'reload schema';
