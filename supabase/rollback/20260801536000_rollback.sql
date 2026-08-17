-- Rollback for 20260801536000_contract_payout_binds_accepted_bid.sql
--
-- Restores admin_generate_job_contract to the pre-guard baseline definition:
-- no payout/accepted-bid binding and no contract.generated audit row.
--
-- Only run this if the binding guard has to be lifted in an emergency. Doing so
-- re-opens the defect: an admin can then generate a contract paying the
-- inspector less than the counter the inspector accepted.

CREATE OR REPLACE FUNCTION "public"."admin_generate_job_contract"(
  "p_application_id" "uuid",
  "p_client_price_cents" bigint,
  "p_inspector_payout_cents" bigint,
  "p_contract_text_md" "text" DEFAULT NULL::"text",
  "p_custom_contract_url" "text" DEFAULT NULL::"text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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

  PERFORM public.create_system_notification(
    v_app.client_id,
    'Contract ready for signature',
    'Admin has prepared the contract for your job. Review and sign to commit funds.',
    'contract_assigned',
    '/client/contracts/job/' || v_id::text,
    v_app.job_id
  );

  RETURN jsonb_build_object('ok', true, 'contract_id', v_id);
END $$;
