// ════════════════════════════════════════════════════════════════════════════
//  lib/pdf/renderPayoutStatement.ts — inspector quarterly/annual statement
//
//  GOLDEN_RULE_2 — INSPECTOR side. Shows ONLY inspector-side numbers:
//    - inspector_payout_cents per job
//    - platform_fee_cents per job (informational)
//    - net_to_inspector_cents per job
//  NEVER shows client_price_cents.
// ════════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface StatementLine {
  jobId: string;
  jobTitle: string;
  paidAt: string | null;
  inspectorPayoutCents: number;
  platformFeeCents: number;
  netCents: number;
  currency: string;
}

export interface StatementHeader {
  inspectorName: string;
  inspectorEmail: string;
  period: string;          // e.g. "Q1-2026" or "2026"
  totalPayoutCents: number;
  totalFeeCents: number;
  totalNetCents: number;
  currency: string;
  stripeConnectId: string | null;
}

export async function renderPayoutStatementPdf(
  header: StatementHeader,
  lines: StatementLine[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([612, 792]);
  const { width } = page.getSize();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const inkText = rgb(0.08, 0.08, 0.12);
  const subText = rgb(0.42, 0.42, 0.48);
  const violet = rgb(0.486, 0.227, 0.929);
  const line = rgb(0.85, 0.85, 0.88);

  let y = 740;

  page.drawText('NEXPEC, Inspector Payout Statement', {
    x: 48, y, size: 9, font: fontRegular, color: subText,
  });
  y -= 28;

  page.drawText(`Payout statement, ${header.period}`, {
    x: 48, y, size: 22, font: fontBold, color: inkText,
  });
  y -= 36;

  page.drawText('INSPECTOR', { x: 48, y, size: 8, font: fontBold, color: subText });
  page.drawText('STRIPE CONNECT', { x: 360, y, size: 8, font: fontBold, color: subText });
  y -= 14;
  page.drawText(header.inspectorName, { x: 48, y, size: 11, font: fontBold, color: inkText });
  page.drawText(header.stripeConnectId ?? 'Not connected', {
    x: 360, y, size: 9, font: fontMono, color: subText,
  });
  y -= 14;
  page.drawText(header.inspectorEmail, { x: 48, y, size: 9, font: fontRegular, color: subText });
  y -= 28;

  // Summary tiles
  drawTile(page, fontBold, fontRegular, 48, y, 'GROSS PAYOUT', formatMoney(header.totalPayoutCents, header.currency), violet);
  drawTile(page, fontBold, fontRegular, 220, y, 'PLATFORM FEE', formatMoney(header.totalFeeCents, header.currency), subText);
  drawTile(page, fontBold, fontRegular, 392, y, 'NET TO YOU', formatMoney(header.totalNetCents, header.currency), violet);
  y -= 90;

  // Table header
  page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 0.5, color: line });
  y -= 14;
  page.drawText('JOB', { x: 48, y, size: 8, font: fontBold, color: subText });
  page.drawText('PAID', { x: 280, y, size: 8, font: fontBold, color: subText });
  page.drawText('GROSS', { x: 360, y, size: 8, font: fontBold, color: subText });
  page.drawText('FEE', { x: 440, y, size: 8, font: fontBold, color: subText });
  page.drawText('NET', { x: width - 90, y, size: 8, font: fontBold, color: subText });
  y -= 14;

  for (const ln of lines) {
    if (y < 80) {
      page = doc.addPage([612, 792]);
      y = 740;
    }
    const title = ln.jobTitle.length > 32 ? ln.jobTitle.slice(0, 31) + '…' : ln.jobTitle;
    page.drawText(title, { x: 48, y, size: 9, font: fontRegular, color: inkText });
    page.drawText(ln.paidAt ? new Date(ln.paidAt).toLocaleDateString() : '—', {
      x: 280, y, size: 9, font: fontRegular, color: subText,
    });
    page.drawText(formatMoney(ln.inspectorPayoutCents, ln.currency), {
      x: 360, y, size: 9, font: fontMono, color: inkText,
    });
    page.drawText(formatMoney(ln.platformFeeCents, ln.currency), {
      x: 440, y, size: 9, font: fontMono, color: subText,
    });
    page.drawText(formatMoney(ln.netCents, ln.currency), {
      x: width - 90, y, size: 9, font: fontMono, color: inkText,
    });
    y -= 14;
  }

  y -= 12;
  page.drawLine({ start: { x: 48, y }, end: { x: width - 48, y }, thickness: 0.5, color: line });
  y -= 18;

  page.drawText(
    'Use this statement for accounting purposes. NEXPEC issues a 1099-NEC (US) / T4A (CA) at year-end if your annual earnings cross the regulatory threshold.',
    { x: 48, y, size: 8, font: fontRegular, color: subText, maxWidth: width - 96 },
  );
  y -= 14;
  page.drawText(`Generated ${new Date().toISOString()}`, {
    x: 48, y, size: 7, font: fontMono, color: subText,
  });

  return doc.save();
}

function drawTile(
  page: import('pdf-lib').PDFPage,
  bold: import('pdf-lib').PDFFont,
  reg: import('pdf-lib').PDFFont,
  x: number,
  y: number,
  label: string,
  value: string,
  valueColor: import('pdf-lib').RGB,
) {
  page.drawRectangle({
    x, y: y - 56, width: 160, height: 70,
    borderColor: rgb(0.85, 0.85, 0.88), borderWidth: 0.5,
    color: rgb(0.98, 0.98, 0.99),
  });
  page.drawText(label, { x: x + 12, y, size: 7, font: bold, color: rgb(0.42, 0.42, 0.48) });
  page.drawText(value, { x: x + 12, y: y - 30, size: 18, font: bold, color: valueColor });
  page.drawText('this period', { x: x + 12, y: y - 50, size: 7, font: reg, color: rgb(0.55, 0.55, 0.6) });
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
