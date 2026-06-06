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
  // legal_name / headline are NO LONGER emitted by the anonymized supplier_directory
  // view (anti-poaching). Kept optional only for back-compat; UI derives an NX-
  // handle + Trust Sigil from `id` instead.
  id: string; legal_name?: string | null; headline?: string | null; capabilities: string[];
  country_code: string | null; rating_avg: number; rating_count: number; standards: any; verified: boolean;
}
export interface Rfq {
  id: string; client_id: string; title: string; spec: any; status: string; broker_mode: string;
  scope_template_id: string | null; requires_source_inspection: boolean; spawned_job_id: string | null; created_at: string;
}
export interface Quote { id: string; rfq_id: string; supplier_id: string; quote: any; status: string; created_at: string; }
// Client-facing offer — projected from rfq_client_offers_view. Carries ONLY the
// admin-set marked-up price + an anonymized NX- handle. The raw supplier price,
// amount, and supplier_id are NOT present (price-blindness / anti-poaching).
export interface ClientOffer {
  id: string; rfq_id: string; price_cents: number | null; status: string;
  presented_at: string | null; created_at: string; lead_time: string | null; supplier_handle: string | null;
}
// Admin-only raw quote view (admin sees cost + supplier identity + margin).
export interface AdminQuote {
  id: string; rfq_id: string; supplier_id: string; supplier_name: string | null;
  quote: any; status: string; client_price_cents: number | null; created_at: string;
}
export interface AdminRfqRow extends Rfq { quote_count: number; presented_count: number; }
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

export async function fetchRfq(id: string): Promise<Rfq | null> {
  const { data } = await sb().from('supplier_rfqs').select('*').eq('id', id).maybeSingle();
  return (data ?? null) as Rfq | null;
}

// Back-compat: rfq + the caller's RLS-accessible quotes. A supplier sees only
// their OWN quote; a client now gets NONE (raw quotes are unreachable post-armor).
// Used by the supplier opportunities detail page.
export async function fetchRfqDetail(id: string): Promise<{ rfq: Rfq | null; quotes: Quote[] }> {
  const { data: r } = await sb().from('supplier_rfqs').select('*').eq('id', id).maybeSingle();
  const { data: q } = await sb().from('supplier_quotes').select('*').eq('rfq_id', id).order('created_at', { ascending: true });
  return { rfq: (r ?? null) as Rfq | null, quotes: (q ?? []) as Quote[] };
}

// CLIENT path — curated, marked-up offers only (raw supplier price is unreachable
// by RLS; this view never exposes it). Use this for the RFQ owner.
export async function fetchClientOffers(rfqId: string): Promise<ClientOffer[]> {
  const { data } = await sb().from('rfq_client_offers_view').select('*').eq('rfq_id', rfqId).order('created_at', { ascending: true });
  return (data ?? []) as ClientOffer[];
}

// SUPPLIER path — the caller's OWN quote (their own bid; RLS scopes to self).
export async function fetchMyQuote(rfqId: string): Promise<Quote | null> {
  const uid = await getUserId();
  if (!uid) return null;
  const { data } = await sb().from('supplier_quotes').select('*').eq('rfq_id', rfqId).eq('supplier_id', uid).maybeSingle();
  return (data ?? null) as Quote | null;
}

// ADMIN path — raw quotes + supplier identity + the markup state (admin RLS).
export async function fetchAdminRfqs(): Promise<AdminRfqRow[]> {
  const { data: rfqs } = await sb().from('supplier_rfqs').select('*').order('created_at', { ascending: false });
  const list = (rfqs ?? []) as Rfq[];
  if (list.length === 0) return [];
  const { data: q } = await sb().from('supplier_quotes').select('rfq_id, status');
  const counts = new Map<string, { total: number; presented: number }>();
  for (const row of (q ?? []) as Array<{ rfq_id: string; status: string }>) {
    const c = counts.get(row.rfq_id) ?? { total: 0, presented: 0 };
    c.total += 1; if (row.status === 'presented') c.presented += 1;
    counts.set(row.rfq_id, c);
  }
  return list.map((r) => ({ ...r, quote_count: counts.get(r.id)?.total ?? 0, presented_count: counts.get(r.id)?.presented ?? 0 }));
}

