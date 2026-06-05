// ════════════════════════════════════════════════════════════════════════════
//  lib/data/marketplace.ts — web data layer for the Supplier Ecosystem
//
//  Mirrors the mobile hooks (src/hooks/useSupplierEcosystem.ts) against the SAME
//  platform-agnostic backend — identical RPC names + params, identical RLS. The
//  only difference is the transport: the web browser Supabase client. Quote
//  amounts are integer cents, matching the mobile bulletproofing.
// ════════════════════════════════════════════════════════════════════════════
'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const sb = () => createSupabaseBrowserClient();

// ── Types (mirror of the mobile interfaces) ──
export interface CapabilityOption { key: string; label: string; category: string; }
export interface ScopeTemplate { id: string; slug: string; name: string; category: string; domain: string; }
export interface SupplierCard {
  id: string; legal_name: string; headline: string | null; capabilities: string[];
  country_code: string | null; rating_avg: number; rating_count: number; standards: any; verified: boolean;
}
export interface Rfq {
  id: string; client_id: string; title: string; spec: any; status: string; broker_mode: string;
  scope_template_id: string | null; requires_source_inspection: boolean; spawned_job_id: string | null; created_at: string;
}
export interface Quote { id: string; rfq_id: string; supplier_id: string; quote: any; status: string; created_at: string; }
export interface VendorProfile {
  id: string; legal_name: string; headline: string | null; capabilities: string[];
  attributes: any; country_code: string | null; rating_avg: number; rating_count: number; is_active: boolean; verified: boolean;
}

