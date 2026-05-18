import { supabase } from '@/src/core/supabase/supabase';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface VerifyContractorParams {
  contractorId: string;
  newStatus: VerificationStatus;
  rejectionReason?: string;
  notifyUser?: boolean;
}

export interface VerifyContractorResponse {
  success: boolean;
  data?: {
    contractor_id: string;
    previous_status: VerificationStatus;
    new_status: VerificationStatus;
    updated_by: string;
    updated_at: string;
    notification: {
      sent: boolean;
      error?: string;
    };
  };
  error?: string;
  code?: string;
}

export interface ContractorWithCertificates {
  id: string;
  full_name: string;
  email: string;
  verification_status: VerificationStatus;
  created_at: string;
  certificates: {
    id: string;
    certificate_name: string;
    expiry_date: string;
    is_verified: boolean;
  }[];
}

class AdminService {
  /**
   * Verify or reject a contractor
   */
  async verifyContractor(params: VerifyContractorParams): Promise<VerifyContractorResponse> {
    try {
      const { data: session } = await supabase.auth.getSession();
      
      if (!session?.session?.access_token) {
        return {
          success: false,
          error: 'Not authenticated',
          code: 'UNAUTHORIZED',
        };
      }

      const response = await supabase.functions.invoke('verify-contractor', {
        body: {
          contractor_id: params.contractorId,
          new_status: params.newStatus,
          rejection_reason: params.rejectionReason,
          notify_user: params.notifyUser ?? true,
        },
      });

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
          code: 'FUNCTION_ERROR',
        };
      }

      return response.data as VerifyContractorResponse;
    } catch (error) {
      console.error('Error verifying contractor:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'UNKNOWN_ERROR',
      };
    }
  }

  /**
   * Get all pending verification requests
   */
  async getPendingVerifications(): Promise<ContractorWithCertificates[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        email,
        verification_status,
        created_at,
        contractor_certifications (
          id,
          certificate_name,
          expiry_date,
          is_verified
        )
      `)
      .eq('verification_status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching pending verifications:', error);
      return [];
    }

    return data.map((profile) => ({
      ...profile,
      certificates: profile.contractor_certifications || [],
    })) as ContractorWithCertificates[];
  }

  /**
   * Get verification audit log for a contractor
   */
  async getVerificationHistory(contractorId: string) {
    const { data, error } = await supabase
      .from('verification_audit_log')
      .select(`
        id,
        previous_status,
        new_status,
        reason,
        created_at,
        admin:profiles!verification_audit_log_admin_id_fkey (
          full_name
        )
      `)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching verification history:', error);
      return [];
    }

    return data;
  }

  /**
   * Verify a certificate
   */
  async verifyCertificate(certificateId: string, isVerified: boolean) {
    const { error } = await supabase
      .from('contractor_certifications')
      .update({ is_verified: isVerified })
      .eq('id', certificateId);

    if (error) {
      throw new Error(`Failed to verify certificate: ${error.message}`);
    }
  }
}

export const adminService = new AdminService();