export async function fetchAdminRfqQuotes(rfqId: string): Promise<{ rfq: Rfq | null; quotes: AdminQuote[] }> {
  const { data: r } = await sb().from('supplier_rfqs').select('*').eq('id', rfqId).maybeSingle();
  // Wide select (post-markup-migration). If client_price_cents isn't present yet —
  // migration not applied, or PostgREST schema cache stale — fall back to a narrow
  // select so the admin can ALWAYS see the raw supplier quotes (never blank).
  type AdminRow = Omit<AdminQuote, 'supplier_name'>;
  let rows: AdminRow[] = [];
  const wide = await sb().from('supplier_quotes')
    .select('id, rfq_id, supplier_id, quote, status, client_price_cents, created_at')
    .eq('rfq_id', rfqId).order('created_at', { ascending: true });
  if (!wide.error && wide.data) {
    rows = wide.data as AdminRow[];
  } else {
    const narrow = await sb().from('supplier_quotes')
      .select('id, rfq_id, supplier_id, quote, status, created_at')
      .eq('rfq_id', rfqId).order('created_at', { ascending: true });
    rows = ((narrow.data ?? []) as Array<Omit<AdminRow, 'client_price_cents'>>).map((x) => ({ ...x, client_price_cents: null }));
  }
  const ids = Array.from(new Set(rows.map((x) => x.supplier_id)));
  const nameMap = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await sb().from('supplier_profiles').select('id, legal_name').in('id', ids);
    for (const p of (profs ?? []) as Array<{ id: string; legal_name: string }>) nameMap.set(p.id, p.legal_name);
  }
  return {
    rfq: (r ?? null) as Rfq | null,
    quotes: rows.map((x) => ({ ...x, supplier_name: nameMap.get(x.supplier_id) ?? null })),
  };
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

// ── Brokered Deal (P1): Award & dispatch → Review & sign client_supply → escrow ──
export interface ClientAgreement {
  id: string; deal_id: string; body_md: string | null; amount_cents: number;
  currency: string; status: string; content_sha256: string | null;
}
// Creates the deal + a presented client_supply agreement; returns { deal_id, client_agreement_id }.
export const awardAndDispatch = (quoteId: string) =>
  sb().rpc('award_and_dispatch', { p_quote_id: quoteId });

// The client's own client_supply leg (RLS: counterparty_id = the client).
export async function fetchClientAgreement(dealId: string): Promise<ClientAgreement | null> {
  const { data } = await sb()
    .from('agreements')
    .select('id, deal_id, body_md, amount_cents, currency, status, content_sha256')
    .eq('deal_id', dealId).eq('kind', 'client_supply')
    .order('version', { ascending: false }).limit(1).maybeSingle();
  return (data ?? null) as ClientAgreement | null;
}

// Signs the agreement → on client_supply this executes it + HOLDS escrow + dispatches.
export const signAgreement = (agreementId: string, signedName: string) =>
  sb().rpc('sign_agreement', { p_agreement_id: agreementId, p_signed_name: signedName });

// ── Admin: Brokered Deal control (P2) — wire legs + per-leg release gates ──
export interface DealRow {
  id: string; rfq_id: string | null; job_id: string | null; status: string;
  client_price_cents: number; currency: string; goods_accepted_at: string | null;
}
export interface DealAgreement { id: string; kind: string; status: string; counterparty_id: string; amount_cents: number; currency: string; }
export interface MoneyLeg { id: string; kind: string; status: string; amount_cents: number; }

export async function fetchDealByRfq(rfqId: string): Promise<DealRow | null> {
  const { data } = await sb().from('deals')
    .select('id, rfq_id, job_id, status, client_price_cents, currency, goods_accepted_at')
    .eq('rfq_id', rfqId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data ?? null) as DealRow | null;
}
export async function fetchDealAgreements(dealId: string): Promise<DealAgreement[]> {
  const { data } = await sb().from('agreements')
    .select('id, kind, status, counterparty_id, amount_cents, currency').eq('deal_id', dealId).order('kind');
  return (data ?? []) as DealAgreement[];
}
export async function fetchDealMoneyLegs(dealId: string): Promise<MoneyLeg[]> {
  const { data } = await sb().from('deal_money_legs').select('id, kind, status, amount_cents').eq('deal_id', dealId).order('kind');
  return (data ?? []) as MoneyLeg[];
}
export const assignInspector = (dealId: string, inspectorId: string, payoutCents: number) =>
  sb().rpc('admin_assign_inspector', { p_deal_id: dealId, p_inspector_id: inspectorId, p_payout_cents: payoutCents });
export const presentAgreement = (agreementId: string) => sb().rpc('admin_present_agreement', { p_agreement_id: agreementId });
export const acceptGoods = (dealId: string) => sb().rpc('admin_accept_goods', { p_deal_id: dealId });
export const releaseSupplierPayout = (dealId: string) => sb().rpc('release_supplier_payout', { p_deal_id: dealId });
export const releaseInspectorPayout = (dealId: string) => sb().rpc('release_inspector_payout', { p_deal_id: dealId });
// ADMIN: set the client-facing marked-up price and release the offer to the client.
export const presentQuote = (quoteId: string, clientPriceCents: number, note?: string) =>
  sb().rpc('admin_present_quote', { p_quote_id: quoteId, p_client_price_cents: clientPriceCents, p_admin_note: note ?? null });

