// ============================================
// NEXPEC CORE TYPES
// Synced with Ultimate Database Schema
// ============================================

// ============================================================================
// ENUMS & LITERAL TYPES
// ============================================================================

/**
 * UserRole - Defines the type of user in the system
 * @type 'client' - Users who request and manage inspections
 * @type 'inspector' - Users who conduct safety inspections
 * @type 'agency' - Enterprise/Agency users who manage inspection teams
 * @type 'admin' - System administrators (optional)
 * @type 'supplier' - Marketplace vendors who bid on RFQs (goods, labs, equipment)
 */
export type UserRole = 'client' | 'inspector' | 'agency' | 'admin' | 'supplier';

/**
 * @deprecated Use UserRole instead
 * Kept for backward compatibility
 */
export type UserType = 'client' | 'inspector';

export type JobStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

export type JobCategory = 
  | 'welding' 
  | 'coating' 
  | 'civil' 
  | 'electrical'      // ✅ E&I
  | 'instrumentation' // ✅ E&I
  | 'mechanical';

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export type MessageType = 'text' | 'image' | 'file' | 'system';

export type WithdrawalStatus = 
  | 'pending' 
  | 'processing' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

export type PayoutMethod = 'bank_transfer' | 'e_transfer' | 'paypal' | 'stripe';

export type TransactionType = 
  | 'deposit' 
  | 'withdrawal' 
  | 'escrow_freeze' 
  | 'escrow_release' 
  | 'payment_received' 
  | 'payment_sent' 
  | 'refund' 
  | 'fee';

export type NDTMethod = 
  | 'UT' | 'RT' | 'MT' | 'PT' | 'VT' | 'ET' | 'AE' | 'LT';

export type CertificationType = 'CWB' | 'ASNT' | 'API' | 'NACE' | 'AWS' | 'CSWIP';

export type JobType = 'onsite' | 'remote' | 'hybrid';

export type EscrowStatus = 'none' | 'frozen' | 'released' | 'refunded';

// ============================================================================
// MAIN INTERFACES
// ============================================================================

/**
 * User Profile Interface
 * Simplified profile interface for authentication and basic user data
 */
export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  full_name?: string;
  avatar_url?: string;
  terms_accepted: boolean;
  created_at?: string;
}

/**
 * Auth State Interface
 * Represents the current authentication state of the application
 */
export interface AuthState {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

/**
 * Profile Interface (Extended)
 * Core fields matching Supabase database schema
 * Extended version with additional fields for full profile data
 */
export interface Profile {
  id: string;
  email: string;
  full_name?: string;
  role: UserRole; // Critical for auth flow - must match DB column
  avatar_url?: string;
  created_at: string;
  
  // Additional optional fields (for backward compatibility and extended profiles)
  professional_title?: string | null;
  phone?: string | null;
  user_type?: UserType | null; // @deprecated - use role instead
  company_name?: string | null;
  bio?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string;
  is_verified?: boolean;
  is_available?: boolean;
  hourly_rate_cents?: number | null;      // ★ Task 4
  years_experience?: number;
  
  // فیلدهای محاسباتی از دیتابیس
  rating_average?: number;
  rating_count?: number;
  rating_breakdown?: Record<string, number>;
  would_recommend_percent?: number;
  
  completed_jobs_count?: number;
  last_active_at?: string;
  updated_at?: string;
}

/**
 * Inspector Certification Interface
 */
export interface InspectorCertification {
  id: string;
  inspector_id: string;
  certification_type: CertificationType;
  certification_number: string;
  level: string | null;
  methods: NDTMethod[];
  issued_date: string;
  expiry_date: string;
  document_url: string | null;
  is_verified: boolean;
  created_at: string;
}

/**
 * Job Interface - Matches the jobs table schema exactly
 * Must use client_id (instead of user_id)
 * Must have budget_min and budget_max (instead of a single budget)
 */
export interface Job {
  id: string;
  created_at: string;
  title: string;
  description: string;
  location: string;
  
  // Financial & Type - Must match DB columns
  budget_min?: number;
  budget_max?: number;
  job_type: 'onsite' | 'remote' | 'hybrid';
  
  category: JobCategory; // Must include 'electrical' and 'instrumentation'
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  
  // Relationships - Must match DB columns
  client_id: string; // Must match DB column (not user_id)
  hired_inspector_id?: string;
  
  scheduled_date?: string;
  
  // Managed Payout System — ★ Task 4: integer cents (bigint)
  contractor_payout_amount_cents?: number;
  payout_amount_cents?: number;
  
  // Additional optional fields (for backward compatibility)
  updated_at?: string;
  property_type?: string;
  inspection_type?: string;
  requirements?: string[];
  attachments?: string[];

  // Optional joins (not in DB schema, added for convenience)
  client?: {
    full_name: string;
    avatar_url?: string;
    company_name?: string;
  };
}

/**
 * Job Application Interface - Matches job_applications table exactly
 */
export interface JobApplication {
  id: string;
  job_id: string;
  inspector_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  proposed_price_cents: number;        // ★ Task 4b
  cover_letter?: string;
  created_at: string;
  
  // Additional optional fields (for backward compatibility)
  updated_at?: string;

