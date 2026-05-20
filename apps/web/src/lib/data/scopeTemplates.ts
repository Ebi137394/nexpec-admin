// ════════════════════════════════════════════════════════════════════════════
//  lib/data/scopeTemplates.ts — list active compliance scope templates
//
//  RLS allows any authenticated user to SELECT active rows; this fetcher
//  intentionally projects only the columns the client form needs.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  CciCredentialTier,
  ScopeTemplate,
} from './scopeTemplates.types';

export type { ScopeTemplate };

// ─── Admin-side projection — includes audit + version + author fields ─────
// Returned ONLY to /admin/* surfaces. The public fetcher above stays as-is
// to preserve the camelCase shape every other consumer relies on.
export interface AdminScopeTemplate extends ScopeTemplate {
  version: number;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeTemplateCounts {
  total: number;
  active: number;
  inactive: number;
  byCategory: Array<{ category: string; count: number }>;
}

export async function fetchAdminScopeTemplates(opts: {
  activeOnly?: boolean;
  category?: string;
  limit?: number;
} = {}): Promise<AdminScopeTemplate[]> {
  try {
    const supabase = await createSupabaseServerClient();
    let q = supabase
      .from('inspection_scope_templates')
      .select(
        'id, slug, name, version, category, region, validity_months, base_price_cents, requires_credential_tier, description_md, is_active, created_by_admin_id, created_at, updated_at',
      )
      .order('updated_at', { ascending: false });

    if (opts.activeOnly) q = q.eq('is_active', true);
    if (opts.category) q = q.eq('category', opts.category);
    q = q.limit(opts.limit ?? 200);

    const { data, error } = await q;
    if (error || !data) {
      if (error) console.warn('[fetchAdminScopeTemplates] failed:', error.message);
      return [];
    }
    const rows = data as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug ?? ''),
      name: String(r.name ?? ''),
      version: typeof r.version === 'number' ? r.version : 1,
      category: String(r.category ?? ''),
      region: String(r.region ?? 'global'),
      validityMonths: typeof r.validity_months === 'number' ? r.validity_months : 12,
      basePriceCents: typeof r.base_price_cents === 'number' ? r.base_price_cents : 0,
      requiresCredentialTier:
        ((r.requires_credential_tier as string | null) ?? 'cci_basic') as CciCredentialTier,
      description: (r.description_md as string | null) ?? null,
      isActive: Boolean(r.is_active),
      createdByAdminId: (r.created_by_admin_id as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    }));
  } catch (e) {
    console.warn('[fetchAdminScopeTemplates] threw:', e);
    return [];
  }
}

export async function fetchAdminScopeTemplateCounts(): Promise<ScopeTemplateCounts> {
  try {
    const supabase = await createSupabaseServerClient();
    const [total, active, inactive, all] = await Promise.all([
      supabase.from('inspection_scope_templates').select('id', { count: 'exact', head: true }),
      supabase
        .from('inspection_scope_templates')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      supabase
        .from('inspection_scope_templates')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', false),
      supabase.from('inspection_scope_templates').select('category'),
    ]);

    const catCounts = new Map<string, number>();
    (all.data as Array<{ category: string }> | null)?.forEach((r) => {
      catCounts.set(r.category, (catCounts.get(r.category) ?? 0) + 1);
    });

    return {
      total: total.count ?? 0,
      active: active.count ?? 0,
      inactive: inactive.count ?? 0,
      byCategory: Array.from(catCounts.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
    };
  } catch (e) {
    console.warn('[fetchAdminScopeTemplateCounts] threw:', e);
    return { total: 0, active: 0, inactive: 0, byCategory: [] };
  }
}

export function formatScopeCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatScopeRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Single-template fetcher (admin detail page) ──────────────────────────
export async function fetchAdminScopeTemplateById(
  id: string,
): Promise<AdminScopeTemplate | null> {
  if (!id || typeof id !== 'string') return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inspection_scope_templates')
      .select(
        'id, slug, name, version, category, region, validity_months, base_price_cents, requires_credential_tier, description_md, is_active, created_by_admin_id, created_at, updated_at',
      )
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      if (error) console.warn('[fetchAdminScopeTemplateById] failed:', error.message);
      return null;
    }
    const r = data as Record<string, unknown>;
    return {
      id: String(r.id),
      slug: String(r.slug ?? ''),
      name: String(r.name ?? ''),
      version: typeof r.version === 'number' ? r.version : 1,
      category: String(r.category ?? ''),
      region: String(r.region ?? 'global'),
      validityMonths: typeof r.validity_months === 'number' ? r.validity_months : 12,
      basePriceCents: typeof r.base_price_cents === 'number' ? r.base_price_cents : 0,
      requiresCredentialTier:
        ((r.requires_credential_tier as string | null) ?? 'cci_basic') as CciCredentialTier,
      description: (r.description_md as string | null) ?? null,
      isActive: Boolean(r.is_active),
      createdByAdminId: (r.created_by_admin_id as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    };
  } catch (e) {
    console.warn('[fetchAdminScopeTemplateById] threw:', e);
    return null;
  }
}

// ─── Evidence requirements (read-only display on detail page) ─────────────
export interface ScopeEvidenceRequirement {
  id: string;
  templateId: string;
  sortOrder: number;
  kind: string;
  label: string;
  hint: string | null;
  required: boolean;
  minCount: number;
  maxCount: number;
}

export async function fetchEvidenceRequirementsForTemplate(
  templateId: string,
): Promise<ScopeEvidenceRequirement[]> {
  if (!templateId || typeof templateId !== 'string') return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('inspection_evidence_requirements')
      .select('id, template_id, sort_order, kind, label, hint, required, min_count, max_count')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true });

    if (error || !data) {
      if (error) console.warn('[fetchEvidenceRequirementsForTemplate] failed:', error.message);
      return [];
    }
    const rows = data as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      templateId: String(r.template_id),
      sortOrder: typeof r.sort_order === 'number' ? r.sort_order : 0,
      kind: String(r.kind ?? ''),
      label: String(r.label ?? ''),
      hint: (r.hint as string | null) ?? null,
      required: Boolean(r.required),
      minCount: typeof r.min_count === 'number' ? r.min_count : 1,
      maxCount: typeof r.max_count === 'number' ? r.max_count : 1,
    }));
  } catch (e) {
    console.warn('[fetchEvidenceRequirementsForTemplate] threw:', e);
    return [];
  }
}

export async function fetchActiveScopeTemplates(): Promise<ScopeTemplate[]> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from('inspection_scope_templates')
      .select(
        'id, slug, name, category, region, validity_months, base_price_cents, requires_credential_tier, description_md, is_active',
      )
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchActiveScopeTemplates] failed:', error.message);
      }
      return [];
    }

    const rows = data as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug ?? ''),
      name: String(r.name ?? ''),
      category: String(r.category ?? ''),
      region: String(r.region ?? 'global'),
      validityMonths:
        typeof r.validity_months === 'number' ? r.validity_months : 12,
      basePriceCents:
        typeof r.base_price_cents === 'number' ? r.base_price_cents : 0,
      requiresCredentialTier:
        ((r.requires_credential_tier as string | null) ??
          'cci_basic') as CciCredentialTier,
      description: (r.description_md as string | null) ?? null,
      isActive: Boolean(r.is_active),
    }));
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchActiveScopeTemplates] threw:', e);
    }
    return [];
  }
}
