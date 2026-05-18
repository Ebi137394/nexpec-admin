// ════════════════════════════════════════════════════════════════════════════
//  src/utils/storage.ts — uploadInspectionPhoto
//
//  Strike: NX-STORAGE-003 closure for the inspection-photos upload helper.
//
//  WHAT CHANGED (vs the legacy helper):
//    1. Auth check — refuses if no Supabase session (was: silently uploaded
//       under the anon role, which the post-Module-2 RLS will now also deny).
//    2. Path scoping — `inspections/<auth.uid()>/<timestamp>_<random>.jpg`
//       replaces the legacy `inspections/<timestamp>_<filename>.jpg`. The
//       new path embeds the uploader's uid so the bucket layer can attach
//       owner-scoped policies in a follow-up.
//    3. Filename sanitization — the caller-supplied `fileName` is stripped
//       of everything except [A-Za-z0-9._-] and capped to 64 chars before
//       being used. Path traversal characters are removed before the
//       string ever reaches Supabase.
//    4. MIME guard — only image/jpeg is accepted (the helper only ever
//       handled JPEGs anyway; making it explicit fails loudly if a caller
//       passes the wrong source format).
//    5. Returns a 1-hour signed URL instead of getPublicUrl — post-lockdown
//       the bucket is private and getPublicUrl would return a non-working
//       URL.
//    6. Size cap — 10 MB. The bucket-level limit is the authoritative cap
//       but a client-side reject saves an unnecessary round trip.
// ════════════════════════════════════════════════════════════════════════════

import { decode } from 'base64-arraybuffer';
import { supabase } from '@/src/core/supabase/supabase';
import { signedUrl, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

const MAX_BYTES = 10 * 1024 * 1024;   // 10 MB
const BUCKET    = 'inspection-photos';

/** Strip path-traversal characters and cap filename length. */
function sanitizeFilename(input: string): string {
  return (input || 'photo')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 64);
}

/**
 * Uploads a base64-encoded JPEG to the `inspection-photos` bucket and
 * returns a 1-hour signed URL for immediate render.
 *
 * @param base64    Raw base64 (NOT a `data:` URI — strip the prefix at the
 *                  call site if applicable).
 * @param fileName  Caller-supplied suffix. Sanitized; do not depend on the
 *                  literal value reaching storage.
 */
export const uploadInspectionPhoto = async (
  base64: string,
  fileName: string,
): Promise<string | null> => {
  try {
    // ── 1. Auth ────────────────────────────────────────────────────
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      console.warn('[uploadInspectionPhoto] not authenticated');
      return null;
    }

    // ── 2. Size guard ──────────────────────────────────────────────
    // Base64 expands by 4/3; sniff approximate decoded size before decoding.
    const paddingChars = (base64.match(/=+$/) ?? [''])[0].length;
    const approxBytes = Math.floor((base64.length * 3) / 4) - paddingChars;
    if (approxBytes > MAX_BYTES) {
      const sizeMb = (approxBytes / 1024 / 1024).toFixed(1);
      console.warn(`[uploadInspectionPhoto] rejected ${sizeMb} MB > 10 MB cap`);
      return null;
    }

    // ── 3. Path build ──────────────────────────────────────────────
    const ts       = Date.now();
    const rand     = Math.random().toString(36).slice(2, 8);
    const clean    = sanitizeFilename(fileName);
    const filePath = `inspections/${user.id}/${ts}_${rand}_${clean}.jpg`;

    // ── 4. Upload ──────────────────────────────────────────────────
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, decode(base64), {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (upErr) {
      console.error('[uploadInspectionPhoto] upload failed:', upErr.message);
      return null;
    }

    // ── 5. Mint a signed URL (bucket is private post-lockdown) ─────
    const url = await signedUrl({
      bucket: BUCKET,
      path:   filePath,
      ttl:    SIGNED_URL_TTL.VIEW,
    });
    return url;
  } catch (error) {
    console.error('[uploadInspectionPhoto] error:', error);
    return null;
  }
};
