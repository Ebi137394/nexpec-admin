// ════════════════════════════════════════════════════════════════════════════
//  src/core/utils/storage.ts
//
//  Legacy entry point preserved for backward compat. The real implementation
//  is src/core/utils/imageUpload.ts (the MIME-validating, size-capping,
//  signed-URL-minting helper). This file re-exports that function so
//  existing imports continue to resolve.
//
//  Why this file exists:
//    - Multiple callers in the codebase import from
//      '@/src/core/utils/storage'. Renaming or deleting would force a
//      large UI sweep right before launch. The shim keeps the import
//      surface stable while consolidating the runtime behaviour onto
//      one hardened helper.
//
//  Strike: NX-STORAGE-005 closure. The previous body of this file was a
//  pre-MIME-validation upload routine that silently relabeled HEIC as
//  JPEG (sending wrong bytes for the declared Content-Type) and had no
//  size cap. Re-pointing to imageUpload.ts inherits its full pre-flight
//  validation, signed-URL return, and PII-stripped logging.
// ════════════════════════════════════════════════════════════════════════════

export {
  uploadImageToSupabase,
  type UploadErrorCode,
} from './imageUpload';
