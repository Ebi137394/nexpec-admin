// src/constants/legalText.ts

export const DEFAULT_LEGAL_TEXT = `
CONFIDENTIALITY AND NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement ("Agreement") is entered into as of the date of electronic signature below.

1. DEFINITION OF CONFIDENTIAL INFORMATION

"Confidential Information" means any and all information or data that has or could have commercial value or other utility in the business in which the Disclosing Party is engaged. This includes, but is not limited to:

a) Technical data, trade secrets, know-how, research, product plans, products, services, suppliers, customer lists, markets, software, developments, inventions, processes, formulas, technology, designs, drawings, engineering, hardware configuration information, marketing, finances, or other business information.

b) Project documentation, including but not limited to inspection reports, compliance assessments, safety evaluations, and any related photographic or video evidence.

c) Site-specific information including location data, access credentials, personnel details, and operational procedures.

2. OBLIGATIONS OF RECEIVING PARTY

The Receiving Party agrees to:

a) Hold and maintain the Confidential Information in strict confidence using the same degree of care as the Receiving Party uses to protect its own confidential information, but in no event less than reasonable care.

b) Not copy or duplicate Confidential Information except as reasonably necessary for the purposes described herein.

c) Not disclose any Confidential Information to any third parties without the prior written consent of the Disclosing Party.

d) Promptly notify the Disclosing Party in writing of any misuse or misappropriation of any Confidential Information.

3. DATA PROCESSING CONSENT

By signing this agreement, you acknowledge and consent to:

a) The collection, storage, and processing of personal data including your name, email address, device information, IP address, and geographic location.

b) The transmission of inspection data, reports, and related documentation through secure electronic channels.

c) The retention of consent records and signature data for legal compliance purposes, which may extend beyond the termination of this agreement.

d) The use of collected data for quality assurance, audit trails, and regulatory compliance purposes.

4. ELECTRONIC SIGNATURE ACKNOWLEDGMENT

You acknowledge that:

a) Your electronic signature on this document constitutes your legal signature and is legally binding.

b) The timestamp and IP address captured at the time of signing will be recorded and may be used as evidence of your consent.

c) You have read and understood all terms of this agreement before signing.

5. TERM AND TERMINATION

This Agreement shall remain in effect for a period of five (5) years from the date of signature, unless earlier terminated by written agreement of both parties.

6. GOVERNING LAW

This Agreement shall be governed by and construed in accordance with the laws of the jurisdiction in which the Disclosing Party operates, without regard to conflicts of law principles.

7. COMPLIANCE REQUIREMENTS

You agree to comply with all applicable local, state, federal, and international laws and regulations regarding data protection, privacy, and confidentiality, including but not limited to GDPR, CCPA, and industry-specific regulations.

8. LIABILITY AND INDEMNIFICATION

The Receiving Party agrees to indemnify and hold harmless the Disclosing Party from any damages, losses, or expenses arising from any breach of this Agreement.

9. ACKNOWLEDGMENT

BY SCROLLING TO THE END OF THIS DOCUMENT AND PROVIDING YOUR ELECTRONIC SIGNATURE, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY ALL TERMS AND CONDITIONS SET FORTH IN THIS AGREEMENT.

Last Updated: ${new Date().toLocaleDateString()}
Version: 2.1.0
`;

export const CONSENT_CHECKBOXES: import('../types/consent.types').ConsentCheckboxItem[] = [
  {
    id: 'ndaAccepted',
    label: 'I understand and accept the Non-Disclosure Agreement',
    description: 'I will maintain confidentiality of all project documentation and sensitive information.',
    required: true,
  },
  {
    id: 'dataProcessingAccepted',
    label: 'I consent to data processing as described above',
    description: 'I allow the collection and processing of my personal data for compliance purposes.',
    required: true,
  },
  {
    id: 'confidentialityAccepted',
    label: 'I acknowledge my confidentiality obligations',
    description: 'I understand the legal implications of breaching confidentiality.',
    required: true,
  },
  {
    id: 'liabilityAccepted',
    label: 'I accept liability for any unauthorized disclosure',
    description: 'I accept responsibility for damages resulting from any breach on my part.',
    required: true,
  },
];