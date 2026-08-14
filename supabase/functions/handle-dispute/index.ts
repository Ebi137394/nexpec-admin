// ============================================================================
// NEXPEC - Handle Dispute Edge Function
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// ----------------------------------------------------------------------------
// Types & Interfaces
// ----------------------------------------------------------------------------

interface DisputeRequest {
  project_id: string;
  reason_category: DisputeReasonCategory;
  reason: string;
  evidence_urls: string[];
  priority?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
}

type DisputeReasonCategory = 
  | 'incomplete_report'
  | 'wrong_data'
  | 'professional_misconduct'
  | 'delayed_delivery'
  | 'quality_issues'
  | 'safety_violations'
  | 'other';

interface ProjectDetails {
  id: string;
  title: string;
  status: string;
  client_id: string;
  inspector_id: string;
  client: {
    id: string;
    full_name: string;
    email: string;
  };
  inspector: {
    id: string;
    full_name: string;
    email: string;
  };
}

interface AdminUser {
  id: string;
  full_name: string;
  email: string;
}

interface DisputeRecord {
  id: string;
  project_id: string;
  raised_by: string;
  reason_category: string;
  reason: string;
  evidence_urls: string[];
  status: string;
  priority: string;
  created_at: string;
}

interface EmailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REASON_LABELS: Record<DisputeReasonCategory, string> = {
  incomplete_report: "Incomplete Report",
  wrong_data: "Wrong Data",
  professional_misconduct: "Professional Misconduct",
  delayed_delivery: "Delayed Delivery",
  quality_issues: "Quality Issues",
  safety_violations: "Safety Violations",
  other: "Other",
};

// ----------------------------------------------------------------------------
// Validation Functions
// ----------------------------------------------------------------------------

function validateDisputeRequest(body: unknown): { valid: boolean; error?: string; data?: DisputeRequest } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: "Request body is required" };
  }

  const request = body as Record<string, unknown>;

  // Validate project_id
  if (!request.project_id || typeof request.project_id !== 'string') {
    return { valid: false, error: "project_id is required and must be a string" };
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(request.project_id)) {
    return { valid: false, error: "project_id must be a valid UUID" };
  }

  // Validate reason_category
  const validCategories: DisputeReasonCategory[] = [
    'incomplete_report', 'wrong_data', 'professional_misconduct',
    'delayed_delivery', 'quality_issues', 'safety_violations', 'other'
  ];
  
  if (!request.reason_category || !validCategories.includes(request.reason_category as DisputeReasonCategory)) {
    return { valid: false, error: `reason_category must be one of: ${validCategories.join(', ')}` };
  }

  // Validate reason text
  if (!request.reason || typeof request.reason !== 'string') {
    return { valid: false, error: "reason is required and must be a string" };
  }

  if (request.reason.length < 10 || request.reason.length > 2000) {
    return { valid: false, error: "reason must be between 10 and 2000 characters" };
  }

  // Validate evidence_urls
  if (!Array.isArray(request.evidence_urls)) {
    return { valid: false, error: "evidence_urls must be an array" };
  }

  if (request.evidence_urls.length > 10) {
    return { valid: false, error: "Maximum 10 evidence files allowed" };
  }

  // Validate each URL
  for (const url of request.evidence_urls) {
    if (typeof url !== 'string' || !url.startsWith('http')) {
      return { valid: false, error: "Each evidence_url must be a valid URL string" };
    }
  }

  // Validate priority if provided
  if (request.priority) {
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (!validPriorities.includes(request.priority as string)) {
      return { valid: false, error: `priority must be one of: ${validPriorities.join(', ')}` };
    }
  }

  return {
    valid: true,
    data: {
      project_id: request.project_id,
      reason_category: request.reason_category as DisputeReasonCategory,
      reason: request.reason,
      evidence_urls: request.evidence_urls as string[],
      priority: (request.priority as 'low' | 'medium' | 'high' | 'critical') || 'medium',
      metadata: (request.metadata as Record<string, unknown>) || {},
    },
  };
}

// ----------------------------------------------------------------------------
// Email Template Functions
// ----------------------------------------------------------------------------

