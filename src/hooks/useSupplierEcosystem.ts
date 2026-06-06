// src/hooks/useSupplierEcosystem.ts
//
// Data + actions for the turnkey Supplier Ecosystem. Pure hooks — fed straight
// into themed lists / DynamicForm. RLS does the role shaping: useRfqs() returns
// a client's own RFQs OR (for an active supplier) the OPEN RFQs to bid on.

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toCents } from '../core/utils/money';

export interface CapabilityOption { key: string; label: string; category: string; }
export interface ScopeTemplate { id: string; slug: string; name: string; category: string; domain: string; }
export interface SupplierCard {
  // legal_name / headline are no longer emitted by the anonymized supplier_directory
  // view (anti-poaching). Optional for back-compat; UI derives an NX- handle from id.
  id: string; legal_name?: string | null; headline?: string | null; capabilities: string[];
  country_code: string | null; rating_avg: number; rating_count: number; standards: any; verified: boolean;
}
export interface Rfq {
  id: string; client_id: string; title: string; spec: any; status: string; broker_mode: string;
  scope_template_id: string | null; requires_source_inspection: boolean; spawned_job_id: string | null; created_at: string;
}
export interface Quote { id: string; rfq_id: string; supplier_id: string; quote: any; status: string; created_at: string; }
// Client-facing offer (rfq_client_offers_view) — marked-up price + NX- handle ONLY.
// The raw supplier price / amount / supplier_id are NOT present (price-blindness).
export interface ClientOffer {
  id: string; rfq_id: string; price_cents: number | null; status: string;
  presented_at: string | null; created_at: string; lead_time: string | null; supplier_handle: string | null;
}

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

