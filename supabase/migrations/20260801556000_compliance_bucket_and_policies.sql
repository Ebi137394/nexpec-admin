-- ════════════════════════════════════════════════════════════════════════════
--  20260801556000_compliance_bucket_and_policies.sql
--
--  D35 — the `compliance` storage bucket does not exist, so every compliance
--  file path is inoperable on any environment this repository builds.
--
--  ── THE DEFECT (probed on Staging, not inferred) ───────────────────────────
--  20260801532000 created "every bucket the code names" — derived from the
--  web app's server actions. The mobile app names a twelfth bucket,
--  `compliance`, which that sweep missed. Observed live on the release APK:
--  a compliance photo capture enqueues into the offline outbox, the drain's
--  storage upload returns 400 "Bucket not found", the error classifies as
--  fatal and the op dead-letters — silently, because release builds strip
--  console.log. Result: captures show locally as PENDING forever and zero
--  rows / zero objects ever reach the database.
--
--  Every writer and reader of the bucket, traced from source:
--    WRITE  outbox handleCaptureSave              captures/<job>/<req>/<id>.jpg   image/jpeg
--    WRITE  compliance/lib/capture.ts             (same path, direct)             image/jpeg
--    WRITE  cci-application.tsx                   cci-applications/<uid>/…        image/jpeg
--    WRITE  post-compliance-job.tsx               documents/<job>/…               image/jpeg
--    WRITE  generate-vca edge fn (service role)   affidavits/<job>/<id>.html/.pdf text/html, application/pdf
--    READ   (admin)/cci-applications/[id].tsx     signed URL, admin session
--    READ   app/verify/[token].tsx                signed URL, ANONYMOUS visitor
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  1. Create the bucket: private, 25 MB cap (matches the other evidence
--     buckets), MIME allowlist = exactly what the writers above send, plus the
--     camera image family the sibling evidence buckets already accept.
--  2. Owner-scoped INSERT/UPDATE/DELETE/SELECT with the admin overlay — the
--     identical shape 20260801532000 stamped on the other eleven buckets.
--  3. One narrow public SELECT for the `affidavits/` folder only, TO anon AND
--     authenticated. The public verify page (app/verify/[token].tsx) signs
--     URLs client-side with no session — affidavits are public trust documents
--     by design (public_verify_url is printed on reports), and their paths are
--     unguessable (job UUID + affidavit UUID). `authenticated` is included
--     because the edge fn uploads with the service role, so `owner` is NULL
--     and the owner-scoped policy cannot serve signed-in visitors either.
--     Nothing outside `affidavits/` is anonymously readable: captures,
--     government IDs and job documents stay owner-or-admin only.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • No existing bucket, policy, table or grant. ON CONFLICT DO NOTHING and
--     same-name DROP POLICY IF EXISTS only (no same-name policies exist).
--   • Idempotent: re-running creates nothing twice.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The bucket ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('compliance', 'compliance', false, 26214400, ARRAY[
     'image/jpeg','image/png','image/webp','image/heic','image/heif',
     'application/pdf','text/html'])
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Owner/admin write + read — the 20260801532000 shape ────────────────
DROP POLICY IF EXISTS nx_compliance_insert_own ON storage.objects;
CREATE POLICY nx_compliance_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'compliance' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS nx_compliance_update_own ON storage.objects;
CREATE POLICY nx_compliance_update_own ON storage.objects FOR UPDATE TO authenticated
  USING      (bucket_id = 'compliance' AND (owner = auth.uid() OR public.nx_is_admin()))
  WITH CHECK (bucket_id = 'compliance' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS nx_compliance_delete_own ON storage.objects;
CREATE POLICY nx_compliance_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'compliance' AND (owner = auth.uid() OR public.nx_is_admin()));

DROP POLICY IF EXISTS nx_compliance_select_own_admin ON storage.objects;
CREATE POLICY nx_compliance_select_own_admin ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'compliance' AND (owner = auth.uid() OR public.nx_is_admin()));

-- ─── 3. Public affidavits — the ONE anonymously readable folder ────────────
DROP POLICY IF EXISTS nx_compliance_select_affidavit_public ON storage.objects;
CREATE POLICY nx_compliance_select_affidavit_public ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'compliance' AND (storage.foldername(name))[1] = 'affidavits');

-- ─── 4. Prove the outcome in the transaction that caused it ────────────────
DO $$
DECLARE
  v_pub boolean;
  v_cnt int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'compliance') THEN
    RAISE EXCEPTION 'COMPLIANCE_BUCKET_MISSING';
  END IF;

  SELECT public INTO v_pub FROM storage.buckets WHERE id = 'compliance';
  IF v_pub THEN
    -- A public compliance bucket would publish captures and government IDs.
    RAISE EXCEPTION 'COMPLIANCE_BUCKET_PUBLIC';
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects'
     AND policyname IN ('nx_compliance_insert_own','nx_compliance_update_own',
                        'nx_compliance_delete_own','nx_compliance_select_own_admin',
                        'nx_compliance_select_affidavit_public');
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'COMPLIANCE_POLICIES_MISSING: % of 5 present', v_cnt;
  END IF;

  RAISE NOTICE 'ok: compliance bucket present (private, capped), 5 policies in place.';
END $$;

COMMIT;
