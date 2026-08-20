-- ════════════════════════════════════════════════════════════════════════════
--  20260801578000_org_buyer_commercial_parity.sql
--
--  ACCOUNT + ORGANIZATION COMMERCIAL PARITY.
--
--  Two defects, both reproduced against the live schema, both affecting every
--  Agency and Enterprise buyer:
--
--  1. CONTRACTS COULD NOT BE GENERATED FOR AN ORGANIZATION-OWNED JOB.
--     jobs_owner_xor makes a job EITHER client_id (individual) XOR agency_id
--     (organization account), so jobs.client_id IS NULL for every org-owned
--     job. admin_generate_job_contract selected j.client_id straight into
--     job_contracts.client_id, which is NOT NULL — so the INSERT could only
--     ever raise a not-null violation there. Staging shows the signature of
--     this: 4 agency-owned jobs exist and 0 of them have a contract. The
--     canonical resolver nx_job_buyer_principal() (COALESCE(agency_id,
--     client_id)) is now used instead.
--
--  2. ORGANIZATION MEMBERS COULD NEVER SEE THEIR OWN ORGANIZATION'S CONTRACT.
--     client_job_contracts_view and the client leg of unified_contracts_view
--     both gated on `jc.client_id = auth.uid()` — the principal ACCOUNT only.
--     A procurement admin acting for the org saw nothing.
--
--  FINANCE PERMISSION IS NARROWER THAN OPERATIONAL ACCESS. Ordinary members
--  must not inherit commercial visibility, so this does NOT reuse
--  nx_is_job_buyer_side() (which admits every non-viewer, including
--  project_lead). A dedicated resolver admits only:
--        the buyer principal  +  org members with role owner | procurement_admin
--  project_lead and viewer keep operational access and see no money.
--
--  UNCHANGED: every projection in both views — the sanitized commercial
--  bodies, the three-tier identity gating, contact-on-FULL, the engaged
--  application predicate and the anti-poaching forwarding gate. Only WHO may
--  read a row changes, and only in the widening direction for an
--  organization's own authorized finance staff. Inspector and supplier
--  surfaces are untouched, so no counterparty gains anything.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Finance-permission resolver ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_job_buyer_finance_principal(
  p_job_id uuid,
  p_uid    uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_uid IS NOT NULL AND (
    -- the buyer principal itself: personal Client, or the Agency/Enterprise
    -- organization account that owns the job
    public.nx_job_buyer_principal(p_job_id) = p_uid
    -- …or a teammate whose organization role actually carries finance
    -- authority. project_lead and viewer are deliberately excluded.
    OR EXISTS (
      SELECT 1
        FROM public.org_members o_owner
        JOIN public.org_members o_me ON o_me.org_id = o_owner.org_id
       WHERE o_owner.user_id = public.nx_job_buyer_principal(p_job_id)
         AND o_me.user_id    = p_uid
         AND o_me.role::text IN ('owner', 'procurement_admin')
    )
  );
$function$;

ALTER FUNCTION public.nx_is_job_buyer_finance_principal(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_job_buyer_finance_principal(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_job_buyer_finance_principal(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_is_job_buyer_finance_principal(uuid, uuid) IS
  'Commercial visibility for the buyer side: the buyer principal (COALESCE(agency_id, client_id)) plus org members with role owner|procurement_admin. Narrower than nx_is_job_buyer_side, which admits project_lead too — ordinary members must not inherit finance access.';

-- ─── 2. Contract generation resolves the buyer principal ────────────────────
--  Only the one SELECT changes; every guard, binding check, audit write and
--  return shape in the function is preserved exactly.
CREATE OR REPLACE FUNCTION public.admin_generate_job_contract(p_application_id uuid, p_client_price_cents bigint, p_inspector_payout_cents bigint, p_contract_text_md text DEFAULT NULL::text, p_custom_contract_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  SELECT a.id, a.job_id, a.applicant_id,
         -- ORG PARITY: an organization-owned job has jobs.client_id IS NULL,
         -- and job_contracts.client_id is NOT NULL. Resolve the canonical
         -- buyer principal so Agency/Enterprise contracts can exist at all.
         public.nx_job_buyer_principal(a.job_id) AS client_id,
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
END $function$
;


-- ─── 3. Client-facing contract surfaces: org-scoped finance access ─────────
CREATE OR REPLACE VIEW public.client_job_contracts_view
WITH (security_barrier = 'true') AS
SELECT
  jc.id,
  jc.job_id,
  jc.application_id,
  jc.client_id,
  jc.inspector_id,
  jc.client_price_cents,
  jc.status,
  CASE WHEN public.nx_is_admin() THEN jc.contract_text_md
       ELSE public.nx_contract_text_for_client(jc.contract_text_md)
  END AS contract_text_md,
  jc.custom_contract_url,
  jc.client_signed_at,
  jc.client_signed_name,
  jc.inspector_signed_at,
  jc.voided_at,
  jc.voided_reason,
  jc.created_at,
  jc.updated_at,
  jc.client_approval_type,
  jc.admin_authorized_at,
  public.nx_job_effective_identity_mode(jc.job_id) AS identity_mode,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  -- OWNER POLICY (final): direct contact is part of FULL disclosure only.
  -- Admin always; client only when the Admin set this job to 'full'.
  CASE WHEN public.nx_is_admin()
         OR public.nx_job_effective_identity_mode(jc.job_id) = 'full'
       THEN p.email END AS inspector_email,
  CASE WHEN public.nx_is_admin()
         OR public.nx_job_effective_identity_mode(jc.job_id) = 'full'
       THEN p.phone END AS inspector_phone,
  jc.effective_identity_mode AS executed_identity_mode
FROM public.job_contracts jc
JOIN public.jobs j ON j.id = jc.job_id
LEFT JOIN public.profiles p ON p.id = jc.inspector_id
WHERE public.nx_is_job_buyer_finance_principal(jc.job_id, auth.uid()) OR public.nx_is_admin();
CREATE OR REPLACE VIEW public.unified_contracts_view
WITH (security_barrier = 'true') AS
 SELECT a.id::text AS contract_id,
    'spine'::text AS source,
    a.kind,
    a.counterparty_id,
    a.status,
    a.status = 'presented'::text AS signable,
    a.amount_cents,
    a.currency,
    a.body_md,
    a.content_sha256,
    a.deal_id,
    d.job_id,
    a.signed_at,
    a.executed_at,
    a.created_at,
    a.legacy_ref
   FROM agreements a
     JOIN deals d ON d.id = a.deal_id
  WHERE a.counterparty_id = auth.uid() OR nx_is_admin()
UNION ALL
 SELECT ('jc:'::text || jc.id) || ':client'::text AS contract_id,
    'job_contract'::text AS source,
    'client_supply'::text AS kind,
    jc.client_id AS counterparty_id,
    jc.status,
    jc.client_signed_at IS NULL AND (jc.status <> ALL (ARRAY['voided'::text, 'fully_executed'::text])) AS signable,
    jc.client_price_cents AS amount_cents,
    'USD'::text AS currency,
        CASE
            WHEN nx_is_admin() THEN jc.contract_text_md
            ELSE nx_contract_text_for_client(jc.contract_text_md)
        END AS body_md,
    NULL::text AS content_sha256,
    NULL::uuid AS deal_id,
    jc.job_id,
    jc.client_signed_at AS signed_at,
        CASE
            WHEN jc.status = 'fully_executed'::text THEN jc.updated_at
            ELSE NULL::timestamp with time zone
        END AS executed_at,
    jc.created_at,
    ('jc:'::text || jc.id) || ':client'::text AS legacy_ref
   FROM job_contracts jc
  WHERE jc.client_id IS NOT NULL AND (public.nx_is_job_buyer_finance_principal(jc.job_id, auth.uid()) OR public.nx_is_admin()) AND NOT (EXISTS ( SELECT 1
           FROM agreements a
          WHERE a.legacy_ref = (('jc:'::text || jc.id) || ':client'::text)))
UNION ALL
 SELECT ('jc:'::text || jc.id) || ':inspector'::text AS contract_id,
    'job_contract'::text AS source,
    'inspector_engagement'::text AS kind,
    jc.inspector_id AS counterparty_id,
    jc.status,
    jc.inspector_signed_at IS NULL AND (jc.status <> ALL (ARRAY['voided'::text, 'fully_executed'::text])) AS signable,
    jc.inspector_payout_cents AS amount_cents,
    'USD'::text AS currency,
        CASE
            WHEN nx_is_admin() THEN jc.contract_text_md
            ELSE nx_contract_text_for_inspector(jc.contract_text_md)
        END AS body_md,
    NULL::text AS content_sha256,
    NULL::uuid AS deal_id,
    jc.job_id,
    jc.inspector_signed_at AS signed_at,
        CASE
            WHEN jc.status = 'fully_executed'::text THEN jc.updated_at
            ELSE NULL::timestamp with time zone
        END AS executed_at,
    jc.created_at,
    ('jc:'::text || jc.id) || ':inspector'::text AS legacy_ref
   FROM job_contracts jc
  WHERE jc.inspector_id IS NOT NULL AND (jc.inspector_id = auth.uid() OR nx_is_admin()) AND NOT (EXISTS ( SELECT 1
           FROM agreements a
          WHERE a.legacy_ref = (('jc:'::text || jc.id) || ':inspector'::text)))
UNION ALL
 SELECT 'sc:'::text || sc.id AS contract_id,
    'supplier_contract'::text AS source,
    'supplier_supply'::text AS kind,
    sc.supplier_id AS counterparty_id,
    sc.status,
    sc.supplier_signed_at IS NULL AND (sc.status <> ALL (ARRAY['voided'::text, 'executed'::text])) AS signable,
    sc.amount_cents,
    'USD'::text AS currency,
    sc.contract_text_md AS body_md,
    sc.content_sha256,
    NULL::uuid AS deal_id,
    sc.job_id,
    sc.supplier_signed_at AS signed_at,
    sc.executed_at,
    sc.created_at,
    'sc:'::text || sc.id AS legacy_ref
   FROM supplier_contracts sc
  WHERE sc.supplier_id IS NOT NULL AND (sc.supplier_id = auth.uid() OR nx_is_admin()) AND NOT (EXISTS ( SELECT 1
           FROM agreements a
          WHERE a.legacy_ref = ('sc:'::text || sc.id)));

-- ─── 4. Selftest — org parity, finance scoping, isolation ──────────────────
DO $selftest$
DECLARE
  v_org uuid := gen_random_uuid(); v_org2 uuid := gen_random_uuid();
  v_agency uuid := gen_random_uuid();  v_proc uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();    v_viewer uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_insp uuid := gen_random_uuid();
  v_job uuid := gen_random_uuid(); v_app uuid := gen_random_uuid(); v_jc uuid;
  n int; v_def text;
BEGIN
  -- CATALOGUE: the surfaces must consult the finance resolver, not client_id.
  SELECT pg_get_viewdef('public.client_job_contracts_view'::regclass, true) INTO v_def;
  IF v_def !~ 'nx_is_job_buyer_finance_principal' THEN
    RAISE EXCEPTION 'SELFTEST: client contract view still gates on the principal account only';
  END IF;
  IF v_def !~ 'nx_contract_text_for_client' THEN
    RAISE EXCEPTION 'SELFTEST: commercial body sanitization was lost';
  END IF;
  SELECT pg_get_functiondef('public.admin_generate_job_contract(uuid,bigint,bigint,text,text)'::regprocedure) INTO v_def;
  IF v_def !~ 'nx_job_buyer_principal' THEN
    RAISE EXCEPTION 'SELFTEST: contract generation still uses the raw j.client_id';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'op.'||u::text||'@synthetic.invalid', now(), now()
      FROM unnest(ARRAY[v_agency,v_proc,v_lead,v_viewer,v_outsider,v_insp]) u;
    INSERT INTO public.profiles (id, role, full_name, email, is_verified) VALUES
      (v_agency,'agency','OP Agency','op.ag@synthetic.invalid',true),
      (v_proc,'client','OP Procurement','op.pr@synthetic.invalid',true),
      (v_lead,'client','OP Lead','op.pl@synthetic.invalid',true),
      (v_viewer,'client','OP Viewer','op.vw@synthetic.invalid',true),
      (v_outsider,'agency','OP Outsider','op.out@synthetic.invalid',true),
      (v_insp,'inspector','OP Inspector','op.in@synthetic.invalid',true)
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

    INSERT INTO public.organizations (id, name, slug) VALUES
      (v_org,'OP Org','op-org-'||substr(v_org::text,1,8)),
      (v_org2,'OP Other','op-other-'||substr(v_org2::text,1,8));
    INSERT INTO public.org_members (org_id, user_id, role) VALUES
      (v_org, v_agency,  'owner'),
      (v_org, v_proc,    'procurement_admin'),
      (v_org, v_lead,    'project_lead'),
      (v_org, v_viewer,  'viewer'),
      (v_org2, v_outsider,'owner');

    -- ORGANIZATION-OWNED job: client_id IS NULL, agency_id set.
    INSERT INTO public.jobs (id,title,client_id,agency_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode)
    VALUES (v_job,'op org job',NULL,v_agency,'open','approved','prepay',100000,80000,'protected');
    INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents,forwarded_to_client_at)
    VALUES (v_app,v_job,v_insp,'hired',80000,now());

    -- The defect: this INSERT is what used to be impossible.
    INSERT INTO public.job_contracts (job_id, application_id, client_id, inspector_id,
                                      client_price_cents, inspector_payout_cents, status, contract_text_md)
    VALUES (v_job, v_app, public.nx_job_buyer_principal(v_job), v_insp, 100000, 80000,
            'fully_executed',
            E'## Org Agreement\nClient price $1,000.00 - Inspector payout $800.00 - platform margin $200.00.')
    RETURNING id INTO v_jc;

    -- OWNER (principal) sees its own total, never payout/margin.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_agency::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO n FROM public.client_job_contracts_view WHERE id = v_jc;
    IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST: agency principal cannot see its own org contract'; END IF;
    IF EXISTS (SELECT 1 FROM public.client_job_contracts_view
                WHERE id = v_jc AND contract_text_md ~* 'payout|\$800|margin|\$200') THEN
      RAISE EXCEPTION 'SELFTEST: agency saw payout/margin';
    END IF;
    RESET ROLE;

    -- PROCUREMENT ADMIN inherits finance access.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_proc::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO n FROM public.client_job_contracts_view WHERE id = v_jc;
    IF n <> 1 THEN RAISE EXCEPTION 'SELFTEST: procurement_admin denied its org contract'; END IF;
    RESET ROLE;

    -- PROJECT LEAD and VIEWER must NOT inherit finance access.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_lead::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO n FROM public.client_job_contracts_view WHERE id = v_jc;
    IF n <> 0 THEN RAISE EXCEPTION 'SELFTEST: project_lead inherited finance access'; END IF;
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_viewer::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO n FROM public.client_job_contracts_view WHERE id = v_jc;
    IF n <> 0 THEN RAISE EXCEPTION 'SELFTEST: viewer inherited finance access'; END IF;
    RESET ROLE;

    -- CROSS-ORG ISOLATION.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_outsider::text||'","role":"authenticated"}', true);
    SELECT count(*) INTO n FROM public.client_job_contracts_view WHERE id = v_jc;
    IF n <> 0 THEN RAISE EXCEPTION 'SELFTEST: another organization read this contract'; END IF;
    RESET ROLE;

    -- INSPECTOR still blind to the client total.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"'||v_insp::text||'","role":"authenticated"}', true);
    IF EXISTS (SELECT 1 FROM public.inspector_job_contracts_view
                WHERE id = v_jc AND contract_text_md ~* 'client price|\$1,000|margin') THEN
      RAISE EXCEPTION 'SELFTEST: inspector saw client price/margin';
    END IF;
    RESET ROLE;

    RAISE NOTICE 'SELFTEST ok — org-owned contracts exist; finance scoped to owner/procurement_admin; lead+viewer excluded; cross-org isolated; counterparties blind';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated); catalogue assertions passed';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE 'op.%@synthetic.invalid') THEN
    RAISE EXCEPTION 'SELFTEST: synthetic fixtures survived';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
