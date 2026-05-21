// ════════════════════════════════════════════════════════════════════════════
//  lib/data/invoices.ts — Invoice Approver fetcher (web)
//
//  Reads public.invoices through the standard supabase client. RLS gates
//  access:
//    • Clients see invoices where client_id = auth.uid() OR client_id
//      is rolled-up through fin_visible_client_ids() (agency/enterprise).
//    • Inspectors see invoices where inspector_id = auth.uid().
//    • Admins see all (admin/super_admin write policy).
//
//  GR2: the client-side projection deliberately excludes
//  inspector_amount_cents. Admin projection includes both.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  EMPTY_INVOICE_COUNTS,
  type InvoiceAdminView,
  type InvoiceClientView,
  type InvoiceCounts,
  type InvoiceLineItem,
  type InvoiceStatus,
} from './invoices.types';

// ─── Field allowlists ──────────────────────────────────────────────────
// CLIENT view → never names inspector_amount_cents.
const CLIENT_INVOICE_FIELDS = [
  'id',
  'invoice_number',
  'job_id',
  'contract_id',
  'client_amount_cents',
  'platform_fee_cents',
  'total_cents',
  'currency',
  'status',
  'issued_at',
  'due_date',
  'approved_at',
  'disputed_at',
  'dispute_reason',
  'paid_at',
  'notes',
  'line_items_json',
  // No inspector_amount_cents
].join(', ');

// ADMIN view → both money columns + audit trail.
const ADMIN_INVOICE_FIELDS = [
  'id',
  'invoice_number',
  'job_id',
  'contract_id',
  'client_id',
  'inspector_id',
  'client_amount_cents',
  'inspector_amount_cents',
  'platform_fee_cents',
  'total_cents',
  'currency',
  'status',
  'issued_at',
  'due_date',
  'approved_at',
  'approved_by',
  'disputed_at',
  'disputed_by',
  'dispute_reason',
  'paid_at',
  'paid_reference',
  'voided_at',
  'voided_by',
  'voided_reason',
  'notes',
  'line_items_json',
].join(', ');

// ─── Client-side fetcher (for /client/invoices) ────────────────────────
export async function fetchClientInvoices(
  opts: { status?: InvoiceStatus; limit?: number } = {},
): Promise<{ invoices: InvoiceClientView[]; counts: InvoiceCounts }> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { invoices: [], counts: EMPTY_INVOICE_COUNTS };

    let q = supabase
      .from('invoices')
      .select(CLIENT_INVOICE_FIELDS)
      .order('issued_at', { ascending: false })
      .limit(opts.limit ?? 100);
    if (opts.status) q = q.eq('status', opts.status);

    const { data, error } = await q;
    if (error || !data) {
      if (error) console.warn('[invoices] fetchClientInvoices failed:', error.message);
      return { invoices: [], counts: EMPTY_INVOICE_COUNTS };
    }

    // Hydrate job titles + inspector names in one batch each
    const jobIds = Array.from(
      new Set(
        (data as Array<Record<string, unknown>>)
          .map((r) => r.job_id as string)
          .filter(Boolean),
      ),
    );
    const titleByJob = new Map<string, string | null>();
    if (jobIds.length > 0) {
      const { data: jobRows } = await supabase
        .from('jobs')
        .select('id, title, hired_inspector_id')
        .in('id', jobIds);
      (jobRows as Array<{ id: string; title: string | null; hired_inspector_id: string | null }> | null)?.forEach(
        (j) => titleByJob.set(j.id, j.title),
      );
    }

    // Counts query — separate, lightweight
    const counts = await fetchInvoiceCounts();

    const rows = data as unknown as Array<Record<string, unknown>>;
    const invoices: InvoiceClientView[] = rows.map((r) => ({
      id: String(r.id),
      invoiceNumber: String(r.invoice_number ?? ''),
      jobId: String(r.job_id ?? ''),
      jobTitle: titleByJob.get(String(r.job_id ?? '')) ?? null,
      contractId: (r.contract_id as string | null) ?? null,
      clientAmountCents: numberOr(r.client_amount_cents, 0),
      platformFeeCents: numberOr(r.platform_fee_cents, 0),
      totalCents: numberOr(r.total_cents, 0),
      currency: String(r.currency ?? 'USD'),
      status: ((r.status as InvoiceStatus) ?? 'pending_review') as InvoiceStatus,
      issuedAt: String(r.issued_at ?? ''),
      dueDate: (r.due_date as string | null) ?? null,
      approvedAt: (r.approved_at as string | null) ?? null,
      disputedAt: (r.disputed_at as string | null) ?? null,
      disputeReason: (r.dispute_reason as string | null) ?? null,
      paidAt: (r.paid_at as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      lineItems: parseLineItems(r.line_items_json),
      inspectorName: null, // resolved separately below
    }));

    return { invoices, counts };
  } catch (e) {
    console.warn('[invoices] fetchClientInvoices threw:', e);
    return { invoices: [], counts: EMPTY_INVOICE_COUNTS };
  }
}

