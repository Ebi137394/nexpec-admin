-- ════════════════════════════════════════════════════════════════════════════
--  20260801484000_match_core_array_append_fix.sql
--
--  P1 — the inspector-matching engine crashes for any verified inspector.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  nx_inspector_job_match_core declares `v_reasons text[] := '{}'` and appends
--  to it five times. Three appends use format(), which returns a known `text`,
--  so `text[] || text` resolves correctly. Two append BARE STRING LITERALS:
--
--      v_reasons := v_reasons || 'verified'
--      v_reasons := v_reasons || 'available'
--
--  A bare literal is type `unknown`. Postgres then resolves `||` as
--  anyarray || anyarray and tries to CAST 'verified' to text[], which fails:
--
--      ERROR: malformed array literal: "verified"
--      DETAIL: Array value must start with "{" or dimension information.
--      CONTEXT: PL/pgSQL function nx_inspector_job_match_core(uuid,uuid) line 68
--
--  Those two branches are the COMMON case — a verified, available inspector —
--  so matching raises for exactly the candidates it should rank highest.
--
--  ── REPRODUCED BEFORE FIXING, independently of any test ────────────────────
--  On the live database: create an unassigned job via the canonical fixture
--  helper, a profile with is_verified/is_available true, then call
--  nx_inspector_job_match_core(job, inspector) directly. It raises the error
--  above. certification_expiry_test was reporting a real product defect, not
--  fixture drift.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  Cast both literals to text so `||` resolves as text[] || text, matching how
--  the three format() appends already behave. The function body is otherwise
--  reproduced verbatim from pg_get_functiondef, so no scoring, weighting or
--  authorization logic changes — this is a type-resolution fix only.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_inspector_job_match_core(p_job_id uuid, p_inspector_id uuid)
 RETURNS TABLE(score integer, specialty_pts integer, cert_pts integer, distance_pts integer, distance_km numeric, verified_pts integer, available_pts integer, work_authorized boolean, reasons text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  j          RECORD;
  p          RECORD;
  v_req_spec int;
  v_overlap  int;
  v_req_cert int;
  v_held     int;
  v_radius   numeric;
  v_reasons  text[] := '{}';
BEGIN
  SELECT jb.specialty_slugs, jb.required_certifications, jb.job_country, jb.geog
    INTO j FROM public.jobs jb WHERE jb.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not found' USING errcode = 'P0002'; END IF;

  SELECT pr.specialty_slugs, pr.is_verified, pr.is_available,
         pr.home_base_lat, pr.home_base_lng, pr.travel_radius_km,
         pr.work_authorized_countries
    INTO p FROM public.profiles pr WHERE pr.id = p_inspector_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inspector not found' USING errcode = 'P0002'; END IF;

  -- specialty (40)
  v_req_spec := COALESCE(array_length(j.specialty_slugs, 1), 0);
  IF v_req_spec = 0 THEN
    specialty_pts := 20;
  ELSE
    SELECT count(*) INTO v_overlap FROM unnest(j.specialty_slugs) s WHERE s = ANY (p.specialty_slugs);
    specialty_pts := round(40.0 * v_overlap / v_req_spec)::int;
    v_reasons := v_reasons || CASE WHEN v_overlap > 0
      THEN format('covers %s/%s discipline(s)', v_overlap, v_req_spec)
      ELSE 'no matching discipline' END;
  END IF;

  -- certifications (25) — verified and unexpired only
  v_req_cert := COALESCE(array_length(j.required_certifications, 1), 0);
  IF v_req_cert = 0 THEN
    cert_pts := 12;
  ELSE
    SELECT count(DISTINCT lower(btrim(r))) INTO v_held
      FROM unnest(j.required_certifications) r
     WHERE EXISTS (
       SELECT 1 FROM public.certifications c
        WHERE c.user_id = p_inspector_id
          AND c.status = 'verified'
          AND (c.expiry_date IS NULL OR c.expiry_date > current_date)
          AND lower(btrim(c.name)) = lower(btrim(r)));
    cert_pts := round(25.0 * v_held / v_req_cert)::int;
    v_reasons := v_reasons || format('holds %s/%s required cert(s)', v_held, v_req_cert);
  END IF;

  -- distance (20)
  IF j.geog IS NOT NULL AND p.home_base_lat IS NOT NULL AND p.home_base_lng IS NOT NULL THEN
    distance_km := round((public.st_distance(
      j.geog,
      public.st_setsrid(public.st_makepoint(p.home_base_lng::double precision,
                                            p.home_base_lat::double precision), 4326)::public.geography
    ) / 1000.0)::numeric, 1);
    v_radius := GREATEST(COALESCE(p.travel_radius_km, 100), 1)::numeric;
    distance_pts := CASE WHEN distance_km <= v_radius
                         THEN round(20.0 * (1 - distance_km / v_radius))::int ELSE 0 END;
    v_reasons := v_reasons || format('%s km away', distance_km);
  ELSE
    distance_km := NULL; distance_pts := 10;
  END IF;

  verified_pts  := CASE WHEN COALESCE(p.is_verified, false)  THEN 10 ELSE 0 END;
  available_pts := CASE WHEN COALESCE(p.is_available, false) THEN 5  ELSE 0 END;
  IF verified_pts  > 0 THEN v_reasons := v_reasons || 'verified'::text;  END IF;
  IF available_pts > 0 THEN v_reasons := v_reasons || 'available'::text; END IF;

  work_authorized := (j.job_country IS NULL) OR (j.job_country = ANY (p.work_authorized_countries));
  score := LEAST(GREATEST(specialty_pts + cert_pts + distance_pts + verified_pts + available_pts, 0), 100);
  reasons := v_reasons;
  RETURN NEXT;
END $function$

;

DO $selftest$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'nx_inspector_job_match_core'
      AND prosrc ~ 'v_reasons \|\| ''(verified|available)''(?!::)'
  ) THEN
    RAISE EXCEPTION
      'SELFTEST: a bare untyped literal is still appended to v_reasons — matching will raise "malformed array literal" for that branch';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
