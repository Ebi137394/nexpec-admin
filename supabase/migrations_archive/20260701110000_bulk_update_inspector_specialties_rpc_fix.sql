-- ════════════════════════════════════════════════════════════════════════════
--  20260701110000_bulk_update_inspector_specialties_rpc_fix.sql
--
--  Hotfix for 20260628120000_bulk_update_inspector_specialties_rpc.sql.
--
--  The original function body filtered with `p.deleted_at IS NULL`, but
--  public.profiles does not carry a deleted_at column — soft-deletion on
--  profiles is signalled by suspended_at. Postgres / plpgsql validates
--  function bodies lazily on first call, so the CREATE went through
--  without error but any actual invocation would raise:
--
--    ERROR:  42703: column p.deleted_at does not exist
--
--  This hotfix replaces the function definition with the corrected
--  predicate. CREATE OR REPLACE preserves the function OID + grants, so
--  no follow-up GRANT EXECUTE is needed and any cached PostgREST
--  introspection continues to work without restart.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_update_inspector_specialties(
  p_inspector_ids uuid[],
  p_add_slugs     text[] DEFAULT ARRAY[]::text[],
  p_remove_slugs  text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_updated integer;
BEGIN
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'Super admin only' USING ERRCODE = '42501';
  END IF;

  IF cardinality(coalesce(p_inspector_ids, ARRAY[]::uuid[])) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'reason', 'no_inspectors');
  END IF;
  IF cardinality(coalesce(p_add_slugs, ARRAY[]::text[])) = 0
     AND cardinality(coalesce(p_remove_slugs, ARRAY[]::text[])) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'reason', 'no_changes');
  END IF;

  -- Eligibility filter now uses suspended_at (the actual soft-delete
  -- signal on profiles) instead of the non-existent deleted_at column.
  WITH updated AS (
    UPDATE public.profiles p
       SET specialty_slugs = (
             SELECT coalesce(array_agg(DISTINCT s ORDER BY s), ARRAY[]::text[])
               FROM unnest(
                 coalesce(p.specialty_slugs, ARRAY[]::text[])
                 || coalesce(p_add_slugs, ARRAY[]::text[])
               ) AS s
              WHERE NOT (s = ANY(coalesce(p_remove_slugs, ARRAY[]::text[])))
           ),
           updated_at = now()
     WHERE p.id = ANY(p_inspector_ids)
       AND p.role = 'inspector'
       AND p.suspended_at IS NULL
     RETURNING p.id
  )
  SELECT count(*)::int INTO v_updated FROM updated;

  RETURN jsonb_build_object('updated', v_updated);
END;
$fn$;

COMMENT ON FUNCTION public.bulk_update_inspector_specialties IS
  'Bulk add and/or remove canonical kebab specialty slugs across multiple '
  'inspector profiles. Operates with set semantics — duplicates collapsed, '
  'remove_slugs takes precedence over add_slugs. SECURITY DEFINER with an '
  'explicit nx_is_admin() check. Eligibility filter uses suspended_at IS '
  'NULL (the soft-delete signal on profiles). Returns jsonb { updated: int }.';

COMMIT;
