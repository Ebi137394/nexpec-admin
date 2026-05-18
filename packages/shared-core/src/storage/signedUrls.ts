// ════════════════════════════════════════════════════════════════════════════
//  storage/signedUrls.ts — extracted from apps/mobile/src/core/storage/signedUrls.ts
//
//  Post-Module-2 lockdown every sensitive bucket is private. Every read in
//  the app must mint a signed URL at render time. This module is the single
//  place that knows the storage URL shape and TTL policy.
// ════════════════════════════════════════════════════════════════════════════

import { _requireCore } from '../client/createCore';

/** Time-to-live presets in seconds. Match the values used by RLS-side checks. */
export const SIGNED_URL_TTL = {
  THUMB: 5 * 60,        // 5 minutes — list thumbnails, ephemeral previews.
  VIEW: 60 * 60,        // 1 hour — open-in-app surfaces.
  DOWNLOAD: 60 * 60,    // 1 hour — save-to-disk.
  EMBED_HTML: 24 * 60 * 60, // 1 day — long-lived embeds in PDFs.
} as const;

export type SignedUrlTtl = (typeof SIGNED_URL_TTL)[keyof typeof SIGNED_URL_TTL];

export interface SignedUrlArgs {
  bucket: string;
  path: string;
  /** Seconds. */
  ttl?: number;
}

/** Mint one signed URL. Returns null on failure (logged). */
export async function signedUrl(args: SignedUrlArgs): Promise<string | null> {
  const { supabase } = _requireCore();
  const { bucket, path, ttl = SIGNED_URL_TTL.VIEW } = args;
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, ttl);
    if (error || !data?.signedUrl) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[signedUrl] failed for ${bucket}/${path}:`, error?.message);
      }
      return null;
    }
    return data.signedUrl;
  } catch (e) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[signedUrl] threw:', e);
    }
    return null;
  }
}

export interface SignedUrlsArgs {
  bucket: string;
  paths: string[];
  ttl?: number;
}

/** Batch variant for galleries. */
export async function signedUrls(
  args: SignedUrlsArgs,
): Promise<Array<{ path: string; signedUrl: string | null }>> {
  const { supabase } = _requireCore();
  const { bucket, paths, ttl = SIGNED_URL_TTL.VIEW } = args;
  if (paths.length === 0) return [];
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, ttl);
    if (error || !data) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[signedUrls] failed for ${bucket}:`, error?.message);
      }
      return paths.map((p) => ({ path: p, signedUrl: null }));
    }
    return data.map((row) => ({
      path: row.path ?? '',
      signedUrl: row.signedUrl ?? null,
    }));
  } catch (e) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[signedUrls] threw:', e);
    }
    return paths.map((p) => ({ path: p, signedUrl: null }));
  }
}

/**
 * Parse a Supabase storage URL (public OR signed) into `{ bucket, path }`.
 * Returns null for unrelated URLs.
 *
 *   https://x.supabase.co/storage/v1/object/public/<bucket>/<path>
 *   https://x.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
 *   https://x.supabase.co/storage/v1/render/image/public/<bucket>/<path>
 */
export function parseSupabaseStorageUrl(
  input: string | null | undefined,
): { bucket: string; path: string } | null {
  if (!input || typeof input !== 'string') return null;

  try {
    const url = new URL(input);
    if (!url.hostname.endsWith('.supabase.co')) return null;

    // Match every storage URL flavour Supabase emits.
    const pathname = url.pathname;
    const match = pathname.match(
      /\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
    );
    if (!match) return null;

    const bucket = decodeURIComponent(match[1] ?? '');
    const path = decodeURIComponent((match[2] ?? '').split('?')[0] ?? '');
    if (!bucket || !path) return null;

    return { bucket, path };
  } catch {
    return null;
  }
}

/**
 * Refresh any Supabase storage URL as a freshly-minted signed URL.
 * For non-Supabase URLs, returns the input unchanged.
 */
export async function refreshAsSignedUrl(
  input: string | null | undefined,
  ttl: number = SIGNED_URL_TTL.VIEW,
): Promise<string | null> {
  if (!input) return null;
  const parsed = parseSupabaseStorageUrl(input);
  if (!parsed) return input;
  return signedUrl({ ...parsed, ttl });
}
