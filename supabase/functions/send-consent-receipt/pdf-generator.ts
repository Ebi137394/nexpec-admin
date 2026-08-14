// supabase/functions/send-consent-receipt/pdf-generator.ts

import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage, degrees } from 'https://esm.sh/pdf-lib@1.17.1';
import { encode as base64Encode } from 'https://deno.land/std@0.208.0/encoding/base64.ts';
import { 
  ConsentWithProfile, 
  AuditTrailItem, 
  PDFGenerationResult 
} from './types.ts';
import { 
  NEXPEC_LOGO_BASE64, 
  NDA_TEXT_TEMPLATE, 
  PDF_STYLES 
} from './constants.ts';

// NOTE: the private fields below carry a definite-assignment `!`. They are
// populated by the async init path, which a constructor cannot await, so
// strictPropertyInitialization (on under Deno 2.1.4) flags them as TS2564.
// The assertion documents that init() must run before any other method.
export class PDFGenerator {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private fonts!: {
    regular: PDFFont;
    bold: PDFFont;
  };
  private currentY!: number;
  private pageWidth!: number;
  private pageHeight!: number;
  private margin!: number;

  constructor() {
    this.margin = PDF_STYLES.margins.page;
  }

  async initialize(): Promise<void> {
    this.doc = await PDFDocument.create();
    this.fonts = {
      regular: await this.doc.embedFont(StandardFonts.Helvetica),
      bold: await this.doc.embedFont(StandardFonts.HelveticaBold),
    };
    this.addNewPage();
  }

  private addNewPage(): void {
    this.page = this.doc.addPage([612, 792]); // Letter size
    this.pageWidth = this.page.getWidth();
    this.pageHeight = this.page.getHeight();
    this.currentY = this.pageHeight - this.margin;
  }

  private checkPageBreak(requiredSpace: number): void {
    if (this.currentY - requiredSpace < this.margin + 50) {
      this.addNewPage();
    }
  }

