// types/application.ts

import { nxHandle } from '../src/core/utils/handle';

/**
 * Application status enum values
 */
export type ApplicationStatus = 
  | 'pending'
  | 'reviewing'
  | 'shortlisted'
  | 'offered' 
  | 'CLIENT_SELECTED' 
  | 'hired' 
  | 'rejected' 
  | 'withdrawn'
  | 'accepted'; // accepted رو هم گذاشتم که اگر دیتای قدیمی داری ارور نده

/**
 * Bid type for custom pricing
 */
export type BidType = 'hourly' | 'daily' | 'fixed';

/**
 * Application record from the database
 */
export interface Application {
  id: string;
  job_id: string;
  applicant_id: string;
  status: ApplicationStatus;
  cover_note: string | null;
  bid_amount_cents: number | null;      // ★ Task 4
  bid_type: BidType | null;
  currency: string;
  estimated_duration: string | null;
  available_start_date: string | null;
  attachments: string[] | null;
  client_notes: string | null;
  rejection_reason: string | null;
  offered_at: string | null;
  hired_at: string | null;
  withdrawn_at: string | null;
  last_viewed_by_client: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Payload for creating a new application
 */
export interface ApplicationInsertPayload {
  job_id: string;
  applicant_id: string;
  cover_note?: string | null;
  bid_amount_cents?: number | null;       // ★ Task 4
  bid_type?: BidType | null;
  currency?: string;
  estimated_duration?: string | null;
  available_start_date?: string | null;
  attachments?: string[] | null;
}

/**
 * Payload for updating an application (by applicant)
 */
export interface ApplicationUpdatePayload {
  cover_note?: string | null;
  bid_amount_cents?: number | null;       // ★ Task 4
  bid_type?: BidType | null;
  estimated_duration?: string | null;
  available_start_date?: string | null;
  attachments?: string[] | null;
}

/**
 * Payload for updating application status (by client)
 */
export interface ApplicationStatusUpdatePayload {
  status: ApplicationStatus;
  client_notes?: string | null;
  rejection_reason?: string | null;
}

/**
 * Form data for submitting an application
 */
export interface ApplicationFormData {
  cover_note: string;
  bid_amount: string;
  bid_type: BidType | '';
  estimated_duration: string;
  available_start_date: string;
  use_custom_bid: boolean;
}

/**
 * Inspector profile for joined queries
 */
export interface ApplicantProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  title: string | null;
  bio: string | null;
  years_experience: number | null;
  hourly_rate_cents: number | null;     // ★ Task 4
  daily_rate: number | null;
  specialties: string[] | null;
}

/**
 * Application with joined applicant profile
 */
export interface ApplicationWithProfile extends Application {
  applicant: ApplicantProfile;
}

/**
 * Application with job details (for applicant's view)
 */
export interface ApplicationWithJob extends Application {
  job: {
    id: string;
    title: string;
    location_city: string | null;
    location_state: string | null;
    budget_type: string;
    budget_min: number | null;
    budget_max: number | null;
    currency: string;
    status: string;
    start_date: string | null;
    client: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
    };
  };
}

/**
 * Full application details (for detailed view)
 */
export interface ApplicationFull extends Application {
  applicant: ApplicantProfile;
  job: {
    id: string;
    title: string;
    description: string | null;
    location_city: string | null;
    location_state: string | null;
    job_type: string;
    urgency: string;
    budget_type: string;
    budget_min: number | null;
    budget_max: number | null;
    currency: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
  };
  certifications?: {
    id: string;
    name: string;
    status: string;
    issuing_organization: string;
  }[];
}

/**
 * Application statistics for a job
 */
export interface JobApplicationStats {
  job_id: string;
  total_applications: number;
  pending_count: number;
  reviewing_count: number;
  shortlisted_count: number;
  offered_count: number;
  hired_count: number;
  rejected_count: number;
  withdrawn_count: number;
  min_bid: number | null;
  max_bid: number | null;
  avg_bid: number | null;
}

/**
 * Status configuration for display
 */
export interface StatusConfig {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
  description: string;
}

/**
 * Status display configurations
 */
export const APPLICATION_STATUS_CONFIG: Record<ApplicationStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    color: '#F59E0B',
    bgColor: '#F59E0B20',
    icon: 'clock',
    description: 'Waiting for client review',
  },
  reviewing: {
    label: 'Under Review',
    color: '#3B82F6',
    bgColor: '#3B82F620',
    icon: 'eye',
    description: 'Client is reviewing your application',
  },
  shortlisted: {
    label: 'Shortlisted',
    color: '#A855F7',
    bgColor: '#A855F720',
    icon: 'star',
    description: 'You\'re on the shortlist!',
  },
  offered: {
    label: 'Offer Received',
    color: '#22C55E',
    bgColor: '#22C55E20',
    icon: 'check-circle',
    description: 'You have received an offer',
  },
  // ★ Client has chosen this inspector. Awaiting super-admin Confirm & Dispatch.
  CLIENT_SELECTED: {
    label: 'Pending Admin Confirmation',
    color: '#3B82F6',
    bgColor: '#3B82F620',
    icon: 'clock',
    description: 'Client selected this inspector. Awaiting admin Confirm & Dispatch.',
  },
  accepted: {
    label: 'Accepted',
    color: '#22C55E',
    bgColor: '#22C55E20',
    icon: 'check-circle',
    description: 'Application accepted (legacy)',
  },
  rejected: {
    label: 'Not Selected',
    color: '#EF4444',
    bgColor: '#EF444420',
    icon: 'x-circle',
    description: 'Application was not selected',
  },
  hired: {
    label: 'Hired',
    color: '#22C55E',
    bgColor: '#22C55E30',
    icon: 'briefcase',
    description: 'Congratulations! You got the job',
  },
  withdrawn: {
    label: 'Withdrawn',
    color: '#64748B',
    bgColor: '#64748B20',
    icon: 'log-out',
    description: 'You withdrew this application',
  },
};