  // Optional joins (not in DB schema, added for convenience)
  job?: Job;
  inspector?: {
    full_name: string;
    avatar_url?: string;
    rating_average: number;
  };
}

/**
 * Bank Details Interface
 * Matches the JSONB structure expected by 'request_withdrawal' RPC
 */
export interface BankDetails {
  bank_name: string;
  account_number: string;
  transit_number: string;
  institution_number?: string;
  account_holder_name: string;
  email?: string; // For e-transfers
}

/**
 * Wallet Interface
 * Matches 'wallets' table exactly
 */
export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  frozen_balance: number; // Funds locked in escrow
  pending_withdrawal: number; // Funds currently being processed
  total_earned: number;
  total_spent: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

/**
 * Transaction Interface
 * Matches 'transactions' table
 */
export interface Transaction {
  id: string;
  wallet_id: string;
  job_id?: string;
  type: TransactionType;
  amount: number;
  fee_amount: number;
  balance_before: number;
  balance_after: number;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  description: string | null;
  metadata?: Record<string, any>;
  created_at: string;
}

/**
 * Withdrawal Request Interface
 * Matches 'withdrawals' table
 */
export interface WithdrawalRequest {
  id: string;
  user_id: string;
  amount: number;
  fee_amount: number;
  net_amount: number;
  status: WithdrawalStatus;
  bank_details: BankDetails;
  created_at: string;
}

/**
 * Legacy Withdrawal Interface (for backward compatibility)
 * @deprecated Use WithdrawalRequest instead
 */
export interface Withdrawal extends WithdrawalRequest {
  wallet_id?: string;
  payout_method?: PayoutMethod;
  requested_at?: string;
  processed_at?: string | null;
  cancelled_at?: string | null;
}

/**
 * Message Interface
 */
export interface Message {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

/**
 * Conversation Interface
 */
export interface Conversation {
  id: string;
  job_id: string;
  client_id: string;
  inspector_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Review Interface
 * اصلاح شده برای هماهنگی با صفحه Rate و سیستم Would Recommend
 */
export interface Review {
  id: string;
  job_id: string;
  inspector_id: string;
  client_id: string;
  rating: number;
  comment: string | null;
  would_recommend: boolean;
  tags: string[];
  is_public: boolean;
  created_at: string;
}

/**
 * Dashboard Stats Interface
 * ✅ CORRECTION: Matches the 'get_inspector_dashboard_stats' RPC function exactly
 */
export interface DashboardStats {
  active_jobs: number;
  completed_jobs: number;
  pending_offers: number;
  total_reviews: number;
  average_rating: number;
  total_earned: number;
  available_balance: number;
}

/**
 * Inspector Dashboard Stats Interface (alias for backward compatibility)
 */
export type InspectorDashboardStats = DashboardStats;

// ============================================================================
// UI HELPER TYPES
// ============================================================================

/**
 * Gifted Chat Message Interface
 * تایپ‌های کمکی برای رابط کاربری
 */
export interface GiftedChatMessage {
  _id: string | number;
  text: string;
  createdAt: Date | number;
  user: {
    _id: string | number;
    name?: string;
    avatar?: string;
  };
  image?: string;
  system?: boolean;
  sent?: boolean;
  received?: boolean;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Partial update type for Profile
 */
export type ProfileUpdate = Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;

/**
 * Partial update type for Job
 */
export type JobUpdate = Partial<Omit<Job, 'id' | 'created_at' | 'updated_at'>>;

/**
 * Partial update type for JobApplication
 */
export type JobApplicationUpdate = Partial<Omit<JobApplication, 'id' | 'created_at' | 'updated_at'>>;

/**
 * Job with related data
 */
export interface JobWithRelations extends Omit<Job, 'client' | 'hired_inspector'> {
  client?: {
    full_name?: string;
    avatar_url?: string;
    company_name?: string;
  };
  hired_inspector?: {
    full_name?: string;
    avatar_url?: string;
    rating_average?: number;
  };
  applications_count?: number;
  messages_count?: number;
}

/**
 * Application with related data
 */
export interface JobApplicationWithRelations extends Omit<JobApplication, 'job' | 'inspector'> {
  job?: Job;
  inspector?: {
    full_name?: string;
    avatar_url?: string;
    rating_average?: number;
  };
}

/**
 * Message with sender info
 */
export interface MessageWithSender extends Message {
  sender?: Profile;
}

/**
 * Conversation with participants
 */
export interface ConversationWithParticipants extends Conversation {
  client?: Profile;
  inspector?: Profile;
  last_message?: Message;
  unread_count?: number;
}

/**
 * Review with related data
 */
export interface ReviewWithRelations extends Review {
  inspector?: Profile;
  client?: Profile;
  job?: Job;
}

// ============================================================================
// FORM & INPUT TYPES
// ============================================================================

/**
 * Job creation form data
 */
export interface JobFormData {
  title: string;
  description: string;
  job_type: JobType;
  ndt_methods: NDTMethod[];
  required_certifications: CertificationType[];
  location: string;
  location_coords?: { lat: number; lng: number } | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
}

/**
 * Application submission form data
 */
export interface ApplicationFormData {
  cover_letter: string | null;
  proposed_price_cents: number;        // ★ Task 4b
  availability_start: string | null;
}

/**
 * Review submission form data
 */
export interface ReviewFormData {
  rating: number;
  comment: string | null;
  would_recommend: boolean;
  tags: string[];
  is_public: boolean;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

// ============================================================================
// FILTER & SORT TYPES
// ============================================================================

/**
 * Job filter options
 */
export interface JobFilters {
  status?: JobStatus[];
  job_type?: JobType[];
  ndt_methods?: NDTMethod[];
  location?: string;
  budget_min?: number;
  budget_max?: number;
  search?: string;
}

/**
 * Application filter options
 */
export interface ApplicationFilters {
  status?: ApplicationStatus[];
  job_id?: string;
  inspector_id?: string;
}

/**
 * Sort options
 */
export type SortOrder = 'asc' | 'desc';

export interface SortOptions {
  field: string;
  order: SortOrder;
}

// ============================================================================
// EXPORT ALL
// ============================================================================
// All types are exported above

