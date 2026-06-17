-- ============================================================================
--  20260801123700_anonymize_supplier_directory.sql
--
--  ANTI-POACHING — make the supplier directory pseudonymous, exactly like the
--  inspector directory (20260727120000). A buyer must never learn the real
--  identity of a supplier they could quote with / be presented an offer from.
--
--  Closes THREE leak paths:
--    1. public.supplier_directory view → drop legal_name + headline (identity /
--       employer vectors). Emit only the opaque id (→ client derives an NX-
--       handle + Trust Sigil), capabilities, standards, rating, country, verified.
--    2. public.supplier_profiles RLS → remove the public `is_active` read so a
--       buyer can't bypass the view and SELECT legal_name from the base table.
--       (The directory view is owner-run, so it still reads everything it needs.)
--    3. public.supplier_match() → it returns legal_name and was granted to every
--       authenticated user; restrict to service_role (admin tooling only).
--
--  Idempotent + safe to re-run.
-- ============================================================================

BEGIN;

-- ── 1. Anonymized directory view (no name, no headline) ───────────────────────
DROP VIEW IF EXISTS public.supplier_directory;
CREATE VIEW public.supplier_directory
WITH (security_barrier = true)
AS
  SELECT
    s.id,                                                  -- opaque UUID → client NX- handle + sigil
    s.capabilities,                                        -- verified competency chips
    s.country_code,                                        -- coarse region only
    s.rating_avg,                                          -- performance metric
    s.rating_count,                                        -- performance metric
    coalesce(s.attributes->'standards','[]'::jsonb) AS standards,
    (s.verification ? 'verified_at') AS verified
  FROM public.supplier_profiles s
  WHERE s.is_active;

COMMENT ON VIEW public.supplier_directory IS
  'ANONYMIZED buyer-facing supplier directory. Emits NO legal_name or headline — '
  'only the opaque id (client derives an NX- handle + sigil), capabilities, '
  'standards, rating, country and verified flag. Anti-poaching enforced at the '
  'data layer. Admin sees real identity via the admin RFQ/markup console.';

REVOKE ALL ON public.supplier_directory FROM public;
GRANT SELECT ON public.supplier_directory TO anon, authenticated;

-- ── 2. Lock the base table — no public read of legal_name ─────────────────────
DROP POLICY IF EXISTS supplier_read ON public.supplier_profiles;
CREATE POLICY supplier_read ON public.supplier_profiles
  FOR SELECT USING (id = auth.uid() OR public.nx_is_admin());

-- ── 3. Restrict the name-leaking matcher to server/admin tooling ──────────────
REVOKE EXECUTE ON FUNCTION public.supplier_match(jsonb, int) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.supplier_match(jsonb, int) TO service_role;

-- ── 4. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.supplier_directory') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: supplier_directory missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'supplier_directory'
       AND column_name IN ('legal_name','headline')
  ) THEN
    RAISE EXCEPTION 'SELFTEST: supplier_directory still exposes legal_name/headline';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='supplier_profiles' AND policyname='supplier_read'
       AND qual ILIKE '%is_active%'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: supplier_profiles still publicly readable (is_active)';
  END IF;
  RAISE NOTICE 'Supplier directory anonymized: no name/headline; base read self+admin; matcher locked.';
END $$;

COMMIT;
