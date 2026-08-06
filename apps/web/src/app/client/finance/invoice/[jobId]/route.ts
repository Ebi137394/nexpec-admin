// ════════════════════════════════════════════════════════════════════════════
//  app/client/finance/invoice/[jobId]/route.ts — stream a per-job invoice PDF
//
//  GOLDEN_RULE_2: this route renders a CLIENT invoice. The fetcher reads
//  only client-facing columns from jobs + profiles. inspector_payout_cents
//  is never SELECTed. The pdf-lib renderer is also strictly typed to refuse
//  payout fields by shape.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { renderInvoicePdf } from '@/lib/pdf/renderInvoice';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { jobId } = await ctx.params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL('/sign-in?next=' + encodeURIComponent(`/client/finance/invoice/${jobId}`), 'https://nexpecapp.com'),
    );
  }

  // STRICT projection — no payout columns.
  const { data: job, error: jobErr } = await supabase
    .from('jobs_secure_view')
    // #QA — jobs has no platform_fee_cents column; the margin is admin-only
    // (platform_spread_cents). Selecting a non-existent column 500'd this route.
    // `completed_at` is NOT a column on public.jobs — naming it made PostgREST
    // 42703 the WHOLE select, so this route 404'd instead of rendering an
    // invoice. The canonical settlement timestamps ARE real columns:
    // client_settled_at (stamped by the settlement RPC) and client_invoiced_at.
    .select(
      'id, title, location_city, client_price_cents, client_settled_at, client_invoiced_at, updated_at, status, client_id, currency',
    )
    .eq('id', jobId)
    .eq('client_id', user.id)
    .maybeSingle();

  if (jobErr || !job) {
    return new NextResponse('Not found', { status: 404 });
  }

  const j = job as unknown as Record<string, unknown>;

  // Client branding (Sprint 9 fields)
  const { data: prof } = await supabase
    .from('profiles')
    .select('full_name, company_name, email, company_logo_url, report_header_text, report_footer_text, use_custom_branding, currency')
    .eq('id', user.id)
    .maybeSingle();
  const p = (prof ?? {}) as Record<string, unknown>;

  const currency =
    (j.currency as string | null) ||
    (p.currency as string | null) ||
    'USD';

  const pdfBytes = await renderInvoicePdf({
    client: {
      fullName: (p.full_name as string | null) ?? null,
      companyName: (p.company_name as string | null) ?? null,
      email: String(p.email ?? user.email ?? ''),
      companyLogoUrl: (p.company_logo_url as string | null) ?? null,
      reportHeaderText: (p.report_header_text as string | null) ?? null,
      reportFooterText: (p.report_footer_text as string | null) ?? null,
      useCustomBranding: Boolean(p.use_custom_branding),
    },
    job: {
      jobId: String(j.id),
      jobTitle: String(j.title ?? 'Inspection'),
      // Settlement first, then invoice issue, then last write. Never a
      // fabricated date — null still renders as unset on the invoice.
      completedAt:
        (j.client_settled_at as string | null) ??
        (j.client_invoiced_at as string | null) ??
        (j.updated_at as string | null) ??
        null,
      locationCity: (j.location_city as string | null) ?? null,
      clientPriceCents:
        typeof j.client_price_cents === 'number'
          ? j.client_price_cents
          : j.client_price_cents
            ? Number(j.client_price_cents)
            : null,
      // Platform margin is admin-only (it would leak the inspector payout via
      // client_price − spread) and jobs has no platform_fee_cents column. The
      // client invoice shows only what the client pays. #QA
      platformFeeCents: null,
      currency,
    },
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${jobId.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
