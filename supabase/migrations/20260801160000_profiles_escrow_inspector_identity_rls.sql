-- ════════════════════════════════════════════════════════════════════════════
--  20260801160000_profiles_escrow_inspector_identity_rls.sql
--
--  DB-LAYER anti-poaching / paywall enforcement on public.profiles.
--
--  THREAT: the buyer already holds the assigned inspector's UUID (it ships in
--  the deal/contract rows so the client can render the NX- handle). With the
--  over-permissive `profiles_authenticated_select_any` policy (USING true), a
--  technical buyer could query `profiles?id=eq.<inspector_uuid>` directly via
--  the Supabase API / network tab and read the inspector's real full_name /
--  first_name / last_name / avatar_url / email — bypassing the Stripe
--  Named-Disclosure paywall + 36-month non-circumvention NDA. UI masking alone
--  (NX- handle on the cards) does NOT stop a raw API call.
--
--  FIX (surgical, RESTRICTIVE, deal-scoped — matches the product rule "unless
--  identity_revealed_at is met for a specific deal between them"): add a
--  RESTRICTIVE SELECT policy that DENIES an authenticated buyer direct access to
--  the profile ROW of an inspector they have an ESCROWED (not-yet-revealed)
--  brokered engagement with. Row-level denial covers every column at once
--  (name, avatar, email, phone …).
--
--  WHY this is safe (no frontend breakage):
--    • Self (id = auth.uid()) and admins (nx_is_admin) are exempt.
--    • RESTRICTIVE policies apply only to `authenticated`; service_role and the
--      SECURITY DEFINER views run as owner and BYPASS RLS — so
--      client_assigned_inspector_view (the legit post-pay reveal path, which
--      already CASE-gates on identity_revealed_at) keeps working.
--    • It only bites the exact (buyer, escrowed-inspector) pair. Every other
--      cross-user read audited (chat partners [admin, never an inspector — zero
--      client↔inspector chat], org/team members, inspector→client, admin
--      consoles, the marketplace inspector directory + applicant lists where no
--      escrowed engagement exists) is UNAFFECTED — NOT EXISTS short-circuits to
--      TRUE for them.
--    • The Smart Contracts Hub already stopped fetching inspector profiles for
--      buyers (commit 210110d) and renders nxHandle, so nothing buyer-facing
--      relies on the now-denied read.
--
--  SCOPE NOTE: `profiles_authenticated_select_any` is intentionally LEFT in
--  place — 19 raw cross-user reads still depend on it. Removing it (and routing
--  those through the existing-but-unused SECURITY DEFINER RPCs get_public_profile
--  / get_marketplace_inspectors / get_organization_members / get_client_branding)
--  is the recommended Phase-2 hardening, tracked separately; it is a multi-site
--  frontend migration, not a DB change, and is out of scope here.
--
--  Idempotent. ADDITIVE (one RESTRICTIVE policy; no existing policy altered).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DROP POLICY IF EXISTS "profiles_block_escrowed_inspector_identity" ON public.profiles;

CREATE POLICY "profiles_block_escrowed_inspector_identity"
  ON public.profiles
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    -- Always allow your own row and admins.
    id = auth.uid()
    OR public.nx_is_admin()
    -- Otherwise allow ANY row UNLESS it is an inspector assigned to one of the
    -- requester's deals whose identity is still escrowed (unrevealed). Once a
    -- paid Named-Disclosure stamps identity_revealed_at, this becomes TRUE and
    -- the row is readable.
    OR NOT EXISTS (
      SELECT 1
      FROM public.inspector_engagement_meta m
      JOIN public.deals d ON d.id = m.deal_id
      WHERE m.inspector_id = profiles.id
        AND d.client_id = auth.uid()
        AND m.identity_revealed_at IS NULL
    )
  );

COMMENT ON POLICY "profiles_block_escrowed_inspector_identity" ON public.profiles IS
  'Anti-poaching / paywall enforcement (20260801160000). Denies an authenticated buyer direct SELECT on the profile row of an inspector assigned to one of their deals while identity is still escrowed (inspector_engagement_meta.identity_revealed_at IS NULL). Self, admins, service_role, and the SECURITY DEFINER client_assigned_inspector_view are exempt. A paid Named-Disclosure (sets identity_revealed_at) lifts the block. RESTRICTIVE → AND-combined with profiles_authenticated_select_any / read_self / read_admin.';

-- ── Self-tests ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.inspector_engagement_meta') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: inspector_engagement_meta missing';
  END IF;
  IF to_regclass('public.deals') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: deals missing';
  END IF;
  IF to_regprocedure('public.nx_is_admin()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: nx_is_admin() missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'profiles_block_escrowed_inspector_identity'
      AND permissive = 'RESTRICTIVE'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: RESTRICTIVE SELECT policy not present on public.profiles';
  END IF;
  RAISE NOTICE 'profiles escrowed-inspector identity lockdown OK (RESTRICTIVE, deal-scoped).';
END $$;

COMMIT;
