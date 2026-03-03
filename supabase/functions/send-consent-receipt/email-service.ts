// supabase/functions/send-consent-receipt/email-service.ts

import { EmailResult, ConsentWithProfile } from './types.ts';
import { EMAIL_TEMPLATE } from './constants.ts';

interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: string;
  }>;
}

export async function sendConsentReceiptEmail(
  consent: ConsentWithProfile,
  pdfBytes: Uint8Array,
  filename: string
): Promise<EmailResult> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY environment variable is not set');
  }

  const fromEmail = Deno.env.get('FROM_EMAIL') || 'noreply@nexpec.com';
  const signedDate = new Date(consent.signed_at);

  // Convert PDF bytes to base64
  const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));

  const emailHtml = generateEmailHtml(consent, signedDate);

  const emailPayload: ResendEmailPayload = {
    from: `NEXPEC Legal <${fromEmail}>`,
    to: [consent.profile.email],
    subject: EMAIL_TEMPLATE.subject,
    html: emailHtml,
    attachments: [
      {
        filename,
        content: pdfBase64,
      },
    ],
  };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Resend API error: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      messageId: result.id,
    };
  } catch (error) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function generateEmailHtml(consent: ConsentWithProfile, signedDate: Date): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>NDA Receipt - NEXPEC</title>
  <!--[if mso]>
  <style type="text/css">
    table { border-collapse: collapse; }
    td { padding: 0; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #020420; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #020420;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%); padding: 15px 30px; border-radius: 12px;">
                    <span style="font-size: 28px; font-weight: 700; color: #FFFFFF; letter-spacing: 2px;">NEXPEC</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background-color: #0F172A; border-radius: 16px; overflow: hidden; border: 1px solid #1E293B;">
              
              <!-- Success Banner -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); padding: 25px; text-align: center;">
                    <div style="font-size: 40px; margin-bottom: 10px;">✓</div>
                    <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 700;">Consent Successfully Recorded</h1>
                    <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Your NDA has been digitally signed and verified</p>
                  </td>
                </tr>
              </table>

              <!-- Content -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 30px;">
                    
                    <!-- Greeting -->
                    <p style="margin: 0 0 20px 0; color: #F1F5F9; font-size: 16px; line-height: 1.6;">
                      Dear <strong>${consent.profile.full_name}</strong>,
                    </p>
                    
                    <p style="margin: 0 0 25px 0; color: #94A3B8; font-size: 14px; line-height: 1.7;">
                      Thank you for completing the Non-Disclosure Agreement. Your electronic signature has been 
                      recorded and a copy of your signed agreement is attached to this email for your records.
                    </p>

                    <!-- Info Box -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                      <tr>
                        <td style="background-color: #1E293B; border-radius: 12px; padding: 20px; border-left: 4px solid #7C3AED;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            <tr>
                              <td width="50%" style="padding: 8px 0;">
                                <span style="color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Document ID</span><br>
                                <span style="color: #F1F5F9; font-size: 14px; font-weight: 600;">${consent.document_id}</span>
                              </td>
                              <td width="50%" style="padding: 8px 0;">
                                <span style="color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Signed At</span><br>
                                <span style="color: #F1F5F9; font-size: 14px; font-weight: 600;">${signedDate.toLocaleDateString('en-US', { 
                                  year: 'numeric', 
                                  month: 'long', 
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZoneName: 'short'
                                })}</span>
                              </td>
                            </tr>
                            <tr>
                              <td width="50%" style="padding: 8px 0;">
                                <span style="color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Version</span><br>
                                <span style="color: #F1F5F9; font-size: 14px; font-weight: 600;">${consent.policy_version}</span>
                              </td>
                              <td width="50%" style="padding: 8px 0;">
                                <span style="color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Status</span><br>
                                <span style="color: #10B981; font-size: 14px; font-weight: 600;">✓ VERIFIED</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Checklist -->
                    <p style="margin: 0 0 15px 0; color: #F1F5F9; font-size: 14px; font-weight: 600;">
                      Acknowledged Terms:
                    </p>
                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                      ${[
                        { label: 'Non-Disclosure Agreement', checked: consent.nda_accepted },
                        { label: 'Data Processing Consent', checked: consent.data_processing_accepted },
                        { label: 'Confidentiality Obligations', checked: consent.confidentiality_accepted },
                        { label: 'Liability Terms', checked: consent.liability_accepted },
                      ].map(item => `
                        <tr>
                          <td style="padding: 6px 0;">
                            <span style="display: inline-block; width: 20px; height: 20px; background-color: ${item.checked ? '#10B981' : '#EF4444'}; border-radius: 4px; text-align: center; line-height: 20px; font-size: 12px; color: white; margin-right: 12px;">${item.checked ? '✓' : '✗'}</span>
                            <span style="color: #94A3B8; font-size: 14px;">${item.label}</span>
                          </td>
                        </tr>
                      `).join('')}
                    </table>

                    <!-- Attachment Notice -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                      <tr>
                        <td style="background-color: rgba(124, 58, 237, 0.1); border: 1px solid rgba(124, 58, 237, 0.3); border-radius: 12px; padding: 20px; text-align: center;">
                          <div style="font-size: 32px; margin-bottom: 10px;">📎</div>
                          <p style="margin: 0; color: #F1F5F9; font-size: 14px; font-weight: 600;">
                            PDF Receipt Attached
                          </p>
                          <p style="margin: 8px 0 0 0; color: #94A3B8; font-size: 12px;">
                            Please save this document for your records
                          </p>
                        </td>
                      </tr>
                    </table>

                    <!-- Important Notice -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 15px;">
                          <p style="margin: 0; color: #F59E0B; font-size: 13px;">
                            <strong>⚠️ Important:</strong> This agreement is legally binding. The terms outlined in the NDA 
                            remain in effect for the duration specified. Please retain this receipt for your records.
                          </p>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

              <!-- Footer -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background-color: #1E293B; padding: 20px 30px; border-top: 1px solid #334155;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center">
                          <p style="margin: 0 0 10px 0; color: #10B981; font-size: 12px; font-weight: 600; letter-spacing: 1px;">
                            🛡️ DIGITALLY VERIFIED
                          </p>
                          <p style="margin: 0; color: #64748B; font-size: 11px;">
                            Consent ID: ${consent.id}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Bottom Footer -->
          <tr>
            <td style="padding: 30px 20px; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #64748B; font-size: 12px;">
                This is an automated message from NEXPEC Legal Compliance System.
              </p>
              <p style="margin: 0; color: #475569; font-size: 11px;">
                © ${new Date().getFullYear()} NEXPEC. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}