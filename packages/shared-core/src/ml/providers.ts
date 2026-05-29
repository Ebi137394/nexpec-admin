// ════════════════════════════════════════════════════════════════════════════
//  ml/providers.ts — platform capability interfaces (dependency injection)
//
//  shared-core is pure TS and may not touch the filesystem, native crypto, or
//  React Native. So it defines the CONTRACTS for those capabilities here; each
//  platform shell supplies a concrete implementation (mobile: expo-*; web/node:
//  Web Crypto / fs). This keeps the security pipeline testable and portable.
// ════════════════════════════════════════════════════════════════════════════

import type { SignatureAlg } from './types';

/** Raw-bytes SHA-256 → lowercase hex. */
export interface HashProvider {
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

/** Asymmetric signature verification. `available()` lets the runtime fail
 *  CLOSED (refuse to load) when no verifier is wired, rather than silently
 *  trusting an unverified model. */
export interface SignatureVerifier {
  available(): boolean | Promise<boolean>;
  verify(input: {
    message: Uint8Array;
    signatureB64: string;
    publicKeyPem: string;
    alg: SignatureAlg;
  }): Promise<boolean>;
}

export interface DownloadResult {
  localUri: string;
  sizeBytes: number;
}

/** Content-addressed file cache keyed by the artifact's sha256. */
export interface ArtifactFileStore {
  /** Local uri if a file for this sha256 is already cached, else null. */
  findCached(sha256: string): Promise<string | null>;
  /** Download a remote URL to a temp location. */
  download(url: string, sha256: string): Promise<DownloadResult>;
  /** Read the raw bytes of a local uri (for hashing). */
  readBytes(localUri: string): Promise<Uint8Array>;
  /** Promote a verified temp file to the permanent cache for sha256. */
  commit(localUri: string, sha256: string): Promise<string>;
  /** Delete a temp/invalid file. Never throws. */
  discard(localUri: string): Promise<void>;
}

/** Offline-resilient cache of the last resolved manifest. */
export interface ManifestCache {
  read(key: string): Promise<unknown | null>;
  write(key: string, manifest: unknown): Promise<void>;
}
