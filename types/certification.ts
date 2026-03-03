// types/certification.ts

/**
 * Certification status enum values
 */
export type CertificationStatus = 'pending' | 'verified' | 'rejected';

/**
 * Certification record from the database
 */
export interface Certification {
  id: string;
  user_id: string;
  name: string;
  issuing_organization: string;
  issue_date: string | null;
  expiry_date: string | null;
  credential_id: string | null;
  file_url: string | null;
  status: CertificationStatus;
  rejection_reason: string | null;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Form data for creating/editing a certification
 */
export interface CertificationFormData {
  name: string;
  issuing_organization: string;
  issue_date: string;
  expiry_date: string;
  credential_id: string;
}

/**
 * Payload for inserting a new certification
 */
export interface CertificationInsertPayload {
  user_id: string;
  name: string;
  issuing_organization: string;
  issue_date: string | null;
  expiry_date: string | null;
  credential_id: string | null;
  file_url: string | null;
  status: CertificationStatus;
}

/**
 * Payload for updating an existing certification
 */
export interface CertificationUpdatePayload {
  name?: string;
  issuing_organization?: string;
  issue_date?: string | null;
  expiry_date?: string | null;
  credential_id?: string | null;
  file_url?: string | null;
}

/**
 * Document file information
 */
export interface DocumentFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

/**
 * Status badge configuration
 */
export interface StatusBadgeConfig {
  label: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
}

/**
 * Certification statistics
 */
export interface CertificationStats {
  user_id: string;
  total_certifications: number;
  verified_count: number;
  pending_count: number;
  rejected_count: number;
  expired_count: number;
  expiring_soon_count: number;
}

/**
 * Common certification types for suggestions
 */
export const COMMON_CERTIFICATIONS: string[] = [
  'CGSB MT Level 1',
  'CGSB MT Level 2',
  'CGSB MT Level 3',
  'CGSB UT Level 1',
  'CGSB UT Level 2',
  'CGSB UT Level 3',
  'CGSB RT Level 1',
  'CGSB RT Level 2',
  'CGSB PT Level 1',
  'CGSB PT Level 2',
  'CGSB VT Level 1',
  'CGSB VT Level 2',
  'AWS CWI',
  'AWS SCWI',
  'API 510',
  'API 570',
  'API 653',
  'API 1169',
  'ASNT NDT Level II',
  'ASNT NDT Level III',
  'NACE CIP Level 1',
  'NACE CIP Level 2',
  'NACE CIP Level 3',
  'CWB W47.1',
  'CWB W59',
  'CSA W178.2',
  'CGSB Aerospace NDT',
];

/**
 * Common issuing organizations
 */
export const COMMON_ORGANIZATIONS: string[] = [
  'Canadian General Standards Board (CGSB)',
  'American Welding Society (AWS)',
  'American Petroleum Institute (API)',
  'American Society for Nondestructive Testing (ASNT)',
  'NACE International',
  'Canadian Welding Bureau (CWB)',
  'CSA Group',
  'Natural Resources Canada (NRCan)',
  'Technical Standards and Safety Authority (TSSA)',
  'Alberta Boilers Safety Association (ABSA)',
];

