-- ════════════════════════════════════════════════════════════════════════════
--  20260801680000_company_logo_path.sql
--
--  Company logos were stored as a PUBLIC URL of a PRIVATE bucket.
--
--  uploadCompanyLogo.ts uploads to storage bucket 'branding_assets', then calls
--  getPublicUrl() and persists that string in profiles.company_logo_url. The
--  bucket is public=false (verified on Production), so every such URL is a dead
--  link the moment it is rendered. The code's own comment admits the bucket
--  policy "is unclear" and persists the public form anyway.
--
--  The mobile branding screen is worse: it uploads to a bucket named
--  'company-logos', which does not exist in Production at all, so the upload
--  throws before anything is stored.
--
--  ── THE CONTRACT ───────────────────────────────────────────────────────────
--  A private object is identified by its STORAGE PATH. A signed URL is a
--  short-lived credential minted at read time and must never be persisted as
--  the file's identity — it expires, and a stored expired URL is
--  indistinguishable from a broken one.
--
--  So: company_logo_path holds the object path (canonical), and readers mint a
--  signed URL per request. company_logo_url is retained ONLY for legacy
--  absolute URLs that may still resolve; it is no longer written.
--
--  Nothing is migrated: ZERO profiles carry a logo today, so there is no dead
--  URL to convert and no ownership to guess. The bucket stays PRIVATE — a
--  branding asset belongs to that customer.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_logo_path text;

COMMENT ON COLUMN public.profiles.company_logo_path IS
  'Storage object path in the private branding_assets bucket. Canonical. '
  'Readers mint a short-lived signed URL at render time. Never store a signed '
  'URL here: it expires, and an expired URL cannot be told apart from a broken '
  'one.';

COMMENT ON COLUMN public.profiles.company_logo_url IS
  'LEGACY absolute URL only. No longer written. New uploads populate '
  'company_logo_path instead, because branding_assets is a private bucket and '
  'getPublicUrl() produced a dead link.';

COMMIT;
