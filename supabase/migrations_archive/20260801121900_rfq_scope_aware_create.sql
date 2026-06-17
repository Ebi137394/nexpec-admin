-- ════════════════════════════════════════════════════════════════════════════
--  20260801121900_rfq_scope_aware_create.sql
--
--  create_rfq now carries the inspection dimension (scope_template_id +
--  requires_source_inspection) so the client picks the cross-discipline scope at
--  RFQ time — which is what the award trigger uses to auto-spawn the matched
--  source/FAT job. Replaces the original 3-arg create_rfq.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.create_rfq(text, jsonb, text);

CREATE OR REPLACE FUNCTION public.create_rfq(
  p_title text,
  p_spec jsonb DEFAULT '{}',
  p_scope_template_id uuid DEFAULT NULL,
  p_requires_source_inspection boolean DEFAULT true,
  p_broker_mode text DEFAULT 'admin'
) RETURNS public.supplier_rfqs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.supplier_rfqs;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(p_title,'') = '' THEN RAISE EXCEPTION 'title_required'; END IF;
  INSERT INTO public.supplier_rfqs (client_id, title, spec, scope_template_id, requires_source_inspection, broker_mode)
  VALUES (v_uid, p_title, coalesce(p_spec,'{}'), p_scope_template_id, coalesce(p_requires_source_inspection, true),
          CASE WHEN p_broker_mode IN ('admin','direct') THEN p_broker_mode ELSE 'admin' END)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.create_rfq(text,jsonb,uuid,boolean,text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_rfq(text,jsonb,uuid,boolean,text) TO authenticated;

DO $$ BEGIN
  IF to_regprocedure('public.create_rfq(text,jsonb,uuid,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST scope-aware create_rfq missing'; END IF;
  RAISE NOTICE 'create_rfq is now scope-aware.';
END $$;

COMMIT;
