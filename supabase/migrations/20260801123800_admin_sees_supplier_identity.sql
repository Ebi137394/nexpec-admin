-- ============================================================================
--  20260801123800_admin_sees_supplier_identity.sql
--
--  GOD-MODE override for the supplier directory. 20260801123700 made the
--  directory fully pseudonymous (no legal_name/headline for ANYONE) for
--  anti-poaching. But the ONE admin (ebi / nx_is_admin) has full control of
--  everything and must see real supplier identities.
--
--  Fix: re-define public.supplier_directory so legal_name + headline are
--  emitted ONLY when public.nx_is_admin() is true. Clients / agencies /
--  enterprises / anon still receive NULL — anti-poaching is preserved BY
--  CONSTRUCTION (the CASE can never leak a name to a non-admin), so the
--  public surface stays zero-PII while admin gets the real identity.
--
--  The view is owner-run (reads all active suppliers); nx_is_admin() reads
--  auth.uid() (the *invoker*), so the gate is evaluated per logged-in user.
--
--  Idempotent + safe to re-run.
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS public.supplier_directory;
CREATE VIEW public.supplier_directory
WITH (security_barrier = true)
AS
  SELECT
    s.id,                                                  -- opaque UUID → client NX- handle + sigil
    s.capabilities,
    s.country_code,
    s.rating_avg,
    s.rating_count,
    coalesce(s.attributes->'standards','[]'::jsonb) AS standards,
    (s.verification ? 'verified_at') AS verified,
    -- Identity columns: god-mode admin only. Everyone else gets NULL.
    CASE WHEN public.nx_is_admin() THEN s.legal_name ELSE NULL END AS legal_name,
    CASE WHEN public.nx_is_admin() THEN s.headline    ELSE NULL END AS headline
  FROM public.supplier_profiles s
  WHERE s.is_active;

COMMENT ON VIEW public.supplier_directory IS
  'Buyer-facing supplier directory. legal_name + headline are emitted ONLY to '
  'nx_is_admin() (god-mode); clients/agencies/anon receive NULL (anti-poaching '
  'preserved by construction). All other columns are business-level + the opaque '
  'id (client derives an NX- handle + Trust Sigil).';

REVOKE ALL ON public.supplier_directory FROM public;
GRANT SELECT ON public.supplier_directory TO anon, authenticated;

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.supplier_directory') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: supplier_directory missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='supplier_directory'
       AND column_name IN ('legal_name','headline')
  ) THEN
    RAISE EXCEPTION 'SELFTEST: supplier_directory must expose admin-gated legal_name/headline';
  END IF;
  RAISE NOTICE 'supplier_directory: legal_name/headline are admin-gated (nx_is_admin); non-admin still anonymized.';
END $$;

COMMIT;
