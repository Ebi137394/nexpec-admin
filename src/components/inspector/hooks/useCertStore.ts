import { useState, useMemo, useCallback } from 'react';
import {
  Certificate,
  CertVerificationStatus,
  CertCategory,
} from '../types/inspectorTools.types';

// ─── Mock Certificates ───
const MOCK_CERTIFICATES: Certificate[] = [
  {
    id: 'cert_001',
    name: 'API 653',
    issuingBody: 'American Petroleum Institute',
    certNumber: 'API653-2023-45892',
    issueDate: '2023-03-15',
    expiryDate: '2026-03-15',
    status: 'verified_by_admin',
    category: 'inspection',
    adminVerifiedAt: '2023-04-01',
    adminNotes: 'Original certificate verified against API registry.',
  },
  {
    id: 'cert_002',
    name: 'API 570',
    issuingBody: 'American Petroleum Institute',
    certNumber: 'API570-2022-33104',
    issueDate: '2022-07-20',
    expiryDate: '2025-07-20',
    status: 'verified_by_admin',
    category: 'inspection',
    adminVerifiedAt: '2022-08-05',
  },
  {
    id: 'cert_003',
    name: 'NACE CIP Level 2',
    issuingBody: 'AMPP (formerly NACE)',
    certNumber: 'NACE-CIP2-2024-12847',
    issueDate: '2024-01-10',
    expiryDate: '2027-01-10',
    status: 'verified_by_admin',
    category: 'coating',
    adminVerifiedAt: '2024-02-15',
  },
  {
    id: 'cert_004',
    name: 'ASNT NDT Level II – UT',
    issuingBody: 'American Society for Nondestructive Testing',
    certNumber: 'ASNT-UT2-2024-88412',
    issueDate: '2024-05-01',
    expiryDate: '2029-05-01',
    status: 'pending_review',
    category: 'ndt',
  },
  {
    id: 'cert_005',
    name: 'ASNT NDT Level II – MT',
    issuingBody: 'American Society for Nondestructive Testing',
    certNumber: 'ASNT-MT2-2023-77301',
    issueDate: '2023-09-12',
    expiryDate: '2028-09-12',
    status: 'verified_by_admin',
    category: 'ndt',
    adminVerifiedAt: '2023-10-01',
  },
  {
    id: 'cert_006',
    name: 'NEBOSH IGC',
    issuingBody: 'National Examination Board in OSH',
    certNumber: 'NEBOSH-IGC-2021-55123',
    issueDate: '2021-11-20',
    expiryDate: '2024-11-20',
    status: 'expired',
    category: 'safety',
  },
  {
    id: 'cert_007',
    name: 'AWS CWI',
    issuingBody: 'American Welding Society',
    certNumber: 'AWS-CWI-2024-99887',
    issueDate: '2024-08-01',
    expiryDate: '2027-08-01',
    status: 'not_submitted',
    category: 'welding',
  },
];

interface UseCertStoreReturn {
  certificates: Certificate[];
  filteredCerts: Certificate[];
  activeFilter: CertVerificationStatus | 'all';
  setActiveFilter: (filter: CertVerificationStatus | 'all') => void;
  isVerified: (cert: Certificate) => boolean;
  isCertExpired: (cert: Certificate) => boolean;
  getDaysUntilExpiry: (cert: Certificate) => number;
  stats: {
    total: number;
    verified: number;
    pending: number;
    expired: number;
    notSubmitted: number;
  };
}

export function useCertStore(): UseCertStoreReturn {
  const [certificates] = useState<Certificate[]>(MOCK_CERTIFICATES);
  const [activeFilter, setActiveFilter] = useState<
    CertVerificationStatus | 'all'
  >('all');

  const isVerified = useCallback(
    (cert: Certificate) => cert.status === 'verified_by_admin',
    []
  );

  const isCertExpired = useCallback((cert: Certificate) => {
    return new Date(cert.expiryDate).getTime() < Date.now();
  }, []);

  const getDaysUntilExpiry = useCallback((cert: Certificate) => {
    const expiry = new Date(cert.expiryDate).getTime();
    return Math.floor((expiry - Date.now()) / (1000 * 60 * 60 * 24));
  }, []);

  const stats = useMemo(() => {
    let verified = 0;
    let pending = 0;
    let expired = 0;
    let notSubmitted = 0;
    certificates.forEach((c) => {
      if (c.status === 'verified_by_admin') verified++;
      else if (c.status === 'pending_review') pending++;
      else if (c.status === 'expired') expired++;
      else if (c.status === 'not_submitted') notSubmitted++;
    });
    return { total: certificates.length, verified, pending, expired, notSubmitted };
  }, [certificates]);

  const filteredCerts = useMemo(() => {
    if (activeFilter === 'all') return certificates;
    return certificates.filter((c) => c.status === activeFilter);
  }, [certificates, activeFilter]);

  return {
    certificates,
    filteredCerts,
    activeFilter,
    setActiveFilter,
    isVerified,
    isCertExpired,
    getDaysUntilExpiry,
    stats,
  };
}