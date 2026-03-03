// supabase/functions/send-consent-receipt/constants.ts

// NEXPEC Logo as base64 (simplified SVG converted to base64 PNG)
// In production, you'd host this or use a proper asset
export const NEXPEC_LOGO_BASE64 = `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
SUVORK5CYII=`;

// Legal text template (shortened version for PDF)
export const NDA_TEXT_TEMPLATE = `
CONFIDENTIALITY AND NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement ("Agreement") is entered into as of the date of electronic signature below.

1. DEFINITION OF CONFIDENTIAL INFORMATION
"Confidential Information" means any and all information or data that has or could have commercial value or other utility in the business in which the Disclosing Party is engaged.

2. OBLIGATIONS OF RECEIVING PARTY
The Receiving Party agrees to hold and maintain the Confidential Information in strict confidence using the same degree of care as the Receiving Party uses to protect its own confidential information.

3. DATA PROCESSING CONSENT
By signing this agreement, you acknowledge and consent to the collection, storage, and processing of personal data including your name, email address, device information, IP address, and geographic location.

4. ELECTRONIC SIGNATURE ACKNOWLEDGMENT
Your electronic signature on this document constitutes your legal signature and is legally binding. The timestamp and IP address captured at the time of signing have been recorded.

5. TERM AND TERMINATION
This Agreement shall remain in effect for a period of five (5) years from the date of signature.

6. GOVERNING LAW
This Agreement shall be governed by and construed in accordance with applicable laws.
`;

// Email template
export const EMAIL_TEMPLATE = {
  subject: 'Your Signed NDA Receipt - NEXPEC',
  preheader: 'Your legal consent has been recorded and verified',
};

// PDF styling constants
export const PDF_STYLES = {
  colors: {
    primary: { r: 124, g: 58, b: 237 },      // #7C3AED
    background: { r: 2, g: 4, b: 32 },        // #020420
    text: { r: 241, g: 245, b: 249 },         // #F1F5F9
    muted: { r: 148, g: 163, b: 184 },        // #94A3B8
    success: { r: 16, g: 185, b: 129 },       // #10B981
    border: { r: 30, g: 41, b: 59 },          // #1E293B
  },
  fonts: {
    title: 24,
    heading: 16,
    body: 11,
    small: 9,
    tiny: 8,
  },
  margins: {
    page: 50,
    section: 20,
  },
};

// Function to generate PDF filename
export const generatePDFFileName = (consentId: string): string => {
  const date = new Date().toISOString().slice(0, 10);
  return `NEXPEC_Consent_Receipt_${consentId}_${date}.pdf`;
};