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

Deno.serve(async (req) => {
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
        evidence_files
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
          headers: { "Content-Type": "application/json" } 
        }
      );
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

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('dispute-reports')
      .getPublicUrl(filename);

    const publicUrl = publicUrlData.publicUrl;

    // Update dispute record with report URL
    await supabase
      .from('disputes')
      .update({ 
        report_url: publicUrl,
        report_generated_at: new Date().toISOString()
      })
      .eq('id', dispute_id);

    // Log the report generation
    await supabase.from('activity_logs').insert({
      action: 'dispute_report_generated',
      resource_type: 'dispute',
      resource_id: dispute_id,
      details: {
        report_url: publicUrl,
        filename: filename
      },
      created_at: new Date().toISOString()
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        url: publicUrl,
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