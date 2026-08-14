import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendJobAssignmentEmail } from "./email-service.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

// AuthZ: this endpoint previously emailed an arbitrary recipient + payout taken
// straight from the request body with no caller check (open relay). Lock it to
// (a) an admin user JWT, or (b) a trusted server-to-server caller presenting the
// shared secret. Fails closed. Returns true iff the caller is authorized.
// TODO(security): the recipient/payout should ideally be derived server-side
// from a job_id (and the assigned inspector) rather than trusted from the body.
async function isAuthorized(req: Request): Promise<boolean> {
  // Path (b): server-to-server shared secret.
  const internalSecret = Deno.env.get('NOTIFY_SHARED_SECRET');
  const provided = req.headers.get('x-internal-secret');
  if (internalSecret && provided && provided === internalSecret) return true;

  // Path (a): admin user JWT.
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey || !authHeader) return false;

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return false;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role;
  return role === 'admin' || role === 'super_admin';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Fail closed unless the caller is an admin or the trusted internal secret.
  if (!(await isAuthorized(req))) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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
      JSON.stringify({ error: "Failed to send email", details: (error instanceof Error ? error.message : String(error)) }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});