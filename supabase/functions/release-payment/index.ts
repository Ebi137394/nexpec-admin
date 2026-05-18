// ============================================================================
//  supabase/functions/release-payment/index.ts
//
//  NX-STRIPE-003 strike — final shape.
//
//  Background
//  ──────────
//  The original audit framed this as "release-payment is a no-op stub that
//  marks milestones paid without moving money." The live-schema diagnostic
//  (information_schema.columns dump, May 17 2026) showed the truth is even
//  more degenerate: the legacy function's INSERT targets six columns that
//  don't exist on the live public.payments table (milestone_id,
//  payment_method, reference_number, paid_by, notes, currency), AND fails
//  to populate three NOT NULL columns that DO exist (client_id, description,
//  due_date). The INSERT errors out on every call. The function has never
//  successfully written a row to the live DB. NX-STRIPE-003 was not a
//  silent money-movement hazard; it was a non-functional feature stub.
//
//  Decision
//  ────────
//  Rather than wire an RPC against a schema that almost certainly belongs
//  to a different feature concept (the payments table's
//  client_id + description + due_date shape looks like an invoice / AR
//  model, not an inspector-payout model), this function now returns
//  501 NOT_IMPLEMENTED. Callers are pointed at process-payout, which is
//  the working super-admin Stripe Connect payout flow.
//
//  This is a Mandate Rule 5 outcome: business intent for the
//  milestone-payout concept is not visible from the schema or the legacy
//  code. STOP AND ASK applies — see migration 20260517130000 for the
//  list of clarifications needed before a real RPC can be authored.
//
//  Authentication is still enforced on this endpoint so the 501 only
//  reaches a legitimate admin (avoids the previous "anyone can hit this
//  URL" surface, even though the previous handler did nothing useful).
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
      405,
    );
  }

  try {
    // ── Authenticate the caller ─────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(
        {
          success: false,
          error: "Missing or malformed Authorization header.",
          code: "AUTH_MISSING",
        },
        401,
      );
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return jsonResponse(
        { success: false, error: "Empty Bearer token", code: "AUTH_MISSING" },
        401,
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

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
        401,
      );
    }

    // ── Authorize — admin / super_admin only ────────────────────────
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .single();

    const allowedRoles = ["super_admin", "admin"];
    if (!profile || !allowedRoles.includes(profile.role)) {
      console.warn(
        `[release-payment][SECURITY] unauthorized call by ${profile?.email ?? user.id} (role: ${profile?.role ?? 'unknown'})`,
      );
      return jsonResponse(
        {
          success: false,
          error: "Access denied. Admin role required.",
          code: "ROLE_UNAUTHORIZED",
        },
        403,
      );
    }

    // ── Audit the 501 hit so ops sees admins trying to use this ────
    //   Best-effort; do not block the response if the audit insert fails.
    try {
      await supabaseAdmin.from("audit_events").insert({
        event_type: "admin_tool.disabled_endpoint_hit",
        severity: "info",
        actor_id: user.id,
        actor_role: profile.role,
        actor_label: profile.email ?? user.id,
        subject_table: "payments",
        subject_id: "00000000-0000-0000-0000-000000000000",
        summary: "Admin invoked release-payment, which is currently disabled (NX-STRIPE-003).",
        delta: {},
        metadata: {
          endpoint: "release-payment",
          reason: "not_implemented",
        },
      });
    } catch {
      // audit_events shape drift is non-fatal here.
    }

    return jsonResponse(
      {
        success: false,
        error:
          "release-payment is not currently implemented. " +
          "The legacy code path was non-functional against the live payments schema. " +
          "For Stripe Connect payouts to inspectors, use the process-payout super_admin tool. " +
          "For milestone payout business intent, see audit ticket NX-STRIPE-003 and migration 20260517130000_release_milestone_payment_rpc.sql.",
        code: "NOT_IMPLEMENTED",
        alternatives: {
          inspector_payout: "POST /functions/v1/process-payout (super_admin)",
          documentation: "supabase/migrations/20260517130000_release_milestone_payment_rpc.sql",
        },
      },
      501,
    );
  } catch (err: any) {
    console.error("[release-payment] fatal:", err);
    return jsonResponse(
      {
        success: false,
        error: "Internal server error.",
        code: "INTERNAL_ERROR",
      },
      500,
    );
  }
});
