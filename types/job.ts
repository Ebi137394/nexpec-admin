// types/job.ts

/**
 * Job status types
 */
export type JobStatus = 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Job urgency levels
 */
export type JobUrgency = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Job type (location-based)
 */
export type JobType = 'onsite' | 'remote' | 'hybrid';

/**
 * Budget type
 */
export type BudgetType = 'hourly' | 'daily' | 'fixed' | 'negotiable';

/**
 * Job record from the database
 */
export interface Job {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  location_address: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string;
  location_lat: number | null;
  location_lng: number | null;
  job_type: JobType;
  inspection_type: string[] | null;
  start_date: string | null;
  end_date: string | null;
  duration_hours: number | null;
  budget_type: BudgetType;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  required_certifications: string[] | null;
  experience_years_min: number;
  status: JobStatus;
  urgency: JobUrgency;
  applications_count: number;
  views_count: number;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  // Joined fields
  client?: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    company_name: string | null;
    professional_title: string | null;
  };
}

/**
 * Job with client info
 */
export interface JobWithClient extends Job {
  client: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    company_name: string | null;
    professional_title: string | null;
  };
}

/**
 * Job filter options
 */
export interface JobFilters {
  search: string;
  jobType: JobType | 'all';
  urgency: JobUrgency | 'all';
  budgetType: BudgetType | 'all';
  location: string;
  sortBy: 'newest' | 'oldest' | 'budget_high' | 'budget_low' | 'urgency';
}

/**
 * Default filter values
 */
export const DEFAULT_JOB_FILTERS: JobFilters = {
  search: '',
  jobType: 'all',
  urgency: 'all',
  budgetType: 'all',
  location: '',
  sortBy: 'newest',
};

/**
 * Job type display config
 */
export const JOB_TYPE_CONFIG: Record<JobType, { label: string; color: string }> = {
  onsite: { label: 'On-site', color: '#3B82F6' },
  remote: { label: 'Remote', color: '#22C55E' },
  hybrid: { label: 'Hybrid', color: '#A855F7' },
};

/**
 * Urgency display config
 */
export const URGENCY_CONFIG: Record<JobUrgency, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Low', color: '#64748B', bgColor: '#64748B20' },
  normal: { label: 'Normal', color: '#3B82F6', bgColor: '#3B82F620' },
  high: { label: 'High', color: '#F59E0B', bgColor: '#F59E0B20' },
  urgent: { label: 'Urgent', color: '#EF4444', bgColor: '#EF444420' },
};

/**
 * Format budget display
 */
export const formatBudget = (job: Job): string => {
  if (job.budget_type === 'negotiable') return 'Negotiable';
  
  const symbol = job.currency === 'CAD' ? 'CA$' : job.currency === 'EUR' ? '€' : job.currency === 'GBP' ? '£' : '$';
  
  if (job.budget_min && job.budget_max) {
    if (job.budget_min === job.budget_max) {
      return `${symbol}${job.budget_min.toLocaleString()}`;
    }
    return `${symbol}${job.budget_min.toLocaleString()} - ${symbol}${job.budget_max.toLocaleString()}`;
  }
  
  if (job.budget_min) return `From ${symbol}${job.budget_min.toLocaleString()}`;
  if (job.budget_max) return `Up to ${symbol}${job.budget_max.toLocaleString()}`;
  
  return 'Negotiable';
};

/**
 * Format budget type label
 */
export const formatBudgetType = (type: BudgetType): string => {
  switch (type) {
    case 'hourly': return '/hr';
    case 'daily': return '/day';
    case 'fixed': return ' fixed';
    default: return '';
  }
};

/**
 * Format location display
 */
export const formatLocation = (job: Job): string => {
  const parts: string[] = [];
  if (job.location_city) parts.push(job.location_city);
  if (job.location_state) parts.push(job.location_state);
  if (parts.length === 0 && job.location_country) {
    return job.location_country;
  }
  return parts.join(', ') || 'Remote';
};

/**
 * Format relative time
 */
export const formatTimeAgo = (dateString: string): string => {
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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * Form data for creating a new job
 */
export interface JobFormData {
  // Step 1: Job Details
  title: string;
  description: string;
  job_type: JobType;
  urgency: JobUrgency;
  inspection_type: string[];
  
  // Step 2: Location & Schedule
  location_city: string;
  location_state: string;
  location_country: string;
  start_date: string;
  end_date: string;
  duration_hours: string;
  
  // Step 3: Budget & Requirements
  budget_type: BudgetType;
  budget_min: string;
  budget_max: string;
  currency: string;
  required_certifications: string[];
  experience_years_min: string;
}

/**
 * Payload for inserting a new job
 */
export interface JobInsertPayload {
  client_id: string;
  title: string;
  description: string | null;
  job_type: JobType;
  urgency: JobUrgency;
  inspection_type: string[] | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string;
  start_date: string | null;
  end_date: string | null;
  duration_hours: number | null;
  budget_type: BudgetType;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  required_certifications: string[] | null;
  experience_years_min: number;
  status: JobStatus;
}

/**
 * Default form values
 */
export const DEFAULT_JOB_FORM: JobFormData = {
  title: '',
  description: '',
  job_type: 'onsite',
  urgency: 'normal',
  inspection_type: [],
  location_city: '',
  location_state: '',
  location_country: 'US',
  start_date: '',
  end_date: '',
  duration_hours: '',
  budget_type: 'negotiable',
  budget_min: '',
  budget_max: '',
  currency: 'USD',
  required_certifications: [],
  experience_years_min: '0',
};

/**
 * Common inspection types
 */
export const INSPECTION_TYPES: string[] = [
  'NDT - Magnetic Particle',
  'NDT - Ultrasonic',
  'NDT - Radiographic',
  'NDT - Liquid Penetrant',
  'NDT - Visual',
  'Welding Inspection',
  'Pipeline Inspection',
  'Structural Inspection',
  'Pressure Vessel',
  'Tank Inspection',
  'Coating Inspection',
  'Corrosion Assessment',
  'Electrical Systems',
  'HVAC Systems',
  'Fire Safety',
  'Environmental',
  'Quality Assurance',
  'Pre-Shutdown',
  'Turnaround Support',
];

/**
 * Common certifications for requirements
 */
export const CERTIFICATION_OPTIONS: string[] = [
  'CGSB MT Level 2',
  'CGSB UT Level 2',
  'CGSB RT Level 2',
  'CGSB PT Level 2',
  'AWS CWI',
  'API 510',
  'API 570',
  'API 653',
  'NACE CIP Level 2',
  'ASNT NDT Level II',
  'CWB W47.1',
];

/**
 * Comprehensive list of countries
 */
export const COUNTRIES = [
  // --- North America ---
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },

  // --- Europe ---
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', flag: '🇫🇮' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
  { code: 'AT', name: 'Austria', flag: '🇦🇹' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'GR', name: 'Greece', flag: '🇬🇷' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷' },

  // --- Middle East & GCC ---
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait', flag: '🇰🇼' },
  { code: 'OM', name: 'Oman', flag: '🇴🇲' },
  { code: 'BH', name: 'Bahrain', flag: '🇧🇭' },
  { code: 'IQ', name: 'Iraq', flag: '🇮🇶' },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬' },

  // --- Asia Pacific ---
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭' },

  // --- South America ---
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'PE', name: 'Peru', flag: '🇵🇪' },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },

  // --- Africa ---
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'DZ', name: 'Algeria', flag: '🇩🇿' },
  { code: 'MA', name: 'Morocco', flag: '🇲🇦' },
  { code: 'AO', name: 'Angola', flag: '🇦🇴' },
];