// ── Money (cents → USD; mirrors mobile formatUsd) ──
export const formatUsd = (cents: number | null | undefined): string =>
  ((Number(cents) || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const toCents = (dollars: number | string | null | undefined): number =>
  Math.round((Number(dollars) || 0) * 100);

// ── Identity ──
export async function getUserId(): Promise<string | null> {
  const { data } = await sb().auth.getUser();
  return data.user?.id ?? null;
}

// ── Reads ──
export async function fetchCapabilityCatalog(): Promise<CapabilityOption[]> {
  const { data } = await sb().from('supplier_capability_catalog').select('key,label,category').eq('is_active', true).order('sort');
  return (data ?? []) as CapabilityOption[];
}

export async function fetchScopeTemplates(): Promise<ScopeTemplate[]> {
  const { data } = await sb().from('inspection_scope_templates').select('id,slug,name,category,domain').eq('is_active', true).order('domain').order('name');
  return (data ?? []) as ScopeTemplate[];
}

export async function fetchSupplierDirectory(): Promise<SupplierCard[]> {
  const { data, error } = await sb().from('supplier_directory').select('*').order('rating_avg', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SupplierCard[];
}

// Single supplier from the public directory projection (anti-poaching safe —
// business-level fields only; admins + buyers see the same view).
export async function fetchSupplierById(id: string): Promise<SupplierCard | null> {
  const { data } = await sb().from('supplier_directory').select('*').eq('id', id).maybeSingle();
  return (data ?? null) as SupplierCard | null;
}

export async function fetchRfqs(): Promise<Rfq[]> {
  const { data } = await sb().from('supplier_rfqs').select('*').order('created_at', { ascending: false });
  return (data ?? []) as Rfq[];
}

export async function fetchRfqDetail(id: string): Promise<{ rfq: Rfq | null; quotes: Quote[] }> {
  const { data: r } = await sb().from('supplier_rfqs').select('*').eq('id', id).maybeSingle();
  const { data: q } = await sb().from('supplier_quotes').select('*').eq('rfq_id', id).order('created_at', { ascending: true });
  return { rfq: (r ?? null) as Rfq | null, quotes: (q ?? []) as Quote[] };
}

export async function fetchMyVendorProfile(): Promise<VendorProfile | null> {
  const uid = await getUserId();
  if (!uid) return null;
  const { data } = await sb().from('supplier_profiles').select('*').eq('id', uid).maybeSingle();
  if (!data) return null;
  return { ...(data as any), verified: !!(data as any)?.verification?.verified_at } as VendorProfile;
}

// ── RPC actions (identical signatures to mobile) ──
export const createRfq = (a: { title: string; spec?: any; scope_template_id?: string | null; requires_source_inspection?: boolean; broker_mode?: string; }) =>
  sb().rpc('create_rfq', {
    p_title: a.title, p_spec: a.spec ?? {}, p_scope_template_id: a.scope_template_id ?? null,
    p_requires_source_inspection: a.requires_source_inspection ?? true, p_broker_mode: a.broker_mode ?? 'admin',
  });

export const submitQuote = (rfqId: string, quote: any) => sb().rpc('submit_quote', { p_rfq_id: rfqId, p_quote: quote });
export const awardQuote = (quoteId: string) => sb().rpc('award_quote', { p_quote_id: quoteId });

export const onboardSupplier = (a: { legal_name: string; capabilities: string[]; attributes?: any; country?: string | null; headline?: string | null; lat?: number | null; lng?: number | null; }) =>
  sb().rpc('supplier_onboard', {
    p_legal_name: a.legal_name, p_capabilities: a.capabilities, p_attributes: a.attributes ?? {},
    p_lat: a.lat ?? null, p_lng: a.lng ?? null, p_country: a.country ?? null, p_headline: a.headline ?? null,
  });

// Seal an uploaded vendor document through the Trust Spine (Phase 1 Custody Core).
export const sealVendorDocument = (a: {
  storage_path: string; content_sha256: string; doc_type?: string; title?: string | null;
  mime_type?: string | null; byte_size?: number | null; bound_type?: string; bound_id?: string | null;
}) =>
  sb().rpc('vendor_document_seal', {
    p_storage_path: a.storage_path, p_content_sha256: a.content_sha256, p_doc_type: a.doc_type ?? 'other',
    p_title: a.title ?? null, p_mime_type: a.mime_type ?? null, p_byte_size: a.byte_size ?? null,
    p_bound_type: a.bound_type ?? 'vendor', p_bound_id: a.bound_id ?? null,
  });

export const uploadVendorFile = (path: string, file: File) =>
  sb().storage.from('vendor_documents').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });

// ── Brokered War Room (meetings) — same RPCs as mobile ──
export interface Meeting {
  id: string; job_id: string | null; rfq_id: string | null; organizer_id: string;
  title: string; provider: string; url: string; scheduled_at: string; duration_min: number; status: string;
}

export async function fetchMeetings(opts: { jobId?: string; rfqId?: string }): Promise<Meeting[]> {
  let q = sb().from('job_meetings').select('*').order('scheduled_at', { ascending: true });
  if (opts.jobId) q = q.eq('job_id', opts.jobId);
  else if (opts.rfqId) q = q.eq('rfq_id', opts.rfqId);
  const { data } = await q;
  return (data ?? []) as Meeting[];
}

export const scheduleMeeting = (a: {
  title: string; url: string; scheduled_at: string; participant_ids: string[];
  job_id?: string | null; rfq_id?: string | null; provider?: string; duration_min?: number;
}) =>
  sb().rpc('schedule_meeting', {
    p_title: a.title, p_url: a.url, p_scheduled_at: a.scheduled_at, p_participant_ids: a.participant_ids,
    p_job_id: a.job_id ?? null, p_rfq_id: a.rfq_id ?? null, p_provider: a.provider ?? 'other', p_duration_min: a.duration_min ?? 30,
  });

export const cancelMeeting = (id: string) => sb().rpc('cancel_meeting', { p_meeting_id: id });

// ── Supplier dashboard data (mirrors mobile useOpenOpportunities / useMyQuotes) ──
export interface Opportunity extends Rfq { matched: boolean; alreadyQuoted: boolean; }
export interface MyQuote extends Quote { rfq_title?: string; rfq_status?: string; spawned_job_id?: string | null; }

export async function fetchOpenOpportunities(): Promise<Opportunity[]> {
  const uid = await getUserId();
  let caps: string[] = [];
  const quoted = new Set<string>();
  if (uid) {
    const { data: sp } = await sb().from('supplier_profiles').select('capabilities').eq('id', uid).maybeSingle();
    caps = ((sp as any)?.capabilities ?? []) as string[];
    const { data: q } = await sb().from('supplier_quotes').select('rfq_id').eq('supplier_id', uid);
    ((q ?? []) as any[]).forEach((x) => quoted.add(x.rfq_id));
  }
  const { data: rfqs } = await sb().from('supplier_rfqs').select('*').eq('status', 'open').order('created_at', { ascending: false });
  const list: Opportunity[] = ((rfqs ?? []) as Rfq[]).map((r) => {
    const need: string[] = Array.isArray((r.spec as any)?.capabilities) ? (r.spec as any).capabilities : [];
    return { ...r, matched: need.length > 0 && need.some((c) => caps.includes(c)), alreadyQuoted: quoted.has(r.id) };
  });
  list.sort((a, b) => Number(b.matched) - Number(a.matched));
  return list;
}

export async function fetchMyQuotes(): Promise<MyQuote[]> {
  const uid = await getUserId();
  if (!uid) return [];
  const { data: quotes } = await sb().from('supplier_quotes').select('*').eq('supplier_id', uid).order('created_at', { ascending: false });
  const qlist = (quotes ?? []) as Quote[];
  const ids = Array.from(new Set(qlist.map((q) => q.rfq_id)));
  let rfqMap: Record<string, any> = {};
  if (ids.length) {
    const { data: rfqs } = await sb().from('supplier_rfqs').select('id,title,status,spawned_job_id').in('id', ids);
    rfqMap = Object.fromEntries(((rfqs ?? []) as any[]).map((r) => [r.id, r]));
  }
  return qlist.map((q) => ({ ...q, rfq_title: rfqMap[q.rfq_id]?.title, rfq_status: rfqMap[q.rfq_id]?.status, spawned_job_id: rfqMap[q.rfq_id]?.spawned_job_id }));
}

// ── Admin SLA Sentinel read ──
export interface OverdueReport { job_id: string; title: string; inspector_id: string; scheduled_date: string; hours_overdue: number; max_stage: number | null; }
export async function fetchOverdueReports(): Promise<OverdueReport[]> {
  const { data, error } = await sb().rpc('get_overdue_reports');
  if (error) return [];
  return (data ?? []) as OverdueReport[];
}

// ── Vendor Document Vault (read; sealing happens in DocumentField) ──
export interface VendorDocument {
  id: string; doc_type: string; title: string | null; storage_path: string;
  mime_type: string | null; byte_size: number | null; content_sha256: string;
  seal_sha256: string; ots_status: string; ots_confirmed_at: string | null;
  bound_type: string | null; status: string; expires_at: string | null; created_at: string;
}
export async function fetchMyVendorDocuments(): Promise<VendorDocument[]> {
  const uid = await getUserId();
  if (!uid) return [];
  const { data } = await sb()
    .from('vendor_documents')
    .select('id,doc_type,title,storage_path,mime_type,byte_size,content_sha256,seal_sha256,ots_status,ots_confirmed_at,bound_type,status,expires_at,created_at')
    .eq('vendor_id', uid)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  return (data ?? []) as VendorDocument[];
}
// Short-lived signed URL so a vendor can open their own sealed artifact.
export async function signVendorDocument(path: string): Promise<string | null> {
  const { data } = await sb().storage.from('vendor_documents').createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

// ── Supplier finance ledger (READ-ONLY — payouts are admin-brokered) ──
// transactions.amount is a USD dollar figure; RLS exposes only the caller's rows.
export interface SupplierTransaction {
  id: string; type: string; amount: number; description: string | null; status: string; created_at: string;
}
export async function fetchSupplierTransactions(): Promise<SupplierTransaction[]> {
  const uid = await getUserId();
  if (!uid) return [];
  const { data } = await sb()
    .from('transactions')
    .select('id,type,amount,description,status,created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []) as SupplierTransaction[];
}

// Capability catalog as a key→label map (for chips across the portal).
export async function fetchCapabilityLabelMap(): Promise<Record<string, string>> {
  const caps = await fetchCapabilityCatalog();
  return Object.fromEntries(caps.map((c) => [c.key, c.label]));
}
