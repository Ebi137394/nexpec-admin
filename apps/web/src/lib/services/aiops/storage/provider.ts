// ════════════════════════════════════════════════════════════════════════════
//  services/aiops/storage/provider.ts — provider-agnostic storage abstraction.
//  A new backend (S3, R2, Google Drive, …) is added by implementing this one
//  interface and registering it in the factory — callers never change.
// ════════════════════════════════════════════════════════════════════════════

export type StorageProviderKey = 'supabase' | 'gdrive' | 's3' | 'r2' | (string & {});

export interface StoredObject {
  key: string;          // provider-relative path
  size: number;
  sha256?: string | null;
  updatedAt?: string;
}

export interface SignedUrl {
  url: string;
  expiresAt: string;    // ISO
}

/** Every storage backend implements exactly this surface. */
export interface StorageProvider {
  readonly key: StorageProviderKey;
  /** Time-limited download URL (used by dashboards + export delivery). */
  getDownloadUrl(path: string, ttlSeconds?: number): Promise<SignedUrl>;
  /** Time-limited upload target (browser/mobile uploads directly to storage). */
  getUploadUrl(path: string, contentType: string, ttlSeconds?: number): Promise<SignedUrl>;
  /** Object metadata (size/sha) for integrity + quota accounting. */
  stat(path: string): Promise<StoredObject | null>;
  /** List a prefix (pagination via cursor when the backend supports it). */
  list(prefix: string, limit?: number): Promise<StoredObject[]>;
  /** Remove an object (soft policies live above this in the service). */
  remove(path: string): Promise<void>;
}

/** Non-secret provider config row shape (mirrors ai_storage_providers). */
export interface ProviderConfigRow {
  key: string;
  display_name: string;
  kind: 'supabase' | 'gdrive' | 's3-compatible';
  config: Record<string, unknown>;
  enabled: boolean;
  is_default: boolean;
}
