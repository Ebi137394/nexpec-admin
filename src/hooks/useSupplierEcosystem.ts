// src/hooks/useSupplierEcosystem.ts
//
// Data + actions for the turnkey Supplier Ecosystem. Pure hooks — fed straight
// into themed lists / DynamicForm. RLS does the role shaping: useRfqs() returns
// a client's own RFQs OR (for an active supplier) the OPEN RFQs to bid on.

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

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

export function useCapabilityCatalog() {
  const [items, setItems] = useState<CapabilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    const { data } = await supabase.from('supplier_capability_catalog').select('key,label,category').eq('is_active', true).order('sort');
    setItems((data ?? []) as CapabilityOption[]); setLoading(false);
  })(); }, []);
  return { items, loading };
}

export function useScopeTemplates() {
  const [items, setItems] = useState<ScopeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    const { data } = await supabase.from('inspection_scope_templates').select('id,slug,name,category,domain').eq('is_active', true).order('domain').order('name');
    setItems((data ?? []) as ScopeTemplate[]); setLoading(false);
  })(); }, []);
  return { items, loading };
}

export function useSupplierDirectory() {
  const [items, setItems] = useState<SupplierCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('supplier_directory').select('*').order('rating_avg', { ascending: false });
    if (error) setError(error.message); else setItems((data ?? []) as SupplierCard[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, loading, error, refetch: load };
}

export function useRfqs() {
  const [items, setItems] = useState<Rfq[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('supplier_rfqs').select('*').order('created_at', { ascending: false });
    setItems((data ?? []) as Rfq[]); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, loading, refetch: load };
}

export function useRfqDetail(id?: string) {
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data: r } = await supabase.from('supplier_rfqs').select('*').eq('id', id).maybeSingle();
    const { data: q } = await supabase.from('supplier_quotes').select('*').eq('rfq_id', id).order('created_at', { ascending: true });
    setRfq((r ?? null) as Rfq | null); setQuotes((q ?? []) as Quote[]); setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  return { rfq, quotes, loading, refetch: load };
}

export function useCurrentUserId() {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null)); }, []);
  return uid;
}

// ── RPC actions ──
export const onboardSupplier = (a: { legal_name: string; capabilities: string[]; attributes?: any; lat?: number | null; lng?: number | null; country?: string | null; headline?: string | null; }) =>
  supabase.rpc('supplier_onboard', { p_legal_name: a.legal_name, p_capabilities: a.capabilities, p_attributes: a.attributes ?? {}, p_lat: a.lat ?? null, p_lng: a.lng ?? null, p_country: a.country ?? null, p_headline: a.headline ?? null });

export const createRfq = (a: { title: string; spec?: any; scope_template_id?: string | null; requires_source_inspection?: boolean; broker_mode?: string; }) =>
  supabase.rpc('create_rfq', { p_title: a.title, p_spec: a.spec ?? {}, p_scope_template_id: a.scope_template_id ?? null, p_requires_source_inspection: a.requires_source_inspection ?? true, p_broker_mode: a.broker_mode ?? 'admin' });

export const submitQuote = (rfqId: string, quote: any) => supabase.rpc('submit_quote', { p_rfq_id: rfqId, p_quote: quote });
export const awardQuote = (quoteId: string) => supabase.rpc('award_quote', { p_quote_id: quoteId });

// ════════════════════════════════════════════════════════════════════════════
//  Supplier Dashboard data
// ════════════════════════════════════════════════════════════════════════════

export interface VendorProfile {
  id: string; legal_name: string; headline: string | null; capabilities: string[];
  attributes: any; country_code: string | null; rating_avg: number; rating_count: number;
  is_active: boolean; verified: boolean;
}

// The signed-in supplier's own profile (verification + capabilities + rating).
export function useMyVendorProfile() {
  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setProfile(null); setLoading(false); return; }
    const { data } = await supabase.from('supplier_profiles').select('*').eq('id', uid).maybeSingle();
    setProfile(data ? ({ ...(data as any), verified: !!(data as any)?.verification?.verified_at } as VendorProfile) : null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { profile, loading, refetch: load };
}

export interface Opportunity extends Rfq { matched: boolean; alreadyQuoted: boolean; }

// Open RFQs the supplier can bid on (RLS rfq_supplier_browse). Flags ones that
// overlap the supplier's capability set, and ones already quoted. Matched first.
export function useOpenOpportunities() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [myCaps, setMyCaps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    let caps: string[] = [];
    const quoted = new Set<string>();
    if (uid) {
      const { data: sp } = await supabase.from('supplier_profiles').select('capabilities').eq('id', uid).maybeSingle();
      caps = ((sp as any)?.capabilities ?? []) as string[];
      const { data: q } = await supabase.from('supplier_quotes').select('rfq_id').eq('supplier_id', uid);
      ((q ?? []) as any[]).forEach((x) => quoted.add(x.rfq_id));
    }
    setMyCaps(caps);
    const { data: rfqs } = await supabase.from('supplier_rfqs').select('*').eq('status', 'open').order('created_at', { ascending: false });
    const list: Opportunity[] = ((rfqs ?? []) as Rfq[]).map((r) => {
      const need: string[] = Array.isArray((r.spec as any)?.capabilities) ? (r.spec as any).capabilities : [];
      return { ...r, matched: need.length > 0 && need.some((c) => caps.includes(c)), alreadyQuoted: quoted.has(r.id) };
    });
    list.sort((a, b) => Number(b.matched) - Number(a.matched));
    setItems(list); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, myCaps, loading, refetch: load };
}

export interface MyQuote extends Quote { rfq_title?: string; rfq_status?: string; spawned_job_id?: string | null; }

// The supplier's own quotes, enriched with the RFQ title/status (requires the
// 122300 RLS widening so quoted-but-no-longer-open RFQs remain readable).
export function useMyQuotes() {
  const [items, setItems] = useState<MyQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setItems([]); setLoading(false); return; }
    const { data: quotes } = await supabase.from('supplier_quotes').select('*').eq('supplier_id', uid).order('created_at', { ascending: false });
    const qlist = (quotes ?? []) as Quote[];
    const ids = Array.from(new Set(qlist.map((q) => q.rfq_id)));
    let rfqMap: Record<string, any> = {};
    if (ids.length) {
      const { data: rfqs } = await supabase.from('supplier_rfqs').select('id,title,status,spawned_job_id').in('id', ids);
      rfqMap = Object.fromEntries(((rfqs ?? []) as any[]).map((r) => [r.id, r]));
    }
    setItems(qlist.map((q) => ({ ...q, rfq_title: rfqMap[q.rfq_id]?.title, rfq_status: rfqMap[q.rfq_id]?.status, spawned_job_id: rfqMap[q.rfq_id]?.spawned_job_id })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, loading, refetch: load };
}
