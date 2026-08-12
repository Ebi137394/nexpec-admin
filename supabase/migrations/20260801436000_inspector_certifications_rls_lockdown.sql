-- ════════════════════════════════════════════════════════════════════════════
--  20260801436000_inspector_certifications_rls_lockdown.sql
--
--  Lane D. Building the four-table credential authority map found something
--  larger than the is_verified/verified drift the lane was scoped for.
--
--  ── THE HOLE ───────────────────────────────────────────────────────────────
--  public.inspector_certifications:
--
--      baseline:40395   GRANT ALL ON TABLE ... TO "anon"
--      baseline:40396   GRANT ALL ON TABLE ... TO "authenticated"
--      RLS              NEVER ENABLED — no ENABLE ROW LEVEL SECURITY for this
--                       table exists anywhere in supabase/migrations
--      POLICIES         zero
--
--  Grants without RLS are not access control. Via PostgREST an UNAUTHENTICATED
--  caller can today:
--
--    SELECT  every inspector's certification_number and document_url
--            — credential identifiers and a link to the certificate file
--    INSERT  a row for ANY inspector_id with is_verified = true
--            — credential forgery against the verification system
--    UPDATE  flip is_verified on anyone's credential
--    DELETE  destroy credential history
--
--  The table is live: apps/web/src/lib/actions/inspectorCertifications.ts:125
--  inserts into it, and apps/web/src/lib/data/inspectorCertifications.ts:26
--  reads it.
--
--  Its three sibling credential tables are all RLS-enabled — certifications
--  (20260801224000), inspector_credentials and contractor_certifications
--  (baseline). This one was simply missed.
--
--  ── THE FIX, MIRRORING THE SIBLING EXACTLY ─────────────────────────────────
--  20260801224000 already established the house pattern for owner-scoped
--  credential tables:
--
--      USING      (inspector_id = auth.uid() OR public.nx_is_admin())
--      WITH CHECK (inspector_id = auth.uid() OR public.nx_is_admin())
--
--  Adopted verbatim so this table stops being the odd one out. No Credentials
--  v2, no new table, no column change, no data rewritten.
--
--  ── VERIFICATION AUTHORITY STAYS WITH ADMIN ────────────────────────────────
--  The owner-scoped policy alone would still let an inspector set is_verified
--  on their OWN row, which is self-verification by another name. A separate
--  BEFORE trigger pins that column: only an admin may raise is_verified, on
--  INSERT or UPDATE. The existing writer never sets it (it relies on the
--  DEFAULT false), so no legitimate call path changes.
--
--  ── DELIBERATELY NOT DONE ──────────────────────────────────────────────────
--  Not merged with certifications / inspector_credentials / contractor_
--  certifications. Not reconciling certifications.is_verified vs .verified —
--  that is the rest of Lane D and belongs with 20260801434000, which remains
--  WIP and unreviewed. Not touching the anon grants on job_applications,
--  inspection_reports or request_senior_review — separate objects, separate
--  blast radius, separate migrations.
--
--  NOTE ON SHAPE: apps/web/src/lib/data/inspectorCertifications.ts:26 selects
--  name / issuing_body / certificate_number / issued_at / expires_at /
--  certificate_path, while the baseline defines certification_type /
--  certification_number / issued_date / expiry_date / document_url. The live
--  shape cannot be confirmed without a database. Everything below is
--  column-agnostic apart from inspector_id and is_verified, so it holds under
--  either shape; the is_verified guard self-skips if that column is absent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Close the anonymous door ─────────────────────────────────────────────
REVOKE ALL ON TABLE public.inspector_certifications FROM PUBLIC, anon;

-- Authenticated keeps row access, but now under RLS rather than instead of it.
-- No DELETE grant: credential history is evidence, and the previous DELETE
-- capability was part of the hole.
GRANT SELECT, INSERT, UPDATE ON TABLE public.inspector_certifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.inspector_certifications TO service_role;

-- ── 2. Turn the control on ──────────────────────────────────────────────────
ALTER TABLE public.inspector_certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inspector_certifications_owner_or_admin ON public.inspector_certifications;
CREATE POLICY inspector_certifications_owner_or_admin
  ON public.inspector_certifications
  FOR ALL
  TO authenticated
  USING      (inspector_id = auth.uid() OR public.nx_is_admin())
  WITH CHECK (inspector_id = auth.uid() OR public.nx_is_admin());

COMMENT ON TABLE public.inspector_certifications IS
  'Inspector-owned certification records. RLS enabled and anon revoked by 20260801436000 — before that this table carried GRANT ALL to anon with NO row-level security and no policies, so any unauthenticated PostgREST caller could read every certification_number and document_url, forge a verified credential for any inspector_id, or delete credential history. Owner-or-admin policy mirrors 20260801224000. is_verified is admin-only, enforced by trg_inspector_certifications_verify_authority.';

-- ── 3. Verification authority — an inspector may not verify themselves ──────
CREATE OR REPLACE FUNCTION public.nx_guard_inspector_certification_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- service_role / owner orchestration (auth.uid() IS NULL) is not a client.
  IF auth.uid() IS NULL OR public.nx_is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_verified, false) THEN
      RAISE EXCEPTION
        'is_verified is set by Admin verification, not by the credential holder (inspector %)', NEW.inspector_id
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_verified, false) IS DISTINCT FROM COALESCE(OLD.is_verified, false) THEN
    RAISE EXCEPTION
      'is_verified may only be changed by Admin verification (inspector %)', COALESCE(OLD.inspector_id, NEW.inspector_id)
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $fn$;

ALTER FUNCTION public.nx_guard_inspector_certification_verification() OWNER TO postgres;

-- Attach only if the column actually exists in the live shape (see NOTE above).
DO $attach$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'inspector_certifications'
       AND column_name = 'is_verified'
  ) THEN
    DROP TRIGGER IF EXISTS trg_inspector_certifications_verify_authority
      ON public.inspector_certifications;
    CREATE TRIGGER trg_inspector_certifications_verify_authority
      BEFORE INSERT OR UPDATE ON public.inspector_certifications
      FOR EACH ROW EXECUTE FUNCTION public.nx_guard_inspector_certification_verification();
  ELSE
    RAISE NOTICE 'inspector_certifications.is_verified absent in this shape — verification guard not attached';
  END IF;
END
$attach$;

-- ── 4. Self-test ────────────────────────────────────────────────────────────
DO $selftest$
BEGIN
  IF to_regclass('public.inspector_certifications') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: inspector_certifications is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'inspector_certifications' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'SELFTEST: RLS is still disabled on inspector_certifications';
  END IF;

  IF has_table_privilege('anon', 'public.inspector_certifications', 'SELECT')
     OR has_table_privilege('anon', 'public.inspector_certifications', 'INSERT')
     OR has_table_privilege('anon', 'public.inspector_certifications', 'UPDATE')
     OR has_table_privilege('anon', 'public.inspector_certifications', 'DELETE') THEN
    RAISE EXCEPTION 'SELFTEST: anon still holds a privilege on inspector_certifications';
  END IF;

  -- Credential history must not be erasable by a client role.
  IF has_table_privilege('authenticated', 'public.inspector_certifications', 'DELETE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated can DELETE credential rows — history is evidence';
  END IF;

  -- Legitimate access must survive.
  IF NOT has_table_privilege('authenticated', 'public.inspector_certifications', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.inspector_certifications', 'INSERT') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated lost SELECT/INSERT — the inspector certification UI is broken';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'inspector_certifications'
  ) THEN
    RAISE EXCEPTION 'SELFTEST: RLS is on but no policy exists — authenticated access is fully denied';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
