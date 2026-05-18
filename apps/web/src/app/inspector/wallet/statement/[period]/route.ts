// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/wallet/statement/[period]/route.ts — quarterly/annual PDF
//
//  Period format:  YYYY  |  YYYY-Q[1-4]  |  YYYY-MM
//  Examples:       2026  |  2026-Q1      |  2026-03
//
//  GOLDEN_RULE_2: inspector-only fetcher. NEVER selects client_price_cents.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  renderPayoutStatementPdf,
  type StatementLine,
} from '@/lib/pdf/renderPayoutStatement';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ period: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { period } = await ctx.params;
  const range = parsePeriod(period);
  if (!range) {
    return new NextResponse('Invalid period format. Use YYYY, YYYY-QN, or YYYY-MM.', {
      status: 400,
    });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL('/sign-in?next=' + encodeURIComponent(`/inspector/wallet/statement/${period}`), 'https://nexpecapp.com'),
    );
  }

  // Inspector-side projection only
  const { data: prof } = await supabase
    .from('profiles')
    .select('full_name, email, stripe_connect_id, currency')
    .eq('id', user.id)
    .maybeSingle();
  const p = (prof ?? {}) as Record<string, unknown>;

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, title, paid_at, completed_at, inspector_payout_cents, platform_fee_cents, payout_status')
    .eq('assigned_inspector_id', user.id)
    .in('payout_status', ['released', 'paid'])
    .gte('paid_at', range.start)
    .lt('paid_at', range.end)
    .order('paid_at', { ascending: true });

  if (error) {
    return new NextResponse('Could not load earnings: ' + error.message, { status: 500 });
  }

  const currency = (p.currency as string | null) || 'USD';
  const lines: StatementLine[] = [];
  let totalPayout = 0;
  let totalFee = 0;
  for (const row of (jobs ?? []) as unknown as Array<Record<string, unknown>>) {
    const payout =
      typeof row.inspector_payout_cents === 'number'
        ? row.inspector_payout_cents
        : Number(row.inspector_payout_cents ?? 0);
    const fee =
      typeof row.platform_fee_cents === 'number'
        ? row.platform_fee_cents
        : Number(row.platform_fee_cents ?? 0);
    const net = payout - fee;
    totalPayout += payout;
    totalFee += fee;
    lines.push({
      jobId: String(row.id),
      jobTitle: String(row.title ?? 'Inspection'),
      paidAt:
        (row.paid_at as string | null) ?? (row.completed_at as string | null) ?? null,
      inspectorPayoutCents: payout,
      platformFeeCents: fee,
      netCents: net,
      currency,
    });
  }

  const pdfBytes = await renderPayoutStatementPdf(
    {
      inspectorName: ((p.full_name as string | null) ?? user.email ?? 'Inspector'),
      inspectorEmail: String(p.email ?? user.email ?? ''),
      period,
      totalPayoutCents: totalPayout,
      totalFeeCents: totalFee,
      totalNetCents: totalPayout - totalFee,
      currency,
      stripeConnectId: (p.stripe_connect_id as string | null) ?? null,
    },
    lines,
  );

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payout-statement-${period}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

/** Parse period strings into a [start, end) ISO timestamp range. */
function parsePeriod(s: string): { start: string; end: string } | null {
  // Full year: YYYY
  const yMatch = /^(\d{4})$/.exec(s);
  if (yMatch) {
    const y = Number(yMatch[1]);
    return { start: `${y}-01-01`, end: `${y + 1}-01-01` };
  }
  // Quarter: YYYY-Q1..Q4
  const qMatch = /^(\d{4})-Q([1-4])$/i.exec(s);
  if (qMatch) {
    const y = Number(qMatch[1]);
    const q = Number(qMatch[2]);
    const startMonth = (q - 1) * 3 + 1;
    const start = `${y}-${String(startMonth).padStart(2, '0')}-01`;
    const endMonth = startMonth + 3;
    const end =
      endMonth > 12
        ? `${y + 1}-01-01`
        : `${y}-${String(endMonth).padStart(2, '0')}-01`;
    return { start, end };
  }
  // Month: YYYY-MM
  const mMatch = /^(\d{4})-(\d{2})$/.exec(s);
  if (mMatch) {
    const y = Number(mMatch[1]);
    const m = Number(mMatch[2]);
    if (m < 1 || m > 12) return null;
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end =
      m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { start, end };
  }
  return null;
}
