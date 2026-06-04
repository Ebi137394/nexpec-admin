import {
  PDFDocument,
  rgb,
  StandardFonts,
  PDFPage,
  PDFFont,
} from "https://esm.sh/pdf-lib@1.17.1";
import { encode as base64Encode } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { ContractData, Profile, Job } from "./types.ts";
// import fontkit from "https://esm.sh/@pdf-lib/fontkit";

// NEXPEC Brand Colors
const COLORS = {
  primary: rgb(0.11, 0.42, 0.69),      // #1C6BB1 - Professional Blue
  secondary: rgb(0.95, 0.62, 0.07),    // #F29E12 - Industrial Orange
  dark: rgb(0.13, 0.15, 0.18),         // #21262E - Dark Gray
  light: rgb(0.96, 0.97, 0.98),        // #F5F7FA - Light Gray
  text: rgb(0.2, 0.2, 0.2),            // #333333 - Text
  muted: rgb(0.5, 0.5, 0.5),           // #808080 - Muted
  success: rgb(0.13, 0.59, 0.33),      // #229754 - Success Green
  border: rgb(0.85, 0.87, 0.89),       // #D9DEE3 - Border
};

const PAGE_MARGIN = 50;
const PAGE_WIDTH = 595.28;  // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2);

export class PDFContractGenerator {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private fonts!: {
    regular: PDFFont;
    bold: PDFFont;
    italic: PDFFont;
    persian: PDFFont;
  };
  private yPosition: number = PAGE_HEIGHT - PAGE_MARGIN;
  private pageNumber: number = 1;

  async generateContract(data: ContractData, signatureBase64?: string): Promise<Uint8Array> {
    // Create new PDF document
    this.doc = await PDFDocument.create();
    // this.doc.registerFontkit(fontkit);
    
    // Load fonts
    this.fonts = {
      regular: await this.doc.embedFont(StandardFonts.Helvetica),
      bold: await this.doc.embedFont(StandardFonts.HelveticaBold),
      italic: await this.doc.embedFont(StandardFonts.HelveticaOblique),
      persian: await this.doc.embedFont(StandardFonts.Helvetica),
    };

    // Add first page
    this.addNewPage();
    
    // Generate content
    await this.addHeader(data);
    this.addTitle();
    this.addContractInfo(data);
    this.addDivider();
    this.addClientSection(data.client);
    this.addDivider();
    this.addInspectorSection(data.inspector);
    this.addDivider();
    this.addScopeOfWork(data.job);
    this.addDivider();
    this.addFinancialTerms(data);
    this.addDivider();
    this.addTermsAndConditions();
    this.addDivider();
    this.addSignatureSection(data);
    this.addFooter(data);

    // Add page numbers to all pages
    this.addPageNumbers();

    // Add signature if provided
    if (signatureBase64) {
      await this.addSignatureImage(signatureBase64);
    }

    return await this.doc.save();
  }

