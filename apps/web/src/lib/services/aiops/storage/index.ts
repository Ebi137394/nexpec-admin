// ════════════════════════════════════════════════════════════════════════════
//  services/aiops/storage/index.ts — Supabase-backed provider + factory.
//  The default provider is Supabase Storage; S3/R2/Google Drive plug in by
//  implementing StorageProvider and being returned from getStorageProvider()
//  — no caller changes. Non-secret config lives in ai_storage_providers.
// ════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider, StorageProviderKey, StoredObject, SignedUrl, ProviderConfigRow } from './provider';

export * from './provider';

/** Supabase Storage implementation (production default). */
export class SupabaseStorageProvider implements StorageProvider {
  readonly key: StorageProviderKey = 'supabase';
  constructor(private sb: SupabaseClient, private bucket = 'ai-dataset') {}

  async getDownloadUrl(path: string, ttlSeconds = 3600): Promise<SignedUrl> {
    const { data, error } = await this.sb.storage.from(this.bucket).createSignedUrl(path, ttlSeconds);
    if (error || !data) throw new Error(`storage.download: ${error?.message ?? 'no url'}`);
    return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
  }
  async getUploadUrl(path: string, _contentType: string, ttlSeconds = 3600): Promise<SignedUrl> {
    const { data, error } = await this.sb.storage.from(this.bucket).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`storage.upload: ${error?.message ?? 'no url'}`);
    return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
  }
  async stat(path: string): Promise<StoredObject | null> {
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const { data, error } = await this.sb.storage.from(this.bucket).list(dir, { search: name, limit: 1 });
    const o = data?.[0];
    if (error || !o) return null;
    return { key: path, size: (o.metadata?.size as number) ?? 0, updatedAt: o.updated_at ?? undefined };
  }
  async list(prefix: string, limit = 100): Promise<StoredObject[]> {
    const { data, error } = await this.sb.storage.from(this.bucket).list(prefix, { limit });
    if (error) throw new Error(`storage.list: ${error.message}`);
    return (data ?? []).map((o) => ({
      key: prefix ? `${prefix}/${o.name}` : o.name,
      size: (o.metadata?.size as number) ?? 0,
      updatedAt: o.updated_at ?? undefined,
    }));
  }
  async remove(path: string): Promise<void> {
    const { error } = await this.sb.storage.from(this.bucket).remove([path]);
    if (error) throw new Error(`storage.remove: ${error.message}`);
  }
}

/** External providers require server-side credentials (a signing worker); until
 *  wired they fail loudly rather than silently mis-storing dataset bytes. */
class UnconfiguredProvider implements StorageProvider {
  constructor(readonly key: StorageProviderKey, private kind: string) {}
  private fail(): never { throw new Error(`AI_OPS_STORAGE_UNCONFIGURED: '${this.key}' (${this.kind}) needs a server credential worker`); }
  getDownloadUrl(): Promise<SignedUrl> { this.fail(); }
  getUploadUrl(): Promise<SignedUrl> { this.fail(); }
  stat(): Promise<StoredObject | null> { this.fail(); }
  list(): Promise<StoredObject[]> { this.fail(); }
  remove(): Promise<void> { this.fail(); }
}

/** Resolve the active provider from ai_storage_providers (default = Supabase). */
export async function getStorageProvider(sb: SupabaseClient, key?: StorageProviderKey): Promise<StorageProvider> {
  const { data } = await sb.from('ai_storage_providers').select('*');
  const rows = (data ?? []) as ProviderConfigRow[];
  const row = key ? rows.find((r) => r.key === key) : (rows.find((r) => r.is_default) ?? rows.find((r) => r.key === 'supabase'));
  if (!row || row.kind === 'supabase') {
    return new SupabaseStorageProvider(sb, (row?.config?.bucket as string) ?? 'ai-dataset');
  }
  // s3-compatible (S3/R2) + gdrive → pluggable; return the loud stub until the
  // credentialed worker is added (one class each, same interface).
  return new UnconfiguredProvider(row.key, row.kind);
}
