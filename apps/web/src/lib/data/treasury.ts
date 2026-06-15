// ════════════════════════════════════════════════════════════════════════════
//  lib/data/treasury.ts — Admin Treasury Control Tower data.
//
//  Powers /admin/treasury: the manual payout-request queue, early-payout advance
//  approvals, and the "owed to you vs you owe" cash-flow summary. All amounts are
//  returned as integer CENTS (withdrawal_requests/payout_advances are *_cents;
//  wallet balances are numeric dollars → ×100). RLS scopes reads to admins.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export type RequesterRole = 'inspector' | 'supplier';

export interface WithdrawalRow {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string | null;
  role: RequesterRole;
  amountCents: number;
  method: string | null;
  destinationNote: string | null;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  externalReference: string | null;
  rejectReason: string | null;
}

export interface AdvanceRow {
  id: string;
  requesterId: string;
  requesterName: string;
  jobId: string | null;
  jobTitle: string | null;
  grossCents: number;
  feeCents: number;
  netCents: number;
  feeBps: number;
  status: string;
  requestedAt: string;
}

export interface TreasurySummary {
  pendingCount: number;
  reservedCents: number;        // sum of open withdrawal requests
  clearedLiabilityCents: number; // wallets.available_balance — withdrawable now (you owe)
  accruedCents: number;          // wallets.pending_amount — net-terms, not yet cleared
  receivablesCents: number;      // net-terms jobs earned but client hasn't settled (owed to you)
  openAdvanceCount: number;
}

export interface TreasuryData {
  summary: TreasurySummary;
  requests: WithdrawalRow[];
  advances: AdvanceRow[];
  recent: WithdrawalRow[];
}

const EMPTY: TreasuryData = {
  summary: {
    pendingCount: 0, reservedCents: 0, clearedLiabilityCents: 0,
    accruedCents: 0, receivablesCents: 0, openAdvanceCount: 0,
  },
  requests: [], advances: [], recent: [],
};

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
}
function toCents(dollars: unknown): number {
  return Math.round(num(dollars) * 100);
}

export async function fetchTreasury(): Promise<TreasuryData> {
  try {
    const supabase = await createSupabaseServerClient();

    const [openRes, recentRes, advRes, walletsRes, recvRes] = await Promise.all([
      supabase.from('withdrawal_requests').select('*').in('status', ['requested', 'approved']).order('requested_at', { ascending: true }),
      supabase.from('withdrawal_requests').select('*').in('status', ['paid', 'rejected', 'cancelled']).order('updated_at', { ascending: false }).limit(8),
      supabase.from('payout_advances').select('*').in('status', ['requested', 'approved']).order('requested_at', { ascending: true }),
      supabase.from('wallets').select('available_balance, pending_amount'),
      supabase.from('jobs').select('client_price_cents').eq('payment_mode', 'net_terms').not('admin_confirmed_at', 'is', null).is('client_settled_at', null).is('deleted_at', null),
    ]);

    const open = (openRes.data ?? []) as Record<string, unknown>[];
    const recentRaw = (recentRes.data ?? []) as Record<string, unknown>[];
    const advRaw = (advRes.data ?? []) as Record<string, unknown>[];

    // Resolve requester names/emails (admin may see real identity) + job titles.
    const userIds = new Set<string>();
    for (const r of [...open, ...recentRaw, ...advRaw]) userIds.add(String(r.requester_id));
    const jobIds = new Set<string>();
    for (const a of advRaw) if (a.job_id) jobIds.add(String(a.job_id));

    const nameById = new Map<string, { name: string; email: string | null }>();
    if (userIds.size > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', Array.from(userIds));
      for (const p of (profs ?? []) as Record<string, unknown>[]) {
        nameById.set(String(p.id), {
          name: (p.full_name as string | null)?.trim() || (p.email as string | null) || 'Unknown',
          email: (p.email as string | null) ?? null,
        });
      }
    }
    const jobTitleById = new Map<string, string>();
    if (jobIds.size > 0) {
      const { data: jr } = await supabase.from('jobs').select('id, title').in('id', Array.from(jobIds));
      for (const j of (jr ?? []) as Record<string, unknown>[]) jobTitleById.set(String(j.id), String(j.title ?? '(untitled)'));
    }

    const mapWithdrawal = (r: Record<string, unknown>): WithdrawalRow => {
      const who = nameById.get(String(r.requester_id));
      return {
        id: String(r.id),
        requesterId: String(r.requester_id),
        requesterName: who?.name ?? 'Unknown',
        requesterEmail: who?.email ?? null,
        role: (r.requester_role as RequesterRole) ?? 'inspector',
        amountCents: num(r.amount_cents),
        method: (r.method as string | null) ?? null,
        destinationNote: (r.destination_note as string | null) ?? null,
        status: String(r.status),
        requestedAt: String(r.requested_at),
        paidAt: (r.paid_at as string | null) ?? null,
        externalReference: (r.external_reference as string | null) ?? null,
        rejectReason: (r.reject_reason as string | null) ?? null,
      };
    };

    const requests = open.map(mapWithdrawal);
    const recent = recentRaw.map(mapWithdrawal);
    const advances: AdvanceRow[] = advRaw.map((a) => ({
      id: String(a.id),
      requesterId: String(a.requester_id),
      requesterName: nameById.get(String(a.requester_id))?.name ?? 'Unknown',
      jobId: (a.job_id as string | null) ?? null,
      jobTitle: a.job_id ? (jobTitleById.get(String(a.job_id)) ?? null) : null,
      grossCents: num(a.gross_cents),
      feeCents: num(a.fee_cents),
      netCents: num(a.net_cents),
      feeBps: num(a.fee_bps),
      status: String(a.status),
      requestedAt: String(a.requested_at),
    }));

    const wallets = (walletsRes.data ?? []) as Record<string, unknown>[];
    const clearedLiabilityCents = wallets.reduce((s, w) => s + toCents(w.available_balance), 0);
    const accruedCents = wallets.reduce((s, w) => s + toCents(w.pending_amount), 0);
    const receivablesCents = ((recvRes.data ?? []) as Record<string, unknown>[]).reduce((s, j) => s + num(j.client_price_cents), 0);
    const reservedCents = requests.reduce((s, r) => s + r.amountCents, 0);

    return {
      summary: {
        pendingCount: requests.length,
        reservedCents,
        clearedLiabilityCents,
        accruedCents,
        receivablesCents,
        openAdvanceCount: advances.length,
      },
      requests,
      advances,
      recent,
    };
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[fetchTreasury] threw:', e);
    return EMPTY;
  }
}