export const onboardSupplier = (a: { legal_name: string; capabilities: string[]; attributes?: any; country?: string | null; headline?: string | null; lat?: number | null; lng?: number | null; }) =>
  sb().rpc('supplier_onboard', {
    p_legal_name: a.legal_name, p_capabilities: a.capabilities, p_attributes: a.attributes ?? {},
    p_lat: a.lat ?? null, p_lng: a.lng ?? null, p_country: a.country ?? null, p_headline: a.headline ?? null,
  });

// ── P3/P4: trust artifacts (A/B/C) + review gate (D) + tiered (E) + identity escrow (F) ──
export interface TrustDossier { kind: string; handle: string; competencies: string[]; certifications: string[]; region: string | null; scope: string | null; redacted_cv: string | null; }
export interface TrustCertificate { kind: string; statement: string; eo_policy_ref: string; verify_path: string; }
export interface TrustIndependence { kind: string; supplier_handle: string | null; statement: string; }
export interface AssignedInspector {
  deal_id: string;
  handle: string;
  dossier: TrustDossier | null;
  certificate: TrustCertificate | null;
  independence: TrustIndependence | null;
  artifacts_seal_id: string | null;
  client_review: 'pending' | 'approved' | 'objected' | 'auto_approved';
  review_deadline: string | null;
  engagement_status: string;
  transparency_tier: string;
  report_confirmed_at: string | null;
  inspector_legal_name: string | null;   // F: NULL until the final report is admin-confirmed
  inspector_signature: string | null;
}
// Client reads the anonymized, identity-escrowed view (never the base meta row).
export async function fetchAssignedInspector(dealId: string): Promise<AssignedInspector | null> {
  const { data } = await sb().from('client_assigned_inspector_view').select('*').eq('deal_id', dealId).maybeSingle();
  return (data ?? null) as AssignedInspector | null;
}
// D: client approves or objects to the assigned inspector.
export const clientReviewEngagement = (dealId: string, decision: 'approved' | 'objected', reason?: string) =>
  sb().rpc('client_review_engagement', { p_deal_id: dealId, p_decision: decision, p_reason: reason ?? null });

// Generic agreement (a counterparty's OWN leg) for /agreements + /agreements/[id]/sign.
// RLS scopes rows to counterparty_id = auth.uid() (or admin), so each party sees only theirs.
export interface MyAgreement { id: string; deal_id: string; kind: string; status: string; amount_cents: number; currency: string; }
export async function fetchMyAgreements(): Promise<MyAgreement[]> {
  const { data } = await sb().from('agreements')
    .select('id, deal_id, kind, status, amount_cents, currency').order('kind');
  return (data ?? []) as MyAgreement[];
}
export async function fetchAgreement(agreementId: string): Promise<(MyAgreement & { body_md: string | null }) | null> {
  const { data } = await sb().from('agreements')
    .select('id, deal_id, kind, status, amount_cents, currency, body_md').eq('id', agreementId).maybeSingle();
  return (data ?? null) as (MyAgreement & { body_md: string | null }) | null;
}

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

// ════════════════════════════════════════════════════════════════════════════
//  Advanced Supplier Finance — analytics engine (READ-ONLY, derived from real
//  rows). NEVER mutates a balance (the platform money model is admin-brokered;
//  client-writable balances were the root of the mint-money incident). Every
//  figure here is computed from accepted quotes (contracted value), the live bid
//  pipeline, and the transactions ledger — so it's premium AND honest.
// ════════════════════════════════════════════════════════════════════════════
const POSITIVE_TX = new Set(['earning', 'deposit', 'refund', 'payout']);
const quoteCents = (q: { quote?: { amount_cents?: number; amount?: number } }): number =>
  q.quote?.amount_cents ?? (q.quote?.amount != null ? toCents(q.quote.amount) : 0);

export interface FinanceMonth { key: string; label: string; awardedCents: number; receivedCents: number; }
export interface AwardedContract { id: string; rfq_id: string; title: string; amountCents: number; dispatched: boolean; created_at: string; }
export interface SupplierFinance {
  contractedCents: number;   // Σ accepted-quote value — work you've won
  inBidCents: number;        // Σ live (submitted+shortlisted) quote value — pipeline
  receivedCents: number;     // Σ completed inbound transactions — settled to you
  pendingCents: number;      // Σ pending/processing transactions
  outstandingCents: number;  // contracted − received (awaiting brokered release)
  wonCount: number; activeCount: number; lostCount: number; bidCount: number;
  winRate: number | null;    // won / (won+lost)
  avgAwardCents: number | null;
  funnel: { submitted: number; shortlisted: number; awarded: number };
  months: FinanceMonth[];    // trailing 6 months
  awardedContracts: AwardedContract[];
  transactions: SupplierTransaction[];
}

