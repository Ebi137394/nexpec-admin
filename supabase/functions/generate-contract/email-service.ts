import { ContractData } from "./types.ts";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || "contracts@nexpec.com";
const NEXPEC_URL = Deno.env.get('NEXPEC_URL') || "https://nexpec.com";

interface EmailRecipient {
  email: string;
  name: string;
  type: 'client' | 'inspector';
}

interface SendEmailOptions {
  to: EmailRecipient;
  contractData: ContractData;
  pdfBase64: string;
  contractUrl: string;
}

export async function sendContractEmail(options: SendEmailOptions): Promise<void> {
  const { to, contractData, pdfBase64, contractUrl } = options;

  const isClient = to.type === 'client';
  const otherParty = isClient 
    ? contractData.inspector.full_name 
    : contractData.client.full_name;

  const emailHtml = generateEmailTemplate({
    recipientName: to.name,
    isClient,
    otherPartyName: otherParty,
    contractData,
    contractUrl,
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `NEXPEC Contracts <${FROM_EMAIL}>`,
      to: [to.email],
      subject: `Service Agreement - ${contractData.job.title} [${contractData.contract_id}]`,
      html: emailHtml,
      attachments: [
        {
          filename: `NEXPEC_Contract_${contractData.contract_id}.pdf`,
          content: pdfBase64,
          type: "application/pdf",
        },
      ],
      tags: [
        { name: "contract_id", value: contractData.contract_id },
        { name: "job_id", value: contractData.job.id },
        { name: "recipient_type", value: to.type },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send email to ${to.email}: ${error}`);
  }

  console.log(`✅ Email sent successfully to ${to.type}: ${to.email}`);
}

interface EmailTemplateData {
  recipientName: string;
  isClient: boolean;
  otherPartyName: string;
  contractData: ContractData;
  contractUrl: string;
}

function generateEmailTemplate(data: EmailTemplateData): string {
  const { recipientName, isClient, otherPartyName, contractData, contractUrl } = data;
  const { job, contract_id, generated_at, valid_until } = contractData;

  const roleLabel = isClient ? "Client" : "Inspector";
  const actionText = isClient 
    ? "Your job request has been accepted by an inspector"
    : "You have been assigned to a new inspection job";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEXPEC Service Agreement</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f7fa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f7fa; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1C6BB1 0%, #145a96 100%); padding: 40px 40px 30px;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="background-color: rgba(255,255,255,0.15); display: inline-block; padding: 12px 20px; border-radius: 8px;">
                      <span style="color: #ffffff; font-size: 24px; font-weight: bold; letter-spacing: 1px;">NEXPEC</span>
                    </div>
                    <p style="color: rgba(255,255,255,0.8); font-size: 14px; margin: 10px 0 0 0;">Industrial Inspection Services</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Orange Accent Bar -->
          <tr>
            <td style="background-color: #F29E12; height: 4px;"></td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <h1 style="color: #1C6BB1; font-size: 24px; margin: 0 0 10px 0;">Service Agreement Generated</h1>
              <p style="color: #666; font-size: 14px; margin: 0 0 30px 0;">Contract ID: <strong>${contract_id}</strong></p>

              <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Dear <strong>${recipientName}</strong>,
              </p>

              <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${actionText}. Please find attached the official Service Agreement for your inspection job.
              </p>

              <!-- Contract Summary Card -->
              <table width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-radius: 8px; margin: 30px 0; border: 1px solid #e2e8f0;">
                <tr>
                  <td style="padding: 25px;">
                    <h3 style="color: #1C6BB1; font-size: 16px; margin: 0 0 20px 0; border-bottom: 2px solid #F29E12; padding-bottom: 10px;">
                      📋 Contract Summary
                    </h3>
                    
                    <table width="100%" cellspacing="0" cellpadding="8">
                      <tr>
                        <td style="color: #666; font-size: 14px; width: 40%;">Job Title:</td>
                        <td style="color: #333; font-size: 14px; font-weight: 600;">${job.title}</td>
                      </tr>
                      <tr>
                        <td style="color: #666; font-size: 14px;">Inspection Type:</td>
                        <td style="color: #333; font-size: 14px;">${job.inspection_type}</td>
                      </tr>
                      <tr>
                        <td style="color: #666; font-size: 14px;">Location:</td>
                        <td style="color: #333; font-size: 14px;">${job.location}</td>
                      </tr>
                      <tr>
                        <td style="color: #666; font-size: 14px;">${isClient ? 'Inspector' : 'Client'}:</td>
                        <td style="color: #333; font-size: 14px;">${otherPartyName}</td>
                      </tr>
                      <tr>
                        <td style="color: #666; font-size: 14px;">Contract Date:</td>
                        <td style="color: #333; font-size: 14px;">${new Date(generated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                      </tr>
                      <tr>
                        <td style="color: #666; font-size: 14px;">Valid Until:</td>
                        <td style="color: #333; font-size: 14px;">${new Date(valid_until).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                      </tr>
                    </table>

                    <!-- Amount Box -->
                    <div style="background-color: #1C6BB1; border-radius: 6px; padding: 15px; margin-top: 20px; text-align: center;">
                      <span style="color: rgba(255,255,255,0.8); font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Total Contract Value</span>
                      <div style="color: #ffffff; font-size: 28px; font-weight: bold; margin-top: 5px;">
                        ${job.currency} ${job.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Action Button -->
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${contractUrl}" style="display: inline-block; background: linear-gradient(135deg, #F29E12 0%, #e08a00 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(242, 158, 18, 0.3);">
                      View Contract Online
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Next Steps -->
              <div style="background-color: #f0f9ff; border-left: 4px solid #1C6BB1; padding: 20px; margin: 30px 0; border-radius: 0 8px 8px 0;">
                <h4 style="color: #1C6BB1; margin: 0 0 10px 0; font-size: 14px;">📌 Next Steps</h4>
                <ol style="color: #333; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>Review the attached contract carefully</li>
                  <li>Sign the document digitally or print & sign manually</li>
                  <li>Upload the signed contract to your NEXPEC dashboard</li>
                  <li>Coordinate with ${otherPartyName} for inspection scheduling</li>
                </ol>
              </div>

              <p style="color: #666; font-size: 14px; line-height: 1.6;">
                If you have any questions about this contract, please don't hesitate to contact our support team.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #21262E; padding: 30px 40px;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <p style="color: #ffffff; font-size: 16px; font-weight: bold; margin: 0 0 5px 0;">NEXPEC</p>
                    <p style="color: #999; font-size: 12px; margin: 0;">Industrial Inspection Services</p>
                  </td>
                  <td align="right">
                    <a href="${NEXPEC_URL}" style="color: #F29E12; font-size: 12px; text-decoration: none;">nexpec.com</a>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 20px; border-top: 1px solid #333; margin-top: 20px;">
                    <p style="color: #666; font-size: 11px; margin: 15px 0 0 0; text-align: center;">
                      This is an automated message from NEXPEC. Please do not reply directly to this email.<br>
                      © ${new Date().getFullYear()} NEXPEC Industries Ltd. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
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

export async function sendContractEmails(
  contractData: ContractData,
  pdfBase64: string,
  contractUrl: string
): Promise<void> {
  const recipients: EmailRecipient[] = [
    {
      email: contractData.client.email,
      name: contractData.client.full_name,
      type: 'client',
    },
    {
      email: contractData.inspector.email,
      name: contractData.inspector.full_name,
      type: 'inspector',
    },
  ];

  const emailPromises = recipients.map((recipient) =>
    sendContractEmail({
      to: recipient,
      contractData,
      pdfBase64,
      contractUrl,
    })
  );

  await Promise.all(emailPromises);
  console.log(`✅ All contract emails sent successfully`);
}