import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sendJobAssignmentEmail } from "./email-service.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inspectorEmail, inspectorName, jobTitle, location, payoutAmount } = await req.json();

    if (!inspectorEmail || !inspectorName || !jobTitle || !location || !payoutAmount) {
    return new Response(
      JSON.stringify({ error: "Missing required parameters" }),
      { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
    }

    const result = await sendJobAssignmentEmail({
      inspectorEmail,
      inspectorName,
      jobTitle,
      location,
      payoutAmount
    });

    return new Response(
      JSON.stringify({ message: "Email sent successfully", result }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error) {
    console.error("Error sending job assignment email:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send email", details: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});