// src/types/consent.types.ts

export interface ConsentFormData {
  ndaAccepted: boolean;
  dataProcessingAccepted: boolean;
  confidentialityAccepted: boolean;
  liabilityAccepted: boolean;
}

export interface ConsentMetadata {
  ipAddress: string;
  timestamp: string;
  userAgent?: string;
  deviceId?: string;
  geoLocation?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

export interface SignatureData {
  base64: string;
  isEmpty: boolean;
  strokeCount: number;
}

export interface LegalConsentResult {
  id?: string;
  userId: string;
  documentId: string;
  signature: SignatureData;
  consents: ConsentFormData;
  metadata: ConsentMetadata;
  createdAt: string;
  version: string;
  status: 'pending' | 'completed' | 'expired' | 'revoked';
}

export interface ConsentGatewayProps {
  visible: boolean;
  onClose: () => void;
  onConsentComplete: (result: LegalConsentResult) => void;
  userId: string;
  documentId: string;
  documentTitle?: string;
  policyVersion?: string;
  customPolicyText?: string;
  requireAllConsents?: boolean;
  expirationDays?: number;
}

export interface ConsentCheckboxItem {
  id: keyof ConsentFormData;
  label: string;
  description?: string;
  required: boolean;
}

export type ConsentStatus = 'idle' | 'scrolling' | 'signing' | 'submitting' | 'success' | 'error';