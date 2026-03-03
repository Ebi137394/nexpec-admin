// supabase/functions/send-consent-receipt/index.ts

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { 
  WebhookPayload, 
  LegalConsent, 
  UserProfile, 
  ConsentWithProfile 
} from './types.ts';
import { generateConsentPDF } from './pdf-generator.ts';
import { sendConsentReceiptEmail } from './email-service.ts';

// CORS headers for development
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FunctionResponse {
  success: boolean;
  message: string;
  data?: {
    consentId: string;
    emailSent: boolean;
    messageId?: string;
    pdfGenerated: boolean;
  };
  error?: string;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    if (!resendApiKey) {
      throw new Error('Missing RESEND_API_KEY environment variable');
    }

    // Parse request body
    const payload: WebhookPayload | { consent_id: string } = await req.json();
    
    let consentId: string;
    
    // Handle both webhook payload and direct invocation
    if ('record' in payload && payload.record?.id) {
      consentId = payload.record.id;
      console.log(`Processing webhook for consent: ${consentId}`);
    } else if ('consent_id' in payload) {
      consentId = payload.consent_id;
      console.log(`Processing direct invocation for consent: ${consentId}`);
    } else {
      throw new Error('Invalid payload: missing consent_id or record');
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Fetch consent data
    console.log(`Fetching consent data for ID: ${consentId}`);
    const { data: consentData, error: consentError } = await supabase
      .from('legal_consents')
      .select('*')
      .eq('id', consentId)
      .single();

    if (consentError) {
      throw new Error(`Failed to fetch consent: ${consentError.message}`);
    }

    if (!consentData) {
      throw new Error(`Consent not found: ${consentId}`);
    }

    const consent = consentData as LegalConsent;
    console.log(`Consent found for user: ${consent.user_id}`);

    // Fetch user profile
    console.log(`Fetching user profile for: ${consent.user_id}`);
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', consent.user_id)
      .single();

    // If profile doesn't exist, try fetching from auth.users
    let profile: UserProfile;
    
    if (profileError || !profileData) {
      console.log('Profile not found in profiles table, checking auth.users...');
      
      // Try to get user from auth
      const { data: { user }, error: authError } = await supabase.auth.admin.getUserById(consent.user_id);
      
      if (authError || !user) {
        // Create a minimal profile from available data
        console.log('Creating minimal profile from consent data');
        profile = {
          id: consent.user_id,
          email: `user-${consent.user_id.substring(0, 8)}@example.com`, // Fallback
          full_name: 'Inspector',
        };
      } else {
        profile = {
          id: user.id,
          email: user.email || `user-${consent.user_id.substring(0, 8)}@example.com`,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || 'Inspector',
          company_name: user.user_metadata?.company_name,
          job_title: user.user_metadata?.job_title,
        };
      }
    } else {
      profile = profileData as UserProfile;
    }

    console.log(`User profile resolved: ${profile.email}`);

    // Combine consent with profile
    const consentWithProfile: ConsentWithProfile = {
      ...consent,
      profile,
    };

    // Generate PDF
    console.log('Generating PDF receipt...');
    const { pdfBytes, filename } = await generateConsentPDF(consentWithProfile);
    console.log(`PDF generated: ${filename} (${pdfBytes.length} bytes)`);

    // Send email
    console.log(`Sending email to: ${profile.email}`);
    const emailResult = await sendConsentReceiptEmail(consentWithProfile, pdfBytes, filename);

    if (!emailResult.success) {
      console.error(`Email sending failed: ${emailResult.error}`);
      // Log the error but don't throw - we still want to record that PDF was generated
    } else {
      console.log(`Email sent successfully: ${emailResult.messageId}`);
    }

    // Update consent record with receipt info
    const { error: updateError } = await supabase
      .from('legal_consents')
      .update({
        receipt_sent_at: new Date().toISOString(),
        receipt_email_id: emailResult.messageId || null,
        receipt_filename: filename,
        updated_at: new Date().toISOString(),
      })
      .eq('id', consentId);

    if (updateError) {
      console.error(`Failed to update consent record: ${updateError.message}`);
    }

    // Log to audit trail
    await supabase.from('consent_audit_logs').insert({
      consent_id: consentId,
      action: 'RECEIPT_GENERATED',
      details: {
        pdf_filename: filename,
        pdf_size_bytes: pdfBytes.length,
        email_sent: emailResult.success,
        email_message_id: emailResult.messageId,
        recipient_email: profile.email,
      },
      created_at: new Date().toISOString(),
    }).catch(err => {
      console.error('Failed to log audit entry:', err);
    });

    const response: FunctionResponse = {
      success: true,
      message: 'Consent receipt processed successfully',
      data: {
        consentId,
        emailSent: emailResult.success,
        messageId: emailResult.messageId,
        pdfGenerated: true,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });

  } catch (error) {
    console.error('Error processing consent receipt:', error);

    const response: FunctionResponse = {
      success: false,
      message: 'Failed to process consent receipt',
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }
});