// Role-aware: the CLIENT (owner) reads ONLY rfq_client_offers_view (marked-up
// offers — raw price is unreachable by RLS); a SUPPLIER reads their OWN bid.
export function useRfqDetail(id?: string) {
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [offers, setOffers] = useState<ClientOffer[]>([]);
  const [myQuote, setMyQuote] = useState<Quote | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const myId = u.user?.id ?? null;
    const { data: r } = await supabase.from('supplier_rfqs').select('*').eq('id', id).maybeSingle();
    const rr = (r ?? null) as Rfq | null;
    setUid(myId); setRfq(rr);
    const owner = !!myId && !!rr && myId === rr.client_id;
    if (owner) {
      const { data: o } = await supabase.from('rfq_client_offers_view').select('*').eq('rfq_id', id).order('created_at', { ascending: true });
      setOffers((o ?? []) as ClientOffer[]); setMyQuote(null);
    } else if (myId) {
      const { data: mq } = await supabase.from('supplier_quotes').select('*').eq('rfq_id', id).eq('supplier_id', myId).maybeSingle();
      setMyQuote((mq ?? null) as Quote | null); setOffers([]);
    } else {
      setMyQuote(null); setOffers([]);
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const isOwner = !!uid && !!rfq && uid === rfq.client_id;
  return { rfq, offers, myQuote, isOwner, uid, loading, refetch: load };
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

// ── Brokered Deal (P1/P2): Award & dispatch → Review & sign client_supply → escrow ──
export interface ClientAgreement {
  id: string; deal_id: string; body_md: string | null; amount_cents: number;
  currency: string; status: string; content_sha256: string | null;
}
export const awardAndDispatch = (quoteId: string) => supabase.rpc('award_and_dispatch', { p_quote_id: quoteId });
export async function fetchClientAgreement(dealId: string): Promise<ClientAgreement | null> {
  const { data } = await supabase
    .from('agreements')
    .select('id, deal_id, body_md, amount_cents, currency, status, content_sha256')
    .eq('deal_id', dealId).eq('kind', 'client_supply')
    .order('version', { ascending: false }).limit(1).maybeSingle();
  return (data ?? null) as ClientAgreement | null;
}
export const signAgreement = (agreementId: string, signedName: string) =>
  supabase.rpc('sign_agreement', { p_agreement_id: agreementId, p_signed_name: signedName });

// ── P3/P4: trust artifacts (A/B/C) + review gate (D) + tiered (E) + identity escrow (F) ──
export interface TrustDossier { kind: string; handle: string; competencies: string[]; certifications: string[]; region: string | null; scope: string | null; redacted_cv: string | null; }
export interface TrustCertificate { kind: string; statement: string; eo_policy_ref: string; verify_path: string; }
export interface TrustIndependence { kind: string; supplier_handle: string | null; statement: string; }
export interface AssignedInspector {
  deal_id: string; handle: string;
  dossier: TrustDossier | null; certificate: TrustCertificate | null; independence: TrustIndependence | null;
  artifacts_seal_id: string | null;
  client_review: 'pending' | 'approved' | 'objected' | 'auto_approved';
  review_deadline: string | null; engagement_status: string; transparency_tier: string;
  report_confirmed_at: string | null;
  inspector_legal_name: string | null; inspector_signature: string | null; // F: NULL until report admin-confirmed
}
// Client reads the anonymized, identity-escrowed view (never the base meta row).
export async function fetchAssignedInspector(dealId: string): Promise<AssignedInspector | null> {
  const { data } = await supabase.from('client_assigned_inspector_view').select('*').eq('deal_id', dealId).maybeSingle();
  return (data ?? null) as AssignedInspector | null;
}
// D: client approves or objects to the assigned inspector.
export const clientReviewEngagement = (dealId: string, decision: 'approved' | 'objected', reason?: string) =>
  supabase.rpc('client_review_engagement', { p_deal_id: dealId, p_decision: decision, p_reason: reason ?? null });

// Generic agreement (a counterparty's OWN leg) for /agreements + /agreements/[id]/sign.
export interface MyAgreement { id: string; deal_id: string; kind: string; status: string; amount_cents: number; currency: string; body_md?: string | null; }
export async function fetchMyAgreements(): Promise<MyAgreement[]> {
  const { data } = await supabase.from('agreements').select('id, deal_id, kind, status, amount_cents, currency').order('kind');
  return (data ?? []) as MyAgreement[];
}
export async function fetchAgreement(agreementId: string): Promise<MyAgreement | null> {
  const { data } = await supabase.from('agreements')
    .select('id, deal_id, kind, status, amount_cents, currency, body_md').eq('id', agreementId).maybeSingle();
  return (data ?? null) as MyAgreement | null;
}

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

// ════════════════════════════════════════════════════════════════════════════
//  Vendor Document Vault (read)
// ════════════════════════════════════════════════════════════════════════════
export interface VendorDocument {
  id: string; doc_type: string; title: string | null; storage_path: string;
  mime_type: string | null; byte_size: number | null; content_sha256: string;
  seal_sha256: string; ots_status: string; ots_confirmed_at: string | null;
  bound_type: string | null; status: string; expires_at: string | null; created_at: string;
}
export function useMyVendorDocuments() {
  const [items, setItems] = useState<VendorDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setItems([]); setLoading(false); return; }
    const { data } = await supabase
      .from('vendor_documents')
      .select('id,doc_type,title,storage_path,mime_type,byte_size,content_sha256,seal_sha256,ots_status,ots_confirmed_at,bound_type,status,expires_at,created_at')
      .eq('vendor_id', uid).eq('status', 'active').order('created_at', { ascending: false });
    setItems((data ?? []) as VendorDocument[]); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, loading, refetch: load };
}
export async function signVendorDocument(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('vendor_documents').createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
//  Advanced Supplier Finance — READ-ONLY analytics (mirror of web engine).
//  No mutable balance — payouts are admin-brokered. Derived from accepted quotes
//  (contracted value), live bids (pipeline) and the transactions ledger.
// ════════════════════════════════════════════════════════════════════════════
export interface SupplierTransaction { id: string; type: string; amount: number; description: string | null; status: string; created_at: string; }
export interface FinanceMonth { key: string; label: string; awardedCents: number; receivedCents: number; }
export interface AwardedContract { id: string; rfq_id: string; title: string; amountCents: number; dispatched: boolean; created_at: string; }
export interface SupplierFinance {
  contractedCents: number; inBidCents: number; receivedCents: number; pendingCents: number; outstandingCents: number;
  wonCount: number; activeCount: number; lostCount: number; bidCount: number;
  winRate: number | null; avgAwardCents: number | null;
  funnel: { submitted: number; shortlisted: number; awarded: number };
  months: FinanceMonth[]; awardedContracts: AwardedContract[]; transactions: SupplierTransaction[];
}
const POSITIVE_TX = new Set(['earning', 'deposit', 'refund', 'payout']);
const qCents = (q: MyQuote): number => q.quote?.amount_cents ?? (q.quote?.amount != null ? toCents(q.quote.amount) : 0);

export function computeSupplierFinance(quotes: MyQuote[], txns: SupplierTransaction[]): SupplierFinance {
  const accepted = quotes.filter((q) => q.status === 'accepted');
  const active = quotes.filter((q) => q.status === 'submitted' || q.status === 'shortlisted');
  const lost = quotes.filter((q) => q.status === 'declined');
  const contractedCents = accepted.reduce((s, q) => s + qCents(q), 0);
  const inBidCents = active.reduce((s, q) => s + qCents(q), 0);
  let receivedCents = 0, pendingCents = 0;
  for (const t of txns) {
    const c = toCents(Math.abs(t.amount));
    if (t.status === 'pending' || t.status === 'processing') pendingCents += c;
    else if (t.status === 'completed' && POSITIVE_TX.has(t.type)) receivedCents += c;
  }
  const wonCount = accepted.length, lostCount = lost.length;
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;
  const now = new Date();
  const months: FinanceMonth[] = [];
  const idx = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    idx.set(key, months.length);
    months.push({ key, label: d.toLocaleDateString('en-US', { month: 'short' }), awardedCents: 0, receivedCents: 0 });
  }
  const bucket = (iso: string): FinanceMonth | null => {
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return null;
    const i = idx.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    return i == null ? null : months[i]!;
  };
  for (const q of accepted) { const m = bucket(q.created_at); if (m) m.awardedCents += qCents(q); }
  for (const t of txns) { if (t.status === 'completed' && POSITIVE_TX.has(t.type)) { const m = bucket(t.created_at); if (m) m.receivedCents += toCents(Math.abs(t.amount)); } }
  return {
    contractedCents, inBidCents, receivedCents, pendingCents,
    outstandingCents: Math.max(contractedCents - receivedCents, 0),
    wonCount, activeCount: active.length, lostCount, bidCount: quotes.length,
    winRate, avgAwardCents: wonCount > 0 ? Math.round(contractedCents / wonCount) : null,
    funnel: { submitted: quotes.length, shortlisted: quotes.filter((q) => q.status === 'shortlisted' || q.status === 'accepted').length, awarded: wonCount },
    months,
    awardedContracts: accepted.map((q) => ({ id: q.id, rfq_id: q.rfq_id, title: q.rfq_title || 'Awarded contract', amountCents: qCents(q), dispatched: !!q.spawned_job_id, created_at: q.created_at })),
    transactions: txns,
  };
}

