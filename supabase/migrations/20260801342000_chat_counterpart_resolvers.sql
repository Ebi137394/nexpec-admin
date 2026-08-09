-- ════════════════════════════════════════════════════════════════════════════
--  20260801342000_chat_counterpart_resolvers.sql
--
--  Three read-only resolvers so a UI can answer "who may I message here?"
--  with ONE call, instead of every screen re-deriving buyer/supplier/inspector
--  ids from whatever happens to be in its local state.
--
--  ── WHY THIS EXISTS ────────────────────────────────────────────────────────
--  The entry points for the three two-party channels have to appear on a dozen
--  screens across two platforms, each with a different data shape: the mobile
--  supplier contract screen, the web supplier contracts page, the inspector job
--  screen, the buyer job screen, the RFQ pages. Deriving the counterpart ids
--  independently on each of those is exactly how a Web/Mobile divergence gets
--  born — one screen forgets agency_id, another keys off a stale proposal row,
--  and the same user sees a button on one platform and not the other.
--
--  These functions are the single source of that answer, so both platforms ask
--  the same question and get the same reply.
--
--  ── THEY CANNOT BE USED TO ENUMERATE ───────────────────────────────────────
--  Each resolver returns an id ONLY when the corresponding chat gate already
--  authorizes the caller for that pair. A supplier probing a job it is not
--  attached to gets an empty set, not a list of inspectors. The resolvers add
--  no authority of their own — they are a convenience projection of decisions
--  nx_direct_chat_authorized / nx_supplier_inspector_chat_authorized /
--  nx_buyer_supplier_chat_authorized have already made.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. "On this job, who can I message?" ────────────────────────────────────
--  Drives the buyer job screen, the inspector job screen and any supplier
--  screen that knows a job id. Every column is independently gated, so a buyer
--  on a Protected job gets inspector_id = NULL while the supplier on the same
--  job still gets a usable inspector_id.
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
ALTER FUNCTION public.nx_job_chat_counterparts(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_job_chat_counterparts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_job_chat_counterparts(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_job_chat_counterparts(uuid) IS
  'Given a job, returns the counterpart ids the CALLER is allowed to message, plus which side they are on. Every id is individually gated by the corresponding chat authorization function, so this cannot be used to enumerate parties on a job you are not part of. Exists so web and mobile derive entry points from one answer instead of re-deriving ids per screen.';

-- ── 2. "Which suppliers may I (a buyer) message?" ───────────────────────────
CREATE OR REPLACE FUNCTION public.nx_my_chattable_suppliers()
RETURNS TABLE (
  buyer_id      uuid,
  supplier_id   uuid,
  supplier_name text,
  rfq_id        uuid,
  rfq_title     text,
  relationship  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  -- Buyer principals this user may act for: themselves, plus any org owner
  -- whose organization they are a non-viewer member of.
  principals AS (
    SELECT uid AS pid FROM me WHERE uid IS NOT NULL
    UNION
    SELECT o_owner.user_id
      FROM public.org_members o_me
      JOIN public.org_members o_owner ON o_owner.org_id = o_me.org_id
      CROSS JOIN me
     WHERE o_me.user_id = me.uid
       AND o_me.role::text <> 'viewer'
  )
  SELECT DISTINCT ON (p.pid, q.supplier_id)
    p.pid,
    q.supplier_id,
    COALESCE(sp.legal_name, pr.full_name),
    r.id,
    r.title,
    CASE WHEN q.status = 'accepted' THEN 'awarded' ELSE 'presented' END
  FROM principals p
  JOIN public.supplier_rfqs   r ON r.client_id = p.pid
  JOIN public.supplier_quotes q ON q.rfq_id = r.id AND q.status IN ('presented', 'accepted')
  LEFT JOIN public.supplier_profiles sp ON sp.id = q.supplier_id
  LEFT JOIN public.profiles          pr ON pr.id = q.supplier_id
  CROSS JOIN me
  WHERE public.nx_buyer_supplier_chat_authorized(p.pid, q.supplier_id, me.uid)
  ORDER BY p.pid, q.supplier_id, q.status DESC;
$$;
ALTER FUNCTION public.nx_my_chattable_suppliers() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_my_chattable_suppliers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_my_chattable_suppliers() TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_my_chattable_suppliers() IS
  'Suppliers the caller (as buyer principal, or as a non-viewer teammate acting for one) already has a presented/accepted relationship with. Never lists a merely submitted quote — the brokered shortlist stays hidden until admin presents it. Drives the buyer-side "Message supplier" lists on web and mobile.';

-- ── 3. "Which buyers and inspections may I (a supplier) message?" ───────────
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
ALTER FUNCTION public.nx_my_supplier_chat_targets() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_my_supplier_chat_targets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_my_supplier_chat_targets() TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_my_supplier_chat_targets() IS
  'Everything a supplier may open a room with: buyers (presented/accepted quote) and inspections at its facility (with the assigned inspector). Both branches are filtered through the same gates the RPCs enforce, so the list can never be wider than what open_*_conversation would allow.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT prosrc FROM pg_proc WHERE oid IN (
      'public.nx_job_chat_counterparts(uuid)'::regprocedure,
      'public.nx_my_chattable_suppliers()'::regprocedure,
      'public.nx_my_supplier_chat_targets()'::regprocedure)
  LOOP
    -- A resolver that does not consult a gate would be an enumeration oracle.
    IF v !~* 'nx_(direct|supplier_inspector|buyer_supplier)_chat_authorized' THEN
      RAISE EXCEPTION 'RESOLVER: a counterpart resolver does not consult any chat gate';
    END IF;
    IF v ~* 'payout|margin|spread|price_cents|amount_cents' THEN
      RAISE EXCEPTION 'GR2: a counterpart resolver selects a money column';
    END IF;
    IF v ~* 'profiles\.role\s*=|role\s*=\s*''supplier''' THEN
      RAISE EXCEPTION 'RESOLVER: authorization by role NAME instead of relationship';
    END IF;
  END LOOP;

  -- The buyer-facing list must never surface an un-presented quote.
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'public.nx_my_chattable_suppliers()'::regprocedure);
  IF v !~* '''presented''' THEN
    RAISE EXCEPTION 'BROKERAGE: the supplier list does not require a presented quote';
  END IF;
  IF v ~* '''submitted''|''shortlisted''' THEN
    RAISE EXCEPTION 'BROKERAGE: the supplier list would leak the un-presented shortlist';
  END IF;

  -- Viewers must stay excluded from acting for a principal.
  IF v !~* 'viewer' THEN
    RAISE EXCEPTION 'RESOLVER: org viewers are not excluded from the buyer principal set';
  END IF;
END
$verify$;

COMMIT;
