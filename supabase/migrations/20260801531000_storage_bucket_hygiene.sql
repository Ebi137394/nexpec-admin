-- ════════════════════════════════════════════════════════════════════════════
--  20260801531000_storage_bucket_hygiene.sql
--
--  Found by the Production migration rehearsal of 2026-08-20.
--
--  Production carries a storage bucket 'certification-files' with public = true.
--  It was created 2026-01-21 04:08:55Z, has never been updated, holds ZERO
--  objects, and is referenced by no application code — web, mobile or SQL.
--  It is an orphan from an early iteration of the credential upload flow, which
--  now uses 'certifications' / 'inspector_certificates' / 'certificates'.
--
--  Left as it is, it is a loaded gun: 'public' on a Supabase bucket means every
--  object in it is readable over an unauthenticated URL. The moment any code
--  path — or any operator using the dashboard — writes an inspector's
--  certification document into it, that document is on the open internet.
--  Nothing today writes there, so nothing is exposed yet. That is precisely
--  why this is cheap to fix now.
--
--  It also blocks the promotion outright: 20260801532000 asserts that no bucket
--  except 'avatars' is public, and refuses to apply while this one is. The
--  rehearsal stopped there, at migration 17 of 41.
--
--  ── SCOPE, DELIBERATELY NARROW ─────────────────────────────────────────────
--  This flips exactly one named bucket, and only after proving it is empty.
--  It does NOT sweep every public bucket private: if some OTHER bucket is
--  public, that is a decision a human should make, and 20260801532000 will
--  stop the push and say so. The bucket is NOT dropped — it holds no data, but
--  removing a Production object is an owner decision, not a migration's.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_public  boolean;
  v_objects bigint;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'certification-files';

  IF v_public IS NULL THEN
    RAISE NOTICE 'certification-files bucket absent — nothing to reconcile (expected on a fresh environment)';
    RETURN;
  END IF;

  IF NOT v_public THEN
    RAISE NOTICE 'certification-files already private — nothing to do';
    RETURN;
  END IF;

  --  Only safe because it is empty. A public bucket with objects in it may have
  --  live unauthenticated URLs in the wild; silently breaking those would be a
  --  functional regression, so stop and let a human decide instead.
  SELECT count(*) INTO v_objects FROM storage.objects WHERE bucket_id = 'certification-files';
  IF v_objects <> 0 THEN
    RAISE EXCEPTION
      'REFUSING TO FLIP: certification-files holds % object(s); public URLs may be live. Owner decision required.',
      v_objects;
  END IF;

  UPDATE storage.buckets SET public = false WHERE id = 'certification-files';
  RAISE NOTICE 'certification-files: public -> private (0 objects, 0 code references)';
END $$;

-- ── A private bucket with no size cap is an unbounded upload ───────────────
--  20260801532000 creates buckets WITH file_size_limit, but it cannot repair a
--  bucket that already exists — its INSERT conflicts and does nothing. On
--  Production flash-report-attachments predates that migration and carries no
--  cap at all, so a single upload is limited only by the platform default.
--  storage_buckets_test asserts every private bucket is capped; on Production
--  it fails on exactly this bucket. 26214400 (25 MiB) is the value the tested
--  configuration uses.
UPDATE storage.buckets
   SET file_size_limit = 26214400
 WHERE id = 'flash-report-attachments'
   AND file_size_limit IS NULL;

-- ── SELFTEST ───────────────────────────────────────────────────────────────
DO $verify$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id) INTO v_bad
    FROM storage.buckets
   WHERE public AND id = 'certification-files';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RECONCILE FAILED: % still public', v_bad;
  END IF;

  SELECT string_agg(id, ', ' ORDER BY id) INTO v_bad
    FROM storage.buckets
   WHERE id = 'flash-report-attachments' AND file_size_limit IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'RECONCILE FAILED: % still has no file size cap', v_bad;
  END IF;
  RAISE NOTICE '════ certification-files is private ════';
END
$verify$;

COMMIT;
