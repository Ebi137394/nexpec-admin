// ════════════════════════════════════════════════════════════════════════════
//  lib/pdf/renderInvoice.ts — per-job invoice PDF (client side)
//
//  Renders a clean B2B invoice for ONE completed job. Uses pdf-lib (zero
//  external deps beyond the package itself; no headless browser required).
//
//  GOLDEN_RULE_2 — this invoice surface is CLIENT-facing. It NEVER shows
//  the inspector's payout fields. Only:
//    - client_price_cents      → "Service total"
//    - platform_fee_cents      → "Platform fee" (if present)
//    - net_to_client_cents     → optional, computed
//  No inspector_payout_cents anywhere.
// ════════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface InvoiceJobRow {
  jobId: string;
  jobTitle: string;
  completedAt: string | null;
  locationCity: string | null;
  clientPriceCents: number | null;
  platformFeeCents: number | null;
  currency: string;
}

export interface InvoiceClientRow {
  fullName: string | null;
  companyName: string | null;
  email: string;
  companyLogoUrl: string | null;
  reportHeaderText: string | null;
  reportFooterText: string | null;
  useCustomBranding: boolean;
}

export interface InvoiceOptions {
  client: InvoiceClientRow;
  job: InvoiceJobRow;
  /** ISO date for the invoice line. Defaults to today. */
  invoiceDate?: string;
  /** Sequential invoice number (free-form). */
  invoiceNumber?: string;
}

export async function renderInvoicePdf(opts: InvoiceOptions): Promise<Uint8Array> {
  const { client, job } = opts;
  const invoiceDate = opts.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const invoiceNumber = opts.invoiceNumber ?? `INV-${job.jobId.slice(0, 8).toUpperCase()}`;

  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const { width } = page.getSize();

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const inkText = rgb(0.08, 0.08, 0.12);
  const subText = rgb(0.42, 0.42, 0.48);
  const violet = rgb(0.486, 0.227, 0.929);
  const line = rgb(0.85, 0.85, 0.88);

  let y = 740;

  // Header band — branding line
  const headerCopy = client.useCustomBranding && client.reportHeaderText
    ? client.reportHeaderText
    : 'NEXPEC, Industrial Inspection Marketplace';
  page.drawText(headerCopy, { x: 48, y, size: 9, font: fontRegular, color: subText });
  y -= 24;

  // INVOICE title
  page.drawText('INVOICE', { x: 48, y, size: 28, font: fontBold, color: inkText });
  page.drawText(invoiceNumber, { x: 48, y: y - 18, size: 10, font: fontMono, color: violet });
  y -= 48;

  // Bill-to + meta two-column
  page.drawText('BILL TO', { x: 48, y, size: 8, font: fontBold, color: subText });
  page.drawText('INVOICE DATE', { x: 360, y, size: 8, font: fontBold, color: subText });
  y -= 14;
  page.drawText(client.companyName ?? client.fullName ?? client.email, {
    x: 48, y, size: 11, font: fontBold, color: inkText,
  });
  page.drawText(invoiceDate, { x: 360, y, size: 11, font: fontRegular, color: inkText });
  y -= 14;
  page.drawText(client.email, { x: 48, y, size: 10, font: fontRegular, color: subText });
  page.drawText(`Job ID  ${job.jobId.slice(0, 12)}…`, {
    x: 360, y, size: 9, font: fontMono, color: subText,
  });
  y -= 36;

  // Line-item table
  page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 0.5, color: line });
  y -= 16;
  page.drawText('DESCRIPTION', { x: 48, y, size: 8, font: fontBold, color: subText });
  page.drawText('AMOUNT', { x: width - 110, y, size: 8, font: fontBold, color: subText });
  y -= 18;

  // Service line
  page.drawText(job.jobTitle, { x: 48, y, size: 11, font: fontBold, color: inkText, maxWidth: 380 });
  const totalCents = job.clientPriceCents ?? 0;
  page.drawText(formatMoney(totalCents, job.currency), {
    x: width - 110, y, size: 11, font: fontBold, color: inkText,
  });
  y -= 14;
  const meta = [
    job.locationCity ? `Location: ${job.locationCity}` : null,
    job.completedAt ? `Completed: ${new Date(job.completedAt).toLocaleDateString()}` : null,
  ].filter(Boolean).join(', ');
  if (meta) {
    page.drawText(meta, { x: 48, y, size: 9, font: fontRegular, color: subText });
    y -= 16;
  }

  y -= 8;
  page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 0.5, color: line });
  y -= 18;

  // Optional platform fee row
  if (job.platformFeeCents && job.platformFeeCents > 0) {
    page.drawText('Platform fee', { x: 48, y, size: 10, font: fontRegular, color: subText });
    page.drawText(formatMoney(job.platformFeeCents, job.currency), {
      x: width - 110, y, size: 10, font: fontRegular, color: subText,
    });
    y -= 14;
  }

  y -= 6;
  page.drawLine({ start: { x: 320, y }, end: { x: width - 48, y }, thickness: 0.5, color: line });
  y -= 18;

  // Total
  page.drawText('TOTAL', { x: 320, y, size: 10, font: fontBold, color: inkText });
  page.drawText(formatMoney(totalCents, job.currency), {
    x: width - 110, y, size: 14, font: fontBold, color: violet,
  });
  y -= 60;

  // Footer
  const footerCopy = client.useCustomBranding && client.reportFooterText
    ? client.reportFooterText
    : 'Funds held in Stripe-backed escrow until you release on a signed report. Questions? support@nexpecapp.com';
  page.drawText(footerCopy, { x: 48, y, size: 8, font: fontRegular, color: subText, maxWidth: width - 96 });
  y -= 14;
  page.drawText(`Audit hash: see signed report. Invoice generated ${new Date().toISOString()}`, {
    x: 48, y, size: 7, font: fontMono, color: subText,
  });

  return doc.save();
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}
