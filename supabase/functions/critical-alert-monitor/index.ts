// supabase/functions/critical-alert-monitor/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────
interface InspectionEvent {
  id: string;
  asset_id: string;
  type: string;
  result: string | null;
  severity: string | null;
  summary: string | null;
  performed_by: string | null;
  performed_at: string;
  metadata: Record<string, unknown>;
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: InspectionEvent;
  schema: string;
  old_record: InspectionEvent | null;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function shouldAlert(event: InspectionEvent): boolean {
  return event.result === "fail" || event.type === "incident";
}

function deriveAlertType(event: InspectionEvent): string {
  if (event.type === "incident") return "incident";
  if (event.result === "fail") return "critical_fail";
  return "anomaly";
}

function deriveSeverity(event: InspectionEvent): string {
  // Use the event's own severity if present; otherwise escalate.
  if (event.severity === "critical") return "critical";
  if (event.type === "incident") return "critical";
  if (event.result === "fail" && event.severity === "high") return "critical";
  if (event.result === "fail") return "high";
  return "medium";
}

function buildTitle(event: InspectionEvent, tagNumber: string): string {
  if (event.type === "incident") {
    return `🚨 Incident Reported — ${tagNumber}`;
  }
  return `⚠️ Inspection FAILED — ${tagNumber}`;
}

function buildMessage(event: InspectionEvent, tagNumber: string): string {
  const lines: string[] = [];
  lines.push(`Asset: ${tagNumber}`);
  lines.push(`Event type: ${event.type}`);
  if (event.result) lines.push(`Result: ${event.result}`);
  if (event.severity) lines.push(`Severity: ${event.severity}`);
  if (event.summary) lines.push(`Summary: ${event.summary}`);
  if (event.performed_by) lines.push(`Performed by: ${event.performed_by}`);
  lines.push(`Date: ${new Date(event.performed_at).toISOString()}`);
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────
// Edge Function handler
// ────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // ── Auth check ────────────────────────────────────────────
  //    The webhook sends a secret in the Authorization header.
  //    Fail CLOSED: reject if WEBHOOK_SECRET is unset OR the header does not
  //    match. (Previously this skipped the check entirely when the secret was
  //    unset, leaving the endpoint open.)
  const authHeader = req.headers.get("Authorization");
  const expectedToken = Deno.env.get("WEBHOOK_SECRET");

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Parse payload ─────────────────────────────────────────
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const event = payload.record;

  // ── Gate: only act on critical events ─────────────────────
  if (!shouldAlert(event)) {
    return new Response(
      JSON.stringify({ message: "Event does not require alert.", event_id: event.id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Supabase admin client ─────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Look up the asset tag number ──────────────────────────
  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .select("tag_number")
    .eq("id", event.asset_id)
    .single();

  if (assetErr) {
    console.error("Failed to fetch asset:", assetErr.message);
    return new Response(
      JSON.stringify({ error: "Asset lookup failed", detail: assetErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const tagNumber = asset.tag_number;

  // ── Check for duplicate alert (idempotency) ───────────────
  const { data: existing } = await supabase
    .from("alerts")
    .select("id")
    .eq("event_id", event.id)
    .limit(1);

  if (existing && existing.length > 0) {
    return new Response(
      JSON.stringify({ message: "Alert already exists.", alert_id: existing[0].id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Insert the alert ──────────────────────────────────────
  const alertType = deriveAlertType(event);
  const severity = deriveSeverity(event);
  const title = buildTitle(event, tagNumber);
  const message = buildMessage(event, tagNumber);

  const { data: alertRecord, error: insertErr } = await supabase
    .from("alerts")
    .insert({
      event_id: event.id,
      asset_id: event.asset_id,
      alert_type: alertType,
      title,
      message,
      severity,
      status: "new",
    })
    .select()
    .single();

  if (insertErr) {
    console.error("Failed to insert alert:", insertErr.message);
    return new Response(
      JSON.stringify({ error: "Alert insert failed", detail: insertErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`[critical-alert-monitor] Alert created: ${alertRecord.id} for event ${event.id}`);

  // ── (Optional) Fire external notification ─────────────────
  //    Push notification, Slack webhook, email, etc.
  const slackWebhookUrl = Deno.env.get("SLACK_WEBHOOK_URL");
  if (slackWebhookUrl) {
    try {
      await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${title}\n${message}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${title}*\n\`\`\`${message}\`\`\``,
              },
            },
          ],
        }),
      });
    } catch (e) {
      console.error("Slack notification failed:", e);
      // Non-blocking — don't fail the function over Slack.
    }
  }

  return new Response(
    JSON.stringify({
      message: "Critical alert created.",
      alert: alertRecord,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
});
