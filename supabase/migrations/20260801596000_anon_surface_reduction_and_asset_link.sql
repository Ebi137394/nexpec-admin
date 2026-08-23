-- ════════════════════════════════════════════════════════════════════════════
--  Anon-surface reduction (audit F-10, F-11, F-12) + AssetVault column repair
--
--  BACKWARD COMPATIBILITY — the mobile clients are SUBMITTED AND IMMUTABLE.
--  Every change below was checked against the shipping clients first:
--    • platform_settings — no client reads this table anonymously. The payment
--      flag reaches every client through nx_online_payments_enabled(), which is
--      SECURITY DEFINER (verified prosecdef = true) and therefore unaffected by
--      RLS. The only direct reader is apps/web/src/lib/data/settings.ts, which
--      uses createSupabaseServerClient() with an authenticated session.
--    • enterprise_domains — no client reads this table directly. Mobile SSO
--      resolves domains via lookup_sso_for_email(), also SECURITY DEFINER
--      (verified), so restricting the table does not touch the SSO flow.
--    • spatial_ref_sys — PostGIS metadata. No client writes SRID definitions;
--      SELECT is retained because PostGIS functions need it.
--  No column is dropped, no grant a client depends on is removed, and no RPC
--  signature changes. Nothing here requires a new mobile build.
-- ════════════════════════════════════════════════════════════════════════════

-- ── F-10 · platform_settings — commission rates were world-readable ─────────
-- client_commission_bps / payout_fee_bps / stripe_application_fee_bps were
-- readable by unauthenticated callers: a public view of the platform's margin
-- structure. Reads now require a session; the flag path (definer RPC) is
-- untouched, so signed-out clients keep resolving online_payments_enabled.
DROP POLICY IF EXISTS platform_settings_select_all ON public.platform_settings;
DROP POLICY IF EXISTS platform_settings_auth_read ON public.platform_settings;
CREATE POLICY platform_settings_auth_read ON public.platform_settings
  FOR SELECT TO authenticated USING (true);

-- ── F-11 · enterprise_domains — enterprise customer list was enumerable ─────
DROP POLICY IF EXISTS enterprise_domains_anon_read ON public.enterprise_domains;
DROP POLICY IF EXISTS enterprise_domains_auth_read ON public.enterprise_domains;
CREATE POLICY enterprise_domains_auth_read ON public.enterprise_domains
  FOR SELECT TO authenticated USING (true);

-- ── F-12 · spatial_ref_sys — NOT FIXABLE AT THIS PRIVILEGE LEVEL ───────────
-- Audit finding F-12 (anon holds INSERT/UPDATE/DELETE on the PostGIS SRID
-- table) is deliberately NOT patched here. The table is owned by
-- supabase_admin and our migration role is `postgres`, which is not a
-- superuser, so REVOKE is silently accepted and changes nothing —
-- has_table_privilege('anon', …, 'INSERT') still returns true afterwards.
-- Shipping a no-op REVOKE would imply a fix that does not exist. This is the
-- stock Supabase/PostGIS default; impact is limited to SRID metadata (no
-- customer data). Tracked as accepted risk — only Supabase support can alter
-- grants on an extension table they own.

-- ── AssetVault repair — additive column, no client contract change ──────────
-- src/core/services/queryAssetIntelligence.ts:184 filters inspection_events by
-- `asset_id`, a column that never existed: PostgREST answers that shipped query
-- with 400 "column does not exist", so AssetVault errors out on the released
-- builds. Adding the column the client already asks for turns that hard failure
-- into a correct empty result, with no app update. Nullable and additive, so
-- every existing INSERT and `select *` keeps working.
ALTER TABLE public.inspection_events
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inspection_events_asset_id
  ON public.inspection_events (asset_id) WHERE asset_id IS NOT NULL;

COMMENT ON COLUMN public.inspection_events.asset_id IS
  'Optional link to public.assets. Added 2026-08-23 to satisfy the shipped mobile AssetVault query (queryAssetIntelligence.ts), which filtered on this column before it existed.';
