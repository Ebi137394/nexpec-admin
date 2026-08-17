-- ════════════════════════════════════════════════════════════════════════════
--  20260801536000_contract_payout_binds_accepted_bid.sql
--
--  DEFECT (P1, money integrity)
--  ----------------------------
--  `admin_generate_job_contract` accepted `p_inspector_payout_cents` as a free
--  parameter. Its only checks were non-negativity (here) and payout <= price
--  (in the web action). Nothing tied the contract payout to the amount the
--  inspector had actually agreed to, so an admin could negotiate a counter,
--  have the inspector accept it, and then generate the contract at a LOWER
--  payout. The inspector signs a contract whose number nobody showed them.
--
--  WHY THIS IS THE INTENDED RULE (derived, not invented)
--  ----------------------------------------------------
--  `inspector_respond_to_counter` already says so in its own body:
--
--      -- On acceptance, copy the counter into bid_amount_cents so the rest of
--      -- the platform (dispatch table, payouts) sees a single canonical price.
--      bid_amount_cents = CASE
--                           WHEN p_decision = 'accepted' THEN admin_counter_cents
--                           ELSE bid_amount_cents
--                         END
--
--  "a single canonical price ... payouts" is the product rule. On acceptance
--  `bid_amount_cents` IS the agreed payout. This migration enforces what that
--  comment already promises. Observed behaviour agrees: client acceptance moves
--  `jobs.inspector_payout_cents` to the accepted counter on its own, and the
--  dispatch form pre-fills it.
--
--  SCOPE — deliberately narrow
--  ---------------------------
--  The guard fires ONLY when `negotiation_status = 'counter_accepted'`, i.e. a
--  counter was offered AND the inspector explicitly accepted it. That is the
--  only state carrying provable mutual consent to a specific number. Where no
--  negotiation concluded (NULL / 'none' / 'counter_rejected'), admin pricing
--  discretion is unchanged — this migration must not quietly become a repricing
--  policy for jobs that never negotiated. A NULL `bid_amount_cents` is skipped
--  because there is nothing to bind to.
--
--  THE SANCTIONED OVERRIDE IS RE-NEGOTIATION, NOT A FLAG
--  ----------------------------------------------------
--  No override parameter is added. Changing an agreed payout requires renewed
--  consent, and the platform already has exactly that workflow:
--  `admin_counter_offer` -> inspector accepts via `inspector_respond_to_counter`.
--  That path is explicit, audited (inspector_decision, _note, _at) and genuinely
--  re-consented. Adding a "reason" escape hatch here would let one party change
--  the other party's money with a free-text string, which is the very thing
--  being fixed.
--
--  Also adds the audit row this money step never wrote.
--
--  BLAST RADIUS: new contract generation only. Existing `job_contracts` rows are
--  untouched. Signature is unchanged, so CREATE OR REPLACE preserves ownership
--  and grants. Rollback: supabase/rollback/20260801536000_rollback.sql.
-- ════════════════════════════════════════════════════════════════════════════

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
  v_app        RECORD;
  v_id         uuid;
  v_actor      uuid := auth.uid();
  v_actor_role text;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_client_price_cents < 0 OR p_inspector_payout_cents < 0 THEN
    RAISE EXCEPTION 'prices must be non-negative';
  END IF;

  -- negotiation columns are needed for the binding check below
  SELECT a.id, a.job_id, a.applicant_id, j.client_id,
         a.bid_amount_cents, a.negotiation_status
    INTO v_app
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
   WHERE a.id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found';
  END IF;

  -- ── the agreed payout is binding ──────────────────────────────────────────
  -- Only when the inspector explicitly accepted a counter. See header.
  IF v_app.negotiation_status = 'counter_accepted'
     AND v_app.bid_amount_cents IS NOT NULL
     AND p_inspector_payout_cents <> v_app.bid_amount_cents THEN
    RAISE EXCEPTION
      'PAYOUT_BINDING_VIOLATION: inspector accepted %, contract would pay %. '
      'The accepted counter is binding. To change it, re-negotiate via '
      'admin_counter_offer and have the inspector accept the new amount.',
      v_app.bid_amount_cents, p_inspector_payout_cents
      USING ERRCODE = '22000';
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

  -- ── audit: this money step previously wrote nothing ───────────────────────
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor;

  BEGIN
    INSERT INTO public.audit_events (
      event_type, severity, actor_id, actor_role,
      subject_table, subject_id, job_id, summary, delta, metadata
    ) VALUES (
      'contract.generated', 'info', v_actor, COALESCE(v_actor_role, 'authenticated'),
      'job_contracts', v_id, v_app.job_id,
      format('Contract generated: client %s cents, inspector payout %s cents',
             p_client_price_cents, p_inspector_payout_cents),
      jsonb_build_object(
        'client_price_cents',     p_client_price_cents,
        'inspector_payout_cents', p_inspector_payout_cents,
        'platform_spread_cents',  p_client_price_cents - p_inspector_payout_cents
      ),
      jsonb_build_object(
        'application_id',      v_app.id,
        'negotiation_status',  v_app.negotiation_status,
        'accepted_bid_cents',  v_app.bid_amount_cents,
        'payout_bound_to_bid', (v_app.negotiation_status = 'counter_accepted')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- auditing must never block contract creation
    RAISE NOTICE 'audit_events insert failed: %', SQLERRM;
  END;

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
END $$;

COMMENT ON FUNCTION "public"."admin_generate_job_contract"("uuid", bigint, bigint, "text", "text")
IS 'Generates the client-inspector job contract. When the inspector accepted an admin counter (negotiation_status = counter_accepted), the contract payout MUST equal applications.bid_amount_cents - the accepted counter is binding and can only be changed by re-negotiating. Writes a contract.generated audit event.';
