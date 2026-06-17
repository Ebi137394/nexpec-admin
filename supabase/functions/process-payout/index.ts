// ============================================================================
// NEXPEC · process-payout Edge Function — DISABLED (NX-STRIPE-004)
// supabase/functions/process-payout/index.ts
// ============================================================================
//
//  Previously the super_admin Stripe Connect payout path
//  (stripe.transfers.create → connected account). Under NEXPEC's locked
//  manual-payout model this is forbidden: admins settle payouts by wiring funds
//  OUTSIDE the platform and clicking "Mark as Paid" (admin_mark_withdrawal_paid)
//  in the Treasury Control Tower, against rows created by request_withdrawal.
//
//  Returns 501 NOT_IMPLEMENTED + audits every attempt (mirrors release-payment /
//  NX-STRIPE-003). Auth enforced. Deletion staged once frontend call sites
//  (app/(admin)/payouts.tsx, inspector job detail) are repointed — see
//  docs/qa/STRIPE_NEUTRALIZATION.md.
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ success: false, code: "AUTH_MISSING" }, 401);
    const token = authHeader.slice(7).trim();
    if (!token) return json({ success: false, code: "AUTH_MISSING" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ success: false, code: "AUTH_INVALID" }, 401);

    const { data: profile } = await admin.from("profiles").select("role, email").eq("id", user.id).single();

    try {
      await admin.from("audit_events").insert({
        event_type: "admin_tool.disabled_endpoint_hit",
        severity: "warning",
        actor_id: user.id,
        actor_role: profile?.role ?? null,
        actor_label: profile?.email ?? user.id,
        subject_table: "withdrawal_requests",
        subject_id: "00000000-0000-0000-0000-000000000000",
        summary: "process-payout invoked; automated Stripe Connect payouts are DISABLED (NX-STRIPE-004). Settle via admin_mark_withdrawal_paid.",
        delta: {},
        metadata: { endpoint: "process-payout", reason: "manual_payout_model" },
      });
    } catch { /* audit drift non-fatal */ }

    return json({
      success: false,
      code: "NOT_IMPLEMENTED",
      error: "Automated Stripe Connect payouts are disabled. Settle payouts manually in the Treasury Control Tower: review the withdrawal_requests row, wire funds out-of-band, then call admin_mark_withdrawal_paid.",
      alternatives: { admin_settle: "admin_mark_withdrawal_paid(p_id, p_reference)", queue: "request_withdrawal creates the queue rows" },
    }, 501);
  } catch (err) {
    console.error("[process-payout] fatal:", err);
    return json({ success: false, code: "INTERNAL_ERROR" }, 500);
  }
});
