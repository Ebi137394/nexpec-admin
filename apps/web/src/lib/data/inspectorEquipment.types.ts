// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorEquipment.types.ts
// ════════════════════════════════════════════════════════════════════════════

export interface InspectorEquipment {
  id: string;
  name: string;
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  lastCalibrationAt: string | null;        // ISO date
  nextCalibrationDue: string | null;       // ISO date
  calibrationCertificateUrl: string | null;
  calibrationCertificatePath: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