  private addNewPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.yPosition = PAGE_HEIGHT - PAGE_MARGIN;
    this.pageNumber++;
  }

  private async loadPersianFont(): Promise<PDFFont> {
    // For now, return Helvetica as fallback
    // In production, implement proper Persian font loading
    return await this.doc.embedFont(StandardFonts.Helvetica);
  }

  private async addSignatureImage(signatureBase64: string): Promise<void> {
    try {
      // Remove data URL prefix if present
      const base64Data = signatureBase64.replace(/^data:image\/png;base64,/, "");
      const signatureImage = await this.doc.embedPng(base64Data);
      
      // Add signature to the last page
      const lastPage = this.doc.getPages().pop();
      if (lastPage) {
        lastPage.drawImage(signatureImage, {
          x: 100,
          y: 150,
          width: 100,
          height: 50,
        });
      }
    } catch (error) {
      console.error("Failed to embed signature image:", error);
    }
  }

  private checkPageBreak(requiredSpace: number = 100): void {
    if (this.yPosition < PAGE_MARGIN + requiredSpace) {
      this.addNewPage();
    }
  }

  private async addHeader(data: ContractData): Promise<void> {
    const { page, fonts } = this;

    // Logo placeholder (rectangle with company name)
    // In production, embed actual logo using doc.embedPng() or doc.embedJpg()
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: this.yPosition - 50,
      width: 120,
      height: 50,
      color: COLORS.primary,
      borderRadius: 4,
    });

    // Company name in logo
    page.drawText("NEXPEC", {
      x: PAGE_MARGIN + 15,
      y: this.yPosition - 35,
      size: 20,
      font: fonts.bold,
      color: rgb(1, 1, 1),
    });

    // Tagline
    page.drawText("Industrial Inspections", {
      x: PAGE_MARGIN + 12,
      y: this.yPosition - 47,
      size: 7,
      font: fonts.regular,
      color: rgb(1, 1, 1),
    });

    // Company info on the right
    const companyInfo = [
      "NEXPEC Industries Ltd.",
      "123 Industrial Boulevard",
      "Houston, TX 77001",
      "contact@nexpec.com",
      "+1 (555) 123-4567",
    ];

    let rightY = this.yPosition - 10;
    companyInfo.forEach((line) => {
      const textWidth = fonts.regular.widthOfTextAtSize(line, 9);
      page.drawText(line, {
        x: PAGE_WIDTH - PAGE_MARGIN - textWidth,
        y: rightY,
        size: 9,
        font: fonts.regular,
        color: COLORS.muted,
      });
      rightY -= 12;
    });

    this.yPosition -= 80;
  }

  private addTitle(): void {
    const { page, fonts } = this;

    // Orange accent line
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: this.yPosition - 5,
      width: CONTENT_WIDTH,
      height: 3,
      color: COLORS.secondary,
    });

    this.yPosition -= 40;

    // Main title
    const title = "SERVICE AGREEMENT";
    const titleWidth = fonts.bold.widthOfTextAtSize(title, 24);
    page.drawText(title, {
      x: (PAGE_WIDTH - titleWidth) / 2,
      y: this.yPosition,
      size: 24,
      font: fonts.bold,
      color: COLORS.primary,
    });

    this.yPosition -= 25;

    // Subtitle
    const subtitle = "Industrial Inspection Services Contract";
    const subtitleWidth = fonts.regular.widthOfTextAtSize(subtitle, 12);
    page.drawText(subtitle, {
      x: (PAGE_WIDTH - subtitleWidth) / 2,
      y: this.yPosition,
      size: 12,
      font: fonts.regular,
      color: COLORS.muted,
    });

    this.yPosition -= 30;
  }

  private addContractInfo(data: ContractData): void {
    const { page, fonts } = this;

    // Contract info box
    const boxHeight = 60;
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: this.yPosition - boxHeight,
      width: CONTENT_WIDTH,
      height: boxHeight,
      color: COLORS.light,
      borderColor: COLORS.border,
      borderWidth: 1,
    });

    // Contract details in three columns
    const col1X = PAGE_MARGIN + 20;
    const col2X = PAGE_MARGIN + CONTENT_WIDTH / 3 + 10;
    const col3X = PAGE_MARGIN + (CONTENT_WIDTH * 2) / 3 + 10;
    const labelY = this.yPosition - 20;
    const valueY = this.yPosition - 38;

    // Column 1: Contract ID
    page.drawText("CONTRACT ID", {
      x: col1X,
      y: labelY,
      size: 8,
      font: fonts.bold,
      color: COLORS.muted,
    });
    page.drawText(data.contract_id, {
      x: col1X,
      y: valueY,
      size: 11,
      font: fonts.bold,
      color: COLORS.dark,
    });

    // Column 2: Issue Date
    page.drawText("ISSUE DATE", {
      x: col2X,
      y: labelY,
      size: 8,
      font: fonts.bold,
      color: COLORS.muted,
    });
    page.drawText(this.formatDate(data.generated_at), {
      x: col2X,
      y: valueY,
      size: 11,
      font: fonts.bold,
      color: COLORS.dark,
    });

    // Column 3: Valid Until
    page.drawText("VALID UNTIL", {
      x: col3X,
      y: labelY,
      size: 8,
      font: fonts.bold,
      color: COLORS.muted,
    });
    page.drawText(this.formatDate(data.valid_until), {
      x: col3X,
      y: valueY,
      size: 11,
      font: fonts.bold,
      color: COLORS.dark,
    });

    this.yPosition -= boxHeight + 20;
  }

  private addClientSection(client: Profile): void {
    this.addSectionHeader("CLIENT INFORMATION", "01");
    this.addProfileInfo(client, "Client");
  }

  private addInspectorSection(inspector: Profile): void {
    this.addSectionHeader("INSPECTOR INFORMATION", "02");
    this.addProfileInfo(inspector, "Inspector");
  }

  private addSectionHeader(title: string, number: string): void {
    const { page, fonts } = this;
    
    this.checkPageBreak(150);

    // Section number badge
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: this.yPosition - 18,
      width: 24,
      height: 20,
      color: COLORS.secondary,
      borderRadius: 3,
    });

    page.drawText(number, {
      x: PAGE_MARGIN + 7,
      y: this.yPosition - 14,
      size: 10,
      font: fonts.bold,
      color: rgb(1, 1, 1),
    });

    // Section title
    page.drawText(title, {
      x: PAGE_MARGIN + 35,
      y: this.yPosition - 12,
      size: 12,
      font: fonts.bold,
      color: COLORS.primary,
    });

    this.yPosition -= 35;
  }

  private addProfileInfo(profile: Profile, role: string): void {
    const { page, fonts } = this;

    const info = [
      { label: `${role} Name:`, value: profile.full_name },
      { label: "Company:", value: profile.company_name || "N/A" },
      { label: "Email:", value: profile.email },
      { label: "Phone:", value: profile.phone || "N/A" },
      { 
        label: "Address:", 
        value: this.formatAddress(profile) 
      },
    ];

    info.forEach((item) => {
      // Label
      page.drawText(item.label, {
        x: PAGE_MARGIN + 10,
        y: this.yPosition,
        size: 10,
        font: fonts.bold,
        color: COLORS.muted,
      });

      // Value
      page.drawText(item.value, {
        x: PAGE_MARGIN + 100,
        y: this.yPosition,
        size: 10,
        font: fonts.regular,
        color: COLORS.dark,
      });

      this.yPosition -= 18;
    });

    this.yPosition -= 10;
  }

  private addScopeOfWork(job: Job): void {
    const { page, fonts } = this;

    this.addSectionHeader("SCOPE OF WORK", "03");

    const scopeItems = [
      { label: "Job Title:", value: job.title },
      { label: "Inspection Type:", value: job.inspection_type },
      { label: "Location:", value: job.location },
      { label: "Scheduled Date:", value: job.scheduled_date ? this.formatDate(job.scheduled_date) : "To be confirmed" },
      { label: "Deadline:", value: job.deadline ? this.formatDate(job.deadline) : "N/A" },
    ];

    scopeItems.forEach((item) => {
      page.drawText(item.label, {
        x: PAGE_MARGIN + 10,
        y: this.yPosition,
        size: 10,
        font: fonts.bold,
        color: COLORS.muted,
      });

      page.drawText(item.value, {
        x: PAGE_MARGIN + 120,
        y: this.yPosition,
        size: 10,
        font: fonts.regular,
        color: COLORS.dark,
      });

      this.yPosition -= 18;
    });

    // Description
    this.yPosition -= 10;
    page.drawText("Description:", {
      x: PAGE_MARGIN + 10,
      y: this.yPosition,
      size: 10,
      font: fonts.bold,
      color: COLORS.muted,
    });
    this.yPosition -= 18;

    // Wrap and draw description text
    const descLines = this.wrapText(job.description || "No description provided.", 85);
    descLines.forEach((line) => {
      this.checkPageBreak(20);
      page.drawText(line, {
        x: PAGE_MARGIN + 10,
        y: this.yPosition,
        size: 10,
        font: fonts.regular,
        color: COLORS.dark,
      });
      this.yPosition -= 15;
    });

    // Special Requirements
    if (job.special_requirements) {
      this.yPosition -= 10;
      page.drawText("Special Requirements:", {
        x: PAGE_MARGIN + 10,
        y: this.yPosition,
        size: 10,
        font: fonts.bold,
        color: COLORS.muted,
      });
      this.yPosition -= 18;

      const reqLines = this.wrapText(job.special_requirements, 85);
      reqLines.forEach((line) => {
        this.checkPageBreak(20);
        page.drawText(line, {
          x: PAGE_MARGIN + 10,
          y: this.yPosition,
          size: 10,
          font: fonts.regular,
          color: COLORS.dark,
        });
        this.yPosition -= 15;
      });
    }

    this.yPosition -= 10;
  }

  private addFinancialTerms(data: ContractData): void {
    const { page, fonts } = this;

    this.addSectionHeader("FINANCIAL TERMS", "04");
    
    this.checkPageBreak(120);

    // Financial summary box
    const boxHeight = 80;
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: this.yPosition - boxHeight,
      width: CONTENT_WIDTH,
      height: boxHeight,
      color: COLORS.light,
      borderColor: COLORS.border,
      borderWidth: 1,
    });

    // Service Fee
    page.drawText("Service Fee:", {
      x: PAGE_MARGIN + 20,
      y: this.yPosition - 25,
      size: 11,
      font: fonts.regular,
      color: COLORS.dark,
    });

    const serviceFee = data.job.total_amount * 0.85;
    page.drawText(`${data.job.currency} ${serviceFee.toFixed(2)}`, {
      x: PAGE_MARGIN + CONTENT_WIDTH - 120,
      y: this.yPosition - 25,
      size: 11,
      font: fonts.regular,
      color: COLORS.dark,
    });

    // Platform Fee
    page.drawText("Platform Fee (15%):", {
      x: PAGE_MARGIN + 20,
      y: this.yPosition - 45,
      size: 11,
      font: fonts.regular,
      color: COLORS.muted,
    });

    const platformFee = data.job.total_amount * 0.15;
    page.drawText(`${data.job.currency} ${platformFee.toFixed(2)}`, {
      x: PAGE_MARGIN + CONTENT_WIDTH - 120,
      y: this.yPosition - 45,
      size: 11,
      font: fonts.regular,
      color: COLORS.muted,
    });

    // Divider line
    page.drawLine({
      start: { x: PAGE_MARGIN + 20, y: this.yPosition - 55 },
      end: { x: PAGE_MARGIN + CONTENT_WIDTH - 20, y: this.yPosition - 55 },
      thickness: 1,
      color: COLORS.border,
    });

    // Total
    page.drawText("TOTAL AMOUNT:", {
      x: PAGE_MARGIN + 20,
      y: this.yPosition - 72,
      size: 12,
      font: fonts.bold,
      color: COLORS.dark,
    });

    page.drawText(`${data.job.currency} ${data.job.total_amount.toFixed(2)}`, {
      x: PAGE_MARGIN + CONTENT_WIDTH - 120,
      y: this.yPosition - 72,
      size: 14,
      font: fonts.bold,
      color: COLORS.success,
    });

    this.yPosition -= boxHeight + 20;

    // Payment terms
    const paymentTerms = [
      "• Payment is due within 30 days of invoice date.",
      "• A 50% deposit may be required before work commences.",
      "• Late payments may incur a 2% monthly interest charge.",
      "• All prices are exclusive of applicable taxes unless stated otherwise.",
    ];

    page.drawText("Payment Terms:", {
      x: PAGE_MARGIN + 10,
      y: this.yPosition,
      size: 10,
      font: fonts.bold,
      color: COLORS.muted,
    });
    this.yPosition -= 18;

    paymentTerms.forEach((term) => {
      this.checkPageBreak(20);
      page.drawText(term, {
        x: PAGE_MARGIN + 10,
        y: this.yPosition,
        size: 9,
        font: fonts.regular,
        color: COLORS.dark,
      });
      this.yPosition -= 14;
    });

    this.yPosition -= 10;
  }

  private addTermsAndConditions(): void {
    const { page, fonts } = this;

    this.addSectionHeader("TERMS & CONDITIONS", "05");

    const terms = [
      {
        title: "1. Service Delivery",
        content: "The Inspector agrees to perform the inspection services as described in the Scope of Work section with due diligence and in accordance with applicable industry standards and regulations."
      },
      {
        title: "2. Confidentiality",
        content: "Both parties agree to keep confidential all proprietary information disclosed during the course of this agreement and not to disclose such information to third parties without prior written consent."
      },
      {
        title: "3. Liability",
        content: "The Inspector's liability shall be limited to the total contract value. Neither party shall be liable for indirect, incidental, or consequential damages."
      },
      {
        title: "4. Cancellation",
        content: "Either party may cancel this agreement with 48 hours written notice. Cancellation fees may apply as per NEXPEC's standard cancellation policy."
      },
      {
        title: "5. Dispute Resolution",
        content: "Any disputes arising from this agreement shall be resolved through arbitration in accordance with the rules of the American Arbitration Association."
      },
    ];

    terms.forEach((term) => {
      this.checkPageBreak(50);

      page.drawText(term.title, {
        x: PAGE_MARGIN + 10,
        y: this.yPosition,
        size: 10,
        font: fonts.bold,
        color: COLORS.dark,
      });
      this.yPosition -= 15;

      const lines = this.wrapText(term.content, 90);
      lines.forEach((line) => {
        this.checkPageBreak(15);
        page.drawText(line, {
          x: PAGE_MARGIN + 10,
          y: this.yPosition,
          size: 9,
          font: fonts.regular,
          color: COLORS.muted,
        });
        this.yPosition -= 12;
      });

      this.yPosition -= 8;
    });

    this.yPosition -= 10;
  }

  private addSignatureSection(data: ContractData): void {
    const { page, fonts } = this;

    this.checkPageBreak(180);
    this.addSectionHeader("SIGNATURES", "06");

    const colWidth = (CONTENT_WIDTH - 40) / 2;
    const col1X = PAGE_MARGIN + 10;
    const col2X = PAGE_MARGIN + colWidth + 30;

    // Client Signature
    page.drawText("CLIENT", {
      x: col1X,
      y: this.yPosition,
      size: 10,
      font: fonts.bold,
      color: COLORS.primary,
    });

    page.drawText("INSPECTOR", {
      x: col2X,
      y: this.yPosition,
      size: 10,
      font: fonts.bold,
      color: COLORS.primary,
    });

    this.yPosition -= 30;

    // Signature lines
    page.drawLine({
      start: { x: col1X, y: this.yPosition },
      end: { x: col1X + colWidth - 20, y: this.yPosition },
      thickness: 1,
      color: COLORS.dark,
    });

    page.drawLine({
      start: { x: col2X, y: this.yPosition },
      end: { x: col2X + colWidth - 20, y: this.yPosition },
      thickness: 1,
      color: COLORS.dark,
    });

    this.yPosition -= 15;

    page.drawText(data.client.full_name, {
      x: col1X,
      y: this.yPosition,
      size: 10,
      font: fonts.regular,
      color: COLORS.dark,
    });

    page.drawText(data.inspector.full_name, {
      x: col2X,
      y: this.yPosition,
      size: 10,
      font: fonts.regular,
      color: COLORS.dark,
    });

    this.yPosition -= 15;

    page.drawText("Signature", {
      x: col1X,
      y: this.yPosition,
      size: 8,
      font: fonts.italic,
      color: COLORS.muted,
    });

    page.drawText("Signature", {
      x: col2X,
      y: this.yPosition,
      size: 8,
      font: fonts.italic,
      color: COLORS.muted,
    });

    this.yPosition -= 35;

    // Date lines
    page.drawLine({
      start: { x: col1X, y: this.yPosition },
      end: { x: col1X + colWidth - 20, y: this.yPosition },
      thickness: 1,
      color: COLORS.dark,
    });

    page.drawLine({
      start: { x: col2X, y: this.yPosition },
      end: { x: col2X + colWidth - 20, y: this.yPosition },
      thickness: 1,
      color: COLORS.dark,
    });

    this.yPosition -= 15;

    page.drawText("Date", {
      x: col1X,
      y: this.yPosition,
      size: 8,
      font: fonts.italic,
      color: COLORS.muted,
    });

    page.drawText("Date", {
      x: col2X,
      y: this.yPosition,
      size: 8,
      font: fonts.italic,
      color: COLORS.muted,
    });

    this.yPosition -= 20;
  }

  private addDivider(): void {
    const { page } = this;
    
    this.checkPageBreak(30);
    
    page.drawLine({
      start: { x: PAGE_MARGIN, y: this.yPosition },
      end: { x: PAGE_WIDTH - PAGE_MARGIN, y: this.yPosition },
      thickness: 0.5,
      color: COLORS.border,
    });
    
    this.yPosition -= 20;
  }

  private addFooter(data: ContractData): void {
    const { page, fonts } = this;

    // Bottom of each page footer will be added separately
    const pages = this.doc.getPages();
    
    pages.forEach((p: PDFPage, index: number) => {
      // Footer line
      p.drawLine({
        start: { x: PAGE_MARGIN, y: 40 },
        end: { x: PAGE_WIDTH - PAGE_MARGIN, y: 40 },
        thickness: 0.5,
        color: COLORS.border,
      });

      // Generated timestamp
      const timestamp = `Generated: ${this.formatDateTime(data.generated_at)}`;
      p.drawText(timestamp, {
        x: PAGE_MARGIN,
        y: 25,
        size: 8,
        font: fonts.regular,
        color: COLORS.muted,
      });

      // Contract ID
      const contractId = `Contract: ${data.contract_id}`;
      const contractIdWidth = fonts.regular.widthOfTextAtSize(contractId, 8);
      p.drawText(contractId, {
        x: PAGE_WIDTH - PAGE_MARGIN - contractIdWidth,
        y: 25,
        size: 8,
        font: fonts.regular,
        color: COLORS.muted,
      });

      // Confidentiality notice
      const notice = "CONFIDENTIAL - This document contains proprietary information.";
      const noticeWidth = fonts.italic.widthOfTextAtSize(notice, 7);
      p.drawText(notice, {
        x: (PAGE_WIDTH - noticeWidth) / 2,
        y: 15,
        size: 7,
        font: fonts.italic,
        color: COLORS.muted,
      });
    });
  }

  private addPageNumbers(): void {
    const { fonts } = this;
    const pages = this.doc.getPages();
    const totalPages = pages.length;

    pages.forEach((page: PDFPage, index: number) => {
      const pageNum = `Page ${index + 1} of ${totalPages}`;
      const pageNumWidth = fonts.regular.widthOfTextAtSize(pageNum, 8);
      
      page.drawText(pageNum, {
        x: (PAGE_WIDTH - pageNumWidth) / 2,
        y: 25,
        size: 8,
        font: fonts.regular,
        color: COLORS.muted,
      });
    });
  }

  // Utility methods
  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  private formatDateTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }

  private formatAddress(profile: Profile): string {
    const parts = [
      profile.address,
      profile.city,
      profile.state,
      profile.zip_code,
      profile.country,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  }

  private wrapText(text: string, maxCharsPerLine: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    words.forEach((word) => {
      if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
        currentLine = (currentLine + ' ' + word).trim();
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    });

    if (currentLine) lines.push(currentLine);
    return lines;
  }
}

export async function generateContractPDF(data: ContractData): Promise<Uint8Array> {
  const generator = new PDFContractGenerator();
  return await generator.generateContract(data);
}