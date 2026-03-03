// src/hooks/useLegalConsent.ts

import { useState, useCallback, useRef } from 'react';
import { useForm, UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { 
  ConsentFormData, 
  ConsentMetadata, 
  SignatureData, 
  LegalConsentResult,
  ConsentStatus 
} from '../types/consent.types';
import { getIPAddress, generateTimestamp, getDeviceInfo } from '../utils/ipService';

// Validation Schema
const consentSchema = z.object({
  ndaAccepted: z.boolean().refine(val => val === true, {
    message: 'You must accept the NDA to continue',
  }),
  dataProcessingAccepted: z.boolean().refine(val => val === true, {
    message: 'You must consent to data processing',
  }),
  confidentialityAccepted: z.boolean().refine(val => val === true, {
    message: 'You must acknowledge confidentiality obligations',
  }),
  liabilityAccepted: z.boolean().refine(val => val === true, {
    message: 'You must accept liability terms',
  }),
});

// Supabase Client Setup
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface UseLegalConsentOptions {
  userId: string;
  documentId: string;
  policyVersion?: string;
  onSuccess?: (result: LegalConsentResult) => void;
  onError?: (error: Error) => void;
}

interface UseLegalConsentReturn {
  form: UseFormReturn<ConsentFormData>;
  status: ConsentStatus;
  hasScrolledToBottom: boolean;
  signatureData: SignatureData | null;
  metadata: ConsentMetadata | null;
  error: string | null;
  isSubmitting: boolean;
  isFormValid: boolean;
  canSubmit: boolean;
  setHasScrolledToBottom: (value: boolean) => void;
  setSignatureData: (data: SignatureData | null) => void;
  clearSignature: () => void;
  submitConsent: () => Promise<LegalConsentResult | null>;
  resetForm: () => void;
  fetchMetadata: () => Promise<void>;
}

export const useLegalConsent = ({
  userId,
  documentId,
  policyVersion = '2.1.0',
  onSuccess,
  onError,
}: UseLegalConsentOptions): UseLegalConsentReturn => {
  const [status, setStatus] = useState<ConsentStatus>('idle');
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [signatureData, setSignatureData] = useState<SignatureData | null>(null);
  const [metadata, setMetadata] = useState<ConsentMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submissionInProgress = useRef(false);

  const form = useForm<ConsentFormData>({
    resolver: zodResolver(consentSchema),
    mode: 'onChange',
    defaultValues: {
      ndaAccepted: false,
      dataProcessingAccepted: false,
      confidentialityAccepted: false,
      liabilityAccepted: false,
    },
  });

  const { formState: { isValid: isFormValid } } = form;

  // Check if form can be submitted
  const canSubmit = 
    hasScrolledToBottom && 
    isFormValid && 
    signatureData !== null && 
    !signatureData.isEmpty &&
    status !== 'submitting';

  // Fetch IP and device metadata
  const fetchMetadata = useCallback(async () => {
    try {
      const [ipInfo, deviceInfo] = await Promise.all([
        getIPAddress(),
        getDeviceInfo(),
      ]);

      setMetadata({
        ipAddress: ipInfo.ip,
        timestamp: generateTimestamp(),
        userAgent: deviceInfo,
        geoLocation: {
          country: ipInfo.country,
          region: ipInfo.region,
          city: ipInfo.city,
        },
      });
    } catch (err) {
      console.error('Failed to fetch metadata:', err);
      // Set fallback metadata
      setMetadata({
        ipAddress: 'Unable to retrieve',
        timestamp: generateTimestamp(),
      });
    }
  }, []);

  // Clear signature
  const clearSignature = useCallback(() => {
    setSignatureData(null);
    setStatus('scrolling');
  }, []);

  // Submit consent to Supabase
  const submitConsent = useCallback(async (): Promise<LegalConsentResult | null> => {
    if (submissionInProgress.current) return null;
    if (!canSubmit) {
      setError('Please complete all required fields');
      return null;
    }

    submissionInProgress.current = true;
    setStatus('submitting');
    setError(null);

    try {
      // Ensure we have fresh metadata
      const currentMetadata = metadata || {
        ipAddress: 'Unable to retrieve',
        timestamp: generateTimestamp(),
      };

      // Update timestamp to submission time
      const submissionMetadata: ConsentMetadata = {
        ...currentMetadata,
        timestamp: generateTimestamp(),
      };

      const consentResult: LegalConsentResult = {
        userId,
        documentId,
        signature: signatureData!,
        consents: form.getValues(),
        metadata: submissionMetadata,
        createdAt: new Date().toISOString(),
        version: policyVersion,
        status: 'completed',
      };

      // Insert into Supabase
      const { data, error: supabaseError } = await supabase
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

      if (supabaseError) {
        throw new Error(supabaseError.message);
      }

      const finalResult: LegalConsentResult = {
        ...consentResult,
        id: data?.id,
      };

      setStatus('success');
      onSuccess?.(finalResult);
      return finalResult;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit consent';
      setError(errorMessage);
      setStatus('error');
      onError?.(err instanceof Error ? err : new Error(errorMessage));
      return null;
    } finally {
      submissionInProgress.current = false;
    }
  }, [canSubmit, metadata, signatureData, form, userId, documentId, policyVersion, onSuccess, onError]);

  // Reset form to initial state
  const resetForm = useCallback(() => {
    form.reset();
    setStatus('idle');
    setHasScrolledToBottom(false);
    setSignatureData(null);
    setMetadata(null);
    setError(null);
    submissionInProgress.current = false;
  }, [form]);

  return {
    form,
    status,
    hasScrolledToBottom,
    signatureData,
    metadata,
    error,
    isSubmitting: status === 'submitting',
    isFormValid,
    canSubmit,
    setHasScrolledToBottom,
    setSignatureData,
    clearSignature,
    submitConsent,
    resetForm,
    fetchMetadata,
  };
};

// Export Supabase table creation SQL for reference
export const SUPABASE_TABLE_SQL = `
-- Create legal_consents table
CREATE TABLE IF NOT EXISTS legal_consents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  signature_base64 TEXT NOT NULL,
  signature_stroke_count INTEGER DEFAULT 0,
  nda_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  data_processing_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  confidentiality_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  liability_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address TEXT,
  user_agent TEXT,
  geo_country TEXT,
  geo_region TEXT,
  geo_city TEXT,
  policy_version TEXT NOT NULL,
  consent_status TEXT NOT NULL DEFAULT 'completed',
  signed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_legal_consents_user_id ON legal_consents(user_id);
CREATE INDEX idx_legal_consents_document_id ON legal_consents(document_id);
CREATE INDEX idx_legal_consents_signed_at ON legal_consents(signed_at);

-- Enable RLS
ALTER TABLE legal_consents ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users
CREATE POLICY "Users can view their own consents" ON legal_consents
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own consents" ON legal_consents
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
`;