export function computeSupplierFinance(quotes: MyQuote[], txns: SupplierTransaction[]): SupplierFinance {
  const accepted = quotes.filter((q) => q.status === 'accepted');
  const active = quotes.filter((q) => q.status === 'submitted' || q.status === 'shortlisted');
  const lost = quotes.filter((q) => q.status === 'declined');

  const contractedCents = accepted.reduce((s, q) => s + quoteCents(q), 0);
  const inBidCents = active.reduce((s, q) => s + quoteCents(q), 0);
  let receivedCents = 0, pendingCents = 0;
  for (const t of txns) {
    const c = toCents(Math.abs(t.amount));
    if (t.status === 'pending' || t.status === 'processing') pendingCents += c;
    else if (t.status === 'completed' && POSITIVE_TX.has(t.type)) receivedCents += c;
  }
  const wonCount = accepted.length;
  const lostCount = lost.length;
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;

  // Trailing 6-month buckets (awarded value by bid date + received by tx date).
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
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const i = idx.get(key);
    return i == null ? null : months[i]!;
  };
  for (const q of accepted) { const m = bucket(q.created_at); if (m) m.awardedCents += quoteCents(q); }
  for (const t of txns) {
    if (t.status === 'completed' && POSITIVE_TX.has(t.type)) { const m = bucket(t.created_at); if (m) m.receivedCents += toCents(Math.abs(t.amount)); }
  }

  return {
    contractedCents, inBidCents, receivedCents, pendingCents,
    outstandingCents: Math.max(contractedCents - receivedCents, 0),
    wonCount, activeCount: active.length, lostCount, bidCount: quotes.length,
    winRate, avgAwardCents: wonCount > 0 ? Math.round(contractedCents / wonCount) : null,
    funnel: {
      submitted: quotes.length,
      shortlisted: quotes.filter((q) => q.status === 'shortlisted' || q.status === 'accepted').length,
      awarded: wonCount,
    },
    months,
    awardedContracts: accepted.map((q) => ({
      id: q.id, rfq_id: q.rfq_id, title: q.rfq_title || 'Awarded contract',
      amountCents: quoteCents(q), dispatched: !!q.spawned_job_id, created_at: q.created_at,
    })),
    transactions: txns,
  };
}

export async function fetchSupplierFinance(): Promise<SupplierFinance> {
  const [quotes, txns] = await Promise.all([fetchMyQuotes(), fetchSupplierTransactions()]);
  return computeSupplierFinance(quotes, txns);
}

// ── Supplier wallet / Stripe Connect payouts (mirror of inspector wallet) ──
export interface SupplierWallet { availableCents: number; connectStatus: string; payoutsEnabled: boolean; }
export async function fetchSupplierWallet(): Promise<SupplierWallet> {
  const uid = await getUserId();
  if (!uid) return { availableCents: 0, connectStatus: 'not_connected', payoutsEnabled: false };
  const client = sb();
  const [{ data: e }, { data: p }] = await Promise.all([
    client.from('supplier_earnings').select('available_balance_halalas').eq('supplier_id', uid).maybeSingle(),
    client.from('profiles').select('stripe_connect_status, stripe_connect_payouts_enabled').eq('id', uid).maybeSingle(),
  ]);
  return {
    availableCents: Number((e as { available_balance_halalas?: number } | null)?.available_balance_halalas ?? 0),
    connectStatus: ((p as { stripe_connect_status?: string } | null)?.stripe_connect_status ?? 'not_connected'),
    payoutsEnabled: !!(p as { stripe_connect_payouts_enabled?: boolean } | null)?.stripe_connect_payouts_enabled,
  };
}
// Stripe Connect Express onboarding — same EF as inspectors.
export async function startSupplierConnectOnboarding(): Promise<string | null> {
  const uid = await getUserId();
  if (!uid) return null;
  const { data, error } = await sb().functions.invoke('create-stripe-connect-link', { body: { user_id: uid } });
  if (error) return null;
  return (data as { url?: string } | null)?.url ?? null;
}
// Trigger a payout via the parallel supplier EF (server re-derives + verifies).
export async function supplierWithdraw(amountCents: number): Promise<{ ok: boolean; error?: string }> {
  const uid = await getUserId();
  if (!uid) return { ok: false, error: 'Not signed in.' };
  const { error } = await sb().functions.invoke('create-supplier-payout', { body: { user_id: uid, amount_cents: amountCents } });
  if (error) {
    let msg = (error as { message?: string }).message ?? 'Payout failed';
    try {
      const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* keep generic */ }
    return { ok: false, error: msg };
  }
  return { ok: true };
}
