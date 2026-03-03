// supabase/functions/send-consent-receipt/types.ts

export interface LegalConsent {
  id: string;
  user_id: string;
  document_id: string;
  signature_base64: string;
  signature_stroke_count: number;
  nda_accepted: boolean;
  data_processing_accepted: boolean;
  confidentiality_accepted: boolean;
  liability_accepted: boolean;
  ip_address: string | null;
  user_agent: string | null;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  policy_version: string;
  consent_status: string;
  signed_at: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  company_name?: string;
  job_title?: string;
  phone?: string;
  avatar_url?: string;
}

export interface ConsentWithProfile extends LegalConsent {
  profile: UserProfile;
}

export interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: LegalConsent;
  schema: string;
  old_record: LegalConsent | null;
}

export interface AuditTrailItem {
  label: string;
  value: string;
}

export interface PDFGenerationResult {
  pdfBytes: Uint8Array;
  filename: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}