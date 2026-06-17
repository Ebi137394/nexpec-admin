// ============================================================================
//  supabase/functions/create-supplier-payout/index.ts
//
//  NX-STRIPE-004 — DISABLED under the manual-payout model.
//
//  Supplier mirror of create-stripe-payout. Previously moved money via
//  stripe.transfers.create() + stripe.payouts.create() (Stripe Connect).
//  Forbidden under the manual model — supplier payouts must flow through
//  request_withdrawal (supplier branch) → admin Treasury "Mark as Paid"
//  (admin_mark_withdrawal_paid). Returns 501 + audits every attempt. Auth
//  enforced. Deletion staged once SupplierPayoutCard / marketplace.ts /
//  useSupplierEcosystem.ts are repointed — see docs/qa/STRIPE_NEUTRALIZATION.md.
//
//  NOTE: public.supplier_earnings does not exist on prod (ghost), so the legacy
//  supplier-payout path was already broken end-to-end; this makes the disablement
//  explicit + audited rather than a silent runtime failure.
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
        subject_table: "supplier_earnings",
        subject_id: "00000000-0000-0000-0000-000000000000",
        summary: "create-supplier-payout invoked; automated Stripe Connect payouts are DISABLED (NX-STRIPE-004). Use the manual Treasury flow.",
        delta: {},
        metadata: { endpoint: "create-supplier-payout", reason: "manual_payout_model" },
      });
    } catch { /* audit drift non-fatal */ }

    return json({
      success: false,
      code: "NOT_IMPLEMENTED",
      error: "Automated Stripe Connect payouts are disabled. Supplier payouts are manual: request_withdrawal then admin Treasury Mark-as-Paid (admin_mark_withdrawal_paid).",
      alternatives: {
        request_payout: "supabase.rpc('request_withdrawal', { p_amount_cents, p_method, p_note })",
        admin_settle: "admin_mark_withdrawal_paid (Treasury Control Tower)",
      },
    }, 501);
  } catch (err) {
    console.error("[create-supplier-payout] fatal:", err);
    return json({ success: false, code: "INTERNAL_ERROR" }, 500);
  }
});
