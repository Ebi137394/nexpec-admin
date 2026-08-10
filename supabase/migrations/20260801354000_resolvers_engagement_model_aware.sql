-- ════════════════════════════════════════════════════════════════════════════
--  20260801354000_resolvers_engagement_model_aware.sql
--
--  ROOT CAUSE (supplier suite tests 70/71). 20260801350000 made the supplier↔
--  inspector GATE engagement-model aware, but the DISCOVERY layer added in
--  20260801342000 was left on the marketplace-only assumption:
--
--    nx_job_chat_counterparts   SELECT jc.inspector_id FROM job_contracts jc …
--    nx_my_supplier_chat_targets  JOIN public.job_contracts jc ON jc.job_id = …
--
--  tg_job_contracts_reject_brokered_job() forbids job_contracts on any job with
--  source_rfq_id IS NOT NULL — which is every job a supplier is attached to. So
--  the first resolver returned inspector_id = NULL (test 70) and the second's
--  INNER JOIN eliminated every row (test 71). Authorization was correct; the
--  user simply had no way to reach it. Backend-only capability, no entry point.
--
--  ── THE FIX: ONE CANONICAL ANSWER, ASKED NOT REIMPLEMENTED ─────────────────
--  nx_current_job_inspector_id(job) proposes a candidate per engagement model
--  and then RETURNS IT ONLY IF nx_is_current_job_inspector(job, candidate)
--  agrees. Discovery therefore inherits every denial the gate makes — presented,
--  voided, superseded, split-brain, cancelled deal — without restating any of
--  the rules. If the two ever disagreed, this function would be the bug; by
--  construction they cannot.
--
--  ── WHAT IS DELIBERATELY UNCHANGED ─────────────────────────────────────────
--  nx_is_current_job_inspector and nx_supplier_inspector_chat_authorized (both
--  proven at runtime by 350000's behavioural proof) are untouched.
--  nx_my_chattable_suppliers is untouched: it is the BUYER↔SUPPLIER hub and
--  never consults an inspector, so the engagement-model conflict cannot reach
--  it. Buyer↔Inspector, org/viewer scoping, cross-job isolation and the
--  money-free column sets are all preserved verbatim.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The canonical "who IS the current inspector" resolver ──────────────────
CREATE OR REPLACE FUNCTION public.nx_current_job_inspector_id(p_job_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job       RECORD;
  v_candidate uuid;
BEGIN
  IF p_job_id IS NULL THEN RETURN NULL; END IF;

  SELECT id, source_rfq_id, contractor_id INTO v_job
    FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_job.source_rfq_id IS NULL THEN
    -- Marketplace: the newest non-voided contract names the candidate.
    SELECT jc.inspector_id INTO v_candidate
      FROM public.job_contracts jc
     WHERE jc.job_id = p_job_id AND jc.status <> 'voided'
     ORDER BY jc.created_at DESC NULLS LAST
     LIMIT 1;
  ELSE
    -- Brokered: the job pointer names the candidate. It is only a CANDIDATE —
    -- the pointer is written at PRESENTED time and is not cleared on void.
    v_candidate := v_job.contractor_id;
  END IF;

  IF v_candidate IS NULL THEN RETURN NULL; END IF;

  -- The canonical gate decides. Discovery can never be wider than access.
  IF public.nx_is_current_job_inspector(p_job_id, v_candidate) THEN
    RETURN v_candidate;
  END IF;
  RETURN NULL;
END;
$fn$;
ALTER FUNCTION public.nx_current_job_inspector_id(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_current_job_inspector_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_current_job_inspector_id(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_current_job_inspector_id(uuid) IS
  'The id of the job''s CURRENT inspector under whichever engagement model owns it, or NULL. Proposes a candidate (marketplace: newest non-voided job_contracts; brokered: jobs.contractor_id) and returns it only if nx_is_current_job_inspector agrees — so discovery inherits every denial the gate makes and can never be wider than access.';

CREATE OR REPLACE FUNCTION public.nx_job_chat_counterparts(p_job_id uuid)
RETURNS TABLE (
  buyer_id            uuid,
  inspector_id        uuid,
  supplier_id         uuid,
  can_chat_inspector  boolean,   -- buyer↔inspector (Full only)
  can_chat_supplier   boolean,   -- buyer↔supplier, or supplier↔inspector
  viewer_side         text       -- 'buyer' | 'inspector' | 'supplier' | 'none'
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_buyer     uuid;
  v_inspector uuid;
  v_supplier  uuid;
  v_side      text := 'none';
BEGIN
  IF v_uid IS NULL OR p_job_id IS NULL THEN RETURN; END IF;

  v_buyer := public.nx_job_buyer_principal(p_job_id);

  -- ★ ENGAGEMENT-MODEL AWARE (20260801354000). This previously read
  --   job_contracts directly, which is MARKETPLACE-ONLY: on a brokered job
  --   (source_rfq_id IS NOT NULL) tg_job_contracts_reject_brokered_job forbids
  --   that row entirely, so v_inspector was always NULL and the supplier hub
  --   silently offered nothing even though the gate authorized the room.
  --   nx_current_job_inspector_id dispatches per model and returns an id ONLY
  --   when nx_is_current_job_inspector agrees — so presented / voided /
  --   superseded / split-brain / cancelled-deal all resolve to NULL here for
  --   exactly the same reasons they are denied by the gate. No authority logic
  --   is duplicated: this asks the canonical helper.
  v_inspector := public.nx_current_job_inspector_id(p_job_id);

  -- The supplier attached to this job, if any. Contract first, then the
  -- accepted quote on the RFQ the inspection was spawned from.
  SELECT sc.supplier_id INTO v_supplier
    FROM public.supplier_contracts sc
   WHERE sc.job_id = p_job_id
     AND COALESCE(sc.status, '') NOT IN ('voided', 'draft')
   LIMIT 1;

  IF v_supplier IS NULL THEN
    SELECT q.supplier_id INTO v_supplier
      FROM public.jobs j
      JOIN public.supplier_rfqs   r ON r.id = j.source_rfq_id
      JOIN public.supplier_quotes q ON q.rfq_id = r.id
     WHERE j.id = p_job_id AND q.status = 'accepted'
     LIMIT 1;
  END IF;

  IF public.nx_is_job_buyer_side(p_job_id, v_uid) THEN
    v_side := 'buyer';
  ELSIF v_inspector IS NOT NULL AND v_uid = v_inspector THEN
    v_side := 'inspector';
  ELSIF v_supplier IS NOT NULL AND v_uid = v_supplier THEN
    v_side := 'supplier';
  END IF;

  IF v_side = 'none' THEN RETURN; END IF;

  RETURN QUERY SELECT
    -- Only the buyer side, and the supplier when it may actually talk to the
    -- buyer, ever learn the buyer principal id.
    CASE
      WHEN v_side = 'buyer' THEN v_buyer
      WHEN v_side = 'supplier'
       AND public.nx_buyer_supplier_chat_authorized(v_buyer, v_supplier, v_uid) THEN v_buyer
      ELSE NULL
    END,
    -- The inspector id is released only to someone allowed to message them.
    CASE
      WHEN v_side = 'buyer'
       AND public.nx_direct_chat_authorized(p_job_id, v_inspector, v_uid) THEN v_inspector
      WHEN v_side = 'inspector' THEN v_inspector
      WHEN v_side = 'supplier'
       AND public.nx_supplier_inspector_chat_authorized(p_job_id, v_inspector, v_supplier, v_uid)
        THEN v_inspector
      ELSE NULL
    END,
    -- …and likewise the supplier id.
    CASE
      WHEN v_side = 'supplier' THEN v_supplier
      WHEN v_side = 'inspector'
       AND public.nx_supplier_inspector_chat_authorized(p_job_id, v_inspector, v_supplier, v_uid)
        THEN v_supplier
      WHEN v_side = 'buyer'
       AND public.nx_buyer_supplier_chat_authorized(v_buyer, v_supplier, v_uid) THEN v_supplier
      ELSE NULL
    END,
    -- buyer↔inspector availability (buyer side only; Full-mode gated)
    (v_side = 'buyer' AND public.nx_direct_chat_authorized(p_job_id, v_inspector, v_uid)),
    -- the "other" supplier-facing channel for whichever side is asking
    CASE
      WHEN v_side = 'buyer'     THEN public.nx_buyer_supplier_chat_authorized(v_buyer, v_supplier, v_uid)
      WHEN v_side = 'inspector' THEN public.nx_supplier_inspector_chat_authorized(p_job_id, v_inspector, v_supplier, v_uid)
      WHEN v_side = 'supplier'  THEN public.nx_supplier_inspector_chat_authorized(p_job_id, v_inspector, v_supplier, v_uid)
      ELSE false
    END,
    v_side;
END;
$$;

ALTER FUNCTION public.nx_job_chat_counterparts(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_chat_counterparts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_chat_counterparts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_my_supplier_chat_targets()
RETURNS TABLE (
  channel      text,       -- 'buyer_supplier' | 'job_supplier_inspector'
  supplier_id  uuid,
  buyer_id     uuid,
  buyer_name   text,
  job_id       uuid,
  job_title    text,
  inspector_id uuid,
  rfq_id       uuid,
  rfq_title    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT auth.uid() AS uid)
  -- Buyers this supplier may talk commerce with.
  SELECT
    'buyer_supplier'::text, me.uid, r.client_id,
    COALESCE(bp.full_name, 'Buyer'), NULL::uuid, NULL::text, NULL::uuid, r.id, r.title
  FROM me
  JOIN public.supplier_rfqs   r ON true
  JOIN public.supplier_quotes q ON q.rfq_id = r.id
                               AND q.supplier_id = me.uid
                               AND q.status IN ('presented', 'accepted')
  LEFT JOIN public.profiles bp ON bp.id = r.client_id
  WHERE me.uid IS NOT NULL
    AND public.nx_buyer_supplier_chat_authorized(r.client_id, me.uid, me.uid)

  UNION ALL

  -- Inspections at this supplier's facility, with the assigned inspector.
  -- ★ ENGAGEMENT-MODEL AWARE (20260801354000). The inner JOIN on job_contracts
  --   made this branch return ZERO rows for every brokered inspection — the
  --   only kind a supplier is ever attached to — so the supplier hub was
  --   permanently empty. LATERAL over the canonical resolver instead: it yields
  --   nothing unless nx_is_current_job_inspector agrees, so every revocation
  --   path drops the row without this query re-deriving any authority.
  SELECT
    'job_supplier_inspector'::text, me.uid, NULL::uuid, NULL::text,
    j.id, j.title, ci.inspector_id, j.source_rfq_id, r2.title
  FROM me
  JOIN public.jobs j ON public.nx_is_job_supplier(j.id, me.uid)
  CROSS JOIN LATERAL (
    SELECT public.nx_current_job_inspector_id(j.id) AS inspector_id
  ) ci
  LEFT JOIN public.supplier_rfqs r2 ON r2.id = j.source_rfq_id
  WHERE me.uid IS NOT NULL
    AND ci.inspector_id IS NOT NULL
    AND public.nx_supplier_inspector_chat_authorized(j.id, ci.inspector_id, me.uid, me.uid);
$$;

ALTER FUNCTION public.nx_my_supplier_chat_targets() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_my_supplier_chat_targets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_my_supplier_chat_targets() TO authenticated, service_role;

-- ── Self-tests (comment-safe: prosrc is stripped of `--` lines first) ───────
DO $verify$
DECLARE v text;
BEGIN
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_job_chat_counterparts(uuid)'::regprocedure;
  IF v ~ 'job_contracts' THEN
    RAISE EXCEPTION 'RESOLVER: nx_job_chat_counterparts still reads job_contracts directly (marketplace-only)';
  END IF;
  IF v !~ 'nx_current_job_inspector_id\s*\(' THEN
    RAISE EXCEPTION 'RESOLVER: nx_job_chat_counterparts does not use the canonical inspector resolver';
  END IF;

  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_my_supplier_chat_targets()'::regprocedure;
  IF v ~ 'job_contracts' THEN
    RAISE EXCEPTION 'RESOLVER: nx_my_supplier_chat_targets still joins job_contracts (marketplace-only)';
  END IF;
  IF v !~ 'nx_current_job_inspector_id\s*\(' THEN
    RAISE EXCEPTION 'RESOLVER: the supplier hub does not use the canonical inspector resolver';
  END IF;
  IF v !~ 'nx_supplier_inspector_chat_authorized\s*\(' THEN
    RAISE EXCEPTION 'RESOLVER: the supplier hub stopped consulting the chat gate';
  END IF;

  -- The resolver must ASK the gate, never restate it.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_current_job_inspector_id(uuid)'::regprocedure;
  IF v !~ 'nx_is_current_job_inspector\s*\(' THEN
    RAISE EXCEPTION 'RESOLVER: nx_current_job_inspector_id does not defer to the canonical gate';
  END IF;
  IF v ~* 'agreements|inspector_engagement_meta' THEN
    RAISE EXCEPTION 'RESOLVER: brokered authority is duplicated instead of delegated';
  END IF;
  IF v ~* 'payout|margin|spread|price_cents' THEN
    RAISE EXCEPTION 'GR2: a money reference reached the inspector resolver';
  END IF;

  -- Untouched neighbours.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_my_chattable_suppliers()'::regprocedure;
  IF v !~ 'viewer' THEN
    RAISE EXCEPTION 'REGRESSION: the buyer-supplier hub lost its viewer exclusion';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_supplier_inspector_chat_authorized(uuid,uuid,uuid,uuid)'::regprocedure;
  IF v !~ 'nx_is_current_job_inspector\s*\(' OR v ~* 'identity_mode' THEN
    RAISE EXCEPTION 'REGRESSION: the supplier gate changed';
  END IF;
END
$verify$;

-- ── Behavioural proof over a REAL brokered chain (generated ids) ────────────
DO $behaviour$
DECLARE
  v_pre       RECORD;
  v_pre_email text;
  v_pre_role  text;
  v_buyer uuid := gen_random_uuid();
  v_sup   uuid := gen_random_uuid();
  v_i1    uuid := gen_random_uuid();
  v_i2    uuid := gen_random_uuid();
  v_rfq   uuid := gen_random_uuid();
  v_quote uuid := gen_random_uuid();
  v_job   uuid := gen_random_uuid();
  v_mjob  uuid := gen_random_uuid();
  v_deal  uuid := gen_random_uuid();
  v_agr1  uuid := gen_random_uuid();
  v_agr2  uuid := gen_random_uuid();
  v_tag   text := 'nx354-' || replace(gen_random_uuid()::text,'-','') || '@selftest.nx';
  v_deals uuid[];
  v_left  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_buyer,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','b.'||v_tag,now(),now()),
    (v_sup,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','s.'||v_tag,now(),now()),
    (v_i1,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i1.'||v_tag,now(),now()),
    (v_i2,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i2.'||v_tag,now(),now());
  INSERT INTO public.profiles (id, email, role) VALUES
    (v_buyer,'b.'||v_tag,'client'), (v_sup,'s.'||v_tag,'supplier'),
    (v_i1,'i1.'||v_tag,'inspector'), (v_i2,'i2.'||v_tag,'inspector')
  -- ── PRODUCTION AUTH PROVISIONING ─────────────────────────────────────────
  --  Production provisions public.profiles automatically from auth.users (a
  --  handle_new_user-style trigger absent from a bare local stack). The
  --  auth.users INSERT above may therefore ALREADY have created these rows with
  --  a default role, so a bare INSERT hits profiles_pkey. DO UPDATE (never DO
  --  NOTHING) is correct and safe here for one specific reason: every id is
  --  gen_random_uuid() minted inside THIS transaction and its auth.users INSERT
  --  just succeeded, so the only row that can possibly conflict is the one the
  --  provisioning trigger just derived from our own fixture. DO NOTHING would
  --  silently leave the provisioned default role in place — which is exactly how
  --  the first Production attempt produced a false 'admin lost access' failure.
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role  = EXCLUDED.role;

  -- ── FIXTURE PRECONDITION: every generated principal, not just admin ───────
  --  Asserted BEFORE any product assertion, so a provisioning difference can
  --  never be misread as a product regression.
  FOR v_pre IN SELECT * FROM (VALUES (v_buyer,'b.'||v_tag,'client'), (v_sup,'s.'||v_tag,'supplier'),
    (v_i1,'i1.'||v_tag,'inspector'), (v_i2,'i2.'||v_tag,'inspector')) AS t(id, email, role)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_pre.id) THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: auth.users row missing for generated % principal % — fixture/provisioning failure, not a product regression', v_pre.role, v_pre.id;
    END IF;
    SELECT p.email, p.role INTO v_pre_email, v_pre_role
      FROM public.profiles p WHERE p.id = v_pre.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: public.profiles row missing for generated % principal % — fixture/provisioning failure, not a product regression', v_pre.role, v_pre.id;
    END IF;
    IF v_pre_email IS DISTINCT FROM v_pre.email OR v_pre_role IS DISTINCT FROM v_pre.role THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: generated principal % resolved to email=% role=% but the fixture requires email=% role=% — an auth-provisioning trigger overwrote the fixture identity; this is a fixture/provisioning failure, not a product regression', v_pre.id, COALESCE(v_pre_email,'<null>'), COALESCE(v_pre_role,'<null>'), v_pre.email, v_pre.role;
    END IF;
  END LOOP;

  INSERT INTO public.supplier_profiles (id, legal_name) VALUES (v_sup,'Selftest Forge 354000')
    -- Same generated-id reasoning as the profiles upsert above: supplier_profiles
    -- is keyed on the principal id, so any Production trigger that derives a
    -- supplier record from a role='supplier' profile would collide here too.
    ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name;
  INSERT INTO public.supplier_rfqs (id, client_id, title, status, requires_source_inspection)
  VALUES (v_rfq, v_buyer, 'selftest rfq 354000', 'awarded', true);

  INSERT INTO public.jobs (id, title, client_id, status, moderation_status, source_rfq_id, contractor_id)
  VALUES (v_job, 'brokered 354000', v_buyer, 'in_progress', 'approved', v_rfq, v_i1);
  UPDATE public.supplier_rfqs SET spawned_job_id = v_job WHERE id = v_rfq;
  INSERT INTO public.supplier_quotes (id, rfq_id, supplier_id, quote, status)
  VALUES (v_quote, v_rfq, v_sup, '{}'::jsonb, 'accepted');
  INSERT INTO public.deals (id, rfq_id, job_id, client_id, status, currency)
  VALUES (v_deal, v_rfq, v_job, v_buyer, 'dispatched', 'USD');

  -- MARKETPLACE control: the delegated path must keep working.
  INSERT INTO public.jobs (id, title, client_id, status, moderation_status)
  VALUES (v_mjob, 'marketplace 354000', v_buyer, 'in_progress', 'approved');
  INSERT INTO public.job_contracts (job_id, client_id, inspector_id, status,
                                    client_price_cents, inspector_payout_cents)
  VALUES (v_mjob, v_buyer, v_i2, 'fully_executed', 100000, 80000);
  IF public.nx_current_job_inspector_id(v_mjob) IS DISTINCT FROM v_i2 THEN
    RAISE EXCEPTION 'SELFTEST: the MARKETPLACE resolver regressed';
  END IF;

  -- PRESENTED → NULL (this is the state that must not open the supplier hub).
  INSERT INTO public.agreements (id, deal_id, kind, status, counterparty_id, version, amount_cents, currency)
  VALUES (v_agr1, v_deal, 'inspector_engagement', 'presented', v_i1, 1, 100000, 'USD');
  INSERT INTO public.inspector_engagement_meta (agreement_id, deal_id, inspector_id)
  VALUES (v_agr1, v_deal, v_i1);
  IF public.nx_current_job_inspector_id(v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: a PRESENTED engagement was resolved as the current inspector';
  END IF;

  -- EXECUTED → the id (this is tests 70/71).
  UPDATE public.agreements SET status = 'executed' WHERE id = v_agr1;
  IF public.nx_current_job_inspector_id(v_job) IS DISTINCT FROM v_i1 THEN
    RAISE EXCEPTION 'SELFTEST: an EXECUTED brokered engagement did not resolve the inspector';
  END IF;

  -- VOIDED with a stale job pointer → NULL.
  UPDATE public.agreements SET status = 'voided' WHERE id = v_agr1;
  IF public.nx_current_job_inspector_id(v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: a VOIDED engagement still resolved (stale pointer trusted)';
  END IF;

  -- SUPERSEDED → the replacement, not the old inspector.
  UPDATE public.agreements SET status = 'amended' WHERE id = v_agr1;
  INSERT INTO public.agreements (id, deal_id, kind, status, counterparty_id, version, amount_cents, currency)
  VALUES (v_agr2, v_deal, 'inspector_engagement', 'executed', v_i2, 2, 100000, 'USD');
  INSERT INTO public.inspector_engagement_meta (agreement_id, deal_id, inspector_id)
  VALUES (v_agr2, v_deal, v_i2);
  UPDATE public.jobs SET contractor_id = v_i2 WHERE id = v_job;
  IF public.nx_current_job_inspector_id(v_job) IS DISTINCT FROM v_i2 THEN
    RAISE EXCEPTION 'SELFTEST: the REPLACEMENT inspector was not resolved';
  END IF;

  -- SPLIT BRAIN → NULL.
  UPDATE public.jobs SET contractor_id = v_i1 WHERE id = v_job;
  IF public.nx_current_job_inspector_id(v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: a split-brain engagement resolved an inspector';
  END IF;
  UPDATE public.jobs SET contractor_id = v_i2 WHERE id = v_job;

  -- CANCELLED deal → NULL; CLOSED still resolves.
  UPDATE public.deals SET status = 'cancelled' WHERE id = v_deal;
  IF public.nx_current_job_inspector_id(v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: a CANCELLED deal still resolved an inspector';
  END IF;
  UPDATE public.deals SET status = 'closed' WHERE id = v_deal;
  IF public.nx_current_job_inspector_id(v_job) IS DISTINCT FROM v_i2 THEN
    RAISE EXCEPTION 'SELFTEST: a CLOSED (completed) deal should still resolve';
  END IF;

  -- Relationship-scoped, FK-safe cleanup (trigger side-effects included).
  SELECT COALESCE(array_agg(DISTINCT d.id),'{}') INTO v_deals FROM public.deals d
   WHERE d.job_id IN (v_job, v_mjob) OR d.rfq_id = v_rfq
      OR d.awarded_quote_id = v_quote OR d.client_id = v_buyer;
  DELETE FROM public.deal_money_legs           WHERE deal_id = ANY(v_deals);
  DELETE FROM public.inspector_engagement_meta WHERE deal_id = ANY(v_deals);
  DELETE FROM public.agreements                WHERE deal_id = ANY(v_deals)
                                                  OR counterparty_id IN (v_buyer,v_sup,v_i1,v_i2);
  DELETE FROM public.supplier_contracts        WHERE rfq_id = v_rfq OR job_id IN (v_job,v_mjob)
                                                  OR supplier_id = v_sup OR quote_id = v_quote;
  DELETE FROM public.deals                     WHERE id = ANY(v_deals);
  DELETE FROM public.supplier_quotes           WHERE rfq_id = v_rfq OR supplier_id = v_sup;
  UPDATE public.supplier_rfqs SET spawned_job_id = NULL WHERE id = v_rfq;
  DELETE FROM public.job_contracts             WHERE job_id IN (v_job, v_mjob);
  DELETE FROM public.conversations             WHERE job_id IN (v_job, v_mjob);
  DELETE FROM public.jobs                      WHERE id IN (v_job, v_mjob);
  DELETE FROM public.supplier_rfqs             WHERE id = v_rfq;
  DELETE FROM public.supplier_profiles         WHERE id = v_sup;
  DELETE FROM public.notifications             WHERE recipient_id IN (v_buyer,v_sup,v_i1,v_i2);

  SELECT count(*) INTO v_left FROM public.agreements
   WHERE counterparty_id IN (v_buyer,v_sup,v_i1,v_i2);
  IF v_left > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % agreement row(s) still reference fixture principals', v_left;
  END IF;

  DELETE FROM public.profiles WHERE id IN (v_buyer,v_sup,v_i1,v_i2);
  DELETE FROM auth.users      WHERE id IN (v_buyer,v_sup,v_i1,v_i2);

  IF EXISTS (SELECT 1 FROM public.jobs WHERE id IN (v_job,v_mjob))
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN (v_buyer,v_sup,v_i1,v_i2))
     OR EXISTS (SELECT 1 FROM auth.users WHERE id IN (v_buyer,v_sup,v_i1,v_i2))
     OR EXISTS (SELECT 1 FROM public.deals WHERE job_id IN (v_job,v_mjob))
     OR EXISTS (SELECT 1 FROM public.agreements WHERE counterparty_id IN (v_buyer,v_sup,v_i1,v_i2))
     OR EXISTS (SELECT 1 FROM public.job_contracts WHERE job_id IN (v_job,v_mjob)) THEN
    RAISE EXCEPTION 'SELFTEST: the behavioural proof left LIVE fixture rows behind';
  END IF;

  RAISE NOTICE 'Resolver parity verified: marketplace + brokered executed resolve; presented/voided/superseded/split-brain/cancelled resolve to NULL.';
END
$behaviour$;

COMMIT;
