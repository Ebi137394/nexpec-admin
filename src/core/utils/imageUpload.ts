// lib/imageUpload.ts
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/src/core/supabase/supabase';
// ★ CONSOLE-NOISE-001 Part B — `dlog` is a no-op in production
//   bundles. Replaces the ~30 debug `console.log` calls in this file
//   without dropping any of them (each still fires in dev for
//   diagnostics) and without burning the perf in production.
import { dlog } from '@/src/utils/debugLog';
// ★ NX-STORAGE-001/002/003 (Module 2 lockdown) — every non-`avatars`
//   bucket is now private. Post-upload, callers need a SIGNED URL to
//   render the image. We mint one immediately so the return shape
//   stays single-call.
import { signedUrl, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

// ─── UPLOAD-MIME-001 — Pre-flight validation constants ────────────────────
//
//   Hard limits enforced BEFORE any auth / disk read / network call.
//   Fails fast with a typed error code; callers (e.g. profile/edit avatar
//   upload, flash-report evidence upload, submit-report photos) can show
//   the user a specific message without parsing free-form error strings.
//
//   The allowlist is intentionally narrow — only camera-native formats
//   and well-supported web formats. Skipping `image/heif` and `image/heic`
//   would block iPhone default-camera uploads (HEIC); including them is
//   non-negotiable. Anything outside this set is rejected before the
//   upload starts.

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

export type UploadErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'INVALID_URI'
  | 'UNSUPPORTED_MIME'
  | 'FILE_TOO_LARGE'
  | 'STORAGE_ERROR'
  | 'UNKNOWN_ERROR';

interface UploadResult {
  success: boolean;
  /**
   * Always populated when success=true. For the `avatars` bucket this is a
   * working public URL. For every OTHER bucket (post-Module-2 lockdown) the
   * publicUrl is the storage's REST path BUT will 400 to anon callers —
   * callers should prefer `signedUrl` for immediate render and treat
   * `publicUrl` as a legacy compat field.
   */
  publicUrl?: string;
  /**
   * 1-hour signed URL minted at upload time. Render this immediately. For
   * later renders, callers should re-mint via signedUrls.signedUrl() with
   * the stored `filePath`.
   */
  signedUrl?: string;
  filePath?: string;
  error?: string;
  errorCode?: UploadErrorCode;
}

// ─── UPLOAD-MIME-001 — Source probe ───────────────────────────────────────
//
//   Resolves (mime, sizeBytes) for any supported URI shape:
//     • data:image/...;base64,…   — derived from prefix + base64 length
//     • file://…                   — FileSystem.getInfoAsync (one disk stat)
//     • http(s)://…                — HEAD request reads Content-Type +
//                                    Content-Length headers
//
//   On failure throws an Error tagged with a .code matching one of the
//   UploadErrorCode values. The caller catches once and surfaces.
//
//   This is the ONLY validation gate. Anything that doesn't return here
//   shouldn't reach the upload network call.
async function probeImageSource(
  uri: string,
): Promise<{ mime: string; sizeBytes: number }> {
  // --- data: URI ---------------------------------------------------------
  if (uri.startsWith('data:')) {
    const match = uri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      const err: any = new Error('Malformed data: URI');
      err.code = 'INVALID_URI';
      throw err;
    }
    const mime = match[1].toLowerCase();
    // base64 expands by 4/3; subtract padding for an exact figure.
    const b64 = match[2];
    const paddingChars = (b64.match(/=+$/) ?? [''])[0].length;
    const sizeBytes = Math.floor((b64.length * 3) / 4) - paddingChars;
    return { mime, sizeBytes };
  }

  // --- file:// URI -------------------------------------------------------
  if (uri.startsWith('file://')) {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists) {
      const err: any = new Error('File not found at URI');
      err.code = 'INVALID_URI';
      throw err;
    }
    const ext = (uri.split('?')[0].split('.').pop() ?? '').toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'png'                    ? 'image/png'  :
      ext === 'webp'                   ? 'image/webp' :
      ext === 'gif'                    ? 'image/gif'  :
      ext === 'heic'                   ? 'image/heic' :
      ext === 'heif'                   ? 'image/heif' :
      'application/octet-stream';
    const sizeBytes =
      typeof (info as { size?: number }).size === 'number'
        ? (info as { size: number }).size
        : 0;
    return { mime, sizeBytes };
  }

  // --- http(s) URI -------------------------------------------------------
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    let resp: Response;
    try {
      resp = await fetch(uri, { method: 'HEAD' });
    } catch (e: any) {
      const err: any = new Error(`HEAD request failed: ${e?.message ?? 'network'}`);
      err.code = 'INVALID_URI';
      throw err;
    }
    if (!resp.ok) {
      const err: any = new Error(`HEAD ${resp.status} for source URI`);
      err.code = 'INVALID_URI';
      throw err;
    }
    const mime = (resp.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase() || 'application/octet-stream';
    const sizeHeader = resp.headers.get('content-length');
    const sizeBytes = sizeHeader ? Number(sizeHeader) : NaN;
    if (!Number.isFinite(sizeBytes)) {
      const err: any = new Error('Remote source did not return Content-Length');
      err.code = 'INVALID_URI';
      throw err;
    }
    return { mime, sizeBytes };
  }

  const err: any = new Error(`Unsupported URI scheme: ${uri.slice(0, 16)}…`);
  err.code = 'INVALID_URI';
  throw err;
}

