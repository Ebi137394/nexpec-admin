// Test script for Critical Alert Monitor Edge Function
// This script can be used to test the function locally or in production

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Test configuration
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/critical-alert-monitor`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Test data for different scenarios
const testEvents = {
  // Test 1: Critical incident
  incident: {
    id: "test-incident-001",
    asset_id: "test-asset-001",
    type: "incident",
    result: null,
    severity: "critical",
    summary: "Equipment malfunction detected during inspection",
    performed_by: "test-inspector",
    performed_at: new Date().toISOString(),
    metadata: { equipment_id: "EQ-12345" }
  },

  // Test 2: Failed inspection
  failedInspection: {
    id: "test-fail-001",
    asset_id: "test-asset-002",
    type: "inspection",
    result: "fail",
    severity: "high",
    summary: "Safety compliance violation found",
    performed_by: "test-inspector",
    performed_at: new Date().toISOString(),
    metadata: { violation_code: "SC-001" }
  },

  // Test 3: Non-critical event (should not trigger alert)
  passedInspection: {
    id: "test-pass-001",
    asset_id: "test-asset-003",
    type: "inspection",
    result: "pass",
    severity: "low",
    summary: "Routine inspection completed successfully",
    performed_by: "test-inspector",
    performed_at: new Date().toISOString(),
    metadata: {}
  }
};

async function createTestAsset(assetId: string, tagNumber: string) {
  const { data, error } = await supabase
    .from("assets")
    .insert({
      id: assetId,
      tag_number: tagNumber,
      description: `Test asset ${tagNumber}`,
      location: "Test Location",
      category: "Test Category",
      metadata: {}
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create test asset:", error.message);
    return null;
  }
  return data;
}

async function sendWebhookEvent(eventData: any) {
  const payload = {
    type: "INSERT",
    table: "inspection_events",
    schema: "public",
    record: eventData,
    old_record: null
  };

  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${WEBHOOK_SECRET}`
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  return { status: response.status, data: result };
}

async function testCriticalAlertMonitor() {
  console.log("🧪 Testing Critical Alert Monitor Edge Function");
  console.log("=" * 50);

  // Clean up any existing test data
  await supabase.from("alerts").delete().match({ event_id: { like: "test-%" } });
  await supabase.from("inspection_events").delete().match({ id: { like: "test-%" } });
  await supabase.from("assets").delete().match({ id: { like: "test-%" } });

  // Test 1: Incident event
  console.log("\n📋 Test 1: Incident Event");
  const incidentAsset = await createTestAsset("test-asset-001", "TAG-INC-001");
  if (!incidentAsset) {
    console.error("Failed to create test asset for incident");
    return;
  }

  const incidentResult = await sendWebhookEvent(testEvents.incident);
  console.log("Status:", incidentResult.status);
  console.log("Response:", JSON.stringify(incidentResult.data, null, 2));

  // Test 2: Failed inspection
  console.log("\n📋 Test 2: Failed Inspection");
  const failAsset = await createTestAsset("test-asset-002", "TAG-FAIL-001");
  if (!failAsset) {
    console.error("Failed to create test asset for failed inspection");
    return;
  }

  const failResult = await sendWebhookEvent(testEvents.failedInspection);
  console.log("Status:", failResult.status);
  console.log("Response:", JSON.stringify(failResult.data, null, 2));

  // Test 3: Passed inspection (should not trigger alert)
  console.log("\n📋 Test 3: Passed Inspection (should not trigger alert)");
  const passAsset = await createTestAsset("test-asset-003", "TAG-PASS-001");
  if (!passAsset) {
    console.error("Failed to create test asset for passed inspection");
    return;
  }

  const passResult = await sendWebhookEvent(testEvents.passedInspection);
  console.log("Status:", passResult.status);
  console.log("Response:", JSON.stringify(passResult.data, null, 2));

  // Verify results in database
  console.log("\n🔍 Verifying results in database...");
  const { data: alerts } = await supabase
    .from("alerts")
    .select("*")
    .match({ event_id: { like: "test-%" } });

  console.log(`Found ${alerts?.length || 0} alerts in database:`);
  if (alerts && alerts.length > 0) {
    alerts.forEach((alert: any) => {
      console.log(`- Alert ID: ${alert.id}`);
      console.log(`  Event ID: ${alert.event_id}`);
      console.log(`  Type: ${alert.alert_type}`);
      console.log(`  Severity: ${alert.severity}`);
      console.log(`  Title: ${alert.title}`);
      console.log(`  Status: ${alert.status}`);
      console.log("");
    });
  }

  // Test 4: Duplicate event (idempotency)
  console.log("\n📋 Test 4: Duplicate Event (idempotency test)");
  const duplicateResult = await sendWebhookEvent(testEvents.incident);
  console.log("Status:", duplicateResult.status);
  console.log("Response:", JSON.stringify(duplicateResult.data, null, 2));

  console.log("\n✅ Testing completed!");
  console.log("\n📝 Summary:");
  console.log("- Incident events should create 'incident' type alerts");
  console.log("- Failed inspections should create 'critical_fail' type alerts");
  console.log("- Passed inspections should not create alerts");
  console.log("- Duplicate events should be handled gracefully (idempotency)");
}

// Run the test if this script is executed directly
if (import.meta.main) {
  testCriticalAlertMonitor().catch(console.error);
}

export { testCriticalAlertMonitor };