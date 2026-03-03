// supabase/functions/generate-contract/types.ts

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  company_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  avatar_url: string | null;
  role: 'client' | 'inspector' | 'admin';
}

export interface Job {
  id: string;
  title: string;
  description: string;
  client_id: string;
  inspector_id: string;
  status: string;
  location: string;
  inspection_type: string;
  scheduled_date: string | null;
  deadline: string | null;
  total_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
  scope_of_work: string | null;
  special_requirements: string | null;
}

export interface ContractData {
  contract_id: string;
  job: Job;
  client: Profile;
  inspector: Profile;
  generated_at: string;
  valid_until: string;
}

export interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: Job;
  old_record: Job | null;
  schema: string;
}

export interface ContractRecord {
  id: string;
  job_id: string;
  contract_number: string;
  pdf_url: string;
  client_id: string;
  inspector_id: string;
  total_amount: number;
  status: 'draft' | 'sent' | 'signed' | 'expired';
  created_at: string;
  signed_at: string | null;
}