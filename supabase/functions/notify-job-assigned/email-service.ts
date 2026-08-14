import { Resend } from "npm:resend";

interface JobAssignmentEmailData {
  inspectorEmail: string;
  inspectorName: string;
  jobTitle: string;
  location: string;
  payoutAmount: string | number; // 🔴 فیکس شد: پشتیبانی از مقادیر عددی برای جلوگیری از ارور
}

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

export async function sendJobAssignmentEmail(data: JobAssignmentEmailData) {
  const htmlContent = generateJobAssignmentEmailHTML(data);
  
  try {
    const result = await resend.emails.send({
      // 🔴 ترفند تست: فرستنده در حالت سندباکس فقط و فقط باید این باشه
      from: "NEXPEC <onboarding@resend.dev>",
      
      // 🔴 ترفند تست: Resend در حالت سندباکس فقط به ایمیل صاحب اکانت پیام می‌دهد.
      //    آدرس شخصی دیگر اینجا hard-code نمی‌شود و از متغیر محیطی خوانده می‌شود.
      //
      // Sandbox override, read from server-side config — never hard-coded.
      // Resend's test mode only delivers to the account owner's address, so
      // RESEND_TEST_RECIPIENT redirects mail there while sandboxing. Leave it
      // UNSET in any real environment and notifications go to the actual
      // inspector, which is the intended behaviour — while it IS set, every
      // assignment notification silently lands in one inbox instead of theirs.
      to: [Deno.env.get("RESEND_TEST_RECIPIENT") ?? data.inspectorEmail],
      
      // ایمیلِ فیکِ بازرس رو می‌ذاریم تو عنوان که بفهمی این پیام مربوط به کی بوده
      subject: `[TEST] New Job Assignment - NEXPEC (For: ${data.inspectorEmail})`,
      
      html: htmlContent,
    });

    // 🔴 گرفتنِ ارورهای مخفی خودِ پکیج Resend
    if (result.error) {
      throw new Error(result.error.message);
    }

    return result;
  } catch (error) {
    console.error("Error sending job assignment email:", error);
    throw error;
  }
}

function generateJobAssignmentEmailHTML(data: JobAssignmentEmailData): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Job Assignment - NEXPEC</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #020420;
            color: #ffffff;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            text-align: center;
            padding: 30px 0;
            background: linear-gradient(135deg, #020420 0%, #1a1c3a 100%);
            border-radius: 16px;
            border: 1px solid #3a3f7a;
            box-shadow: 0 8px 32px rgba(124, 58, 237, 0.1);
        }
        .logo {
            font-size: 28px;
            font-weight: 700;
            color: #7C3AED;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .tagline {
            color: #a0a0c0;
            font-size: 14px;
            font-weight: 500;
        }
        .content-card {
            background: linear-gradient(145deg, #0f1235 0%, #1a1c3a 100%);
            border-radius: 16px;
            padding: 30px;
            margin: 20px 0;
            border: 1px solid #3a3f7a;
            box-shadow: 0 8px 32px rgba(124, 58, 237, 0.1);
        }
        .greeting {
            font-size: 20px;
            font-weight: 600;
            color: #ffffff;
            margin-bottom: 20px;
        }
        .message {
            font-size: 16px;
            line-height: 1.6;
            color: #d0d0f0;
            margin-bottom: 30px;
        }
        .job-details {
            background: rgba(124, 58, 237, 0.1);
            border: 1px solid #7C3AED;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid rgba(124, 58, 237, 0.3);
        }
        .detail-row:last-child {
            border-bottom: none;
        }
        .detail-label {
            color: #a0a0c0;
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .detail-value {
            color: #ffffff;
            font-size: 16px;
            font-weight: 700;
        }
        .payout-highlight {
            color: #7C3AED;
            font-size: 20px;
        }
        .action-button {
            display: inline-block;
            background: linear-gradient(135deg, #7C3AED 0%, #22d3ee 100%);
            color: white;
            padding: 16px 32px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 700;
            font-size: 16px;
            margin: 20px 0;
            text-align: center;
            width: 100%;
            box-shadow: 0 8px 25px rgba(124, 58, 237, 0.3);
            border: none;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .action-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 35px rgba(124, 58, 237, 0.4);
        }
        .footer-note {
            font-size: 14px;
            color: #8a8ab0;
            text-align: center;
            margin-top: 20px;
            line-height: 1.5;
        }
        .divider {
            height: 1px;
            background: linear-gradient(90deg, transparent, #7C3AED, transparent);
            margin: 30px 0;
        }
        @media (max-width: 600px) {
            .container {
                padding: 15px;
            }
            .content-card {
                padding: 20px;
            }
            .detail-row {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">NEXPEC</div>
            <div class="tagline">Professional Inspection Network</div>
        </div>

        <div class="content-card">
            <div class="greeting">Hello ${data.inspectorName},</div>
            
            <div class="message">
                A new inspection job has been assigned to you. Please log in to the NEXPEC app to view the details and start the inspection.
            </div>

            <div class="divider"></div>

            <div class="job-details">
                <div class="detail-row">
                    <span class="detail-label">Job Title</span>
                    <span class="detail-value">${data.jobTitle}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Location</span>
                    <span class="detail-value">${data.location}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Payout Amount</span>
                    <span class="detail-value payout-highlight">${data.payoutAmount}</span>
                </div>
            </div>

            <a href="https://app.nexpec.com" class="action-button">
                View Job Details in App
            </a>

            <div class="footer-note">
                This is an automated notification from NEXPEC. 
                If you have any questions about this assignment, 
                please contact your administrator or check the app.
            </div>
        </div>
    </div>
</body>
</html>
  `;
}