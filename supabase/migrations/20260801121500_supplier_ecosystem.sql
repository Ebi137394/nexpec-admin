-- ════════════════════════════════════════════════════════════════════════════
--  20260801121500_supplier_ecosystem.sql
--
--  THE SUPPLIER ECOSYSTEM — a new actor type that co-exists with the inspector
--  marketplace, generalised as Actor + Capability graph + two-sided Matching +
--  RFQ, all on the existing trust/RLS spine. Renders through DynamicForm +
--  JSON-driven lists — zero new design.
--
--    1. Role            widen profiles.role CHECK to allow 'supplier'
--    2. supplier_profiles      capability vector + attributes (GIN) + geo
--    3. capability catalog     drives onboarding select options + directory chips
--    4. RFQ + quotes           buyer need ↔ supplier bid (price-blind between suppliers)
--    5. matching               haversine + explainable weighted score RPC
--    6. RPCs                   supplier_onboard · create_rfq · submit_quote
--    7. directory view         business-level, no personal PII (anti-poaching)
--    8. RLS                    owner/admin manage; suppliers never see each others' quotes
--    9. self-test              proves matching math + role widen at apply time
--
--  Idempotent + atomic. Suppliers onboard via supplier_onboard() (no rewrite of
--  the existing apply_onboarding_role wizard fn).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1) Allow the 'supplier' role (reconcile-safe: replace the role CHECK[s]) ──
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
       AND pg_get_constraintdef(oid) ILIKE '%inspector%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'profiles_role_allowed' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_allowed CHECK (
      role = ANY (ARRAY['inspector','client','agency','enterprise','supplier','senior','admin','super_admin']));
  END IF;
EXCEPTION WHEN others THEN RAISE NOTICE 'role widen: %', SQLERRM;
END $$;

-- ── 2) Supplier profiles (the capability graph node) ──
CREATE TABLE IF NOT EXISTS public.supplier_profiles (
  id            uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  legal_name    text NOT NULL,
  headline      text,
  capabilities  text[] NOT NULL DEFAULT '{}',     -- catalog keys (GIN-indexed)
  attributes    jsonb  NOT NULL DEFAULT '{}',     -- {standards:[],regions:[],lead_time_days,min_order_cents,certs:[]}
  geo_lat       double precision,
  geo_lng       double precision,
  country_code  text REFERENCES public.country_codes(code),
  rating_avg    numeric(3,2) NOT NULL DEFAULT 0,
  rating_count  int NOT NULL DEFAULT 0,
  verification  jsonb NOT NULL DEFAULT '{}',      -- sealable cert evidence
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_caps_gin  ON public.supplier_profiles USING gin (capabilities);
CREATE INDEX IF NOT EXISTS supplier_attr_gin  ON public.supplier_profiles USING gin (attributes jsonb_path_ops);
CREATE INDEX IF NOT EXISTS supplier_active_idx ON public.supplier_profiles (is_active) WHERE is_active;

-- ── 3) Capability catalog (taxonomy → onboarding options + directory chips) ──
CREATE TABLE IF NOT EXISTS public.supplier_capability_catalog (
  key text PRIMARY KEY, label text NOT NULL, category text NOT NULL,
  sort int NOT NULL DEFAULT 100, is_active boolean NOT NULL DEFAULT true
);
INSERT INTO public.supplier_capability_catalog (key,label,category,sort) VALUES
 ('ndt_lab','NDT Laboratory','testing',10),
 ('calibration_lab','Calibration Laboratory','testing',20),
 ('material_testing','Material / Mechanical Testing','testing',30),
 ('equipment_rental','Equipment Rental','equipment',40),
 ('equipment_sales','Equipment Sales','equipment',50),
 ('consumables','Welding / NDT Consumables','materials',60),
 ('raw_materials','Raw Materials & Alloys','materials',70),
 ('coating_services','Coating & Surface Treatment','services',80),
 ('heat_treatment','Heat Treatment','services',90),
 ('inspection_agency','Third-Party Inspection','services',100),
 ('logistics','Logistics & Freight','services',110),
 ('training','Training & Certification','services',120)
ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, category=EXCLUDED.category, sort=EXCLUDED.sort;

