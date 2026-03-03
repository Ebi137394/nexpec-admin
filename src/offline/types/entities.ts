export interface BaseEntity {
  id: string;
  created_at: string;
  updated_at: string;
  _local_modified?: boolean;
  _local_updated_at?: string;
  _synced?: boolean;
}

export interface Job extends BaseEntity {
  contractor_id: string;
  client_name: string;
  address: string;
  scheduled_date: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface InspectionReport extends BaseEntity {
  job_id: string;
  contractor_id: string;
  summary: string;
  notes: string;
  status: 'draft' | 'submitted' | 'approved';
  photos_urls: string; // stored as JSON string in SQLite
}

export interface InspectionPhoto {
  id: string;
  inspection_report_id: string;
  local_uri: string;
  remote_url?: string;
  upload_status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  file_size?: number;
  mime_type?: string;
  created_at: string;
  uploaded_at?: string;
  retry_count: number;
}

export interface JobExpense extends BaseEntity {
  job_id: string;
  contractor_id: string;
  description: string;
  amount: number;
  category: string;
  receipt_url?: string;
}

export interface SyncOutboxItem {
  id: number;
  uuid: string;
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record_id: string;
  payload: string;
  created_at: string;
  retry_count: number;
  status: 'pending' | 'processing' | 'failed' | 'completed';
  error_message?: string;
  requires_manual_resolution: boolean;
  local_updated_at: string;
  server_updated_at?: string;
}