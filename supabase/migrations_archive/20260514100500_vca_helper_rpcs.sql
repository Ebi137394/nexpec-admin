-- ============================================================================
-- VCA HELPER RPCs — service-role read helpers for the generate-vca function
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.vca_claimed_address_text(p_job_id uuid)
RETURNS TABLE (wkt text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT ST_AsText(j.claimed_address_geocoded::geometry) AS wkt
    FROM public.jobs j
   WHERE j.id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.vca_load_job(p_job_id uuid)
RETURNS TABLE (
  id                       uuid,
  client_id                uuid,
  agency_id                uuid,
  contractor_id            uuid,
  status                   text,
  inspection_type          public.inspection_type_kind,
  scope_template_id        uuid,
  title                    text,
  claimed_address_text     text,
  claimed_address_wkt      text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    j.id, j.client_id, j.agency_id, j.contractor_id, j.status,
    j.inspection_type, j.scope_template_id, j.title,
    j.claimed_address_text,
    ST_AsText(j.claimed_address_geocoded::geometry) AS claimed_address_wkt
  FROM public.jobs j
  WHERE j.id = p_job_id;
$$;

GRANT EXECUTE ON FUNCTION public.vca_claimed_address_text(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.vca_load_job(uuid)              TO service_role;

COMMIT;