-- ── 4) RFQ + quotes ──
CREATE TABLE IF NOT EXISTS public.supplier_rfqs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       text NOT NULL,
  spec        jsonb NOT NULL DEFAULT '{}',   -- {capabilities:[],standards:[],region,quantity,needed_by,notes}
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','quoted','awarded','closed','cancelled')),
  broker_mode text NOT NULL DEFAULT 'admin' CHECK (broker_mode IN ('admin','direct')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.supplier_quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id      uuid NOT NULL REFERENCES public.supplier_rfqs(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quote       jsonb NOT NULL DEFAULT '{}',   -- {price_cents,currency,lead_time_days,validity_days,notes}
  status      text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','shortlisted','accepted','declined','withdrawn')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS rfq_client_idx    ON public.supplier_rfqs (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quote_rfq_idx     ON public.supplier_quotes (rfq_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quote_supplier_idx ON public.supplier_quotes (supplier_id, created_at DESC);

-- ── 5) Distance helper (no PostGIS dependency) ──
CREATE OR REPLACE FUNCTION public._haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
    ELSE 2 * 6371 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))) END;
$$;

-- ── 6) Two-sided matching: explainable weighted score (caps · standards · rating · proximity) ──
CREATE OR REPLACE FUNCTION public.supplier_match(p_need jsonb, p_limit int DEFAULT 20)
RETURNS TABLE(supplier_id uuid, legal_name text, score numeric, distance_km numeric, matched_caps text[], why jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH need AS (
    SELECT coalesce(array(SELECT jsonb_array_elements_text(p_need->'capabilities')), '{}')::text[] AS caps,
           coalesce(array(SELECT jsonb_array_elements_text(p_need->'standards')),    '{}')::text[] AS stds,
           (p_need->>'lat')::double precision AS lat,
           (p_need->>'lng')::double precision AS lng
  )
  SELECT s.id, s.legal_name,
    round((
        0.50 * (CASE WHEN array_length(n.caps,1) IS NULL THEN 0
                     ELSE (SELECT count(*) FROM unnest(s.capabilities) c WHERE c = ANY(n.caps))::numeric
                          / greatest(array_length(n.caps,1),1) END)
      + 0.20 * (CASE WHEN array_length(n.stds,1) IS NULL THEN 0.5
                     ELSE (SELECT count(*) FROM jsonb_array_elements_text(coalesce(s.attributes->'standards','[]'::jsonb)) st
                            WHERE st = ANY(n.stds))::numeric / greatest(array_length(n.stds,1),1) END)
      + 0.15 * (coalesce(s.rating_avg,0) / 5)
      + 0.15 * (CASE WHEN n.lat IS NULL OR s.geo_lat IS NULL THEN 0.4
                     ELSE greatest(0, 1 - (public._haversine_km(n.lat,n.lng,s.geo_lat,s.geo_lng) / 500)) END)
    )::numeric, 4) AS score,
    round(public._haversine_km(n.lat,n.lng,s.geo_lat,s.geo_lng)::numeric, 1) AS distance_km,
    array(SELECT c FROM unnest(s.capabilities) c WHERE c = ANY(n.caps)) AS matched_caps,
    jsonb_build_object('rating', s.rating_avg, 'capabilities', s.capabilities) AS why
  FROM public.supplier_profiles s, need n
  WHERE s.is_active
    AND (array_length(n.caps,1) IS NULL OR s.capabilities && n.caps)   -- GIN-friendly overlap prefilter
  ORDER BY score DESC NULLS LAST
  LIMIT greatest(1, least(p_limit, 100));
$$;

-- ── 7) Onboarding + RFQ RPCs ──
CREATE OR REPLACE FUNCTION public.supplier_onboard(
  p_legal_name text, p_capabilities text[] DEFAULT '{}', p_attributes jsonb DEFAULT '{}',
  p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_country text DEFAULT NULL)
