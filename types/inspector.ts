// ============================================================================
// INSPECTOR TYPES — Extended interfaces for inspector-specific data
// ============================================================================

import type { Profile } from './database';

export interface InspectorEarnings {
  id: string;
  inspector_id: string;
  total_earned: number;
  monthly_earned: number;
  pending_amount: number;
  completed_jobs_count: number;
  referral_code: string;
  updated_at: string;
}

export interface InspectorJob {
  id: string;
  title: string;
  job_code: string | null;          // e.g. "API-653" — real value from DB
  address: string | null;
  status: 'pending' | 'active' | 'completed' | 'cancelled' | 'urgent';
  priority: 'low' | 'normal' | 'high' | 'urgent' | null;
  inspector_id: string | null;
  client_id: string;
  scheduled_date: string | null;
  created_at: string;
  updated_at: string;
  client?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
}

// UI-level status badge values
export type UIJobStatus = 'Critical' | 'Assigned' | 'In Progress' | 'Pending' | 'Completed' | 'Cancelled';

// Job shape after DB → UI mapping
export interface MappedInspectorJob extends InspectorJob {
  uiStatus: UIJobStatus;
  uiStatusColor: string;   // Text/icon color
  uiStatusBg: string;      // Badge background
}

// Full return type of useInspectorData
export interface InspectorDataReturn {
  jobs: MappedInspectorJob[];
  earnings: InspectorEarnings | null;
  isLoadingJobs: boolean;
  isLoadingEarnings: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // Derived stats — memoized
  activeJobsCount: number;
  criticalJobsCount: number;
  completedJobsCount: number;
  totalEarned: number;
  monthlyEarned: number;
  pendingAmount: number;
  referralCode: string;
}