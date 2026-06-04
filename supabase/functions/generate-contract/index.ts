import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { encode as base64Encode } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { generateContractPDF } from "./pdf-generator.ts";
import { sendContractEmails } from "./email-service.ts";
import { WebhookPayload, Job, Profile, ContractData, ContractRecord } from "./types.ts";

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORAGE_BUCKET = "contracts";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Initialize Supabase client
function getSupabaseClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Generate unique contract ID
function generateContractId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `NXP-${timestamp}-${random}`;
}

// Fetch job details
async function fetchJobDetails(supabase: SupabaseClient, jobId: string): Promise<Job> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error) throw new Error(`Failed to fetch job: ${error.message}`);
  if (!data) throw new Error(`Job not found: ${jobId}`);
  
  return data;
}

// Fetch profile details
async function fetchProfile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) throw new Error(`Failed to fetch profile: ${error.message}`);
  if (!data) throw new Error(`Profile not found: ${userId}`);
  
  return data;
}

// Upload PDF to Storage
async function uploadToStorage(
  supabase: SupabaseClient,
  contractId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const fileName = `${contractId}.pdf`;
  const filePath = `${new Date().getFullYear()}/${fileName}`;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, pdfBytes, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw new Error(`Failed to upload PDF: ${error.message}`);

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

// Save contract record to database
async function saveContractRecord(
  supabase: SupabaseClient,
  contractData: ContractData,
  pdfUrl: string
): Promise<ContractRecord> {
  const record = {
    job_id: contractData.job.id,
    contract_number: contractData.contract_id,
    pdf_url: pdfUrl,
    client_id: contractData.client.id,
    inspector_id: contractData.inspector.id,
    total_amount: contractData.job.total_amount,
    status: "sent",
    valid_until: contractData.valid_until,
  };

  const { data, error } = await supabase
    .from("contracts")
    .insert(record)
    .select()
    .single();

  if (error) throw new Error(`Failed to save contract record: ${error.message}`);
  
  return data;
}

// Update job with contract reference
async function updateJobWithContract(
  supabase: SupabaseClient,
  jobId: string,
  contractId: string
): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({ 
      contract_id: contractId,
      contract_generated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) throw new Error(`Failed to update job: ${error.message}`);
}

// Fetch inspector signature for contract
async function fetchInspectorSignature(supabase: SupabaseClient, inspectorId: string) {
  const { data, error } = await supabase
    .from("legal_consents")
    .select("signature_image")
    .eq("user_id", inspectorId)
    .order("signed_at", { ascending: false })
    .limit(1)
    .single();

  return data?.signature_image || null;
}

// Main handler
async function handleContractGeneration(jobId: string): Promise<Response> {
  const supabase = getSupabaseClient();
  
  console.log(`🚀 Starting contract generation for job: ${jobId}`);

  try {
    // 1. Fetch all required data
    console.log("📥 Fetching job and profile data...");
    const job = await fetchJobDetails(supabase, jobId);
    
    // Validate job status
    if (job.status !== "hired") {
      return new Response(
        JSON.stringify({ error: "Job is not in 'hired' status" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [client, inspector] = await Promise.all([
      fetchProfile(supabase, job.client_id),
      fetchProfile(supabase, job.inspector_id),
    ]);

    // 2. Prepare contract data
    const contractId = generateContractId();
    const now = new Date();
    const validUntil = new Date(now);
    validUntil.setDate(validUntil.getDate() + 30); // Valid for 30 days

    const contractData: ContractData = {
      contract_id: contractId,
      job,
      client,
      inspector,
      generated_at: now.toISOString(),
      valid_until: validUntil.toISOString(),
    };

    // 3. Fetch inspector signature and generate PDF
    console.log("📄 Fetching inspector signature...");
    const signature = await fetchInspectorSignature(supabase, job.inspector_id);
    
    console.log("📄 Generating PDF contract...");
    const pdfBytes = await generateContractPDF(contractData);
    console.log(`✅ PDF generated: ${pdfBytes.length} bytes`);

    // 4. Upload to Storage
    console.log("☁️ Uploading to storage...");
    const pdfUrl = await uploadToStorage(supabase, contractId, pdfBytes);
    console.log(`✅ PDF uploaded: ${pdfUrl}`);

    // 5. Save contract record
    console.log("💾 Saving contract record...");
    const contractRecord = await saveContractRecord(supabase, contractData, pdfUrl);
    console.log(`✅ Contract record saved: ${contractRecord.id}`);

    // 6. Update job with contract reference
    await updateJobWithContract(supabase, jobId, contractRecord.id);

    // 7. Send emails to both parties
    console.log("📧 Sending contract emails...");
    const pdfBase64 = base64Encode(pdfBytes);
    await sendContractEmails(contractData, pdfBase64, pdfUrl);
    console.log("✅ Emails sent successfully");

    // 8. Log activity
    await supabase.from("activity_logs").insert({
      action: "contract_generated",
      entity_type: "contract",
      entity_id: contractRecord.id,
      metadata: {
        job_id: jobId,
        contract_number: contractId,
        client_id: client.id,
        inspector_id: inspector.id,
        total_amount: job.total_amount,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Contract generated and sent successfully",
        data: {
          contract_id: contractRecord.id,
          contract_number: contractId,
          pdf_url: pdfUrl,
          sent_to: [client.email, inspector.email],
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("❌ Contract generation failed:", error);

    // Log error
    await supabase.from("error_logs").insert({
      function_name: "generate-contract",
      error_message: (error as Error).message,
      error_stack: (error as Error).stack,
      metadata: { job_id: jobId },
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

// Edge Function entry point
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();

    // Check if this is a webhook payload or direct call
    if (body.type === "UPDATE" && body.table === "jobs") {
      // Webhook trigger
      const payload = body as WebhookPayload;
      
      // Only process if status changed to 'hired'
      if (
        payload.record.status === "hired" &&
        payload.old_record?.status !== "hired"
      ) {
        return await handleContractGeneration(payload.record.id);
      }

      return new Response(
        JSON.stringify({ message: "No action needed - status not changed to hired" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Direct call with job_id
    if (body.job_id) {
      return await handleContractGeneration(body.job_id);
    }

    return new Response(
      JSON.stringify({ error: "Invalid request body - job_id required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Request parsing error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});