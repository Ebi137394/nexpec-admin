import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ============================================
// TYPE DEFINITIONS
// ============================================

type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

interface VerifyContractorRequest {
  contractor_id: string;
  new_status: VerificationStatus;
  rejection_reason?: string;
  notify_user?: boolean;
}

interface ContractorProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  expo_push_token: string | null;
  verification_status: VerificationStatus;
}

interface Certificate {
  id: string;
  certificate_name: string;
  expiry_date: string;
  is_verified: boolean;
}

interface ExpoPushMessage {
  to: string;
  sound?: "default" | null;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: "default" | "normal" | "high";
  channelId?: string;
  badge?: number;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// ============================================
// CONSTANTS
// ============================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

const STATUS_TRANSITIONS: Record<VerificationStatus, VerificationStatus[]> = {
  unverified: ["pending"],
  pending: ["verified", "rejected"],
  verified: ["pending", "rejected"], // Can be revoked
  rejected: ["pending"], // Can resubmit
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Creates a JSON response with proper headers
 */
function jsonResponse<T>(
  data: ApiResponse<T>,
  status: number = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * Creates an error response
 */
function errorResponse(
  message: string,
  code: string,
  status: number = 400
): Response {
  return jsonResponse({ success: false, error: message, code }, status);
}

/**
 * Validates UUID format
 */
function isValidUUID(uuid: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validates status transition
 */
function isValidTransition(
  currentStatus: VerificationStatus,
  newStatus: VerificationStatus
): boolean {
  return STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}

/**
 * Generates notification content based on status
 */
function getNotificationContent(
  status: VerificationStatus,
  rejectionReason?: string
): { title: string; body: string } {
  switch (status) {
    case "verified":
      return {
        title: "🎉 Verification Approved!",
        body: "Congratulations! Your contractor account has been verified. You now have access to all platform features.",
      };
    case "rejected":
      return {
        title: "❌ Verification Not Approved",
        body: rejectionReason
          ? `Your verification request was not approved. Reason: ${rejectionReason}`
          : "Your verification request was not approved. Please review the requirements and resubmit.",
      };
    case "pending":
      return {
        title: "📋 Verification Under Review",
        body: "Your verification request is being reviewed by our team. We'll notify you once the review is complete.",
      };
    case "unverified":
      return {
        title: "ℹ️ Verification Status Reset",
        body: "Your verification status has been reset. Please submit your documents for verification.",
      };
    default:
      return {
        title: "Verification Status Update",
        body: "Your verification status has been updated.",
      };
  }
}

// ============================================
// EXPO PUSH NOTIFICATION SERVICE
// ============================================

/**
 * Validates Expo push token format
 */
function isValidExpoPushToken(token: string): boolean {
  return (
    token.startsWith("ExponentPushToken[") ||
    token.startsWith("ExpoPushToken[") ||
    /^[a-zA-Z0-9-_]+$/.test(token)
  );
}

/**
 * Sends push notification via Expo API
 */
async function sendExpoPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<{ success: boolean; ticket?: ExpoPushTicket; error?: string }> {
  if (!isValidExpoPushToken(pushToken)) {
    return { success: false, error: "Invalid Expo push token format" };
  }

  const message: ExpoPushMessage = {
    to: pushToken,
    sound: "default",
    title,
    body,
    data: {
      ...data,
      timestamp: new Date().toISOString(),
    },
    priority: "high",
    channelId: "verification-updates",
  };

  try {
    const response = await fetch(EXPO_PUSH_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Expo API error:", errorText);
      return {
        success: false,
        error: `Expo API returned ${response.status}: ${errorText}`,
      };
    }

    const result = await response.json();
    const ticket = result.data?.[0] as ExpoPushTicket;

    if (ticket?.status === "error") {
      console.error("Push notification error:", ticket.message);
      return {
        success: false,
        ticket,
        error: ticket.message,
      };
    }

    return { success: true, ticket };
  } catch (error) {
    console.error("Failed to send push notification:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================
// DATABASE OPERATIONS
// ============================================

/**
 * Verifies the caller is an admin
 */
async function verifyAdminRole(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) {
    console.error("Error checking admin role:", error);
    return false;
  }

  return data !== null;
}

/**
 * Fetches contractor profile
 */
async function getContractorProfile(
  supabaseAdmin: SupabaseClient,
  contractorId: string
): Promise<ContractorProfile | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, expo_push_token, verification_status")
    .eq("id", contractorId)
    .single();

  if (error) {
    console.error("Error fetching contractor:", error);
    return null;
  }

  return data as ContractorProfile;
}

/**
 * Checks for valid certificates
 */
async function getValidCertificates(
  supabaseAdmin: SupabaseClient,
  contractorId: string
): Promise<Certificate[]> {
  const { data, error } = await supabaseAdmin
    .from("contractor_certifications")
    .select("id, certificate_name, expiry_date, is_verified")
    .eq("contractor_id", contractorId)
    .eq("is_verified", true)
    .gt("expiry_date", new Date().toISOString().split("T")[0]);

  if (error) {
    console.error("Error fetching certificates:", error);
    return [];
  }

  return (data as Certificate[]) || [];
}

/**
 * Updates contractor verification status
 */
async function updateVerificationStatus(
  supabaseAdmin: SupabaseClient,
  contractorId: string,
  newStatus: VerificationStatus,
  adminId: string,
  rejectionReason?: string
): Promise<{ success: boolean; error?: string }> {
  const updateData: Record<string, unknown> = {
    verification_status: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === "verified") {
    updateData.verified_at = new Date().toISOString();
    updateData.verified_by = adminId;
    updateData.rejection_reason = null;
  } else if (newStatus === "rejected") {
    updateData.rejection_reason = rejectionReason || null;
    updateData.verified_at = null;
    updateData.verified_by = null;
  } else {
    updateData.verified_at = null;
    updateData.verified_by = null;
    updateData.rejection_reason = null;
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update(updateData)
    .eq("id", contractorId);

  if (error) {
    console.error("Error updating verification status:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ============================================
// MAIN HANDLER
// ============================================

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }

  try {
    // ========================================
    // ENVIRONMENT SETUP
    // ========================================
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      console.error("Missing environment variables");
      return errorResponse(
        "Server configuration error",
        "CONFIG_ERROR",
        500
      );
    }

    // ========================================
    // AUTHENTICATION
    // ========================================
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse(
        "Missing authorization header",
        "UNAUTHORIZED",
        401
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // Create admin client with service role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Create user client to verify the JWT
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get the authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser(token);

    if (authError || !user) {
      console.error("Auth error:", authError);
      return errorResponse(
        "Invalid or expired token",
        "UNAUTHORIZED",
        401
      );
    }

    // ========================================
    // ADMIN VERIFICATION
    // ========================================
    const isAdmin = await verifyAdminRole(supabaseAdmin, user.id);
    if (!isAdmin) {
      console.warn(`Non-admin user ${user.id} attempted to verify contractor`);
      return errorResponse(
        "Admin privileges required",
        "FORBIDDEN",
        403
      );
    }

    // ========================================
    // REQUEST VALIDATION
    // ========================================
    let requestBody: VerifyContractorRequest;
    try {
      requestBody = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", "INVALID_REQUEST", 400);
    }

    const {
      contractor_id,
      new_status,
      rejection_reason,
      notify_user = true,
    } = requestBody;

    // Validate required fields
    if (!contractor_id) {
      return errorResponse(
        "contractor_id is required",
        "VALIDATION_ERROR",
        400
      );
    }

    if (!new_status) {
      return errorResponse("new_status is required", "VALIDATION_ERROR", 400);
    }

    // Validate UUID format
    if (!isValidUUID(contractor_id)) {
      return errorResponse(
        "Invalid contractor_id format",
        "VALIDATION_ERROR",
        400
      );
    }

    // Validate status value
    const validStatuses: VerificationStatus[] = [
      "unverified",
      "pending",
      "verified",
      "rejected",
    ];
    if (!validStatuses.includes(new_status)) {
      return errorResponse(
        `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        "VALIDATION_ERROR",
        400
      );
    }

    // Validate rejection reason if rejecting
    if (new_status === "rejected" && !rejection_reason?.trim()) {
      return errorResponse(
        "rejection_reason is required when rejecting",
        "VALIDATION_ERROR",
        400
      );
    }

    // ========================================
    // FETCH CONTRACTOR
    // ========================================
    const contractor = await getContractorProfile(supabaseAdmin, contractor_id);
    if (!contractor) {
      return errorResponse("Contractor not found", "NOT_FOUND", 404);
    }

    // Check if status is already the same
    if (contractor.verification_status === new_status) {
      return errorResponse(
        `Contractor is already ${new_status}`,
        "NO_CHANGE",
        400
      );
    }

    // Validate status transition
    if (
      !isValidTransition(
        contractor.verification_status as VerificationStatus,
        new_status
      )
    ) {
      return errorResponse(
        `Invalid status transition from ${contractor.verification_status} to ${new_status}`,
        "INVALID_TRANSITION",
        400
      );
    }

    // ========================================
    // CERTIFICATE VALIDATION (for verification)
    // ========================================
    if (new_status === "verified") {
      const validCerts = await getValidCertificates(
        supabaseAdmin,
        contractor_id
      );

      if (validCerts.length === 0) {
        return errorResponse(
          "Cannot verify contractor: No valid, verified certificates found. " +
            "Contractor must have at least one verified certificate that has not expired.",
          "CERTIFICATE_REQUIRED",
          400
        );
      }

      console.log(
        `Contractor ${contractor_id} has ${validCerts.length} valid certificate(s)`
      );
    }

    // ========================================
    // UPDATE STATUS
    // ========================================
    const updateResult = await updateVerificationStatus(
      supabaseAdmin,
      contractor_id,
      new_status,
      user.id,
      rejection_reason
    );

    if (!updateResult.success) {
      return errorResponse(
        `Failed to update status: ${updateResult.error}`,
        "UPDATE_FAILED",
        500
      );
    }

    console.log(
      `Admin ${user.id} updated contractor ${contractor_id} status: ` +
        `${contractor.verification_status} -> ${new_status}`
    );

    // ========================================
    // SEND PUSH NOTIFICATION
    // ========================================
    let notificationResult: {
      sent: boolean;
      error?: string;
    } = { sent: false };

    if (notify_user && contractor.expo_push_token) {
      const { title, body } = getNotificationContent(
        new_status,
        rejection_reason
      );

      const pushResult = await sendExpoPushNotification(
        contractor.expo_push_token,
        title,
        body,
        {
          type: "verification_status_update",
          status: new_status,
          contractor_id,
        }
      );

      notificationResult = {
        sent: pushResult.success,
        error: pushResult.error,
      };

      if (pushResult.success) {
        console.log(`Push notification sent to contractor ${contractor_id}`);
      } else {
        console.warn(
          `Failed to send push notification: ${pushResult.error}`
        );
      }
    } else if (notify_user && !contractor.expo_push_token) {
      notificationResult = {
        sent: false,
        error: "Contractor has no push token registered",
      };
    }

    // ========================================
    // RETURN SUCCESS RESPONSE
    // ========================================
    return jsonResponse({
      success: true,
      data: {
        contractor_id,
        previous_status: contractor.verification_status,
        new_status,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
        notification: notificationResult,
      },
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      "INTERNAL_ERROR",
      500
    );
  }
});