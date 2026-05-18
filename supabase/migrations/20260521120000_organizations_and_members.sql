-- ════════════════════════════════════════════════════════════════════════════
--  20260521120000_organizations_and_members.sql
--  Phase 6 / Sprint 3 close — multi-tenant identity primitives.
--
--  WHAT THIS LANDS
--  ───────────────
--    public.organizations  — the entity (enterprise buyer / agency)
--    public.org_members    — user ↔ org membership with seat role
--
--  Minimal, read-first schema. No seat-purchase or invitation flow yet
--  (Sprint 4). Admin UI for Sprint 3 is read-only — surfaces existing rows
--  if any, otherwise renders the empty state.
--
--  RLS posture
--    organizations:
--      SELECT — super_admin OR member of the org
--      INSERT / UPDATE / DELETE — super_admin only (membership management
--      via dedicated RPCs in a later sprint, not free-form mutations)
--
--    org_members:
--      SELECT — super_admin OR member of the same org
--      No INSERT / UPDATE / DELETE policies — service-role or admin RPCs
--      only, mirroring audit_events's append-only-through-RPC posture
--
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Type for member seat role ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_member_role') THEN
    CREATE TYPE public.org_member_role AS ENUM (
      'owner',
      'procurement_admin',
      'project_lead',
      'viewer'
    );
  END IF;
END $$;

-- ── organizations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL    DEFAULT now(),
  updated_at   timestamptz NOT NULL    DEFAULT now(),

  name         text        NOT NULL,
  slug         text        UNIQUE,
  /** 'enterprise' = buyer organisation. 'agency' = inspection-agency. */
  kind         text        NOT NULL    DEFAULT 'enterprise'
                                      CHECK (kind IN ('enterprise', 'agency')),

  /** Owner / primary contact — the user who created the org. */
  owner_id     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,

  /** Display + contact metadata. */
  logo_url     text,
  website_url  text,
  contact_email text,

  /** Soft-suspension flag honoured by RLS in member-facing surfaces. */
  is_active    boolean     NOT NULL    DEFAULT true
);

COMMENT ON TABLE public.organizations IS
  'Multi-tenant identity: enterprise buyers + inspection agencies. RLS-gated; members see their own org, super_admin sees all.';

CREATE INDEX IF NOT EXISTS organizations_kind_idx
  ON public.organizations (kind, created_at DESC);

-- ── org_members ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL    DEFAULT now(),

  org_id       uuid        NOT NULL    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL    REFERENCES public.profiles(id)      ON DELETE CASCADE,
  role         public.org_member_role NOT NULL DEFAULT 'viewer',

  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_members_org_idx
  ON public.org_members (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS org_members_user_idx
  ON public.org_members (user_id);

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select_admin   ON public.organizations;
DROP POLICY IF EXISTS organizations_select_members ON public.organizations;
DROP POLICY IF EXISTS organizations_admin_write    ON public.organizations;

CREATE POLICY organizations_select_admin
  ON public.organizations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

CREATE POLICY organizations_select_members
  ON public.organizations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = organizations.id
        AND m.user_id = auth.uid()
    )
  );

CREATE POLICY organizations_admin_write
  ON public.organizations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS org_members_select_admin   ON public.org_members;
DROP POLICY IF EXISTS org_members_select_members ON public.org_members;

CREATE POLICY org_members_select_admin
  ON public.org_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

CREATE POLICY org_members_select_members
  ON public.org_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.org_members m2
      WHERE m2.org_id = org_members.org_id
        AND m2.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies on org_members → service-role or
-- super_admin RPC only. Membership mutations land in Sprint 4.

COMMIT;