  private drawText(
    text: string,
    options: {
      x?: number;
      y?: number;
      size?: number;
      font?: PDFFont;
      color?: { r: number; g: number; b: number };
      maxWidth?: number;
    } = {}
  ): number {
    const {
      x = this.margin,
      y = this.currentY,
      size = PDF_STYLES.fonts.body,
      font = this.fonts.regular,
      color = PDF_STYLES.colors.text,
      maxWidth = this.pageWidth - 2 * this.margin,
    } = options;

    // Word wrap
    const words = text.split(' ');
    let line = '';
    let lines: string[] = [];
    
    for (const word of words) {
      const testLine = line + (line ? ' ' : '') + word;
      const testWidth = font.widthOfTextAtSize(testLine, size);
      
      if (testWidth > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);

    let currentLineY = y;
    for (const lineText of lines) {
      this.page.drawText(lineText, {
        x,
        y: currentLineY,
        size,
        font,
        color: rgb(color.r / 255, color.g / 255, color.b / 255),
      });
      currentLineY -= size + 4;
    }

    return lines.length * (size + 4);
  }

  private drawLine(
    y: number,
    options: {
      startX?: number;
      endX?: number;
      color?: { r: number; g: number; b: number };
      thickness?: number;
    } = {}
  ): void {
    const {
      startX = this.margin,
      endX = this.pageWidth - this.margin,
      color = PDF_STYLES.colors.border,
      thickness = 1,
    } = options;

    this.page.drawLine({
      start: { x: startX, y },
      end: { x: endX, y },
      thickness,
      color: rgb(color.r / 255, color.g / 255, color.b / 255),
    });
  }

  private drawRect(
    x: number,
    y: number,
    width: number,
    height: number,
    options: {
      color?: { r: number; g: number; b: number };
      borderColor?: { r: number; g: number; b: number };
      borderWidth?: number;
    } = {}
  ): void {
    const { color, borderColor, borderWidth = 1 } = options;

    if (color) {
      this.page.drawRectangle({
        x,
        y,
        width,
        height,
        color: rgb(color.r / 255, color.g / 255, color.b / 255),
      });
    }

    if (borderColor) {
      this.page.drawRectangle({
        x,
        y,
        width,
        height,
        borderColor: rgb(borderColor.r / 255, borderColor.g / 255, borderColor.b / 255),
        borderWidth,
      });
    }
  }

  async addHeader(): Promise<void> {
    // Add logo
    try {
      const logoBytes = Uint8Array.from(atob(NEXPEC_LOGO_BASE64), c => c.charCodeAt(0));
      const logoImage = await this.doc.embedPng(logoBytes);
      const logoDims = logoImage.scale(0.3);
      
      this.page.drawImage(logoImage, {
        x: this.margin,
        y: this.currentY - logoDims.height,
        width: logoDims.width,
        height: logoDims.height,
      });
      
      this.currentY -= logoDims.height + 10;
    } catch (error) {
      // Fallback: Draw text logo
      this.drawText('NEXPEC', {
        size: 28,
        font: this.fonts.bold,
        color: PDF_STYLES.colors.primary,
      });
      this.currentY -= 40;
    }

    // Draw header line
    this.drawLine(this.currentY, {
      color: PDF_STYLES.colors.primary,
      thickness: 2,
    });
    this.currentY -= 30;

    // Document title
    this.drawText('LEGAL CONSENT RECEIPT', {
      size: PDF_STYLES.fonts.title,
      font: this.fonts.bold,
      color: PDF_STYLES.colors.primary,
    });
    this.currentY -= 35;

    // Subtitle
    this.drawText('Non-Disclosure Agreement - Digitally Signed', {
      size: PDF_STYLES.fonts.heading,
      font: this.fonts.regular,
      color: PDF_STYLES.colors.muted,
    });
    this.currentY -= 30;
  }

  addConsentInfo(consent: ConsentWithProfile): void {
    // Signer information box
    this.drawRect(
      this.margin,
      this.currentY - 80,
      this.pageWidth - 2 * this.margin,
      80,
      {
        color: { r: 15, g: 23, b: 42 },
        borderColor: PDF_STYLES.colors.border,
      }
    );

    const boxTop = this.currentY - 10;
    
    this.drawText('SIGNER INFORMATION', {
      y: boxTop,
      x: this.margin + 15,
      size: PDF_STYLES.fonts.small,
      font: this.fonts.bold,
      color: PDF_STYLES.colors.primary,
    });

    this.drawText(`Name: ${consent.profile.full_name}`, {
      y: boxTop - 20,
      x: this.margin + 15,
      size: PDF_STYLES.fonts.body,
      color: PDF_STYLES.colors.text,
    });

    this.drawText(`Email: ${consent.profile.email}`, {
      y: boxTop - 35,
      x: this.margin + 15,
      size: PDF_STYLES.fonts.body,
      color: PDF_STYLES.colors.text,
    });

    if (consent.profile.company_name) {
      this.drawText(`Company: ${consent.profile.company_name}`, {
        y: boxTop - 50,
        x: this.margin + 15,
        size: PDF_STYLES.fonts.body,
        color: PDF_STYLES.colors.text,
      });
    }

    // Right side - Document info
    const rightCol = this.pageWidth / 2 + 20;
    
    this.drawText(`Document ID: ${consent.document_id}`, {
      y: boxTop - 20,
      x: rightCol,
      size: PDF_STYLES.fonts.body,
      color: PDF_STYLES.colors.text,
    });

    this.drawText(`Version: ${consent.policy_version}`, {
      y: boxTop - 35,
      x: rightCol,
      size: PDF_STYLES.fonts.body,
      color: PDF_STYLES.colors.text,
    });

    this.drawText(`Status: ${consent.consent_status.toUpperCase()}`, {
      y: boxTop - 50,
      x: rightCol,
      size: PDF_STYLES.fonts.body,
      font: this.fonts.bold,
      color: PDF_STYLES.colors.success,
    });

    this.currentY -= 100;
  }

  addNDAContent(): void {
    this.checkPageBreak(300);
    
    this.currentY -= 20;
    
    this.drawText('AGREEMENT TERMS', {
      size: PDF_STYLES.fonts.heading,
      font: this.fonts.bold,
      color: PDF_STYLES.colors.primary,
    });
    this.currentY -= 25;

    // Draw NDA text
    const paragraphs = NDA_TEXT_TEMPLATE.trim().split('\n\n');
    
    for (const paragraph of paragraphs) {
      this.checkPageBreak(60);
      
      const isHeading = paragraph === paragraph.toUpperCase() || /^\d+\./.test(paragraph);
      
      const textHeight = this.drawText(paragraph, {
        size: isHeading ? PDF_STYLES.fonts.body : PDF_STYLES.fonts.small,
        font: isHeading ? this.fonts.bold : this.fonts.regular,
        color: isHeading ? PDF_STYLES.colors.text : PDF_STYLES.colors.muted,
      });
      
      this.currentY -= textHeight + 10;
    }
  }

  addConsentChecklist(consent: ConsentWithProfile): void {
    this.checkPageBreak(150);
    
    this.currentY -= 20;
    
    this.drawText('CONSENT ACKNOWLEDGMENTS', {
      size: PDF_STYLES.fonts.heading,
      font: this.fonts.bold,
      color: PDF_STYLES.colors.primary,
    });
    this.currentY -= 25;

    const checklistItems = [
      { label: 'Non-Disclosure Agreement Accepted', value: consent.nda_accepted },
      { label: 'Data Processing Consent', value: consent.data_processing_accepted },
      { label: 'Confidentiality Obligations Acknowledged', value: consent.confidentiality_accepted },
      { label: 'Liability Terms Accepted', value: consent.liability_accepted },
    ];

    for (const item of checklistItems) {
      const checkmark = item.value ? '✓' : '✗';
      const color = item.value ? PDF_STYLES.colors.success : { r: 239, g: 68, b: 68 };
      
      this.drawText(checkmark, {
        size: PDF_STYLES.fonts.body,
        font: this.fonts.bold,
        color,
      });
      
      this.drawText(item.label, {
        x: this.margin + 25,
        size: PDF_STYLES.fonts.body,
        color: PDF_STYLES.colors.text,
      });
      
      this.currentY -= 20;
    }
  }

  async addSignature(signatureBase64: string): Promise<void> {
    this.checkPageBreak(180);
    
    this.currentY -= 30;
    
    this.drawText('ELECTRONIC SIGNATURE', {
      size: PDF_STYLES.fonts.heading,
      font: this.fonts.bold,
      color: PDF_STYLES.colors.primary,
    });
    this.currentY -= 20;

    // Signature box
    const sigBoxHeight = 100;
    const sigBoxWidth = 300;
    
    this.drawRect(
      this.margin,
      this.currentY - sigBoxHeight,
      sigBoxWidth,
      sigBoxHeight,
      {
        color: { r: 30, g: 41, b: 59 },
        borderColor: PDF_STYLES.colors.primary,
        borderWidth: 2,
      }
    );

    // Embed signature image
    if (signatureBase64 && signatureBase64.includes('base64,')) {
      try {
        const base64Data = signatureBase64.split('base64,')[1];
        const sigBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const sigImage = await this.doc.embedPng(sigBytes);
        
        const maxWidth = sigBoxWidth - 20;
        const maxHeight = sigBoxHeight - 20;
        const scale = Math.min(maxWidth / sigImage.width, maxHeight / sigImage.height);
        
        this.page.drawImage(sigImage, {
          x: this.margin + 10,
          y: this.currentY - sigBoxHeight + 10,
          width: sigImage.width * scale,
          height: sigImage.height * scale,
        });
      } catch (error) {
        console.error('Error embedding signature:', error);
        this.drawText('[Signature on file]', {
          x: this.margin + 20,
          y: this.currentY - 50,
          size: PDF_STYLES.fonts.body,
          color: PDF_STYLES.colors.muted,
        });
      }
    }

    // Signature line label
    this.drawText('Authorized Signature', {
      x: this.margin,
      y: this.currentY - sigBoxHeight - 15,
      size: PDF_STYLES.fonts.small,
      color: PDF_STYLES.colors.muted,
    });

    this.currentY -= sigBoxHeight + 30;
  }

  addAuditTrail(consent: ConsentWithProfile): void {
    this.checkPageBreak(200);
    
    this.currentY -= 20;
    
    // Section header with background
    this.drawRect(
      this.margin,
      this.currentY - 25,
      this.pageWidth - 2 * this.margin,
      25,
      { color: PDF_STYLES.colors.primary }
    );
    
    this.drawText('AUDIT TRAIL', {
      y: this.currentY - 18,
      x: this.margin + 10,
      size: PDF_STYLES.fonts.body,
      font: this.fonts.bold,
      color: { r: 255, g: 255, b: 255 },
    });
    
    this.currentY -= 35;

    const signedDate = new Date(consent.signed_at);
    const auditItems: AuditTrailItem[] = [
      { label: 'Consent ID', value: consent.id },
      { label: 'Signed At', value: signedDate.toUTCString() },
      { label: 'IP Address', value: consent.ip_address || 'Not captured' },
      { label: 'Device/User Agent', value: this.truncateText(consent.user_agent || 'Not captured', 60) },
      { label: 'Location', value: this.formatLocation(consent) },
      { label: 'Policy Version', value: consent.policy_version },
      { label: 'Signature Strokes', value: consent.signature_stroke_count.toString() },
    ];

    // Draw audit table
    const colWidth = (this.pageWidth - 2 * this.margin) / 2;
    
    for (let i = 0; i < auditItems.length; i++) {
      const item = auditItems[i];
      const rowY = this.currentY - (i * 22);
      const isEven = i % 2 === 0;
      
      // Row background
      this.drawRect(
        this.margin,
        rowY - 18,
        this.pageWidth - 2 * this.margin,
        20,
        { color: isEven ? { r: 15, g: 23, b: 42 } : { r: 30, g: 41, b: 59 } }
      );
      
      // Label
      this.drawText(item.label + ':', {
        x: this.margin + 10,
        y: rowY - 13,
        size: PDF_STYLES.fonts.small,
        font: this.fonts.bold,
        color: PDF_STYLES.colors.muted,
      });
      
      // Value
      this.drawText(item.value, {
        x: this.margin + colWidth,
        y: rowY - 13,
        size: PDF_STYLES.fonts.small,
        color: PDF_STYLES.colors.text,
        maxWidth: colWidth - 20,
      });
    }
    
    this.currentY -= auditItems.length * 22 + 20;
  }

  addFooter(): void {
    // Watermark on each page
    const pages = this.doc.getPages();
    
    for (const page of pages) {
      const { width, height } = page.getSize();
      
      // Footer line
      page.drawLine({
        start: { x: this.margin, y: 40 },
        end: { x: width - this.margin, y: 40 },
        thickness: 1,
        color: rgb(
          PDF_STYLES.colors.border.r / 255,
          PDF_STYLES.colors.border.g / 255,
          PDF_STYLES.colors.border.b / 255
        ),
      });

      // Watermark text
      page.drawText('DIGITALLY VERIFIED', {
        x: width / 2 - 60,
        y: 25,
        size: PDF_STYLES.fonts.small,
        font: this.fonts.bold,
        color: rgb(
          PDF_STYLES.colors.success.r / 255,
          PDF_STYLES.colors.success.g / 255,
          PDF_STYLES.colors.success.b / 255
        ),
      });

      // Shield icon (text representation)
      page.drawText('🛡️', {
        x: width / 2 - 80,
        y: 23,
        size: 12,
      });

      // Page number
      const pageIndex = pages.indexOf(page) + 1;
      page.drawText(`Page ${pageIndex} of ${pages.length}`, {
        x: width - this.margin - 50,
        y: 25,
        size: PDF_STYLES.fonts.tiny,
        font: this.fonts.regular,
        color: rgb(
          PDF_STYLES.colors.muted.r / 255,
          PDF_STYLES.colors.muted.g / 255,
          PDF_STYLES.colors.muted.b / 255
        ),
      });

      // Generation timestamp
      page.drawText(`Generated: ${new Date().toISOString()}`, {
        x: this.margin,
        y: 25,
        size: PDF_STYLES.fonts.tiny,
        font: this.fonts.regular,
        color: rgb(
          PDF_STYLES.colors.muted.r / 255,
          PDF_STYLES.colors.muted.g / 255,
          PDF_STYLES.colors.muted.b / 255
        ),
      });

      // Diagonal watermark
      page.drawText('VERIFIED COPY', {
        x: width / 2 - 100,
        y: height / 2,
        size: 48,
        font: this.fonts.bold,
        color: rgb(0.5, 0.5, 0.5),
        opacity: 0.05,
        // pdf-lib's own helper. The literal { type: 'degrees', … } happened to work
        // at runtime because RotationTypes.Degrees === 'degrees', but the string
        // does not narrow to the enum, so deno check rejected it (TS2322).
        rotate: degrees(-45),
      });
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  private formatLocation(consent: ConsentWithProfile): string {
    const parts = [
      consent.geo_city,
      consent.geo_region,
      consent.geo_country,
    ].filter(Boolean);
    
    return parts.length > 0 ? parts.join(', ') : 'Not captured';
  }

  async generate(): Promise<Uint8Array> {
    this.addFooter();
    return await this.doc.save();
  }
}

export async function generateConsentPDF(
  consent: ConsentWithProfile
): Promise<PDFGenerationResult> {
  const generator = new PDFGenerator();
  await generator.initialize();
  
  await generator.addHeader();
  generator.addConsentInfo(consent);
  generator.addNDAContent();
  generator.addConsentChecklist(consent);
  await generator.addSignature(consent.signature_base64);
  generator.addAuditTrail(consent);
  
  const pdfBytes = await generator.generate();
  
  const signedDate = new Date(consent.signed_at);
  const filename = `NEXPEC_NDA_Receipt_${consent.id.substring(0, 8)}_${signedDate.toISOString().split('T')[0]}.pdf`;
  
  return {
    pdfBytes,
    filename,
  };
}