// ─── Admin-side fetcher (for /admin/invoices) ──────────────────────────
export async function fetchAdminInvoices(
  opts: { status?: InvoiceStatus; limit?: number } = {},
): Promise<{ invoices: InvoiceAdminView[]; counts: InvoiceCounts }> {
  try {
    const supabase = await createSupabaseServerClient();
    let q = supabase
      .from('invoices')
      .select(ADMIN_INVOICE_FIELDS)
      .order('issued_at', { ascending: false })
      .limit(opts.limit ?? 200);
    if (opts.status) q = q.eq('status', opts.status);

    const { data, error } = await q;
    if (error || !data) {
      if (error) console.warn('[invoices] fetchAdminInvoices failed:', error.message);
      return { invoices: [], counts: EMPTY_INVOICE_COUNTS };
    }

    const rows = data as unknown as Array<Record<string, unknown>>;
    // Hydrate names + titles
    const jobIds = Array.from(new Set(rows.map((r) => r.job_id as string).filter(Boolean)));
    const profileIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.client_id as string, r.inspector_id as string])
          .filter(Boolean),
      ),
    );

    const titleByJob = new Map<string, string | null>();
    const nameById = new Map<string, string>();
    if (jobIds.length > 0) {
      const { data: jobs } = await supabase.from('jobs').select('id, title').in('id', jobIds);
      (jobs as Array<{ id: string; title: string | null }> | null)?.forEach((j) =>
        titleByJob.set(j.id, j.title),
      );
    }
    if (profileIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', profileIds);
      (profs as Array<{ id: string; full_name: string | null; email: string | null }> | null)?.forEach(
        (p) => nameById.set(p.id, p.full_name ?? p.email ?? 'Unknown'),
      );
    }

    const counts = await fetchInvoiceCounts();

    const invoices: InvoiceAdminView[] = rows.map((r) => ({
      id: String(r.id),
      invoiceNumber: String(r.invoice_number ?? ''),
      jobId: String(r.job_id ?? ''),
      jobTitle: titleByJob.get(String(r.job_id ?? '')) ?? null,
      contractId: (r.contract_id as string | null) ?? null,
      clientId: String(r.client_id ?? ''),
      clientName: nameById.get(String(r.client_id ?? '')) ?? 'Client',
      inspectorId: (r.inspector_id as string | null) ?? null,
      inspectorName: r.inspector_id
        ? nameById.get(String(r.inspector_id)) ?? null
        : null,
      clientAmountCents: numberOr(r.client_amount_cents, 0),
      inspectorAmountCents: numberOr(r.inspector_amount_cents, 0),
      platformFeeCents: numberOr(r.platform_fee_cents, 0),
      totalCents: numberOr(r.total_cents, 0),
      currency: String(r.currency ?? 'USD'),
      status: ((r.status as InvoiceStatus) ?? 'pending_review') as InvoiceStatus,
      issuedAt: String(r.issued_at ?? ''),
      dueDate: (r.due_date as string | null) ?? null,
      approvedAt: (r.approved_at as string | null) ?? null,
      approvedBy: (r.approved_by as string | null) ?? null,
      disputedAt: (r.disputed_at as string | null) ?? null,
      disputedBy: (r.disputed_by as string | null) ?? null,
      disputeReason: (r.dispute_reason as string | null) ?? null,
      paidAt: (r.paid_at as string | null) ?? null,
      paidReference: (r.paid_reference as string | null) ?? null,
      voidedAt: (r.voided_at as string | null) ?? null,
      voidedBy: (r.voided_by as string | null) ?? null,
      voidedReason: (r.voided_reason as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      lineItems: parseLineItems(r.line_items_json),
    }));

    return { invoices, counts };
  } catch (e) {
    console.warn('[invoices] fetchAdminInvoices threw:', e);
    return { invoices: [], counts: EMPTY_INVOICE_COUNTS };
  }
}

