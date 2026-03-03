// ============================================================
// FILE: supabase/functions/release-payment/index.ts
// PURPOSE: Validates admin role, creates payment, updates
//          milestone status, writes audit log
// DEPLOY: supabase functions deploy release-payment
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────
interface ReleasePaymentBody {
  milestone_id: string;
  project_id: string;
  payment_method?: "bank_transfer" | "stripe" | "manual";
  notes?: string;
}

interface SuccessResponse {
  success: true;
  payment_id: string;
  milestone_id: string;
  amount: number;
  message: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  code: string;
}

// ──────────────────────────────────────────────
// CORS HEADERS
// ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ──────────────────────────────────────────────
// HELPER: JSON response
// ──────────────────────────────────────────────
function jsonResponse(
  body: SuccessResponse | ErrorResponse,
  status: number
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ──────────────────────────────────────────────
// HELPER: UUID validation
// ──────────────────────────────────────────────
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    str
  );
}

// ══════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════
serve(async (req: Request) => {
  // ── Handle CORS preflight ──
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Only allow POST ──
  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
      405
    );
  }

  try {
    // ════════════════════════════════════════
    // STEP 1: AUTHENTICATE THE USER
    // ════════════════════════════════════════
    const authHeader = req.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(
        {
          success: false,
          error: "Missing or malformed Authorization header.",
          code: "AUTH_MISSING",
        },
        401
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // Create a Supabase client with the SERVICE ROLE key
    // (so we can bypass RLS for admin operations)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Verify the JWT and get the user
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse(
        {
          success: false,
          error: "Invalid or expired authentication token.",
          code: "AUTH_INVALID",
        },
        401
      );
    }

    // ════════════════════════════════════════
    // STEP 2: VALIDATE ADMIN ROLE
    // ════════════════════════════════════════
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, role, full_name, email")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return jsonResponse(
        {
          success: false,
          error: "User profile not found.",
          code: "PROFILE_NOT_FOUND",
        },
        403
      );
    }

    const allowedRoles = ["super_admin", "admin"];
    if (!allowedRoles.includes(profile.role)) {
      console.warn(
        `[SECURITY] Unauthorized payment attempt by user ${profile.email} (role: ${profile.role})`
      );
      return jsonResponse(
        {
          success: false,
          error: `Access denied. Role "${profile.role}" cannot release payments. Required: ${allowedRoles.join(", ")}.`,
          code: "ROLE_UNAUTHORIZED",
        },
        403
      );
    }

    // ════════════════════════════════════════
    // STEP 3: PARSE & VALIDATE REQUEST BODY
    // ════════════════════════════════════════
    let body: ReleasePaymentBody;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "Invalid JSON request body.",
          code: "INVALID_JSON",
        },
        400
      );
    }

    const { milestone_id, project_id, payment_method, notes } = body;

    // Validate required fields
    if (!milestone_id || !project_id) {
      return jsonResponse(
        {
          success: false,
          error: "Missing required fields: milestone_id, project_id.",
          code: "MISSING_FIELDS",
        },
        400
      );
    }

    // Validate UUIDs
    if (!isValidUUID(milestone_id) || !isValidUUID(project_id)) {
      return jsonResponse(
        {
          success: false,
          error: "Invalid UUID format for milestone_id or project_id.",
          code: "INVALID_UUID",
        },
        400
      );
    }

    // Validate payment method
    const validMethods = ["bank_transfer", "stripe", "manual"];
    const method = payment_method ?? "bank_transfer";
    if (!validMethods.includes(method)) {
      return jsonResponse(
        {
          success: false,
          error: `Invalid payment_method. Must be: ${validMethods.join(", ")}.`,
          code: "INVALID_PAYMENT_METHOD",
        },
        400
      );
    }

    // ════════════════════════════════════════
    // STEP 4: FETCH & VALIDATE THE MILESTONE
    // ════════════════════════════════════════
    const { data: milestone, error: msError } = await supabaseAdmin
      .from("milestones")
      .select("id, project_id, title, amount, status")
      .eq("id", milestone_id)
      .eq("project_id", project_id)
      .single();

    if (msError || !milestone) {
      return jsonResponse(
        {
          success: false,
          error: "Milestone not found or does not belong to this project.",
          code: "MILESTONE_NOT_FOUND",
        },
        404
      );
    }

    // Only approved milestones can be paid
    if (milestone.status !== "approved") {
      return jsonResponse(
        {
          success: false,
          error: `Milestone status is "${milestone.status}". Only "approved" milestones can be paid.`,
          code: "MILESTONE_NOT_APPROVED",
        },
        409
      );
    }

    // Sanity check on amount
    if (!milestone.amount || milestone.amount <= 0) {
      return jsonResponse(
        {
          success: false,
          error: "Milestone amount must be greater than zero.",
          code: "INVALID_AMOUNT",
        },
        400
      );
    }

    // ════════════════════════════════════════
    // STEP 5: CHECK BUDGET HASN'T BEEN EXCEEDED
    // ════════════════════════════════════════
    const { data: project, error: projError } = await supabaseAdmin
      .from("projects")
      .select("id, total_budget, currency")
      .eq("id", project_id)
      .single();

    if (projError || !project) {
      return jsonResponse(
        {
          success: false,
          error: "Project not found.",
          code: "PROJECT_NOT_FOUND",
        },
        404
      );
    }

    // Sum of all completed payments for this project
    const { data: paymentSum, error: sumError } = await supabaseAdmin
      .from("payments")
      .select("amount")
      .eq("project_id", project_id)
      .eq("status", "completed");

    if (sumError) {
      return jsonResponse(
        {
          success: false,
          error: "Failed to calculate existing payments.",
          code: "QUERY_ERROR",
        },
        500
      );
    }

    const totalPaid = (paymentSum ?? []).reduce(
      (sum: number, p: { amount: number }) => sum + Number(p.amount),
      0
    );

    const projectedTotal = totalPaid + milestone.amount;

    if (projectedTotal > project.total_budget) {
      return jsonResponse(
        {
          success: false,
          error: `Payment would exceed project budget. Budget: $${project.total_budget}, Already paid: $${totalPaid}, This payment: $${milestone.amount}, Projected: $${projectedTotal}.`,
          code: "BUDGET_EXCEEDED",
        },
        409
      );
    }

    // ════════════════════════════════════════
    // STEP 6: IDEMPOTENCY CHECK
    // (prevent double-payment if button clicked twice)
    // ════════════════════════════════════════
    const { data: existingPayment } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("milestone_id", milestone_id)
      .eq("status", "completed")
      .maybeSingle();

    if (existingPayment) {
      return jsonResponse(
        {
          success: false,
          error: "This milestone has already been paid.",
          code: "ALREADY_PAID",
        },
        409
      );
    }

    // ════════════════════════════════════════
    // STEP 7: EXECUTE THE PAYMENT
    // (In production, this is where you'd call
    //  Stripe, bank API, etc.)
    // ════════════════════════════════════════
    const now = new Date().toISOString();

    // Generate a mock reference number
    const referenceNumber = `NXPC-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    // 7A: Insert the payment record
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from("payments")
      .insert({
        milestone_id: milestone_id,
        project_id: project_id,
        amount: milestone.amount,
        currency: project.currency ?? "USD",
        payment_method: method,
        reference_number: referenceNumber,
        status: "completed",
        paid_by: user.id,
        notes: notes ?? null,
        paid_at: now,
      })
      .select("id, amount")
      .single();

    if (paymentError || !payment) {
      console.error("[ERROR] Failed to insert payment:", paymentError);
      return jsonResponse(
        {
          success: false,
          error: "Failed to create payment record.",
          code: "PAYMENT_INSERT_FAILED",
        },
        500
      );
    }

    // 7B: Update milestone status to "paid"
    const { error: updateError } = await supabaseAdmin
      .from("milestones")
      .update({
        status: "paid",
        paid_at: now,
      })
      .eq("id", milestone_id);

    if (updateError) {
      console.error("[ERROR] Failed to update milestone:", updateError);
      // NOTE: In production, you'd want to rollback the payment
      // or mark it for manual review. For now, we log and continue.
      return jsonResponse(
        {
          success: false,
          error: "Payment created but milestone update failed. Contact support.",
          code: "MILESTONE_UPDATE_FAILED",
        },
        500
      );
    }

    // ════════════════════════════════════════
    // STEP 8: WRITE AUDIT LOG
    // ════════════════════════════════════════
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? 
                     req.headers.get("cf-connecting-ip") ?? 
                     null;

    await supabaseAdmin.from("payment_audit_log").insert({
      action: "payment_released",
      entity_type: "milestone",
      entity_id: milestone_id,
      performed_by: user.id,
      metadata: {
        payment_id: payment.id,
        amount: milestone.amount,
        currency: project.currency,
        payment_method: method,
        reference_number: referenceNumber,
        milestone_title: milestone.title,
        project_id: project_id,
        user_email: profile.email,
        user_name: profile.full_name,
        budget_before: totalPaid,
        budget_after: projectedTotal,
        budget_total: project.total_budget,
        utilization_pct_after: Number(
          ((projectedTotal / project.total_budget) * 100).toFixed(2)
        ),
      },
      ip_address: clientIp,
    });

    // ════════════════════════════════════════
    // STEP 9: RETURN SUCCESS
    // ════════════════════════════════════════
    console.log(
      `[SUCCESS] Payment ${payment.id} released by ${profile.email} for milestone "${milestone.title}" ($${milestone.amount})`
    );

    return jsonResponse(
      {
        success: true,
        payment_id: payment.id,
        milestone_id: milestone_id,
        amount: milestone.amount,
        message: `Payment of $${milestone.amount} released for "${milestone.title}". Reference: ${referenceNumber}`,
      },
      200
    );
  } catch (err) {
    // ── Catch-all error handler ──
    console.error("[FATAL] Unhandled error in release-payment:", err);
    return jsonResponse(
      {
        success: false,
        error: "Internal server error. Please try again later.",
        code: "INTERNAL_ERROR",
      },
      500
    );
  }
});