function generateDisputeEmailHTML(
  recipientName: string,
  recipientRole: 'inspector' | 'admin',
  dispute: DisputeRecord,
  project: ProjectDetails,
  clientName: string
): string {
  const baseUrl = Deno.env.get("APP_BASE_URL") || "https://nexpec.app";
  const disputeUrl = `${baseUrl}/disputes/${dispute.id}`;
  
  const priorityColors: Record<string, string> = {
    low: '#10B981',
    medium: '#F59E0B',
    high: '#EF4444',
    critical: '#7C3AED',
  };

  const priorityColor = priorityColors[dispute.priority] || '#F59E0B';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dispute Notification - NEXPEC</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 12px 12px 0 0;">
              <img src="${baseUrl}/logo-white.png" alt="NEXPEC" style="height: 40px; margin-bottom: 20px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                ⚠️ New Dispute Raised
              </h1>
            </td>
          </tr>

          <!-- Priority Badge -->
          <tr>
            <td style="padding: 20px 40px 0;">
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td align="center">
                    <span style="display: inline-block; padding: 6px 16px; background-color: ${priorityColor}; color: white; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                      ${dispute.priority} Priority
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="margin: 0; color: #333; font-size: 16px;">
                Hello <strong>${recipientName}</strong>,
              </p>
              <p style="margin: 15px 0 0; color: #666; font-size: 15px; line-height: 1.6;">
                A new dispute has been raised ${recipientRole === 'inspector' ? 'for a project you are assigned to' : 'and requires your attention'}.
              </p>
            </td>
          </tr>

          <!-- Dispute Details Card -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0;">
                          <span style="color: #64748b; font-size: 13px;">Project</span><br>
                          <strong style="color: #1e293b; font-size: 15px;">${project.title}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-top: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 13px;">Raised By</span><br>
                          <strong style="color: #1e293b; font-size: 15px;">${clientName}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-top: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 13px;">Category</span><br>
                          <strong style="color: #1e293b; font-size: 15px;">${REASON_LABELS[dispute.reason_category as DisputeReasonCategory] || dispute.reason_category}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-top: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 13px;">Description</span><br>
                          <p style="margin: 5px 0 0; color: #1e293b; font-size: 14px; line-height: 1.5;">
                            ${dispute.reason.length > 200 ? dispute.reason.substring(0, 200) + '...' : dispute.reason}
                          </p>
                        </td>
                      </tr>
                      ${dispute.evidence_urls.length > 0 ? `
                      <tr>
                        <td style="padding: 8px 0; border-top: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 13px;">Evidence Attached</span><br>
                          <strong style="color: #1e293b; font-size: 15px;">${dispute.evidence_urls.length} file(s)</strong>
                        </td>
                      </tr>
                      ` : ''}
                      <tr>
                        <td style="padding: 8px 0; border-top: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 13px;">Created At</span><br>
                          <strong style="color: #1e293b; font-size: 15px;">${new Date(dispute.created_at).toLocaleString('en-US', { 
                            dateStyle: 'medium', 
                            timeStyle: 'short' 
                          })}</strong>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 40px;" align="center">
              <a href="${disputeUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
                View Dispute Details
              </a>
            </td>
          </tr>

          ${recipientRole === 'admin' ? `
          <!-- Admin Actions -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #fef3c7; border-radius: 8px; border: 1px solid #fcd34d;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0; color: #92400e; font-size: 14px;">
                      <strong>⚡ Action Required:</strong> Please review this dispute and take appropriate action within 24 hours for high/critical priority disputes.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f8fafc; border-radius: 0 0 12px 12px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 10px; color: #64748b; font-size: 13px; text-align: center;">
                This is an automated notification from NEXPEC.
              </p>
              <p style="margin: 0; color: #94a3b8; font-size: 12px; text-align: center;">
                © ${new Date().getFullYear()} NEXPEC Industrial Inspections. All rights reserved.
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

// ----------------------------------------------------------------------------
// Email Sending Function (Resend API)
// ----------------------------------------------------------------------------

async function sendEmail(payload: EmailPayload): Promise<{ success: boolean; error?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  
  if (!resendApiKey) {
    console.error("RESEND_API_KEY is not configured");
    return { success: false, error: "Email service not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Resend API error:", errorData);
      return { success: false, error: errorData.message || "Failed to send email" };
    }

    const result = await response.json();
    console.log("Email sent successfully:", result.id);
    return { success: true };
  } catch (error) {
    console.error("Error sending email:", error);
    return { success: false, error: (error instanceof Error ? error.message : String(error)) };
  }
}

// ----------------------------------------------------------------------------
// Main Handler
// ----------------------------------------------------------------------------

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    // Extract authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Client with user's token (for RLS)
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Admin client (bypasses RLS for notifications)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Get current user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const validation = validateDisputeRequest(body);
    
    if (!validation.valid || !validation.data) {
      return new Response(
        JSON.stringify({ success: false, error: validation.error }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const disputeData = validation.data;

    // Check if user can raise dispute
    const { data: canRaiseResult, error: checkError } = await supabaseAdmin
      .rpc('can_raise_dispute', {
        p_project_id: disputeData.project_id,
        p_user_id: user.id,
      });

    if (checkError) {
      console.error("Error checking dispute eligibility:", checkError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to verify dispute eligibility" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (!canRaiseResult?.allowed) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: canRaiseResult?.reason || "You are not authorized to raise a dispute for this project" 
        }),
        { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Fetch project details with client and inspector info
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select(`
        id,
        title,
        status,
        client_id,
        inspector_id,
        client:profiles!projects_client_id_fkey (
          id,
          full_name,
          email
        ),
        inspector:profiles!projects_inspector_id_fkey (
          id,
          full_name,
          email
        )
      `)
      .eq('id', disputeData.project_id)
      .single();

    if (projectError || !project) {
      console.error("Error fetching project:", projectError);
      return new Response(
        JSON.stringify({ success: false, error: "Project not found" }),
        { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Start transaction-like operations
    // 1. Create the dispute record (using user client for RLS)
    const { data: dispute, error: disputeError } = await supabaseUser
      .from('disputes')
      .insert({
        project_id: disputeData.project_id,
        raised_by: user.id,
        reason_category: disputeData.reason_category,
        reason: disputeData.reason,
        evidence_urls: disputeData.evidence_urls,
        priority: disputeData.priority,
        status: 'open',
        metadata: {
          ...disputeData.metadata,
          user_agent: req.headers.get('user-agent'),
          created_via: 'mobile_app',
        },
      })
      .select()
      .single();

    if (disputeError) {
      console.error("Error creating dispute:", disputeError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: disputeError.code === '23505' 
            ? "A dispute already exists for this project" 
            : "Failed to create dispute" 
        }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // 2. Update project status to 'disputed'
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({ 
        status: 'disputed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeData.project_id);

    if (updateError) {
      console.error("Error updating project status:", updateError);
      // Note: We don't fail here since the dispute was created
      // In production, consider using a proper transaction or saga pattern
    }

    // 3. Log the initial activity
    await supabaseAdmin
      .from('dispute_activities')
      .insert({
        dispute_id: dispute.id,
        actor_id: user.id,
        action: 'dispute_created',
        new_value: {
          reason_category: disputeData.reason_category,
          priority: disputeData.priority,
          evidence_count: disputeData.evidence_urls.length,
        },
      });

    // 4. Fetch admin users for notification
    const { data: admins, error: adminsError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'admin')
      .eq('is_active', true);

    if (adminsError) {
      console.error("Error fetching admins:", adminsError);
    }

    // 5. Send email notifications
    const emailPromises: Promise<{ success: boolean; error?: string }>[] = [];
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@nexpec.app";
    const clientName = project.client?.full_name || "Client";

    // Email to Inspector
    if (project.inspector?.email) {
      const inspectorEmailHtml = generateDisputeEmailHTML(
        project.inspector.full_name || "Inspector",
        'inspector',
        dispute,
        project as ProjectDetails,
        clientName
      );

      emailPromises.push(sendEmail({
        from: fromEmail,
        to: [project.inspector.email],
        subject: `⚠️ Dispute Raised - ${project.title}`,
        html: inspectorEmailHtml,
      }));
    }

    // Email to Admins
    if (admins && admins.length > 0) {
      for (const admin of admins) {
        if (admin.email) {
          const adminEmailHtml = generateDisputeEmailHTML(
            admin.full_name || "Admin",
            'admin',
            dispute,
            project as ProjectDetails,
            clientName
          );

          emailPromises.push(sendEmail({
            from: fromEmail,
            to: [admin.email],
            subject: `⚠️ [${(disputeData.priority ?? 'normal').toUpperCase()}] New Dispute - ${project.title}`,
            html: adminEmailHtml,
          }));
        }
      }
    }

    // Wait for all emails to be sent (don't fail if emails fail)
    const emailResults = await Promise.allSettled(emailPromises);
    const emailsSent = emailResults.filter(
      (r) => r.status === 'fulfilled' && r.value.success
    ).length;

    console.log(`Sent ${emailsSent}/${emailPromises.length} notification emails`);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          dispute_id: dispute.id,
          project_id: dispute.project_id,
          status: dispute.status,
          created_at: dispute.created_at,
        },
        message: "Dispute created successfully",
        notifications_sent: emailsSent,
      }),
      { 
        status: 201, 
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    // Internal detail stays server-side (logs only) — never in the response.
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal error",
      }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
