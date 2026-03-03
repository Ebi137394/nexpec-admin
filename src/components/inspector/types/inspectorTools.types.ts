// ─── Voice Drafter ───
export type VoiceDrafterState =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'completed'
  | 'error';

export interface VoiceDraftResult {
  id: string;
  rawDuration: number;        // seconds recorded
  transcribedText: string;
  confidence: number;          // 0-1
  timestamp: number;
  fieldTarget?: string;        // which form field to auto-fill
}

export interface VoiceDrafterProps {
  /** Which form field this drafter targets */
  targetFieldId?: string;
  /** Callback when transcription is ready */
  onTranscriptionReady: (result: VoiceDraftResult) => void;
  /** Optional: position override */
  position?: { bottom: number; right: number };
  /** Disable the button externally */
  disabled?: boolean;
}

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