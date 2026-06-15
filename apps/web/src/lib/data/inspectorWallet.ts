// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorWallet.ts — the inspector's two-bucket wallet (web).
//
//  Available  = wallets.available_balance  (cleared, withdrawable now)
//  Accrued    = wallets.pending_amount     (earned on net-terms jobs, clears when
//                                           the client settles — NOT withdrawable)
//  In-flight  = wallets.pending_payouts    (reserved by an open payout request)
//
//  Wallet columns are numeric DOLLARS → ×100 to cents (formatCents expects cents).
//  RLS scopes every read to the signed-in inspector.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface WalletTxn {
  id: string;
  type: string;
  amountCents: number;
  status: string;
  description: string | null;
  createdAt: string;
}

export interface InspectorWalletView {
  availableCents: number;
  accruedCents: number;
  inFlightCents: number;
  totalEarnedCents: number;
  openRequest: { id: string; amountCents: number; status: string; requestedAt: string } | null;
  recent: WalletTxn[];
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
}
const toCents = (dollars: unknown): number => Math.round(num(dollars) * 100);

export async function fetchInspectorWallet(): Promise<InspectorWalletView | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const [walletRes, openRes, txRes] = await Promise.all([
      supabase.from('wallets').select('available_balance, pending_amount, pending_payouts, total_earned').eq('user_id', user.id).maybeSingle(),
      supabase.from('withdrawal_requests').select('id, amount_cents, status, requested_at').eq('requester_id', user.id).in('status', ['requested', 'approved']).order('requested_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('transactions').select('id, type, amount, status, description, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(12),
    ]);

    const w = (walletRes.data ?? {}) as Record<string, unknown>;
    const openRaw = openRes.data as Record<string, unknown> | null;

    return {
      availableCents: toCents(w.available_balance),
      accruedCents: toCents(w.pending_amount),
      inFlightCents: toCents(w.pending_payouts),
      totalEarnedCents: toCents(w.total_earned),
      openRequest: openRaw
        ? {
            id: String(openRaw.id),
            amountCents: num(openRaw.amount_cents),
            status: String(openRaw.status),
            requestedAt: String(openRaw.requested_at),
          }
        : null,
      recent: ((txRes.data ?? []) as Record<string, unknown>[]).map((t) => ({
        id: String(t.id),
        type: String(t.type),
        amountCents: toCents(t.amount),
        status: String(t.status ?? 'completed'),
        description: (t.description as string | null) ?? null,
        createdAt: String(t.created_at),
      })),
    };
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[fetchInspectorWallet] threw:', e);
    return null;
  }
}