// ── Supplier wallet / Stripe Connect payouts (mirror inspector wallet) ──
export interface SupplierWallet { availableCents: number; connectStatus: string; payoutsEnabled: boolean; }
export function useSupplierWallet() {
  const [data, setData] = useState<SupplierWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setData(null); setLoading(false); return; }
    const [{ data: e }, { data: p }] = await Promise.all([
      supabase.from('supplier_earnings').select('available_balance_halalas').eq('supplier_id', uid).maybeSingle(),
      supabase.from('profiles').select('stripe_connect_status, stripe_connect_payouts_enabled').eq('id', uid).maybeSingle(),
    ]);
    setData({
      availableCents: Number((e as any)?.available_balance_halalas ?? 0),
      connectStatus: ((p as any)?.stripe_connect_status ?? 'not_connected') as string,
      payoutsEnabled: !!(p as any)?.stripe_connect_payouts_enabled,
    });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { data, loading, refetch: load };
}
export async function startSupplierConnectOnboarding(): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id; if (!uid) return null;
  const { data, error } = await supabase.functions.invoke('create-stripe-connect-link', { body: { user_id: uid } });
  if (error) return null;
  return (data as any)?.url ?? null;
}
export async function supplierWithdraw(amountCents: number): Promise<{ ok: boolean; error?: string }> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id; if (!uid) return { ok: false, error: 'Not signed in.' };
  const { error } = await supabase.functions.invoke('create-supplier-payout', { body: { user_id: uid, amount_cents: amountCents } });
  if (error) {
    let msg = (error as any).message ?? 'Payout failed';
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep */ }
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export function useSupplierFinance() {
  const [data, setData] = useState<SupplierFinance | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) { setData(null); setLoading(false); return; }
    const [{ data: quotes }, { data: txns }] = await Promise.all([
      supabase.from('supplier_quotes').select('*').eq('supplier_id', uid).order('created_at', { ascending: false }),
      supabase.from('transactions').select('id,type,amount,description,status,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
    ]);
    const qlist = (quotes ?? []) as Quote[];
    const ids = Array.from(new Set(qlist.map((q) => q.rfq_id)));
    let rfqMap: Record<string, any> = {};
    if (ids.length) {
      const { data: rfqs } = await supabase.from('supplier_rfqs').select('id,title,status,spawned_job_id').in('id', ids);
      rfqMap = Object.fromEntries(((rfqs ?? []) as any[]).map((r) => [r.id, r]));
    }
    const enriched: MyQuote[] = qlist.map((q) => ({ ...q, rfq_title: rfqMap[q.rfq_id]?.title, rfq_status: rfqMap[q.rfq_id]?.status, spawned_job_id: rfqMap[q.rfq_id]?.spawned_job_id }));
    setData(computeSupplierFinance(enriched, (txns ?? []) as SupplierTransaction[]));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { data, loading, refetch: load };
}