RETURNS public.supplier_profiles LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.supplier_profiles;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(p_legal_name,'') = '' THEN RAISE EXCEPTION 'legal_name_required'; END IF;
  -- promote to supplier (never demote a platform admin)
  UPDATE public.profiles SET role = 'supplier' WHERE id = v_uid AND role NOT IN ('admin','super_admin');
  INSERT INTO public.supplier_profiles (id, legal_name, capabilities, attributes, geo_lat, geo_lng, country_code)
  VALUES (v_uid, p_legal_name, coalesce(p_capabilities,'{}'), coalesce(p_attributes,'{}'), p_lat, p_lng, p_country)
  ON CONFLICT (id) DO UPDATE SET
    legal_name=EXCLUDED.legal_name, capabilities=EXCLUDED.capabilities, attributes=EXCLUDED.attributes,
    geo_lat=EXCLUDED.geo_lat, geo_lng=EXCLUDED.geo_lng, country_code=EXCLUDED.country_code, updated_at=now()
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.create_rfq(p_title text, p_spec jsonb DEFAULT '{}', p_broker_mode text DEFAULT 'admin')
RETURNS public.supplier_rfqs LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.supplier_rfqs;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(p_title,'') = '' THEN RAISE EXCEPTION 'title_required'; END IF;
  INSERT INTO public.supplier_rfqs (client_id, title, spec, broker_mode)
  VALUES (v_uid, p_title, coalesce(p_spec,'{}'),
          CASE WHEN p_broker_mode IN ('admin','direct') THEN p_broker_mode ELSE 'admin' END)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.submit_quote(p_rfq_id uuid, p_quote jsonb)
RETURNS public.supplier_quotes LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.supplier_quotes;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_profiles WHERE id = v_uid AND is_active) THEN RAISE EXCEPTION 'not_a_supplier'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_rfqs WHERE id = p_rfq_id AND status = 'open') THEN RAISE EXCEPTION 'rfq_not_open'; END IF;
  INSERT INTO public.supplier_quotes (rfq_id, supplier_id, quote)
  VALUES (p_rfq_id, v_uid, coalesce(p_quote,'{}'))
  ON CONFLICT (rfq_id, supplier_id) DO UPDATE SET quote=EXCLUDED.quote, status='submitted', created_at=now()
  RETURNING * INTO v_row;
  UPDATE public.supplier_rfqs SET status='quoted' WHERE id = p_rfq_id AND status='open';
  RETURN v_row;
END $$;

-- ── 8) Public directory projection (business-level only — anti-poaching) ──
CREATE OR REPLACE VIEW public.supplier_directory AS
  SELECT s.id, s.legal_name, s.headline, s.capabilities, s.country_code,
         s.rating_avg, s.rating_count,
         coalesce(s.attributes->'standards','[]'::jsonb) AS standards,
         (s.verification ? 'verified_at') AS verified
  FROM public.supplier_profiles s
  WHERE s.is_active;

-- ── 9) RLS ──
ALTER TABLE public.supplier_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_capability_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_rfqs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_quotes             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cap_read  ON public.supplier_capability_catalog;
CREATE POLICY cap_read  ON public.supplier_capability_catalog FOR SELECT USING (is_active);
DROP POLICY IF EXISTS cap_admin ON public.supplier_capability_catalog;
CREATE POLICY cap_admin ON public.supplier_capability_catalog FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

