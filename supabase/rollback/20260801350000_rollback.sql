-- ════════════════════════════════════════════════════════════════════════════
--  Rollback for 20260801350000_current_job_inspector_engagement_aware
--
--  ⚠ THIS RESTORES A STRUCTURALLY BROKEN GATE. The 340000 body requires
--  is_active_contract_inspector(), which reads public.job_contracts — and
--  tg_job_contracts_reject_brokered_job() forbids job_contracts on any job with
--  source_rfq_id IS NOT NULL. Supplier↔inspector chat therefore becomes
--  unreachable again on exactly the brokered jobs it exists for. Roll this back
--  only together with 340000, never on its own.
--
--  No message or room is deleted; existing supplier↔inspector rooms simply stop
--  authorizing, and their media stops minting, because nx_can_access_doc routes
--  through this same gate.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_supplier_inspector_chat_authorized(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_supplier_id  uuid,
  p_uid          uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.jobs j
     WHERE j.id = p_job_id
       AND p_uid IS NOT NULL
       AND p_inspector_id IS NOT NULL
       AND p_supplier_id  IS NOT NULL
       -- only the two parties themselves; the buyer is NOT in this room
       AND (p_uid = p_inspector_id OR p_uid = p_supplier_id)
       AND public.is_active_contract_inspector(p_job_id, p_inspector_id)
       AND public.nx_is_job_supplier(p_job_id, p_supplier_id)
       AND COALESCE(j.status, '') NOT IN ('cancelled', 'paid')
  );
$$;

COMMENT ON FUNCTION public.nx_supplier_inspector_chat_authorized(uuid, uuid, uuid, uuid) IS
  'Restored to the 20260801340000 body. NOTE: this version is unsatisfiable on brokered (source_rfq_id) jobs — see the 350000 rollback header.';

DROP FUNCTION IF EXISTS public.nx_is_current_job_inspector(uuid, uuid);

DO $verify$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.nx_is_current_job_inspector(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the engagement-aware helper still exists';
  END IF;
  v := (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.nx_supplier_inspector_chat_authorized(uuid,uuid,uuid,uuid)'::regprocedure);
  IF v ~ 'nx_is_current_job_inspector' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the gate still references the helper';
  END IF;
  IF v !~ 'is_active_contract_inspector' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: the 340000 predicate was not restored';
  END IF;
  -- Neither the brokered guard nor marketplace authority is this rollback's to touch.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_job_contracts_reject_brokered_job' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK OVERREACHED: the brokered guard is missing';
  END IF;
  RAISE WARNING '350000 rolled back — supplier↔inspector chat is unreachable on brokered jobs again.';
END
$verify$;

COMMIT;
