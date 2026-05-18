-- ════════════════════════════════════════════════════════════════════════════
--  20260521120100_organizations_schema_align.sql
--  Remediates the failed run of 20260521120000.
--
--  ROOT CAUSE
--  ──────────
--  A `public.organizations` table already existed in your project from
--  earlier work, but its column set did not include `kind`. The previous
--  migration's `CREATE TABLE IF NOT EXISTS` is a NO-OP when the table is
--  already present — it does NOT reconcile columns. The next statement
--  (`CREATE INDEX ... ON organizations (kind, ...)`) then failed with
--  42703 and rolled the whole transaction back.
--
--  FIX
--  ───
--  Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` per column instead of
--  relying on the CREATE TABLE clauses. That works in both cases —
--  freshly-created table OR pre-existing table with a different shape.
--  Then add the constraints + indexes defensively (DO blocks check
--  pg_constraint first).
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Type ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_member_role') THEN
    CREATE TYPE public.org_member_role AS ENUM (
      'owner', 'procurement_admin', 'project_lead', 'viewer'
    );
  END IF;
END $$;

-- ── organizations — table + every column ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_at    timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS name          text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug          text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS kind          text        NOT NULL DEFAULT 'enterprise';
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS owner_id      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url      text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS website_url   text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_active     boolean     NOT NULL DEFAULT true;

-- Constraints defensively.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_kind_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_kind_check
      CHECK (kind IN ('enterprise', 'agency'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_slug_key'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
  END IF;
END $$;

COMMENT ON TABLE public.organizations IS
  'Multi-tenant identity: enterprise buyers + inspection agencies. RLS-gated; members see their own org, super_admin sees all.';

-- ── org_members — table + every column ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE public.org_members ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.org_members ADD COLUMN IF NOT EXISTS org_id     uuid;
ALTER TABLE public.org_members ADD COLUMN IF NOT EXISTS user_id    uuid;
ALTER TABLE public.org_members ADD COLUMN IF NOT EXISTS role       public.org_member_role NOT NULL DEFAULT 'viewer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_members_org_id_fkey'
  ) THEN
    ALTER TABLE public.org_members
      ADD CONSTRAINT org_members_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_members_user_id_fkey'
  ) THEN
    ALTER TABLE public.org_members
      ADD CONSTRAINT org_members_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_members_org_id_user_id_key'
  ) THEN
    ALTER TABLE public.org_members
      ADD CONSTRAINT org_members_org_id_user_id_key UNIQUE (org_id, user_id);
  END IF;
END $$;

-- ── Indexes (kind now guaranteed to exist) ───────────────────────────
CREATE INDEX IF NOT EXISTS organizations_kind_idx
  ON public.organizations (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS org_members_org_idx
  ON public.org_members (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS org_members_user_idx
  ON public.org_members (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select_admin   ON public.organizations;
DROP POLICY IF EXISTS organizations_select_members ON public.organizations;
DROP POLICY IF EXISTS organizations_admin_write    ON public.organizations;

CREATE POLICY organizations_select_admin
  ON public.organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  ));

CREATE POLICY organizations_select_members
  ON public.organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = organizations.id AND m.user_id = auth.uid()
  ));

CREATE POLICY organizations_admin_write
  ON public.organizations FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  ));

DROP POLICY IF EXISTS org_members_select_admin   ON public.org_members;
DROP POLICY IF EXISTS org_members_select_members ON public.org_members;

CREATE POLICY org_members_select_admin
  ON public.org_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  ));

CREATE POLICY org_members_select_members
  ON public.org_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.org_members m2
      WHERE m2.org_id = org_members.org_id
        AND m2.user_id = auth.uid()
    )
  );

COMMIT;
