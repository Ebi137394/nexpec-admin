import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.2';
import { 
  NEXPEC_LOGO_BASE64, 
  EMAIL_TEMPLATE, 
  PDF_STYLES,
  generatePDFFileName
} from './constants.ts';
import { generateConsentPDF } from './pdf-generator.ts';
import { sendConsentReceiptEmail } from './email-service.ts';
import type { 
  WebhookPayload, 
  LegalConsent, 
  UserProfile, 
  ConsentWithProfile,
  AuditTrailItem,
  PDFGenerationResult,
  EmailResult
} from './types.ts';

// Initialize Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Email service using Resend
const resendApiKey = Deno.env.get('RESEND_API_KEY');

serve(async (req: Request) => {
  try {
    const payload: WebhookPayload = await req.json();

    // Only process INSERT events for new consents
    if (payload.type !== 'INSERT' || payload.table !== 'legal_consents') {
      return new Response(JSON.stringify({ message: 'Skipping non-INSERT event' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const consentData = payload.record as LegalConsent;
    
    // Fetch user profile
    const userProfile = await fetchUserProfile(consentData.user_id);
    if (!userProfile) {
      throw new Error(`User profile not found for user_id: ${consentData.user_id}`);
    }

    const consentWithProfile: ConsentWithProfile = {
      ...consentData,
      profile: userProfile
    };

    // Generate PDF receipt using the new PDF generator
    const pdfResult = await generateConsentPDF(consentWithProfile);
    
    // Send email with PDF attachment using the new email service
    const emailResult = await sendConsentReceiptEmail(
      consentWithProfile,
      pdfResult.pdfBytes,
      pdfResult.filename
    );

    return new Response(JSON.stringify({
      message: 'Consent receipt processed successfully',
      consentId: consentData.id,
      emailResult,
      pdfFilename: pdfResult.filename
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error processing consent receipt:', error);
    
    return new Response(JSON.stringify({
      error: 'Failed to process consent receipt',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, company_name, job_title, phone, avatar_url')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }

    return data as UserProfile;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}


// To invoke:
// curl -i --location --request POST 'http://localhost:54321/functions/v1/send-consent-receipt' \
//   --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
//   --header 'Content-Type: application/json' \
//   --data '{"name":"Functions"}'