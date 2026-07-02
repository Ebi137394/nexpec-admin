import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface DisputeData {
  id: string;
  project_title: string;
  project_id: string;
  contractor_name: string;
  client_name: string;
  dispute_type: string;
  description: string;
  created_at: string;
  status: string;
  resolution_details: string;
  resolution_date: string;
  resolved_by: string;
  amount_involved?: number;
  evidence_files?: string[];
}

// CORS for the browser caller (src/components/DisputeReportDownloader.tsx).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

Deno.serve(async (req) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body
    const { dispute_id } = await req.json();
    
    if (!dispute_id) {
      return new Response(
        JSON.stringify({ error: 'dispute_id is required' }), 
        { 
          status: 400, 
          headers: { "Content-Type": "application/json" } 
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase environment variables not configured' }), 
        { 
          status: 500, 
          headers: { "Content-Type": "application/json" } 
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // AuthZ: resolve the caller from their JWT. Only a party to the dispute
    // (the project's client or inspector, or whoever raised it) or an admin may
    // pull the report. Without this, any authenticated user could read any
    // dispute by id (IDOR) since the service-role client bypasses RLS.
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 1. دریافت اطلاعات کامل اختلاف از دیتابیس
    const { data: disputeData, error: disputeError } = await supabase
      .from('disputes')
      .select(`
        id,
        project_title,
        project_id,
        contractor_name,
        client_name,
        dispute_type,
        description,
        created_at,
        status,
        resolution_details,
        resolution_date,
        resolved_by,
        amount_involved,
        evidence_files,
        raised_by
      `)
      .eq('id', dispute_id)
      .single();

    if (disputeError || !disputeData) {
      return new Response(
        JSON.stringify({
          error: 'Dispute not found or error fetching data',
          details: disputeError?.message
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // AuthZ gate: caller must be a dispute party or an admin. The dispute links
    // to a project (project_id) whose client_id / inspector_id are the parties,
    // plus disputes.raised_by. Mirrors the live RLS policy on public.disputes.
    {
      let isParty = disputeData.raised_by === user.id;
      if (!isParty && disputeData.project_id) {
        const { data: project } = await supabase
          .from('projects')
          .select('client_id, inspector_id')
          .eq('id', disputeData.project_id)
          .maybeSingle();
        isParty =
          project?.client_id === user.id || project?.inspector_id === user.id;
      }
      if (!isParty) {
        const { data: callerProfile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        const role = (callerProfile as { role?: string } | null)?.role;
        const isAdmin = role === 'admin' || role === 'super_admin';
        if (!isAdmin) {
          return new Response(
            JSON.stringify({ error: 'forbidden' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    // 2. طراحی ساختار PDF
    const doc = new jsPDF();
    
    // Set up document properties
    doc.setProperties({
      title: `Dispute Resolution Report - ${disputeData.project_title}`,
      subject: 'NEXPEC Dispute Resolution',
      author: 'NEXPEC Platform',
      creator: 'NEXPEC Backend System'
    });

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(41, 128, 185);
    doc.text("NEXPEC DISPUTE RESOLUTION REPORT", 105, 20, { align: "center" });
    
    // Subtitle
    doc.setFontSize(12);
    doc.setTextColor(108, 122, 137);
    doc.text(`Generated on: ${new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`, 105, 28, { align: "center" });

    // Line separator
    doc.setDrawColor(41, 128, 185);
    doc.line(20, 35, 190, 35);

    // Basic Information Section
    doc.setFontSize(14);
    doc.setTextColor(52, 73, 94);
    doc.setFont('helvetica', 'bold');
    doc.text("BASIC INFORMATION", 20, 45);
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(74, 85, 96);
    
    const basicInfo = [
      { label: "Report ID:", value: disputeData.id },
      { label: "Project:", value: disputeData.project_title },
      { label: "Project ID:", value: disputeData.project_id },
      { label: "Contractor:", value: disputeData.contractor_name },
      { label: "Client:", value: disputeData.client_name },
      { label: "Dispute Type:", value: disputeData.dispute_type },
      { label: "Status:", value: disputeData.status },
      { label: "Created:", value: new Date(disputeData.created_at).toLocaleDateString() },
    ];

    let yPos = 55;
    basicInfo.forEach(item => {
      doc.text(item.label, 20, yPos);
      doc.text(item.value, 80, yPos);
      yPos += 8;
    });

    // Amount Section (if applicable)
    if (disputeData.amount_involved) {
      yPos += 4;
      doc.text(`Amount Involved: $${disputeData.amount_involved.toLocaleString()}`, 20, yPos);
      yPos += 10;
    }

    // Description Section
    yPos += 5;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text("DISPUTE DESCRIPTION", 20, yPos);
    
    yPos += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const descriptionLines = doc.splitTextToSize(disputeData.description, 170);
    doc.text(descriptionLines, 20, yPos);

    // Calculate position after description
    yPos += (descriptionLines.length * 6) + 10;

    // Resolution Section
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text("RESOLUTION DETAILS", 20, yPos);
    
    yPos += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    
    const resolutionInfo = [
      { label: "Resolution Date:", value: disputeData.resolution_date ? new Date(disputeData.resolution_date).toLocaleDateString() : 'Not resolved' },
      { label: "Resolved By:", value: disputeData.resolved_by || 'Not resolved' },
    ];

    resolutionInfo.forEach(item => {
      doc.text(item.label, 20, yPos);
      doc.text(item.value, 80, yPos);
      yPos += 8;
    });

    yPos += 5;
    doc.text("Decision Details:", 20, yPos);
    yPos += 8;
    
    const resolutionLines = doc.splitTextToSize(disputeData.resolution_details || 'No resolution details available.', 170);
    doc.text(resolutionLines, 20, yPos);

    // Calculate final position
    yPos += (resolutionLines.length * 6) + 15;

    // Evidence Section
    if (disputeData.evidence_files && disputeData.evidence_files.length > 0) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text("EVIDENCE FILES", 20, yPos);
      
      yPos += 10;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      
      disputeData.evidence_files.forEach((file, index) => {
        doc.text(`${index + 1}. ${file}`, 20, yPos);
        yPos += 6;
      });
      
      yPos += 5;
    }

    // Footer
    doc.setDrawColor(202, 207, 210);
    doc.line(20, yPos, 190, yPos);
    
    yPos += 10;
    doc.setFontSize(10);
    doc.setTextColor(149, 165, 166);
    doc.text("This report was automatically generated by the NEXPEC platform.", 20, yPos);
    doc.text("For questions or concerns, please contact support@nexpec.com", 20, yPos + 5);

    // 3. آپلود در Storage و بازگرداندن لینک
    const pdfOutput = doc.output("arraybuffer");
    
    // Generate filename
    const filename = `dispute-report-${disputeData.id}-${Date.now()}.pdf`;
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('dispute-reports')
      .upload(filename, pdfOutput, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      return new Response(
        JSON.stringify({ 
          error: 'Failed to upload PDF to storage',
          details: uploadError.message 
        }), 
        { 
          status: 500, 
          headers: { "Content-Type": "application/json" } 
        }
      );
    }

    // The `dispute-reports` bucket is private (owner+admin only). Store the
    // storage PATH (filename) in the DB; mint a signed URL for the response.
    const { data: signed } = await supabase.storage
      .from('dispute-reports')
      .createSignedUrl(filename, 3600);

    // Update dispute record with report PATH
    await supabase
      .from('disputes')
      .update({
        report_url: filename,
        report_generated_at: new Date().toISOString()
      })
      .eq('id', dispute_id);

    // Log the report generation (store PATH, not a public URL)
    await supabase.from('activity_logs').insert({
      action: 'dispute_report_generated',
      resource_type: 'dispute',
      resource_id: dispute_id,
      details: {
        report_url: filename,
        filename: filename
      },
      created_at: new Date().toISOString()
    });

    return new Response(
      JSON.stringify({
        success: true,
        url: signed?.signedUrl ?? null,
        filename: filename,
        message: 'Dispute resolution report generated successfully'
      }),
      { 
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        } 
      }
    );

  } catch (error) {
    console.error('Error generating dispute report:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), 
      { 
        status: 500, 
        headers: { "Content-Type": "application/json" } 
      }
    );
  }
});

// Add CORS headers for all requests
addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      const response = await fetch(event.request);
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    })()
  );
});