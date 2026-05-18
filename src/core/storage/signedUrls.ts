// ════════════════════════════════════════════════════════════════════════════
//  src/core/storage/signedUrls.ts
//
//  Centralised signed-URL helpers for private storage buckets. Post-Module-2
//  lockdown, every non-`avatars` bucket is private; rendering / downloading
//  any file in those buckets requires a signed URL minted via this module.
//
//  Why centralise:
//    - One place to manage TTLs by use-case (thumb / view / download).
//    - One place to audit how long a signed URL stays alive.
//    - One place to handle the (rare) "this bucket is public so getPublicUrl
//      is fine" branch (only `avatars` qualifies post-lockdown).
//
//  Usage:
//    const url = await signedUrl({
//      bucket: 'report-images',
//      path:   'reports/abc_123_xyz.jpg',
//      ttl:    SIGNED_URL_TTL.VIEW,
//    });
//    if (url) <Image source={{ uri: url }} />;
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '@/src/core/supabase/supabase';

/** TTL presets in seconds. Tuned for the platform's UX vs leak-risk balance. */
export const SIGNED_URL_TTL = {
  /** Thumbnail render inside a list view. Cycles quickly; short TTL ok. */
  THUMB:        5 * 60,         //  5 minutes
  /** Full-screen image / PDF view from a detail screen. */
  VIEW:         60 * 60,        //  1 hour
  /** Explicit "Download" action (saves the file via share sheet). */
  DOWNLOAD:     60 * 60,        //  1 hour
  /** Embedded image inside a server-rendered HTML artifact (affidavit). */
  EMBED_HTML:   60 * 60 * 24,   //  1 day
} as const;

/**
 * `avatars` is the ONE private/public exception post-lockdown — kept public
 * for cross-user card display. Other buckets do not pass through this list.
 */
const PUBLIC_BUCKETS = new Set<string>(['avatars']);

export interface SignedUrlOptions {
  bucket: string;
  path:   string;
  /** Seconds. Use one of SIGNED_URL_TTL.* unless there's a strong reason. */
  ttl:    number;
}

/**
 * Mints a URL that the caller can render or download. For PUBLIC_BUCKETS,
 * returns the public URL directly (no token needed). For private buckets,
 * mints a signed URL with the requested TTL.
 *
 * Returns null on any failure so callers can fall back to a placeholder
 * instead of crashing the render.
 */
export async function signedUrl(opts: SignedUrlOptions): Promise<string | null> {
  const { bucket, path, ttl } = opts;
  if (!bucket || !path) return null;

  if (PUBLIC_BUCKETS.has(bucket)) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl ?? null;
  }

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, ttl);
    if (error) {
      console.warn(
        `[signedUrl] createSignedUrl failed for ${bucket}/${path}: ${error.message}`,
      );
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (e: any) {
    console.warn(`[signedUrl] exception minting URL for ${bucket}/${path}:`, e?.message);
    return null;
  }
}

/**
 * Batch variant. Returns an object keyed by input `path`. Useful for list
 * views that need N image URLs at once. Each entry is null on failure.
 */
export async function signedUrls(
  bucket: string,
  paths: string[],
  ttl: number,
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    paths.map(async (path) => [path, await signedUrl({ bucket, path, ttl })] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Convenience: derive the bucket + path from a stored full URL (post-Module-2
 * we still have legacy DB rows containing public URLs from the pre-lockdown
 * era). Returns null if the URL doesn't match the Supabase storage shape.
 */
export function parseSupabaseStorageUrl(url: string | null | undefined): {
  bucket: string;
  path:   string;
} | null {
  if (!url) return null;
  // Public URL shape:
  //   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
  // Signed URL shape:
  //   https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=…
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!m) return null;
  return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
}

/**
 * Convenience: take a legacy public URL stored in DB, re-mint it as a signed
 * URL post-lockdown. Returns the original URL untouched if parsing fails
 * (graceful degradation for non-Supabase URLs).
 */
export async function refreshAsSignedUrl(
  legacyUrl: string | null | undefined,
  ttl: number = SIGNED_URL_TTL.VIEW,
): Promise<string | null> {
  if (!legacyUrl) return null;
  const parsed = parseSupabaseStorageUrl(legacyUrl);
  if (!parsed) return legacyUrl; // not ours — leave it alone
  return await signedUrl({ bucket: parsed.bucket, path: parsed.path, ttl });
}