// ─── Single-invoice fetcher ────────────────────────────────────────────
export async function fetchInvoiceById(
  id: string,
): Promise<InvoiceClientView | null> {
  if (!id) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('invoices')
      .select(CLIENT_INVOICE_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn('[invoices] fetchInvoiceById failed:', error.message);
      return null;
    }
    const r = data as unknown as Record<string, unknown>;

    // Hydrate job title
    let title: string | null = null;
    const jobId = r.job_id as string;
    if (jobId) {
      const { data: jrow } = await supabase
        .from('jobs')
        .select('title')
        .eq('id', jobId)
        .maybeSingle();
      title = (jrow as { title?: string | null } | null)?.title ?? null;
    }

    return {
      id: String(r.id),
      invoiceNumber: String(r.invoice_number ?? ''),
      jobId,
      jobTitle: title,
      contractId: (r.contract_id as string | null) ?? null,
      clientAmountCents: numberOr(r.client_amount_cents, 0),
      platformFeeCents: numberOr(r.platform_fee_cents, 0),
      totalCents: numberOr(r.total_cents, 0),
      currency: String(r.currency ?? 'USD'),
      status: ((r.status as InvoiceStatus) ?? 'pending_review') as InvoiceStatus,
      issuedAt: String(r.issued_at ?? ''),
      dueDate: (r.due_date as string | null) ?? null,
      approvedAt: (r.approved_at as string | null) ?? null,
      disputedAt: (r.disputed_at as string | null) ?? null,
      disputeReason: (r.dispute_reason as string | null) ?? null,
      paidAt: (r.paid_at as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      lineItems: parseLineItems(r.line_items_json),
      inspectorName: null,
    };
  } catch (e) {
    console.warn('[invoices] fetchInvoiceById threw:', e);
    return null;
  }
}

// ─── Counts (status histogram + outstanding cents) ─────────────────────
async function fetchInvoiceCounts(): Promise<InvoiceCounts> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('invoices')
      .select('status, total_cents');
    if (!data) return EMPTY_INVOICE_COUNTS;
    const rows = data as Array<{ status: string; total_cents: number | string | null }>;
    const counts: InvoiceCounts = { ...EMPTY_INVOICE_COUNTS };
    for (const r of rows) {
      counts.total += 1;
      if (r.status === 'pending_review') counts.pendingReview += 1;
      else if (r.status === 'approved') counts.approved += 1;
      else if (r.status === 'disputed') counts.disputed += 1;
      else if (r.status === 'paid') counts.paid += 1;
      else if (r.status === 'voided') counts.voided += 1;
      if (r.status === 'pending_review' || r.status === 'approved') {
        counts.outstandingCents += numberOr(r.total_cents, 0);
      }
    }
    return counts;
  } catch {
    return EMPTY_INVOICE_COUNTS;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────
function numberOr(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseLineItems(raw: unknown): InvoiceLineItem[] {
  if (Array.isArray(raw)) {
    return (raw as Array<Record<string, unknown>>).map((item) => ({
      kind: String(item.kind ?? 'item'),
      description: String(item.description ?? ''),
      amount_cents: numberOr(item.amount_cents, 0),
      contract_id: item.contract_id ? String(item.contract_id) : undefined,
    }));
  }
  return [];
}

export function formatInvoiceCents(cents: number, currency = 'USD'): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatInvoiceDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function invoiceRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
