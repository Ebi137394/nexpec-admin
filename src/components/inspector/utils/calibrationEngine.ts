import { CalibrationStatus, EquipmentItem } from '../types/inspectorTools.types';

const WARNING_THRESHOLD_DAYS = 30; // warn 30 days before expiry

/**
 * Pure function: compute calibration status from an equipment item
 */
export function getCalibrationStatus(item: EquipmentItem): CalibrationStatus {
  const calibDate = new Date(item.calibrationDate);
  const expiryDate = new Date(
    calibDate.getTime() + item.calibrationDueDays * 24 * 60 * 60 * 1000
  );
  const now = new Date();
  const daysRemaining = Math.floor(
    (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= WARNING_THRESHOLD_DAYS) return 'expiring_soon';
  return 'valid';
}

/**
 * Get days until calibration expires (negative = overdue)
 */
export function getDaysUntilExpiry(item: EquipmentItem): number {
  const calibDate = new Date(item.calibrationDate);
  const expiryDate = new Date(
    calibDate.getTime() + item.calibrationDueDays * 24 * 60 * 60 * 1000
  );
  const now = new Date();
  return Math.floor(
    (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
}

/**
 * Format a calibration expiry date from equipment data
 */
export function getExpiryDateFormatted(item: EquipmentItem): string {
  const calibDate = new Date(item.calibrationDate);
  const expiryDate = new Date(
    calibDate.getTime() + item.calibrationDueDays * 24 * 60 * 60 * 1000
  );
  return expiryDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Can this equipment be used in official reports?
 */
export function isEquipmentUsable(item: EquipmentItem): boolean {
  return item.isActive && getCalibrationStatus(item) !== 'expired';
}

/**
 * Get human-readable status label
 */
export function getStatusLabel(status: CalibrationStatus): string {
  switch (status) {
    case 'valid':
      return 'Calibration Valid';
    case 'expiring_soon':
      return 'Calibration Expiring Soon';
    case 'expired':
      return 'Calibration Expired';
  }
}

/**
 * Mock professional summaries for voice drafter simulation
 */
export const MOCK_TRANSCRIPTIONS: Record<string, string[]> = {
  general: [
    'Visual inspection of the vessel shell revealed no visible signs of external corrosion, pitting, or mechanical damage. All nozzle connections appear intact with no evidence of leakage or flange distortion. Insulation jacketing is in satisfactory condition with no moisture ingress points identified.',
    'Ultrasonic thickness measurements were obtained at twelve predetermined CML locations on the lower shell course. Readings ranged from 0.485" to 0.512" against a nominal wall thickness of 0.500". No readings fell below the required minimum thickness of 0.450" per API 653 calculations.',
    'Internal inspection of the tank floor revealed generalized corrosion on approximately 15% of the floor area, concentrated near the sump region. Maximum pit depth measured 0.095" using a calibrated pit gauge. Recommend continued monitoring at 2-year intervals per API 653 Section 6.3.2.',
    'Weld inspection of the shell-to-bottom junction was performed using MPI. No rejectable indications were detected per ASME Section V, Article 7. All examined welds exhibited acceptable profile and surface condition.',
    'Coating inspection of the tank interior revealed DFT readings between 8.2 and 12.5 mils, within the specified range of 8-14 mils per project specification. Holiday testing at 1500V detected no discontinuities. Coating system is performing satisfactorily.',
  ],
  thickness: [
    'Thickness measurement survey completed using Olympus 38DL Plus ultrasonic gauge (S/N: 45892). Contact method with D797 transducer at 5MHz. Couplant: glycerin gel. Surface preparation: wire brush to SA-2 equivalent. All readings taken at ambient temperature of 32°C with no temperature compensation required.',
  ],
  corrosion: [
    'Corrosion mapping performed on the lower 12 inches of shell course 1. Corrosion rate calculated at 0.005 inches per year based on previous inspection data from 2021. Remaining life estimated at 7.0 years at current corrosion rate. Next inspection recommended no later than January 2028.',
  ],
};