DROP POLICY IF EXISTS supplier_read ON public.supplier_profiles;
CREATE POLICY supplier_read ON public.supplier_profiles FOR SELECT USING (is_active OR id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS supplier_self ON public.supplier_profiles;
CREATE POLICY supplier_self ON public.supplier_profiles FOR ALL USING (id = auth.uid() OR public.nx_is_admin()) WITH CHECK (id = auth.uid() OR public.nx_is_admin());

-- buyer owns their RFQs; active suppliers may browse OPEN RFQs to quote
DROP POLICY IF EXISTS rfq_owner ON public.supplier_rfqs;
CREATE POLICY rfq_owner ON public.supplier_rfqs FOR ALL USING (client_id = auth.uid() OR public.nx_is_admin()) WITH CHECK (client_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS rfq_supplier_browse ON public.supplier_rfqs;
CREATE POLICY rfq_supplier_browse ON public.supplier_rfqs FOR SELECT USING (
  status = 'open' AND EXISTS (SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = auth.uid() AND sp.is_active));

-- a supplier sees ONLY their own quote; the RFQ owner sees all quotes on their RFQ (price-blind between suppliers)
DROP POLICY IF EXISTS quote_supplier ON public.supplier_quotes;
CREATE POLICY quote_supplier ON public.supplier_quotes FOR ALL USING (supplier_id = auth.uid() OR public.nx_is_admin()) WITH CHECK (supplier_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS quote_client_view ON public.supplier_quotes;
CREATE POLICY quote_client_view ON public.supplier_quotes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.supplier_rfqs r WHERE r.id = rfq_id AND r.client_id = auth.uid()) OR public.nx_is_admin());

-- grants
GRANT SELECT ON public.supplier_capability_catalog TO anon, authenticated;
GRANT SELECT ON public.supplier_directory          TO anon, authenticated;
GRANT SELECT ON public.supplier_profiles           TO authenticated;
GRANT SELECT ON public.supplier_rfqs, public.supplier_quotes TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_match(jsonb,int)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_onboard(text,text[],jsonb,double precision,double precision,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_rfq(text,jsonb,text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quote(uuid,jsonb)               TO authenticated;

-- ── 10) SELF-TEST (fails the migration if matching math or role widen is wrong) ──
DO $$
DECLARE d double precision; n int;
BEGIN
  d := public._haversine_km(48.8566, 2.3522, 51.5074, -0.1278);   -- Paris → London ≈ 344 km
  IF d IS NULL OR abs(d - 344) > 8 THEN RAISE EXCEPTION 'SELFTEST haversine Paris-London ~344 got %', d; END IF;

  SELECT count(*) INTO n FROM public.supplier_capability_catalog;
  IF n < 12 THEN RAISE EXCEPTION 'SELFTEST capability catalog count %', n; END IF;

  PERFORM * FROM public.supplier_match('{"capabilities":["ndt_lab"],"lat":25.2,"lng":55.27}'::jsonb, 5);  -- must not error

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.profiles'::regclass AND pg_get_constraintdef(oid) ILIKE '%supplier%') THEN
    RAISE EXCEPTION 'SELFTEST profiles role CHECK does not allow supplier';
  END IF;

  RAISE NOTICE 'Supplier ecosystem self-test passed (haversine + catalog + match + role).';
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- CLIENT WIRING (zero new design — reuse DynamicForm + JSON lists):
--   • Onboarding: a form_template (capabilities from supplier_capability_catalog)
--       → supabase.rpc('supplier_onboard', { p_legal_name, p_capabilities, p_attributes })
--   • Find Suppliers: select * from supplier_directory  →  existing directory list
--   • Match: supabase.rpc('supplier_match', { p_need:{capabilities:[...],standards:[...],lat,lng} })
--   • RFQ: create_rfq(...) ; suppliers submit_quote(...) ; reuse chat/contracts for award.
--   • A "Supplier" entry in the onboarding role picker + apply_onboarding_role whitelist
--     is the only follow-up to let users self-select the role at signup.
-- ─────────────────────────────────────────────────────────────────────────
