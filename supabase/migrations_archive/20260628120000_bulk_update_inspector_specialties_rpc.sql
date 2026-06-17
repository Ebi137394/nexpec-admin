-- ════════════════════════════════════════════════════════════════════════════
--  20260628120000_bulk_update_inspector_specialties_rpc.sql
--
--  Atomic RPC for the /admin/users/specialties-bulk admin tool. Adds and/or
--  removes canonical kebab specialty slugs across multiple inspector
--  profiles in a single round-trip.
--
--  WHY THIS EXISTS
--  ───────────────
--  Domain-launch readiness for civil_construction, electrical,
--  mechanical_field, and chemical_process is bottlenecked on inspector
--  pool size. The natural workflow during a launch is:
--
--    1. Filter inspectors who have an adjacent specialty (e.g. inspectors
--       holding 'aws-cwi' are good mechanical_field candidates).
--    2. Select a batch.
--    3. Add a new kebab discipline slug (e.g. 'vibration-analysis') to
--       every selected profile.
--    4. Repeat for the next adjacent specialty / target slug.
--
--  Without this RPC the admin clicks through /admin/users/[id] one
--  profile at a time. A four-domain launch is dozens of profile edits.
--  This collapses each batch into one API call.
--
--  SECURITY
--  ────────
--    • SECURITY DEFINER with an explicit nx_is_admin() check inside.
--    • Underlying profiles RLS write policy ALSO restricts to admin,
--      so even if the function were called from a non-admin path the
--      UPDATE would be filtered out at the row layer (defense in depth).
--    • Idempotent: the array_agg DISTINCT collapses duplicates, so
--      re-adding an existing slug is a no-op (the resulting array is
--      identical pre/post).
--    • Operates only on rows WHERE role = 'inspector' AND deleted_at IS
--      NULL — never accidentally edits a client or admin profile.
--
--  RETURN VALUE
--  ────────────
--  jsonb { "updated": <integer> } — the number of inspector rows whose
--  specialty_slugs actually changed value (Postgres UPDATE returns the
--  rows it touched; a no-op WHERE-matched row still counts here).
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
  -- Defense in depth #1 — re-check admin even though the calling server
  -- action and the underlying RLS policy also check.
  IF NOT public.nx_is_admin() THEN
    RAISE EXCEPTION 'Super admin only' USING ERRCODE = '42501';
  END IF;

  -- Empty-input short-circuit (avoid a no-op UPDATE that still touches
  -- updated_at on every matching row).
  IF cardinality(coalesce(p_inspector_ids, ARRAY[]::uuid[])) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'reason', 'no_inspectors');
  END IF;
  IF cardinality(coalesce(p_add_slugs, ARRAY[]::text[])) = 0
     AND cardinality(coalesce(p_remove_slugs, ARRAY[]::text[])) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'reason', 'no_changes');
  END IF;

  -- The merge:
  --   new_slugs = (existing_slugs ∪ add_slugs) \ remove_slugs   (set semantics)
  -- array_agg(DISTINCT … ORDER BY …) collapses duplicates and gives
  -- deterministic alphabetical ordering for downstream readability.
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
       AND p.deleted_at IS NULL
     RETURNING p.id
  )
  SELECT count(*)::int INTO v_updated FROM updated;

  RETURN jsonb_build_object('updated', v_updated);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.bulk_update_inspector_specialties(uuid[], text[], text[]) TO authenticated;

COMMENT ON FUNCTION public.bulk_update_inspector_specialties IS
  'Bulk add and/or remove canonical kebab specialty slugs across multiple '
  'inspector profiles. Operates with set semantics — duplicates collapsed, '
  'remove_slugs takes precedence over add_slugs. SECURITY DEFINER with an '
  'explicit nx_is_admin() check (defense in depth alongside the underlying '
  'profiles RLS write policy). Returns jsonb { updated: int }.';

COMMIT;
