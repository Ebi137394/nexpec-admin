-- ════════════════════════════════════════════════════════════════════════════
--  20260801532000_storage_buckets_and_write_policies.sql
--
--  P1 — the entire document, evidence and attachment surface is inoperable on
--  any environment this repository can build. Ten of the eleven storage buckets
--  the application uses do not exist, and no bucket except `avatars` has a
--  write policy.
--
--  ── THE DEFECT (probed on Staging, not inferred) ───────────────────────────
--  A real upload was attempted against every bucket the code names, with the
--  correct role's JWT:
--
--    vendor_documents          400  NoSuchBucket
--    client_documents          400  NoSuchBucket
--    inspector_credentials     400  NoSuchBucket
--    inspector_certificates    400  NoSuchBucket
--    resumes                   400  NoSuchBucket
--    chat_attachments          400  NoSuchBucket
--    inspection-photos         400  NoSuchBucket
--    inspection_signatures     400  NoSuchBucket
--    flash-report-attachments  400  NoSuchBucket
--    branding_assets           400  NoSuchBucket
--    avatars                   200  (the only one that works)
--
--  storage.buckets held exactly one row, on Staging AND on a freshly reset
--  local database. No migration has ever created a bucket. The buckets in the
--  original project were made by hand in the dashboard, so the repository
--  cannot reproduce its own environment — every new environment ships with the
--  Document Vault, compliance uploads, inspection evidence, signatures, flash
--  reports, chat attachments and company branding silently broken.
--
--  Several earlier migrations wrote SELECT policies for these bucket ids
--  (20260801242000, 20260801246000, 20260801326000), which is why the gap was
--  invisible: the policies referenced buckets that were never created.
--
--  A SECOND defect sits underneath. Even with the buckets present, uploads
--  would still fail: storage.objects has RLS enabled and, before this
--  migration, held exactly ONE INSERT policy, ONE UPDATE and ONE DELETE — all
--  three for `avatars`. Every other bucket was read-only by construction.
--  apps/web/src/lib/actions/inspectorDocuments.ts:18 even says
--  "20 MB matches bucket cap", so a cap was intended and never created.
--
--  ── THE FIX ────────────────────────────────────────────────────────────────
--  1. Create every bucket the code names, private except `avatars`, with a size
--     cap and a MIME allowlist DERIVED FROM the app's own ALLOWED_MIME /
--     MAX_BYTES constants — never narrower than what the application already
--     accepts, so no working path is broken. The bucket limits are a server-side
--     backstop for a request that skips the server action; the action stays the
--     user-facing validator with the friendlier message.
--  2. Give every private bucket owner-scoped INSERT/UPDATE/DELETE, plus the
--     admin overlay the existing SELECT policies already use
--     (`owner = auth.uid() OR nx_is_admin()`), so read and write are symmetric:
--     a user can only write what they will then be able to read.
--
--  ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--   • `avatars` — the one bucket that works — is left exactly as it is, row and
--     policies alike. ON CONFLICT DO NOTHING guarantees it.
--   • No existing SELECT policy is altered or dropped. The new SELECT policies
--     are added ONLY for buckets that had none.
--   • No table, view, function or grant outside the storage schema.
--   • Idempotent: re-running creates nothing twice.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The buckets ────────────────────────────────────────────────────────
-- MIME lists and caps trace directly to the server actions:
--   resumes                  uploadResume.ts            10 MB · pdf/doc/docx
--   inspector_certificates   inspectorCertificates.ts   15 MB · +jpeg/png/webp
--   inspector_credentials    inspectorDocuments.ts      20 MB · images+pdf
--   client_documents         clientDocuments.ts         25 MB · images+office
--   flash-report-attachments flashReports.ts            25 MB · images+pdf
--   chat_attachments         messages.ts                50 MB · any (the accept
--                            list spans video, audio and zip, so a MIME list
--                            here would reject something the UI offers)
--   branding_assets          uploadCompanyLogo.ts       10 MB · jpeg/png/webp
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('resumes', 'resumes', false, 10485760, ARRAY[
     'application/pdf','application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),

  ('inspector_certificates', 'inspector_certificates', false, 15728640, ARRAY[
     'application/pdf','application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'image/jpeg','image/png','image/webp']),

  ('inspector_credentials', 'inspector_credentials', false, 20971520, ARRAY[
     'image/jpeg','image/png','image/webp','image/heic','application/pdf']),

  ('client_documents', 'client_documents', false, 26214400, ARRAY[
     'image/jpeg','image/png','image/webp','image/heic','application/pdf',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),

  -- Same document classes as client_documents; the Vendor Document Vault
  -- accepts ISO certs, accreditations, insurance and mill certificates.
  ('vendor_documents', 'vendor_documents', false, 26214400, ARRAY[
     'image/jpeg','image/png','image/webp','image/heic','application/pdf',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),

  ('inspection-photos', 'inspection-photos', false, 26214400, ARRAY[
     'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']),

  -- A captured signature is a small raster. No SVG: it is scriptable markup and
  -- these are served back through signed URLs.
  ('inspection_signatures', 'inspection_signatures', false, 5242880, ARRAY[
     'image/png','image/jpeg']),

  ('flash-report-attachments', 'flash-report-attachments', false, 26214400, ARRAY[
     'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif',
     'application/pdf']),

  ('chat_attachments', 'chat_attachments', false, 52428800, NULL),

  ('branding_assets', 'branding_assets', false, 10485760, ARRAY[
     'image/jpeg','image/png','image/webp']),

  ('ai-dataset', 'ai-dataset', false, 104857600, ARRAY[
     'image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Write policies for every private bucket ────────────────────────────
-- Generated so all eleven get an identical, auditable shape rather than eleven
-- hand-written triples that could drift. `owner` is set by the storage service
-- to the caller's uid on insert, and it is the same column the existing SELECT
-- policies match on — so read and write scope agree by construction.
DO $$
DECLARE
  b    text;
  slug text;
  buckets text[] := ARRAY[
    'resumes','inspector_certificates','inspector_credentials','client_documents',
    'vendor_documents','inspection-photos','inspection_signatures',
    'flash-report-attachments','chat_attachments','branding_assets','ai-dataset'
  ];
BEGIN
  FOREACH b IN ARRAY buckets LOOP
    slug := replace(b, '-', '_');

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects', 'nx_' || slug || '_insert_own');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated
         WITH CHECK (bucket_id = %L AND (owner = auth.uid() OR public.nx_is_admin()))',
      'nx_' || slug || '_insert_own', b);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects', 'nx_' || slug || '_update_own');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated
         USING      (bucket_id = %L AND (owner = auth.uid() OR public.nx_is_admin()))
         WITH CHECK (bucket_id = %L AND (owner = auth.uid() OR public.nx_is_admin()))',
      'nx_' || slug || '_update_own', b, b);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects', 'nx_' || slug || '_delete_own');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated
         USING (bucket_id = %L AND (owner = auth.uid() OR public.nx_is_admin()))',
      'nx_' || slug || '_delete_own', b);
  END LOOP;
END $$;

-- ─── 3. SELECT only for buckets that had NONE ──────────────────────────────
-- The 2026-08-01 lockdown wave already wrote owner/admin SELECT policies for
-- chat_attachments, client_documents, inspection-photos and resumes. Those are
-- left untouched — client_documents in particular is party-scoped, which is
-- broader than owner-scoped on purpose. Only the buckets with no read path at
-- all get one here.
DO $$
DECLARE
  b    text;
  slug text;
  buckets text[] := ARRAY[
    'inspector_certificates','inspector_credentials','vendor_documents',
    'inspection_signatures','flash-report-attachments','branding_assets','ai-dataset'
  ];
BEGIN
  FOREACH b IN ARRAY buckets LOOP
    slug := replace(b, '-', '_');
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects', 'nx_' || slug || '_select_own_admin');
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR SELECT TO authenticated
         USING (bucket_id = %L AND (owner = auth.uid() OR public.nx_is_admin()))',
      'nx_' || slug || '_select_own_admin', b);
  END LOOP;
END $$;

-- ─── 4. Prove the outcome in the transaction that caused it ────────────────
DO $$
DECLARE
  v_missing text;
  v_public  text;
BEGIN
  SELECT string_agg(b, ', ' ORDER BY b) INTO v_missing
    FROM unnest(ARRAY[
      'avatars','resumes','inspector_certificates','inspector_credentials',
      'client_documents','vendor_documents','inspection-photos',
      'inspection_signatures','flash-report-attachments','chat_attachments',
      'branding_assets','ai-dataset']) AS b
   WHERE NOT EXISTS (SELECT 1 FROM storage.buckets s WHERE s.id = b);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'BUCKETS_STILL_MISSING: %', v_missing;
  END IF;

  -- Only avatars may be public. A private document bucket turned public would
  -- publish every resume and certificate on the internet.
  SELECT string_agg(id, ', ' ORDER BY id) INTO v_public
    FROM storage.buckets WHERE public AND id <> 'avatars';
  IF v_public IS NOT NULL THEN
    RAISE EXCEPTION 'UNEXPECTED_PUBLIC_BUCKET: %', v_public;
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='storage' AND tablename='objects' AND cmd='INSERT') < 12 THEN
    RAISE EXCEPTION 'WRITE_POLICIES_MISSING: fewer INSERT policies than buckets';
  END IF;

  RAISE NOTICE 'ok: 12 storage buckets present, none public but avatars, write policies in place.';
END $$;

COMMIT;
