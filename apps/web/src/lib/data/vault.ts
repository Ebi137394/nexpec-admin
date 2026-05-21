// ════════════════════════════════════════════════════════════════════════════
//  lib/data/vault.ts — Compliance Vault fetcher (web)
//
//  Source-of-truth: public.client_documents (RLS — owner + admin + assigned
//  inspector). Round 1's migration added category/validity/verification
//  columns we project here.
//
//  For trust certificates we read public.trust_certificates filtered by
//  jobs the caller is involved in.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  EMPTY_VAULT_COUNTS,
  type TrustCertificate,
  type VaultCategory,
  type VaultCounts,
  type VaultDocument,
} from './vault.types';

const DOC_FIELDS = [
  'id',
  'owner_id',
  'job_id',
  'kind',
  'label',
  'category',
  'file_path',
  'external_url',
  'notes',
  'valid_from',
  'valid_until',
  'is_verified',
  'verified_by',
  'verified_at',
  'is_archived',
  'created_at',
  'updated_at',
].join(', ');

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

export async function fetchVaultDocuments(
  opts: { category?: VaultCategory; includeArchived?: boolean; limit?: number } = {},
): Promise<{ documents: VaultDocument[]; counts: VaultCounts }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { documents: [], counts: EMPTY_VAULT_COUNTS };

    let q = supabase
      .from('client_documents')
      .select(DOC_FIELDS)
      .order('updated_at', { ascending: false })
      .limit(opts.limit ?? 200);

    if (opts.category) q = q.eq('category', opts.category);
    if (!opts.includeArchived) q = q.eq('is_archived', false);

    const { data, error } = await q;
    if (error || !data) {
      if (error) console.warn('[vault] fetchVaultDocuments failed:', error.message);
      return { documents: [], counts: EMPTY_VAULT_COUNTS };
    }

    const rows = data as unknown as Array<Record<string, unknown>>;

    // Hydrate owner names + job titles
    const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id as string).filter(Boolean)));
    const jobIds = Array.from(new Set(rows.map((r) => r.job_id as string).filter(Boolean)));
    const nameById = new Map<string, string>();
    const titleByJob = new Map<string, string | null>();
    if (ownerIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ownerIds);
      (profs as Array<{ id: string; full_name: string | null; email: string | null }> | null)?.forEach((p) =>
        nameById.set(p.id, p.full_name ?? p.email ?? 'Unknown'),
      );
    }
    if (jobIds.length > 0) {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title')
        .in('id', jobIds);
      (jobs as Array<{ id: string; title: string | null }> | null)?.forEach((j) =>
        titleByJob.set(j.id, j.title),
      );
    }

    const documents: VaultDocument[] = rows.map((r) => ({
      id: String(r.id),
      ownerId: String(r.owner_id ?? ''),
      ownerName: nameById.get(String(r.owner_id ?? '')) ?? null,
      jobId: (r.job_id as string | null) ?? null,
      jobTitle: r.job_id ? titleByJob.get(String(r.job_id)) ?? null : null,
      kind: String(r.kind ?? 'other'),
      label: String(r.label ?? 'Untitled'),
      category: ((r.category as string) ?? 'other') as VaultCategory,
      filePath: (r.file_path as string | null) ?? null,
      externalUrl: (r.external_url as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      validFrom: (r.valid_from as string | null) ?? null,
      validUntil: (r.valid_until as string | null) ?? null,
      isVerified: Boolean(r.is_verified),
      verifiedBy: (r.verified_by as string | null) ?? null,
      verifiedAt: (r.verified_at as string | null) ?? null,
      isArchived: Boolean(r.is_archived),
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    }));

    // Counts — separate lightweight query so filter doesn't skew totals
    const counts = await fetchVaultCounts(opts.includeArchived ?? false);
    return { documents, counts };
  } catch (e) {
    console.warn('[vault] fetchVaultDocuments threw:', e);
    return { documents: [], counts: EMPTY_VAULT_COUNTS };
  }
}

