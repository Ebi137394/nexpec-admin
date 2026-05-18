// ════════════════════════════════════════════════════════════════════════════
//  lib/data/dispatchQueue.types.ts — type-only. Safe for Client Components.
// ════════════════════════════════════════════════════════════════════════════

export interface DispatchApplication {
  id: string;
  job_id: string;
  applicant_id: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  payout_amount_cents: number | null;
  created_at: string | null;
}

export interface DispatchJob {
  id: string;
  title: string | null;
  location: string | null;
  created_at: string | null;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  posted_payout_cents: number | null;
  applications: DispatchApplication[];
}

export interface DispatchQueueResult {
  jobs: DispatchJob[];
  total: number;
}
