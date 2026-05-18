-- ============================================================================
-- ADDITIVE-ONLY MIGRATION — Sprint 12I + 12J
--
-- NO-REGRESSION MANDATE COMPLIANCE:
--   - No DROP COLUMN anywhere
--   - No ALTER COLUMN DROP NOT NULL anywhere
--   - No DROP CONSTRAINT on pre-existing constraints
--   - No changes to tables mobile reads/writes (reports, flash_reports,
--     org_members existing columns)
--   - Every new column is nullable with no default that violates existing rows
--   - All CHECKs are NOT VALID so existing rows never block
--   - Every block wrapped in DO ... EXCEPTION so script never aborts
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Sprint 12I: org_invitations table (NEW table, no touch on org_members)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why a separate table: org_members.user_id is NOT NULL in the existing
-- schema, and the no-regression mandate forbids dropping that. Pending
-- email-only invites live in org_invitations until accepted, then promote
-- to an org_members row via accept_org_invitation() RPC.

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  invited_email        text NOT NULL,
  invited_role         public.org_member_role NOT NULL DEFAULT 'viewer',
  invitation_token     uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_by           uuid,
  expires_at           timestamptz NOT NULL DEFAULT (NOW() + interval '14 days'),
  accepted_at          timestamptz,
  accepted_by_user_id  uuid,
  revoked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT NOW(),
  updated_at           timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='org_invitations_org_fkey') THEN
      ALTER TABLE public.org_invitations DROP CONSTRAINT org_invitations_org_fkey;
    END IF;
    ALTER TABLE public.org_invitations ADD CONSTRAINT org_invitations_org_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'org_invitations_org_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='org_invitations_invited_by_fkey') THEN
      ALTER TABLE public.org_invitations DROP CONSTRAINT org_invitations_invited_by_fkey;
    END IF;
    ALTER TABLE public.org_invitations ADD CONSTRAINT org_invitations_invited_by_fkey
      FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'org_invitations_invited_by_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='org_invitations_accepted_by_fkey') THEN
      ALTER TABLE public.org_invitations DROP CONSTRAINT org_invitations_accepted_by_fkey;
    END IF;
    ALTER TABLE public.org_invitations ADD CONSTRAINT org_invitations_accepted_by_fkey
      FOREIGN KEY (accepted_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'org_invitations_accepted_by_fkey: %', SQLERRM; END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='org_invitations_email_format') THEN
      ALTER TABLE public.org_invitations DROP CONSTRAINT org_invitations_email_format;
    END IF;
    ALTER TABLE public.org_invitations ADD CONSTRAINT org_invitations_email_format
      CHECK (invited_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') NOT VALID;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'org_invitations_email_format: %', SQLERRM; END;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS org_invitations_token_uniq
  ON public.org_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org
  ON public.org_invitations(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_invitations_pending
  ON public.org_invitations(invited_email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

DROP TRIGGER IF EXISTS org_invitations_touch ON public.org_invitations;
CREATE TRIGGER org_invitations_touch
  BEFORE UPDATE ON public.org_invitations
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin OR the invitee (email match) OR existing org members
DROP POLICY IF EXISTS "org_invitations_select" ON public.org_invitations;
CREATE POLICY "org_invitations_select" ON public.org_invitations FOR SELECT
  USING (
    public.nx_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.org_members m
       WHERE m.org_id = org_invitations.org_id AND m.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND lower(p.email) = lower(invited_email)
    )
  );

-- No INSERT/UPDATE/DELETE policies — RPCs only.

-- ─── RPC: invite_org_member ───────────────────────────────────────────
-- Only owners + procurement_admins on the org (or super_admin) can invite.
CREATE OR REPLACE FUNCTION public.invite_org_member(
  p_org_id  uuid,
  p_email   text,
  p_role    public.org_member_role DEFAULT 'viewer'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_can boolean := false;
  v_inv_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  -- Permission gate: super_admin OR owner/procurement_admin of the target org
  v_can := public.nx_is_admin();
  IF NOT v_can THEN
    SELECT EXISTS (
      SELECT 1 FROM public.org_members m
       WHERE m.org_id = p_org_id
         AND m.user_id = v_uid
         AND m.role IN ('owner','procurement_admin')
    ) INTO v_can;
  END IF;
  IF NOT v_can THEN
    RAISE EXCEPTION 'not authorised to invite members to this org';
  END IF;

  -- Prevent duplicate pending invites for same (org, email)
  IF EXISTS (
    SELECT 1 FROM public.org_invitations
     WHERE org_id = p_org_id
       AND lower(invited_email) = lower(p_email)
       AND accepted_at IS NULL
       AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'already invited (pending)';
  END IF;

  INSERT INTO public.org_invitations(org_id, invited_email, invited_role, invited_by)
    VALUES (p_org_id, lower(trim(p_email)), p_role, v_uid)
    RETURNING id INTO v_inv_id;

  RETURN v_inv_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.invite_org_member(uuid, text, public.org_member_role) TO authenticated;

-- ─── RPC: revoke_org_invitation ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_org_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid(); v_org uuid; v_can boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT org_id INTO v_org FROM public.org_invitations WHERE id = p_invitation_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'invitation not found'; END IF;

  v_can := public.nx_is_admin();
  IF NOT v_can THEN
    SELECT EXISTS (
      SELECT 1 FROM public.org_members m
       WHERE m.org_id = v_org AND m.user_id = v_uid
         AND m.role IN ('owner','procurement_admin')
    ) INTO v_can;
  END IF;
  IF NOT v_can THEN RAISE EXCEPTION 'not authorised'; END IF;

  UPDATE public.org_invitations
     SET revoked_at = NOW()
   WHERE id = p_invitation_id AND accepted_at IS NULL;
END $fn$;

GRANT EXECUTE ON FUNCTION public.revoke_org_invitation(uuid) TO authenticated;

-- ─── RPC: accept_org_invitation ───────────────────────────────────────
-- Anyone authenticated with a matching email + valid token may accept.
-- Atomic: validates → promotes to org_members row → marks invitation accepted.
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_token uuid)
RETURNS uuid -- returns the new org_members.id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_inv record;
  v_member_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'profile email missing'; END IF;

  SELECT * INTO v_inv FROM public.org_invitations WHERE invitation_token = p_token;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'invitation not found'; END IF;
  IF v_inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'already accepted'; END IF;
  IF v_inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invitation revoked'; END IF;
  IF v_inv.expires_at < NOW() THEN RAISE EXCEPTION 'invitation expired'; END IF;
  IF lower(v_inv.invited_email) <> lower(v_email) THEN
    RAISE EXCEPTION 'invitation email mismatch';
  END IF;

  -- Promote to org_members. ON CONFLICT (org_id, user_id) → return existing.
  INSERT INTO public.org_members(org_id, user_id, role)
    VALUES (v_inv.org_id, v_uid, v_inv.invited_role)
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING id INTO v_member_id;

  UPDATE public.org_invitations
     SET accepted_at = NOW(), accepted_by_user_id = v_uid
   WHERE id = v_inv.id;

  -- Notify the inviter
  IF v_inv.invited_by IS NOT NULL THEN
    PERFORM public.notify(
      v_inv.invited_by,
      'system',
      'Invitation accepted',
      format('%s joined your organisation as %s', v_email, v_inv.invited_role::text),
      '/client/team',
      NULL
    );
  END IF;

  RETURN v_member_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.accept_org_invitation(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Sprint 12J: external_url support on inspection_reports + jobs
-- ════════════════════════════════════════════════════════════════════════════
--
-- IMPORTANT: This section ONLY touches `inspection_reports` (the table the
-- web uses) and `jobs`. It does NOT touch:
--   - `reports`        (legacy/mobile)
--   - `flash_reports`  (different flow)
--
-- All additions are pure ADD COLUMN IF NOT EXISTS with nullable default-null.
-- Existing rows are unaffected. Mobile clients that don't know about these
-- columns simply leave them NULL.

-- ─── inspection_reports.external_url ─────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='inspection_reports' AND relnamespace='public'::regnamespace) THEN
    ALTER TABLE public.inspection_reports
      ADD COLUMN IF NOT EXISTS external_url           text,
      ADD COLUMN IF NOT EXISTS external_url_label     text;

    -- URL format CHECK (NOT VALID — only enforced on new rows)
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inspection_reports_external_url_format') THEN
        ALTER TABLE public.inspection_reports DROP CONSTRAINT inspection_reports_external_url_format;
      END IF;
      ALTER TABLE public.inspection_reports ADD CONSTRAINT inspection_reports_external_url_format
        CHECK (external_url IS NULL OR external_url ~* '^https?://') NOT VALID;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'inspection_reports_external_url_format: %', SQLERRM; END;
  ELSE
    RAISE NOTICE 'inspection_reports table not found — skipping external_url add';
  END IF;
END $$;

-- ─── jobs.custom_report_template_{url,path} ──────────────────────────
-- Client supplies a custom template at job-post time. Inspector downloads
-- it from /inspector/jobs/[id] before submitting their report. Either an
-- uploaded path (in the client_documents bucket — reusing existing
-- storage to avoid yet-another-bucket) OR an external URL. Both nullable.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='jobs' AND relnamespace='public'::regnamespace) THEN
    ALTER TABLE public.jobs
      ADD COLUMN IF NOT EXISTS custom_report_template_path text,
      ADD COLUMN IF NOT EXISTS custom_report_template_url  text,
      ADD COLUMN IF NOT EXISTS custom_report_template_label text;

    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_custom_template_xor') THEN
        ALTER TABLE public.jobs DROP CONSTRAINT jobs_custom_template_xor;
      END IF;
      -- AT MOST one of (path, url). Both null = no template required.
      ALTER TABLE public.jobs ADD CONSTRAINT jobs_custom_template_xor
        CHECK (NOT (custom_report_template_path IS NOT NULL
                AND custom_report_template_url  IS NOT NULL)) NOT VALID;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'jobs_custom_template_xor: %', SQLERRM; END;

    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_custom_template_url_format') THEN
        ALTER TABLE public.jobs DROP CONSTRAINT jobs_custom_template_url_format;
      END IF;
      ALTER TABLE public.jobs ADD CONSTRAINT jobs_custom_template_url_format
        CHECK (custom_report_template_url IS NULL OR custom_report_template_url ~* '^https?://') NOT VALID;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'jobs_custom_template_url_format: %', SQLERRM; END;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. New table:
--      SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='org_invitations';
-- 2. New columns on inspection_reports:
--      SELECT column_name FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='inspection_reports'
--         AND column_name IN ('external_url','external_url_label');
-- 3. New columns on jobs:
--      SELECT column_name FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='jobs'
--         AND column_name IN ('custom_report_template_path','custom_report_template_url',
--                             'custom_report_template_label');
-- 4. RPCs:
--      SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--       WHERE n.nspname='public' AND proname IN ('invite_org_member','accept_org_invitation','revoke_org_invitation');
-- ============================================================================
