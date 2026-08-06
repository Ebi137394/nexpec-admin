-- ════════════════════════════════════════════════════════════════════════════
--  20260801318000_rollback.sql  (NOT a migration — run manually to revert)
--
--  Reverts 20260801318000_jobs_payout_column_privilege_symmetry.sql, returning
--  the database to the 20260801312000 boundary:
--    • payout columns GRANTed back to `authenticated` on public.jobs
--    • jobs_secure_view restored to plain `SELECT j.*` (no margin masking)
--    • jobs_inspector_secure_view and the 318000 helpers dropped
--
--  ⚠ SECURITY WARNING — running this REOPENS the margin leak this migration
--    closed: a buyer regains the ability to read inspector_payout_cents (and,
--    through the unmasked view, platform_spread_cents) for their own jobs and
--    therefore to derive NEXPEC's exact margin and the inspector's true rate.
--    Only run it if 318000 is actively breaking production, and pair it with an
--    immediate revert of the application call sites (they read the seller view).
--
--  Ordered so dependents drop before the objects they reference.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Drop the seller view (the app must be reverted in the same window) ──────
DROP VIEW IF EXISTS public.jobs_inspector_secure_view;

-- 2) Restore jobs_secure_view to the 312000 definition (unmasked SELECT j.*) ─
--    CREATE OR REPLACE keeps the existing grants.
CREATE OR REPLACE VIEW public.jobs_secure_view
WITH (security_barrier = 'true') AS
SELECT j.*
  FROM public.jobs j
 WHERE j.client_id = auth.uid()
    OR j.agency_id = auth.uid()
    OR public.nx_is_admin();

COMMENT ON VIEW public.jobs_secure_view IS
  'Buyer + admin job read (312000 definition restored by the 318000 rollback). WARNING: margin columns are NOT masked in this form.';

-- 3) Re-grant the seller columns on the base table ───────────────────────────
--    Mirrors what 312000 left in place: everything except the buyer-only set.
DO $regrant$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['inspector_payout_cents','payout_amount_cents'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='jobs' AND column_name=v_col) THEN
      EXECUTE format('GRANT SELECT (%I) ON public.jobs TO authenticated', v_col);
    END IF;
  END LOOP;
  -- contractor_payout_amount_cents / platform_spread_cents stay REVOKED:
  -- they were revoked by 312000, not by 318000.
END
$regrant$;

-- 4) Drop the 318000 helpers (after the view that used them is gone) ─────────
DROP FUNCTION IF EXISTS public.nx_jobs_margin_columns();
DROP FUNCTION IF EXISTS public.nx_jobs_seller_only_columns();
DROP FUNCTION IF EXISTS public.nx_is_inspector();

NOTIFY pgrst, 'reload schema';
