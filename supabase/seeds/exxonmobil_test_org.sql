-- ════════════════════════════════════════════════════════════════════════════
--  supabase/seeds/exxonmobil_test_org.sql
--  One-shot test seed for an ExxonMobil enterprise org.
--
--  HOW TO USE
--  ──────────
--  1. Open the Supabase SQL editor for your project.
--  2. Paste this whole file and run it.
--  3. Sign in to the app as the email noted in the OUTPUT block at the
--     bottom — that user will be the org owner with role `owner`, which
--     grants full mutation rights via can_manage_org_structure().
--
--  WHAT THIS LANDS
--  ───────────────
--    · One `organizations` row for ExxonMobil (kind = 'enterprise').
--    · A `slug` column that satisfies NOT NULL + UNIQUE.
--    · An optional `org_members` insert that promotes the chosen user
--      to `owner` so they can manage the tree from /client/structure.
--    · An optional `procurement_admin` seat for a second test user so
--      you can verify the elevated-role gate (also can edit).
--    · A `viewer` seat so you can verify the readOnly client view.
--
--  IDEMPOTENT
--  ──────────
--    · `organizations` row is upserted on the unique `slug`.
--    · `org_members` upserts on the unique `(org_id, user_id)` pair.
--
--  CONFIGURE THESE BEFORE RUNNING
--  ──────────────────────────────
--  Set the three email addresses below. Each must already exist in
--  `auth.users` (i.e. they've signed up at least once). The script
--  looks them up by email and skips memberships for any that don't
--  exist — it logs which ones it skipped in the OUTPUT.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  CONFIGURE — change these if you want different test accounts.
-- ─────────────────────────────────────────────────────────────────────
DO $seed$
DECLARE
  -- Owner address is NOT hard-coded. Set it at run time, e.g.
--   psql -v owner_email='you@example.com' -f this_file.sql
-- The fallback is a non-routable example address so a forgotten override
-- can never mail a real person from a test seed.
  v_owner_email           text := coalesce(current_setting('nexpec.owner_email', true), 'owner@example.invalid');   -- becomes role 'owner'
  v_procurement_email     text := coalesce(current_setting('nexpec.owner_email', true), 'owner@example.invalid');   -- becomes role 'procurement_admin' (set to NULL to skip)
  v_viewer_email          text := NULL;                          -- becomes role 'viewer' (set to NULL to skip)

  v_org_id          uuid;
  v_owner_id        uuid;
  v_procurement_id  uuid;
  v_viewer_id       uuid;

  v_skipped_owner       boolean := false;
  v_skipped_procurement boolean := false;
  v_skipped_viewer      boolean := false;
BEGIN
  -- Resolve user ids by email from the auth.users table. NULL means
  -- the user hasn't signed up yet; we skip those memberships rather
  -- than failing the whole script.
  IF v_owner_email IS NOT NULL THEN
    SELECT id INTO v_owner_id FROM auth.users
     WHERE lower(email) = lower(v_owner_email) LIMIT 1;
    IF v_owner_id IS NULL THEN
      v_skipped_owner := true;
    END IF;
  END IF;

  IF v_procurement_email IS NOT NULL THEN
    SELECT id INTO v_procurement_id FROM auth.users
     WHERE lower(email) = lower(v_procurement_email) LIMIT 1;
    IF v_procurement_id IS NULL THEN
      v_skipped_procurement := true;
    END IF;
  END IF;

  IF v_viewer_email IS NOT NULL THEN
    SELECT id INTO v_viewer_id FROM auth.users
     WHERE lower(email) = lower(v_viewer_email) LIMIT 1;
    IF v_viewer_id IS NULL THEN
      v_skipped_viewer := true;
    END IF;
  END IF;

  -- ── Insert (or upsert) the org ─────────────────────────────────────
  -- Every NOT NULL column is supplied: name, slug, kind. `is_active` and
  -- timestamps default. owner_id is set if we resolved the owner.
  INSERT INTO public.organizations (
    name, slug, kind, owner_id, website_url, contact_email, is_active
  )
  VALUES (
    'ExxonMobil',
    'exxonmobil',
    'enterprise',
    v_owner_id,
    'https://corporate.exxonmobil.com',
    'procurement@exxonmobil.example',
    true
  )
  ON CONFLICT (slug) DO UPDATE
    SET name          = EXCLUDED.name,
        kind          = EXCLUDED.kind,
        owner_id      = COALESCE(EXCLUDED.owner_id, public.organizations.owner_id),
        website_url   = EXCLUDED.website_url,
        contact_email = EXCLUDED.contact_email,
        is_active     = EXCLUDED.is_active,
        updated_at    = now()
  RETURNING id INTO v_org_id;

  -- ── Memberships ────────────────────────────────────────────────────
  IF v_owner_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, v_owner_id, 'owner'::public.org_member_role)
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role = EXCLUDED.role;
  END IF;

  IF v_procurement_id IS NOT NULL AND v_procurement_id <> COALESCE(v_owner_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, v_procurement_id, 'procurement_admin'::public.org_member_role)
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role = EXCLUDED.role;
  END IF;

  IF v_viewer_id IS NOT NULL
     AND v_viewer_id <> COALESCE(v_owner_id,       '00000000-0000-0000-0000-000000000000'::uuid)
     AND v_viewer_id <> COALESCE(v_procurement_id, '00000000-0000-0000-0000-000000000000'::uuid)
  THEN
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, v_viewer_id, 'viewer'::public.org_member_role)
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role = EXCLUDED.role;
  END IF;

  -- ── OUTPUT report (Supabase shows NOTICEs in the SQL editor) ───────
  RAISE NOTICE '──────────────────────────────────────────────────────';
  RAISE NOTICE 'ExxonMobil seed complete.';
  RAISE NOTICE '  org_id   = %', v_org_id;
  RAISE NOTICE '  slug     = exxonmobil';
  RAISE NOTICE '  owner    = % (%)',
    COALESCE(v_owner_email, '— not configured —'),
    CASE WHEN v_skipped_owner THEN 'SKIPPED: no auth.users row' ELSE 'OK' END;
  RAISE NOTICE '  proc.adm = % (%)',
    COALESCE(v_procurement_email, '— not configured —'),
    CASE WHEN v_skipped_procurement THEN 'SKIPPED: no auth.users row' ELSE 'OK' END;
  RAISE NOTICE '  viewer   = % (%)',
    COALESCE(v_viewer_email, '— not configured —'),
    CASE WHEN v_skipped_viewer THEN 'SKIPPED: no auth.users row' ELSE 'OK' END;
  RAISE NOTICE '──────────────────────────────────────────────────────';
  RAISE NOTICE 'Next: sign in as % and visit /client/structure', v_owner_email;
  RAISE NOTICE 'Or as super_admin and visit /admin/orgs/%/structure', v_org_id;
  RAISE NOTICE '──────────────────────────────────────────────────────';
END
$seed$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
--  QUICK VERIFICATION QUERIES (run after the script above)
-- ─────────────────────────────────────────────────────────────────────
-- SELECT id, name, slug, kind, owner_id, is_active
--   FROM public.organizations
--  WHERE slug = 'exxonmobil';
--
-- SELECT m.role, p.full_name, p.email
--   FROM public.org_members m
--   JOIN public.profiles p ON p.id = m.user_id
--   JOIN public.organizations o ON o.id = m.org_id
--  WHERE o.slug = 'exxonmobil'
--  ORDER BY m.created_at;
--
-- -- Sanity-check the new authorization helper:
-- SELECT public.can_manage_org_structure(
--   (SELECT id FROM public.organizations WHERE slug = 'exxonmobil'),
--   (SELECT id FROM auth.users WHERE lower(email) = lower(coalesce(current_setting('nexpec.owner_email', true), 'owner@example.invalid')) LIMIT 1)
-- ) AS owner_can_manage;