/**
 * BULLETPROOF IMAGE UPLOAD
 * Handles Base64, strips prefixes, generates clean filenames
 */
export async function uploadImageToSupabase(
  imageUri: string,
  bucketName: string = 'report-images'
): Promise<UploadResult> {
  try {
    dlog('════════════════════════════════════════');
    dlog('📤 BULLETPROOF IMAGE UPLOAD');
    dlog('Platform:', Platform.OS);
    dlog('Original URI:', imageUri);
    dlog('════════════════════════════════════════');

    // ─── UPLOAD-MIME-001 — Step 0: Pre-flight validation ──────────────
    //
    //   Runs BEFORE auth, disk read, or storage upload. Rejects with
    //   typed error codes so the caller can show the user a precise
    //   message ("File too large", "Unsupported format") without
    //   parsing strings.
    //
    //   Order matters:
    //     1. probeImageSource — surfaces INVALID_URI for malformed input.
    //     2. ALLOWED_MIME_TYPES — surfaces UNSUPPORTED_MIME.
    //     3. MAX_BYTES — surfaces FILE_TOO_LARGE.
    //
    //   Each failure returns early; nothing past this block runs on a
    //   rejected source. No network is touched, no auth call is made.
    let probed: { mime: string; sizeBytes: number };
    try {
      probed = await probeImageSource(imageUri);
    } catch (probeErr: any) {
      const code = (probeErr?.code as UploadErrorCode | undefined) ?? 'INVALID_URI';
      console.warn('🚫 Source probe failed:', probeErr?.message);
      return {
        success: false,
        error: probeErr?.message ?? 'Could not read image source.',
        errorCode: code,
      };
    }

    if (!ALLOWED_MIME_TYPES.has(probed.mime)) {
      console.warn(`🚫 MIME rejected: ${probed.mime}`);
      return {
        success: false,
        error:
          `Unsupported image format "${probed.mime}". ` +
          `Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}.`,
        errorCode: 'UNSUPPORTED_MIME',
      };
    }

    if (probed.sizeBytes > MAX_BYTES) {
      const sizeMb = (probed.sizeBytes / 1024 / 1024).toFixed(1);
      const limitMb = (MAX_BYTES / 1024 / 1024).toFixed(0);
      console.warn(`🚫 Size rejected: ${sizeMb} MB > ${limitMb} MB cap`);
      return {
        success: false,
        error:
          `Image is ${sizeMb} MB, which exceeds the ${limitMb} MB upload limit. ` +
          `Compress the image or pick a smaller one.`,
        errorCode: 'FILE_TOO_LARGE',
      };
    }

    dlog(
      `✅ Pre-flight ok, mime=${probed.mime} size=${(probed.sizeBytes / 1024).toFixed(1)} KB`,
    );

    // Step 1: Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: 'User not authenticated',
        errorCode: 'NOT_AUTHENTICATED',
      };
    }

    // ★ CONSOLE-NOISE-001(A): PII-stripped (was: user.id).
    dlog('✅ Auth resolved for upload');

    // Step 2: Use the validated MIME from the pre-flight probe — no
    // re-derivation needed. The extension is derived from the canonical
    // MIME so we don't drift between the upload Content-Type and the
    // on-disk filename.
    const contentType = probed.mime;
    const fileExtension =
      contentType === 'image/jpeg' ? 'jpg' :
      contentType === 'image/png'  ? 'png' :
      contentType === 'image/webp' ? 'webp' :
      contentType === 'image/gif'  ? 'gif' :
      contentType === 'image/heic' ? 'heic' :
      contentType === 'image/heif' ? 'heif' :
      'bin'; // unreachable after ALLOWED_MIME_TYPES check, but kept for compiler

    dlog('📄 File extension:', fileExtension);
    dlog('📄 Content-Type:', contentType);

    // Step 3: Generate clean filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 10);
    const cleanFileName = `${user.id}_${timestamp}_${randomId}.${fileExtension}`;
    const filePath = `reports/${cleanFileName}`;

    dlog('📝 Clean filename:', cleanFileName);
    dlog('📁 Full path:', filePath);

    // Step 4: Prepare upload data (Platform-specific)
    let uploadData: Blob | ArrayBuffer;

    if (Platform.OS === 'web') {
      dlog('🌐 WEB PLATFORM');
      
      if (imageUri.startsWith('data:')) {
        // CRITICAL: Strip base64 prefix using regex
        dlog('🔪 Stripping base64 prefix...');
        
        // Regex to match and remove image/...;base64,
        const base64Regex = /^data:image\/[a-zA-Z]+;base64,/;
        const base64Data = imageUri.replace(base64Regex, '');
        
        dlog('✅ Base64 prefix stripped');
        dlog('Base64 length (after strip):', base64Data.length);

        // Convert base64 to blob
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        uploadData = new Blob([byteArray], { type: contentType });

        dlog('✅ Blob created:', uploadData.size, 'bytes');
        dlog('✅ Blob type:', uploadData.type);
      } else {
        // Fetch from URI
        const response = await fetch(imageUri);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        let blob = await response.blob();
        
        // Ensure correct content type
        if (blob.type !== contentType) {
          blob = new Blob([blob], { type: contentType });
        }
        
        uploadData = blob;
        dlog('✅ Blob from fetch:', uploadData.size, 'bytes');
      }
    } else {
      dlog('📱 MOBILE PLATFORM');
      
      let base64String: string;

      if (imageUri.startsWith('data:')) {
        // CRITICAL: Strip base64 prefix using regex
        dlog('🔪 Stripping base64 prefix from data URI...');
        
        const base64Regex = /^data:image\/[a-zA-Z]+;base64,/;
        base64String = imageUri.replace(base64Regex, '');
        
        dlog('✅ Base64 prefix stripped');
      } else {
        // Read from file system
        dlog('📖 Reading from FileSystem...');
        base64String = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      dlog('✅ Base64 length:', base64String.length);

      // Decode to ArrayBuffer
      uploadData = decode(base64String);
      dlog('✅ ArrayBuffer size:', uploadData.byteLength, 'bytes');
    }

    // Step 5: Upload to Supabase
    dlog('🔼 Uploading to Supabase Storage...');
    dlog('Bucket:', bucketName);
    dlog('Path:', filePath);
    dlog('Content-Type:', contentType);

    const { data: uploadResult, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, uploadData, {
        contentType: contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      // ★ UPLOAD-MIME-001 — Typed code so callers can branch on
      //   "transient network/storage error" vs the pre-flight rejections.
      const err: any = new Error(`Upload failed: ${uploadError.message}`);
      err.code = 'STORAGE_ERROR';
      throw err;
    }

    dlog('✅ Upload successful!');
    dlog('Upload result:', uploadResult);

    // Step 6: Generate URLs. publicUrl is the legacy compat shape; signedUrl
    // is the post-lockdown render target. For the `avatars` bucket (still
    // public) both URLs are usable; for every other bucket the signedUrl is
    // what should be rendered.
    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);
    const publicUrl = urlData?.publicUrl;
    dlog('✅ Public URL:', publicUrl);

    const fresh = await signedUrl({
      bucket: bucketName,
      path:   filePath,
      ttl:    SIGNED_URL_TTL.VIEW,
    });
    dlog('✅ Signed URL (1h):', fresh ? 'minted' : 'failed');

    dlog('════════════════════════════════════════');

    return {
      success: true,
      publicUrl,
      signedUrl: fresh ?? undefined,
      filePath,
    };
  } catch (error: any) {
    console.error('💥 UPLOAD FAILED:', error);
    dlog('════════════════════════════════════════');

    // ★ UPLOAD-MIME-001 — Preserve any typed code the inner throws
    //   attached (STORAGE_ERROR from the Supabase storage step, etc.).
    //   Unknown failures fall back to UNKNOWN_ERROR so callers always
    //   get a defined errorCode field.
    const code: UploadErrorCode =
      (error?.code as UploadErrorCode | undefined) ?? 'UNKNOWN_ERROR';

    return {
      success: false,
      error: error?.message || 'Unknown error',
      errorCode: code,
    };
  }
}

