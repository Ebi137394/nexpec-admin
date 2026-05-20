// VoiceDrafter types (VoiceDrafterState / VoiceDraftResult / VoiceDrafterProps)
// were removed 2026-05-20 along with the VoiceDrafter component and the
// useVoiceRecorder hook. No remaining consumers.

// ─── Equipment Wallet ───
export type CalibrationStatus = 'valid' | 'expiring_soon' | 'expired';

export interface EquipmentItem {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  category: EquipmentCategory;
  icon: string;
  calibrationDate: string;      // ISO date of last calibration
  calibrationDueDays: number;   // how many days calibration is valid
  calibrationCertId?: string;
  isActive: boolean;
  lastUsedInReport?: string;
  notes?: string;
}

export type EquipmentCategory =
  | 'thickness_gauge'
  | 'ultrasonic'
  | 'mpi'
  | 'dye_penetrant'
  | 'hardness_tester'
  | 'holiday_detector'
  | 'measurement'
  | 'visual'
  | 'other';

export interface EquipmentWalletProps {
  inspectorId: string;
  /** Called when equipment is toggled for use in current report */
  onEquipmentToggle?: (equipmentId: string, usable: boolean) => void;
  /** Called when user wants to update calibration */
  onRecalibrateRequest?: (equipment: EquipmentItem) => void;
}

// ─── Cert Wallet ───
export type CertVerificationStatus =
  | 'verified_by_admin'
  | 'pending_review'
  | 'rejected'
  | 'expired'
  | 'not_submitted';

export interface Certificate {
  id: string;
  name: string;                   // "API-653", "NACE CIP Level 2"
  issuingBody: string;            // "American Petroleum Institute"
  certNumber: string;
  issueDate: string;              // ISO
  expiryDate: string;             // ISO
  status: CertVerificationStatus;
  documentUri?: string;           // local file path to scanned cert
  category: CertCategory;
  adminVerifiedAt?: string;
  adminNotes?: string;
}

export type CertCategory =
  | 'inspection'
  | 'corrosion'
  | 'welding'
  | 'ndt'
  | 'safety'
  | 'coating'
  | 'other';

export interface CertWalletProps {
  inspectorId: string;
  onCertPress?: (cert: Certificate) => void;
  onUploadRequest?: (certId: string) => void;
}