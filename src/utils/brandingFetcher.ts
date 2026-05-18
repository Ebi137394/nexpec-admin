import { supabase } from '../lib/supabase';
import type { BrandingConfig } from '../types/report';

export async function fetchClientBranding(clientId: string): Promise<BrandingConfig | null> {
  try {
    if (!clientId) return null;
    const { data, error } = await supabase.from('profiles').select('company_logo_url, report_header_text, report_footer_text, use_custom_branding').eq('id', clientId).single();
    if (error || !data) return null;
    
    return { 
      company_logo_url: data.company_logo_url || null, 
      report_header_text: data.report_header_text || null, 
      report_footer_text: data.report_footer_text || null, 
      use_custom_branding: data.use_custom_branding || false 
    };
  } catch (err) { 
    return null; 
  }
}