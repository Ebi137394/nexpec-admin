-- ════════════════════════════════════════════════════════════════════════════
--  20260801122000_supplier_onboard_headline.sql
--
--  supplier_onboard now persists `headline` (the one-line pitch the directory
--  cards render). The original RPC set everything BUT headline, so the column
--  stayed NULL and the onboarding field was silently dropped. Replaces the
--  6-arg RPC with a 7-arg version (headline last, defaulted) — DROP+CREATE to
--  avoid PostgREST overload ambiguity (same pattern as 121900/create_rfq).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.supplier_onboard(text, text[], jsonb, double precision, double precision, text);

CREATE OR REPLACE FUNCTION public.supplier_onboard(
  p_legal_name   text,
  p_capabilities text[]           DEFAULT '{}',
  p_attributes   jsonb            DEFAULT '{}',
  p_lat          double precision DEFAULT NULL,
  p_lng          double precision DEFAULT NULL,
  p_country      text             DEFAULT NULL,
  p_headline     text             DEFAULT NULL
) RETURNS public.supplier_profiles
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.supplier_profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(p_legal_name,'') = '' THEN RAISE EXCEPTION 'legal_name_required'; END IF;

  INSERT INTO public.supplier_profiles (id, legal_name, headline, capabilities, attributes, geo_lat, geo_lng, country_code)
  VALUES (v_uid, p_legal_name, nullif(btrim(coalesce(p_headline,'')), ''), coalesce(p_capabilities,'{}'),
          coalesce(p_attributes,'{}'), p_lat, p_lng, p_country)
  ON CONFLICT (id) DO UPDATE SET
    legal_name   = EXCLUDED.legal_name,
    headline     = EXCLUDED.headline,
    capabilities = EXCLUDED.capabilities,
    attributes   = EXCLUDED.attributes,
    geo_lat      = EXCLUDED.geo_lat,
    geo_lng      = EXCLUDED.geo_lng,
    country_code = EXCLUDED.country_code,
    updated_at   = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.supplier_onboard(text,text[],jsonb,double precision,double precision,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.supplier_onboard(text,text[],jsonb,double precision,double precision,text,text) TO authenticated;

DO $$ BEGIN
  IF to_regprocedure('public.supplier_onboard(text,text[],jsonb,double precision,double precision,text,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST headline-aware supplier_onboard missing'; END IF;
  RAISE NOTICE 'supplier_onboard now persists headline.';
END $$;

COMMIT;