/**
 * Default form data
 */
export const DEFAULT_APPLICATION_FORM: ApplicationFormData = {
  cover_note: '',
  bid_amount: '',
  bid_type: '',
  estimated_duration: '',
  available_start_date: '',
  use_custom_bid: false,
};

/**
 * Status flow - what statuses can transition to what
 */
export const STATUS_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  // ★ Client may now jump straight to CLIENT_SELECTED from pending or shortlisted.
  pending: ['shortlisted', 'CLIENT_SELECTED', 'offered', 'rejected', 'withdrawn'],
  shortlisted: ['CLIENT_SELECTED', 'offered', 'pending', 'rejected', 'withdrawn'],
  // Legacy 'offered' kept so old rows still validate; treat the same as CLIENT_SELECTED.
  offered: ['hired', 'rejected', 'withdrawn'],
  // ★ Admin owns the promotion to 'hired'.
  CLIENT_SELECTED: ['hired', 'rejected', 'shortlisted', 'withdrawn'],
  hired: [],     // Terminal
  rejected: [],  // Terminal
  withdrawn: [], // Terminal
  accepted: [],  // Legacy terminal
};

/**
 * Check if a status transition is valid
 */
export const canTransitionTo = (
  currentStatus: ApplicationStatus,
  newStatus: ApplicationStatus
): boolean => {
  return STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
};

/**
 * Check if a status is terminal (no further transitions possible)
 */
export const isTerminalStatus = (status: ApplicationStatus): boolean => {
  return STATUS_TRANSITIONS[status]?.length === 0;
};

/**
 * Get action label for status transition
 */
export const getTransitionActionLabel = (
  status: ApplicationStatus
): string => {
  switch (status) {
    case 'reviewing':
      return 'Mark as Reviewing';
    case 'shortlisted':
      return 'Add to Shortlist';
    case 'offered':
      return 'Send Offer';
    case 'rejected':
      return 'Reject';
    case 'hired':
      return 'Hire';
    case 'withdrawn':
      return 'Withdraw';
    default:
      return status;
  }
};

/**
 * Format bid display
 */
export const formatBid = (
  amount: number | null,
  type: BidType | null,
  currency: string = 'USD'
): string => {
  if (amount === null) return 'Negotiable';
  
  const symbol = currency === 'CAD' ? 'CA$' : 
                 currency === 'EUR' ? '€' : 
                 currency === 'GBP' ? '£' : '$';
  
  const formattedAmount = `${symbol}${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  
  switch (type) {
    case 'hourly':
      return `${formattedAmount}/hr`;
    case 'daily':
      return `${formattedAmount}/day`;
    case 'fixed':
      return `${formattedAmount} fixed`;
    default:
      return formattedAmount;
  }
};

/**
 * Format relative time for application
 */
export const formatApplicationTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
};

/**
 * Pseudonymous applicant label for CLIENT-facing surfaces.
 *
 * ANTI-POACHING / identity escrow: clients must never see an inspector's real
 * name pre-reveal (pre-hire + active work). This canonical helper returns the
 * NX- handle derived from the opaque id so no client caller can leak by
 * default. The real name is surfaced only on post-completion surfaces (rating,
 * final report review), which resolve it through their own gated queries.
 */
export const getApplicantName = (applicant: ApplicantProfile): string => {
  return nxHandle(applicant.id);
};

/**
 * Identity-free glyph for the pseudonymous avatar sigil.
 */
export const getApplicantInitials = (_applicant: ApplicantProfile): string => {
  return 'NX';
};

/**
 * Sort applications by relevance
 */
export const sortApplications = (
  applications: ApplicationWithProfile[],
  sortBy: 'newest' | 'oldest' | 'bid_low' | 'bid_high' | 'experience'
): ApplicationWithProfile[] => {
  const sorted = [...applications];
  
  switch (sortBy) {
    case 'newest':
      return sorted.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    case 'oldest':
      return sorted.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    case 'bid_low':
      return sorted.sort((a, b) => {
        if (a.bid_amount_cents === null) return 1;
        if (b.bid_amount_cents === null) return -1;
        return a.bid_amount_cents - b.bid_amount_cents;
      });
    case 'bid_high':
      return sorted.sort((a, b) => {
        if (a.bid_amount_cents === null) return 1;
        if (b.bid_amount_cents === null) return -1;
        return b.bid_amount_cents - a.bid_amount_cents;
      });
    case 'experience':
      return sorted.sort((a, b) => {
        const expA = a.applicant.years_experience || 0;
        const expB = b.applicant.years_experience || 0;
        return expB - expA;
      });
    default:
      return sorted;
  }
};

/**
 * Filter applications by status
 */
export const filterApplicationsByStatus = (
  applications: Application[],
  statuses: ApplicationStatus[]
): Application[] => {
  if (statuses.length === 0) return applications;
  return applications.filter(app => statuses.includes(app.status));
};

/**
 * Check if application can be edited
 */
export const canEditApplication = (status: ApplicationStatus): boolean => {
  return status === 'pending' || status === 'reviewing';
};

/**
 * Check if application can be withdrawn
 */
export const canWithdrawApplication = (status: ApplicationStatus): boolean => {
  return ['pending', 'reviewing', 'shortlisted'].includes(status);
};

/**
 * Check if offer can be accepted
 */
export const canAcceptOffer = (status: ApplicationStatus): boolean => {
  return status === 'offered';
};

