// src/services/consentService.ts

import { createClient } from '@supabase/supabase-js';
import { 
  LegalConsentResult, 
  ConsentFormData, 
  SignatureData, 
  ConsentMetadata 
} from '../types/consent.types';
import { getIPAddress, generateTimestamp, getDeviceInfo } from '../utils/ipService';

// Supabase client setup
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface ConsentCheckResult {
  hasConsent: boolean;
  latestConsent?: LegalConsentResult;
  needsNewConsent: boolean;
}

export class ConsentService {
  private static instance: ConsentService;
  private metadata: ConsentMetadata | null = null;

  private constructor() {}

  public static getInstance(): ConsentService {
    if (!ConsentService.instance) {
      ConsentService.instance = new ConsentService();
    }
    return ConsentService.instance;
  }

  /**
   * Fetches and caches user metadata (IP, device info, etc.)
   */
  public async fetchMetadata(): Promise<ConsentMetadata> {
    if (this.metadata) {
      return this.metadata;
    }

    try {
      const [ipInfo, deviceInfo] = await Promise.all([
        getIPAddress(),
        getDeviceInfo(),
      ]);

      this.metadata = {
        ipAddress: ipInfo.ip,
        timestamp: generateTimestamp(),
        userAgent: deviceInfo,
        geoLocation: {
          country: ipInfo.country,
          region: ipInfo.region,
          city: ipInfo.city,
        },
      };

      return this.metadata;
    } catch (error) {
      console.error('Failed to fetch metadata:', error);
      // Return fallback metadata
      this.metadata = {
        ipAddress: 'Unable to retrieve',
        timestamp: generateTimestamp(),
      };
      return this.metadata;
    }
  }

  /**
   * Checks if user has valid consent for a specific document
   */
  public async checkConsent(
    userId: string, 
    documentId: string, 
    policyVersion: string = '2.1.0'
  ): Promise<ConsentCheckResult> {
    try {
      const { data, error } = await supabase
        .from('legal_consents')
        .select('*')
        .eq('user_id', userId)
        .eq('document_id', documentId)
        .eq('policy_version', policyVersion)
        .eq('consent_status', 'completed')
        .eq('nda_accepted', true)
        .eq('data_processing_accepted', true)
        .eq('confidentiality_accepted', true)
        .eq('liability_accepted', true)
        .order('signed_at', { ascending: false })
        .limit(1);

      if (error) {
        throw error;
      }

      const hasConsent = data && data.length > 0;
      const latestConsent = data && data.length > 0 ? this.mapToConsentResult(data[0]) : undefined;
      
      // Check if consent is older than 1 year (365 days)
      const needsNewConsent = latestConsent ? this.isConsentExpired(latestConsent) : false;

      return {
        hasConsent,
        latestConsent,
        needsNewConsent,
      };
    } catch (error) {
      console.error('Error checking consent:', error);
      return {
        hasConsent: false,
        needsNewConsent: true,
      };
    }
  }

  /**
   * Saves consent to the database
   */
  public async saveConsent(
    userId: string,
    documentId: string,
    signature: SignatureData,
    consents: ConsentFormData,
    policyVersion: string = '2.1.0'
  ): Promise<LegalConsentResult> {
    // Ensure we have fresh metadata
    const metadata = await this.fetchMetadata();
    
    // Update timestamp to submission time
    const submissionMetadata: ConsentMetadata = {
      ...metadata,
      timestamp: generateTimestamp(),
    };

    const consentResult: LegalConsentResult = {
      userId,
      documentId,
      signature,
      consents,
      metadata: submissionMetadata,
      createdAt: new Date().toISOString(),
      version: policyVersion,
      status: 'completed',
    };

    try {
      const { data, error } = await supabase
        .from('legal_consents')
        .insert({
          user_id: consentResult.userId,
          document_id: consentResult.documentId,
          signature_base64: consentResult.signature.base64,
          signature_stroke_count: consentResult.signature.strokeCount,
          nda_accepted: consentResult.consents.ndaAccepted,
          data_processing_accepted: consentResult.consents.dataProcessingAccepted,
          confidentiality_accepted: consentResult.consents.confidentialityAccepted,
          liability_accepted: consentResult.consents.liabilityAccepted,
          ip_address: consentResult.metadata.ipAddress,
          user_agent: consentResult.metadata.userAgent,
          geo_country: consentResult.metadata.geoLocation?.country,
          geo_region: consentResult.metadata.geoLocation?.region,
          geo_city: consentResult.metadata.geoLocation?.city,
          policy_version: consentResult.version,
          consent_status: consentResult.status,
          signed_at: consentResult.metadata.timestamp,
        })
        .select('id')
        .single();

      if (error) {
        throw error;
      }

      const finalResult: LegalConsentResult = {
        ...consentResult,
        id: data?.id,
      };

      return finalResult;
    } catch (error) {
      console.error('Error saving consent:', error);
      throw error;
    }
  }

  /**
   * Gets user's consent history
   */
  public async getConsentHistory(userId: string): Promise<LegalConsentResult[]> {
    try {
      const { data, error } = await supabase
        .from('legal_consents')
        .select('*')
        .eq('user_id', userId)
        .order('signed_at', { ascending: false });

      if (error) {
        throw error;
      }

      return data ? data.map(this.mapToConsentResult) : [];
    } catch (error) {
      console.error('Error fetching consent history:', error);
      return [];
    }
  }

  /**
   * Revokes a specific consent
   */
  public async revokeConsent(consentId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('legal_consents')
        .update({ consent_status: 'revoked' })
        .eq('id', consentId);

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Error revoking consent:', error);
      return false;
    }
  }

  /**
   * Checks if consent is expired (older than 1 year)
   */
  private isConsentExpired(consent: LegalConsentResult): boolean {
    const consentDate = new Date(consent.metadata.timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - consentDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays > 365;
  }

  /**
   * Maps database record to LegalConsentResult
   */
  private mapToConsentResult(record: any): LegalConsentResult {
    return {
      id: record.id,
      userId: record.user_id,
      documentId: record.document_id,
      signature: {
        base64: record.signature_base64,
        isEmpty: false, // We assume stored signatures are not empty
        strokeCount: record.signature_stroke_count || 0,
      },
      consents: {
        ndaAccepted: record.nda_accepted,
        dataProcessingAccepted: record.data_processing_accepted,
        confidentialityAccepted: record.confidentiality_accepted,
        liabilityAccepted: record.liability_accepted,
      },
      metadata: {
        ipAddress: record.ip_address,
        timestamp: record.signed_at,
        userAgent: record.user_agent,
        geoLocation: {
          country: record.geo_country,
          region: record.geo_region,
          city: record.geo_city,
        },
      },
      createdAt: record.created_at,
      version: record.policy_version,
      status: record.consent_status,
    };
  }

  /**
   * Clears cached metadata
   */
  public clearMetadata(): void {
    this.metadata = null;
  }
}

// Export singleton instance
export const consentService = ConsentService.getInstance();