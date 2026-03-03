// test-contract-generation.ts
// Run with: deno run --allow-net test-contract-generation.ts

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function testContractGeneration() {
  console.log("🧪 Testing contract generation...\n");

  // Test job ID (replace with actual job ID)
  const testJobId = "your-test-job-id";

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/generate-contract`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ job_id: testJobId }),
    }
  );

  const result = await response.json();

  console.log("Status:", response.status);
  console.log("Response:", JSON.stringify(result, null, 2));

  if (result.success) {
    console.log("\n✅ Contract generated successfully!");
    console.log("📄 PDF URL:", result.data.pdf_url);
    console.log("📧 Sent to:", result.data.sent_to.join(", "));
  } else {
    console.log("\n❌ Contract generation failed:", result.error);
  }
}

testContractGeneration();