export interface BrandingConfig {
  company_logo_url: string | null;
  report_header_text: string | null;
  report_footer_text: string | null;
  use_custom_branding: boolean;
  primary_color?: string;
  company_name?: string;
}

export interface InspectionReport {
  id: string;
  job_title: string;
  job_location: string | null;
  project_id: string;
  client_id: string;
  inspector_id: string;
  inspector_first_name: string;
  inspector_last_name: string;
  inspector_email?: string;
  summary: string;
  findings?: string;
  recommendations?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  photos_urls: string[];
  signature: string | null;
  submitted_at: string;
  created_at: string;
}

export interface PDFGenerationResult {
  success: boolean;
  uri?: string;
  error?: string;
  shared?: boolean;
}