-- ════════════════════════════════════════════════════════════════════════════
--  RLS hardening — closes findings F-1…F-5 of the 2026-08-23 pre-launch audit
--
--  WHY
--  ---
--  Five tables carried blanket `authenticated` grants while sitting outside
--  RLS (or, for inspection_events, behind a `USING (true)` read policy). Any
--  signed-up user could therefore read/modify every tenant's rows. All five
--  are EMPTY on Production today, so this closes a latent breach rather than
--  an active one — and no row is created, altered or deleted here.
--
--  BACKWARD COMPATIBILITY (mobile builds are already submitted)
--  ------------------------------------------------------------
--  Verified against the shipping clients before writing this:
--    • form_drafts  — the app's "form drafts" are a LOCAL SQLite table
--                     (src/hooks/useFormDrafts.ts, sqliteManager.execute).
--                     Nothing reads this Postgres table. Default-deny is safe.
--    • badges/user_badges — BadgeWall.tsx renders a local BADGES_DATA
--                     constant. No client query touches these tables.
--    • error_logs   — sole writer is supabase/functions/generate-contract
--                     (service_role, which bypasses RLS and keeps its grants).
--    • assets / inspection_events — read by mobile AssetVault via
--                     src/core/services/queryAssetIntelligence.ts using the
--                     user's session. Scoped here with the SAME idiom already
--                     used by programs/integration_* /documents, so an org
--                     member keeps seeing exactly their org's rows.
--  No column is dropped, no RPC signature changes, no grant a client depends
--  on is removed. TRUNCATE (never legitimate from a client) is revoked.
-- ════════════════════════════════════════════════════════════════════════════

-- ── F-1 · assets — org-scoped (was: RLS off + full authenticated grants) ────
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.assets FROM authenticated;

DROP POLICY IF EXISTS assets_org_read ON public.assets;
CREATE POLICY assets_org_read ON public.assets FOR SELECT TO authenticated
  USING (public.nx_is_admin()
         OR (organization_id IS NOT NULL
             AND public.nx_is_org_member(organization_id, auth.uid())));

DROP POLICY IF EXISTS assets_org_insert ON public.assets;
CREATE POLICY assets_org_insert ON public.assets FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NOT NULL
              AND public.nx_is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS assets_org_update ON public.assets;
CREATE POLICY assets_org_update ON public.assets FOR UPDATE TO authenticated
  USING (organization_id IS NOT NULL
         AND public.nx_is_org_member(organization_id, auth.uid()))
  WITH CHECK (organization_id IS NOT NULL
              AND public.nx_is_org_member(organization_id, auth.uid()));
-- DELETE deliberately has no client policy: no client path exists, and asset
-- history is audit-relevant. Admin/service-role deletion is unaffected.

COMMENT ON TABLE public.assets IS
  'Org-scoped asset registry. RLS: members read/write their own organization_id only (audit F-1, 2026-08-23).';

-- ── F-2 · form_drafts — default-deny (server table is unused; app uses SQLite)
ALTER TABLE public.form_drafts ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.form_drafts FROM authenticated;
-- No policy on purpose => default-deny for anon/authenticated, matching the
-- eight other service-role-only tables here. The table has no owner column, so
-- a per-user policy is not expressible; denying client access is the correct
-- and non-breaking fix. service_role (unused today) is unaffected.
COMMENT ON TABLE public.form_drafts IS
  'Service-role only; no client path (drafts live in on-device SQLite). Default-deny RLS (audit F-2, 2026-08-23).';

-- ── F-3 · error_logs — admin-read only, no client writes ────────────────────
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
-- SELECT grant is KEPT so the admin policy below can take effect (grants are
-- checked before RLS); the mutating grants that allowed log tampering go away.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.error_logs FROM authenticated;

DROP POLICY IF EXISTS error_logs_admin_read ON public.error_logs;
CREATE POLICY error_logs_admin_read ON public.error_logs FOR SELECT TO authenticated
  USING (public.nx_is_admin());

COMMENT ON TABLE public.error_logs IS
  'Edge-function error sink. Written by service_role only; readable by admins. Clients cannot delete/truncate (audit F-3, 2026-08-23).';

-- ── F-4 · badges / user_badges — no self-awarding ───────────────────────────
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.badges FROM authenticated;
DROP POLICY IF EXISTS badges_read_all ON public.badges;
CREATE POLICY badges_read_all ON public.badges FOR SELECT TO authenticated
  USING (true);  -- badge DEFINITIONS are a public catalog; readability preserved.

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_badges FROM authenticated;
DROP POLICY IF EXISTS user_badges_read ON public.user_badges;
CREATE POLICY user_badges_read ON public.user_badges FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.nx_is_admin());

COMMENT ON TABLE public.user_badges IS
  'Badge awards. Read own (or admin); awarded by service-role only — clients can no longer self-award (audit F-4, 2026-08-23).';

-- ── F-5 · inspection_events — replace the tenant-blind read policy ──────────
-- Writes were already denied (grants exist but no write policy), so only the
-- USING(true) read policy is replaced. inspection_events_admin_all is retained.
DROP POLICY IF EXISTS "Allow authenticated read on inspection_events" ON public.inspection_events;
DROP POLICY IF EXISTS inspection_events_org_read ON public.inspection_events;
CREATE POLICY inspection_events_org_read ON public.inspection_events FOR SELECT TO authenticated
  USING (public.nx_is_admin()
         OR (organization_id IS NOT NULL
             AND public.nx_is_org_member(organization_id, auth.uid())));
REVOKE TRUNCATE ON public.inspection_events FROM authenticated;

COMMENT ON TABLE public.inspection_events IS
  'Org-scoped inspection event log. Read restricted to the owning organization (was USING(true) — audit F-5, 2026-08-23).';
