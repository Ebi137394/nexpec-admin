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
    .from('jobs')
    .select('id, title, location_city, client_price_cents, platform_fee_cents, completed_at, status, client_id, currency')
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
      completedAt: (j.completed_at as string | null) ?? null,
      locationCity: (j.location_city as string | null) ?? null,
      clientPriceCents:
        typeof j.client_price_cents === 'number'
          ? j.client_price_cents
          : j.client_price_cents
            ? Number(j.client_price_cents)
            : null,
      platformFeeCents:
        typeof j.platform_fee_cents === 'number'
          ? j.platform_fee_cents
          : j.platform_fee_cents
            ? Number(j.platform_fee_cents)
            : null,
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
