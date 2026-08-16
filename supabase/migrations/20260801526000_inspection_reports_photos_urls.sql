-- ════════════════════════════════════════════════════════════════════════════
--  20260801526000_inspection_reports_photos_urls.sql
--
--  P1 — the OFFLINE photo-evidence replay cannot attach a photo to a report.
--
--  ── THE DEFECT ─────────────────────────────────────────────────────────────
--  src/core/offline/operations.ts, on the upload_photo operation with
--  link_to_report_id set, does a read-modify-write:
--
--      .from('inspection_reports').select('photos_urls')          ← 42703
--      …
--      .update({ photos_urls: next })                             ← 42703
--
--  public.inspection_reports has `photo_url` — singular, text — and no
--  photos_urls at all. The SELECT's error is not swallowed here (`if (readErr)
--  throw readErr`), so the whole replay operation throws. Offline photo
--  evidence uploads to storage and then fails to attach, every time, for every
--  inspector. The replay suites pass because they do not exercise the
--  link_to_report_id branch.
--
--  ── WHY A COLUMN AND NOT `photo_url` ───────────────────────────────────────
--  Folding this onto the singular photo_url would cap a report at one photo and
--  silently overwrite prior evidence on the second upload — losing inspection
--  evidence is a worse failure than not attaching it. The offline contract, the
--  operation's own comment, and the read-modify-write shape all assume a list.
--
--  text[] is the convention this schema already uses for exactly this:
--      disputes.evidence_urls                     text[]
--      job_disputes.evidence_urls                 text[]
--      inspector_credentials.experience_evidence_paths  text[]
--
--  ── WHAT THESE VALUES ARE ──────────────────────────────────────────────────
--  STORAGE PATHS, not URLs, despite the column name matching the existing
--  evidence_urls convention. The bucket is private; operations.ts stores the
--  object key deliberately ("getPublicUrl yields a dead link") and a signed URL
--  is minted at read time. Documented on the column so nobody renders these
--  directly.
--
--  ── SAFETY ─────────────────────────────────────────────────────────────────
--   • Additive. Nullable, defaults to an empty array, so existing rows are
--     unaffected and no writer is forced to supply it.
--   • photo_url is left in place and untouched; other readers still use it.
--   • No policy, grant or trigger changes — inspection_reports keeps exactly
--     the RLS posture it had.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.inspection_reports
  ADD COLUMN IF NOT EXISTS photos_urls text[] DEFAULT '{}'::text[];

COMMENT ON COLUMN public.inspection_reports.photos_urls IS
  'Object PATHS (not URLs) inside the private evidence bucket, appended by the offline upload_photo replay in src/core/offline/operations.ts. A signed URL is minted at read time — never render these directly. Added by 20260801526000; before it, every offline photo linked to a report threw 42703 and failed to attach.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='inspection_reports'
       AND column_name='photos_urls' AND data_type='ARRAY'
  ) THEN
    RAISE EXCEPTION 'PHOTOS_URLS_MISSING: inspection_reports.photos_urls did not materialise as an array column.';
  END IF;
  RAISE NOTICE 'ok: inspection_reports.photos_urls is present and is an array.';
END $$;

COMMIT;