async function fetchVaultCounts(includeArchived: boolean): Promise<VaultCounts> {
  try {
    const supabase = await createSupabaseServerClient();
    let q = supabase
      .from('client_documents')
      .select('category, is_verified, valid_until, is_archived');
    if (!includeArchived) q = q.eq('is_archived', false);
    const { data } = await q;
    if (!data) return EMPTY_VAULT_COUNTS;

    const rows = data as Array<{
      category: string;
      is_verified: boolean;
      valid_until: string | null;
      is_archived: boolean;
    }>;
    const counts: VaultCounts = {
      ...EMPTY_VAULT_COUNTS,
      byCategory: [],
    };
    const catMap = new Map<VaultCategory, number>();
    const now = Date.now();
    for (const r of rows) {
      counts.total += 1;
      if (r.is_verified) counts.verified += 1;
      else counts.unverified += 1;
      if (r.valid_until) {
        const t = new Date(r.valid_until).getTime();
        if (Number.isFinite(t)) {
          if (t < now) counts.expired += 1;
          else if (t - now < DAYS_30_MS) counts.expiringSoon += 1;
        }
      }
      const cat = (r.category ?? 'other') as VaultCategory;
      catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
    }
    counts.byCategory = Array.from(catMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
    return counts;
  } catch {
    return EMPTY_VAULT_COUNTS;
  }
}

export async function fetchVaultDocumentById(id: string): Promise<VaultDocument | null> {
  if (!id) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('client_documents')
      .select(DOC_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as unknown as Record<string, unknown>;

    let ownerName: string | null = null;
    let jobTitle: string | null = null;
    if (r.owner_id) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', r.owner_id as string)
        .maybeSingle();
      const p = prof as { full_name?: string | null; email?: string | null } | null;
      ownerName = p?.full_name ?? p?.email ?? null;
    }
    if (r.job_id) {
      const { data: job } = await supabase
        .from('jobs')
        .select('title')
        .eq('id', r.job_id as string)
        .maybeSingle();
      jobTitle = (job as { title?: string | null } | null)?.title ?? null;
    }

    return {
      id: String(r.id),
      ownerId: String(r.owner_id ?? ''),
      ownerName,
      jobId: (r.job_id as string | null) ?? null,
      jobTitle,
      kind: String(r.kind ?? 'other'),
      label: String(r.label ?? 'Untitled'),
      category: ((r.category as string) ?? 'other') as VaultCategory,
      filePath: (r.file_path as string | null) ?? null,
      externalUrl: (r.external_url as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      validFrom: (r.valid_from as string | null) ?? null,
      validUntil: (r.valid_until as string | null) ?? null,
      isVerified: Boolean(r.is_verified),
      verifiedBy: (r.verified_by as string | null) ?? null,
      verifiedAt: (r.verified_at as string | null) ?? null,
      isArchived: Boolean(r.is_archived),
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    };
  } catch (e) {
    console.warn('[vault] fetchVaultDocumentById threw:', e);
    return null;
  }
}

// ─── Signed URL generator for downloads ─────────────────────────────────
export async function getVaultSignedUrl(filePath: string): Promise<string | null> {
  if (!filePath) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.storage
      .from('client_documents')
      .createSignedUrl(filePath, 300);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

// ─── Trust certificates aggregator ──────────────────────────────────────
export async function fetchTrustCertificates(
  opts: { limit?: number } = {},
): Promise<TrustCertificate[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('trust_certificates')
      .select(
        'id, public_slug, supplier_profile_id, scope_template_id, affidavit_id, is_public_directory_listed, valid_from, valid_until, revoked_at, revoked_reason, created_at',
      )
      .order('valid_until', { ascending: false })
      .limit(opts.limit ?? 100);
    if (error || !data) {
      if (error) console.warn('[vault] fetchTrustCertificates failed:', error.message);
      return [];
    }
    const rows = data as Array<Record<string, unknown>>;
    // Hydrate supplier names + template names
    const supplierIds = Array.from(
      new Set(rows.map((r) => r.supplier_profile_id as string).filter(Boolean)),
    );
    const templateIds = Array.from(
      new Set(rows.map((r) => r.scope_template_id as string).filter(Boolean)),
    );
    const nameById = new Map<string, string>();
    const tplByID = new Map<string, string>();
    if (supplierIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, company_name, email')
        .in('id', supplierIds);
      (profs as Array<{ id: string; full_name: string | null; company_name: string | null; email: string | null }> | null)?.forEach(
        (p) => nameById.set(p.id, p.company_name ?? p.full_name ?? p.email ?? 'Supplier'),
      );
    }
    if (templateIds.length > 0) {
      const { data: tpl } = await supabase
        .from('inspection_scope_templates')
        .select('id, name')
        .in('id', templateIds);
      (tpl as Array<{ id: string; name: string }> | null)?.forEach((t) =>
        tplByID.set(t.id, t.name),
      );
    }
    return rows.map((r) => ({
      id: String(r.id),
      publicSlug: String(r.public_slug ?? ''),
      supplierProfileId: String(r.supplier_profile_id ?? ''),
      supplierName: nameById.get(String(r.supplier_profile_id ?? '')) ?? null,
      scopeTemplateId: String(r.scope_template_id ?? ''),
      scopeTemplateName: tplByID.get(String(r.scope_template_id ?? '')) ?? null,
      affidavitId: String(r.affidavit_id ?? ''),
      isPublicDirectoryListed: Boolean(r.is_public_directory_listed),
      validFrom: String(r.valid_from ?? ''),
      validUntil: String(r.valid_until ?? ''),
      revokedAt: (r.revoked_at as string | null) ?? null,
      revokedReason: (r.revoked_reason as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    }));
  } catch (e) {
    console.warn('[vault] fetchTrustCertificates threw:', e);
    return [];
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────
export function vaultRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function vaultExpiryStatus(validUntil: string | null): 'none' | 'ok' | 'soon' | 'expired' {
  if (!validUntil) return 'none';
  const t = new Date(validUntil).getTime();
  if (!Number.isFinite(t)) return 'none';
  const now = Date.now();
  if (t < now) return 'expired';
  if (t - now < DAYS_30_MS) return 'soon';
  return 'ok';
}

export function formatVaultDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
