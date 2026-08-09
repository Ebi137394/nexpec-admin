-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801354000_resolvers_engagement_model_aware
--
--  ⚠ RESTORES A MARKETPLACE-ONLY DISCOVERY LAYER. Under the 20260801342000
--  bodies, nx_job_chat_counterparts returns inspector_id = NULL and
--  nx_my_supplier_chat_targets returns zero rows for every BROKERED job,
--  because both read public.job_contracts, which
--  tg_job_contracts_reject_brokered_job() forbids on source_rfq_id jobs. The
--  supplier↔inspector room stays authorized but becomes unreachable from the
--  UI — a backend-only capability with no entry point.
--
--  No authorization is widened by this rollback; only discovery narrows.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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

  SELECT jc.inspector_id INTO v_inspector
    FROM public.job_contracts jc
   WHERE jc.job_id = p_job_id AND jc.status <> 'voided'
   ORDER BY jc.created_at DESC NULLS LAST
   LIMIT 1;

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
  SELECT
    'job_supplier_inspector'::text, me.uid, NULL::uuid, NULL::text,
    j.id, j.title, jc.inspector_id, j.source_rfq_id, r2.title
  FROM me
  JOIN public.jobs j ON public.nx_is_job_supplier(j.id, me.uid)
  JOIN public.job_contracts jc ON jc.job_id = j.id AND jc.status <> 'voided'
  LEFT JOIN public.supplier_rfqs r2 ON r2.id = j.source_rfq_id
  WHERE me.uid IS NOT NULL
    AND public.nx_supplier_inspector_chat_authorized(j.id, jc.inspector_id, me.uid, me.uid);
$$;

DROP FUNCTION IF EXISTS public.nx_current_job_inspector_id(uuid);

DO $verify$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.nx_current_job_inspector_id(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the canonical inspector resolver still exists';
  END IF;
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_job_chat_counterparts(uuid)'::regprocedure;
  IF v ~ 'nx_current_job_inspector_id' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: a resolver still references the removed helper';
  END IF;
  -- Not this rollback's to touch.
  IF to_regprocedure('public.nx_is_current_job_inspector(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: it removed the canonical gate helper';
  END IF;
  RAISE WARNING '354000 rolled back — supplier hub and job counterpart discovery are marketplace-only again.';
END
$verify$;

COMMIT;
